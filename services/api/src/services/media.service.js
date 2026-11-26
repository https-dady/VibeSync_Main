'use strict';

const fs = require('node:fs/promises');
const Room = require('../models/Room');
const MediaAsset = require('../models/MediaAsset');
const config = require('../config/env');
const ApiError = require('../utils/ApiError');
const { publish, afterCommit } = require('../utils/transaction');
const { activeMemberOrThrow, hostMemberOrThrow } = require('./room.service');
const { mediaKind } = require('../middleware/upload');
const { resetPlaybackForMedia } = require('./playback.service');
const { validateUrl, resolveMediaSource } = require('./mediaProviders');
const storage = require('./mediaStorage');
const { atomic } = require('../utils/transaction');

function validateExternalUrl(value) {
  return validateUrl(value).toString();
}

function validateDrm(input) {
  const scheme = String(input.drmScheme || '').toLowerCase();
  const licenseUrl = String(input.drmLicenseUrl || '').trim();
  if (!scheme && !licenseUrl) return { drmScheme: '', drmLicenseUrl: '' };
  if (!scheme) {
    throw ApiError.badRequest(
      'Choose a DRM scheme before adding a license URL',
      'DRM_SCHEME_REQUIRED',
    );
  }
  if (!licenseUrl) {
    throw ApiError.badRequest(
      'A DRM license URL is required for DRM-protected media',
      'DRM_LICENSE_REQUIRED',
    );
  }
  let parsed;
  try {
    parsed = new URL(licenseUrl);
  } catch {
    throw ApiError.badRequest('DRM license URL is not valid', 'INVALID_DRM_LICENSE_URL');
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw ApiError.badRequest(
      'DRM license URLs must use HTTP(S)',
      'INVALID_DRM_LICENSE_URL',
    );
  }
  if (parsed.username || parsed.password) {
    throw ApiError.badRequest(
      'Credentials must not be embedded in DRM license URLs',
      'INVALID_DRM_LICENSE_URL',
    );
  }
  if (config.isProduction && parsed.protocol !== 'https:') {
    throw ApiError.badRequest(
      'Production DRM license URLs must use HTTPS',
      'INSECURE_DRM_LICENSE_URL',
    );
  }
  if (scheme === 'fairplay' && (!input.drmCertificateUrl || !input.drmContentId)) {
    throw ApiError.badRequest('FairPlay requires an authorized certificate URL and content identifier', 'FAIRPLAY_CONFIGURATION_REQUIRED');
  }
  return { drmScheme: scheme, drmLicenseUrl: validateExternalUrl(parsed.toString()),
    drmCertificateUrl: scheme === 'fairplay' ? validateExternalUrl(input.drmCertificateUrl) : '',
    drmContentId: scheme === 'fairplay' ? input.drmContentId : '' };
}

async function validateFileSignature(file) {
  const handle = await fs.open(file.path, 'r');
  try {
    const header = Buffer.alloc(64);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const text = header.toString('latin1');
    const mp4 = text.slice(4, 8) === 'ftyp';
    const ebml = header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    const valid = {
      'audio/mpeg': text.startsWith('ID3') || header[0] === 0xff && (header[1] & 0xe0) === 0xe0,
      'audio/aac': header[0] === 0xff && (header[1] & 0xf6) === 0xf0,
      'audio/mp4': mp4, 'video/mp4': mp4, 'video/quicktime': mp4 || ['moov', 'mdat', 'wide'].includes(text.slice(4, 8)),
      'audio/ogg': text.startsWith('OggS'), 'video/ogg': text.startsWith('OggS'),
      'audio/wav': text.startsWith('RIFF') && text.slice(8, 12) === 'WAVE',
      'audio/x-wav': text.startsWith('RIFF') && text.slice(8, 12) === 'WAVE',
      'audio/flac': text.startsWith('fLaC'), 'audio/x-flac': text.startsWith('fLaC'),
      'audio/webm': ebml, 'video/webm': ebml, 'video/x-matroska': ebml,
      'video/mpeg': header[0] === 0 && header[1] === 0 && header[2] === 1,
    };
    if (!bytesRead || !valid[file.mimetype]) throw ApiError.badRequest('File content does not match its declared media format', 'INVALID_MEDIA_CONTENT');
  } finally { await handle.close(); }
}

