'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const config = require('../config/env');
const ApiError = require('../utils/ApiError');

const AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/flac',
  'audio/x-flac',
]);

const VIDEO_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'video/ogg',
  'video/mpeg',
]);

function ensureUploadDir() {
  fs.mkdirSync(config.MEDIA_STORAGE_DIR, { recursive: true });
}

function extensionFor(mimetype, originalname) {
  const known = {
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/aac': '.aac',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/webm': '.weba',
    'audio/flac': '.flac',
    'audio/x-flac': '.flac',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm',
    'video/x-matroska': '.mkv',
    'video/ogg': '.ogv',
    'video/mpeg': '.mpeg',
  };
  return known[mimetype] || path.extname(originalname || '').toLowerCase().slice(0, 8) || '.bin';
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureUploadDir();
    cb(null, config.MEDIA_STORAGE_DIR);
  },
  filename: (req, file, cb) => {
    const key = `${Date.now()}-${crypto.randomUUID()}${extensionFor(file.mimetype, file.originalname)}`;
    cb(null, key);
  },
});

const mediaUpload = multer({
  storage,
  limits: { fileSize: config.uploadMaxBytes, files: 1, fields: 20 },
  fileFilter: (req, file, cb) => {
    if (!AUDIO_TYPES.has(file.mimetype) && !VIDEO_TYPES.has(file.mimetype)) {
      return cb(ApiError.badRequest('Only supported audio and video files may be uploaded', 'UNSUPPORTED_MEDIA'));
    }
    return cb(null, true);
  },
});

function mediaKind(mimetype) {
  if (AUDIO_TYPES.has(mimetype)) return 'audio';
  if (VIDEO_TYPES.has(mimetype)) return 'video';
  return null;
}

module.exports = { mediaUpload, mediaKind, ensureUploadDir, AUDIO_TYPES, VIDEO_TYPES };