async function addUploadedMedia(room, userId, file, input) {
  await hostMemberOrThrow(room, userId);
  if (room.status !== 'active') throw ApiError.conflict('Room has ended', 'ROOM_ENDED');
  const kind = mediaKind(file.mimetype);
  if (!kind) throw ApiError.badRequest('Unsupported media file', 'UNSUPPORTED_MEDIA');
  if (input.mediaType && input.mediaType !== kind) {
    throw ApiError.badRequest('Uploaded file does not match the requested media type', 'MEDIA_TYPE_MISMATCH');
  }
  await validateFileSignature(file);
  const descriptor = await storage.store(file, room._id);
  let media;
  try {
    media = await atomic(async (freshRoom) => {
      await hostMemberOrThrow(freshRoom, userId);
      if (freshRoom.status !== 'active') throw ApiError.conflict('Room has ended', 'ROOM_ENDED');
      await Room.updateOne({ _id: freshRoom._id }, { $set: { lastActivityAt: new Date() } });
      return MediaAsset.create({
    room: room._id,
    owner: userId,
    title: input.title || file.originalname,
    artist: input.artist || '',
    type: kind,
    source: 'upload',
    ...descriptor,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    durationMs: Math.max(0, Number(input.durationMs) || 0),
      });
    })(room);
  } catch (error) { await storage.remove(descriptor).catch(() => {}); throw error; }
  if (descriptor.storageDriver === 's3') await fs.unlink(file.path).catch(() => {});
  publish('media.added', { room, media });
  return media;
}

async function addUrlMedia(room, userId, input) {
  await hostMemberOrThrow(room, userId);
  if (room.status !== 'active') throw ApiError.conflict('Room has ended', 'ROOM_ENDED');
  await Room.updateOne({ _id: room._id }, { $set: { lastActivityAt: new Date() } });
  const drm = validateDrm(input);
  const resolved = resolveMediaSource(input);
  const media = await MediaAsset.create({
    room: room._id,
    owner: userId,
    title: input.title,
    artist: input.artist || '',
    type: input.type,
    source: 'url',
    url: resolved.url,
    mimeType: resolved.mimeType,
    durationMs: Math.max(0, Number(input.durationMs) || 0),
    provider: resolved.provider,
    playbackCapabilities: resolved.playbackCapabilities,
    ...drm,
  });
  publish('media.added', { room, media });
  return media;
}

async function listMedia(room, userId) {
  await activeMemberOrThrow(room, userId);
  const media = await MediaAsset.find({ room: room._id, deletedAt: null })
    .sort({ createdAt: -1 })
    .limit(100);
  return media.map((item) => item.toPublicJSON());
}

async function getAuthorizedMedia(room, userId, mediaId) {
  await activeMemberOrThrow(room, userId);
  const media = await MediaAsset.findOne({
    _id: mediaId,
    room: room._id,
    deletedAt: null,
  }).select('+storageKey');
  if (!media) throw ApiError.notFound('Media not found', 'MEDIA_NOT_FOUND');
  return media;
}

async function deleteMedia(room, userId, mediaId) {
  await hostMemberOrThrow(room, userId);
  const media = await MediaAsset.findOne({
    _id: mediaId,
    room: room._id,
  }).select('+storageKey');
  if (!media) throw ApiError.notFound('Media not found', 'MEDIA_NOT_FOUND');
  media.deletedAt = new Date();
  await media.save();
  await resetPlaybackForMedia(room, media._id);
  if (media.source === 'upload' && media.storageKey) {
    afterCommit(() => storage.remove(media));
  }
  publish('media.removed', { room, mediaId: media._id.toString() });
  return true;
}

function absoluteMediaPath(media) {
  if (!media.storageKey) return null;
  return media.storageDriver === 's3' ? null : storage.localPath(media.storageKey);
}

module.exports = {
  addUploadedMedia,
  addUrlMedia: atomic(addUrlMedia),
  listMedia,
  getAuthorizedMedia,
  deleteMedia: atomic(deleteMedia),
  absoluteMediaPath,
  validateExternalUrl,
};
