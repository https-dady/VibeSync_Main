'use strict';

const Room = require('../models/Room');
const MediaAsset = require('../models/MediaAsset');
const ApiError = require('../utils/ApiError');
const { atomic, publish, afterCommit } = require('../utils/transaction');
const RoomMember = require('../models/RoomMember');
const { getRedis } = require('../config/redis');

const CACHE_TTL_SECONDS = 60 * 60 * 12;
const MAX_POSITION_MS = 24 * 60 * 60 * 1000;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function computedPosition(playback, durationMs, now = Date.now()) {
  const base = Math.max(0, Number(playback.positionMs) || 0);
  const rate = clamp(Number(playback.rate) || 1, 0.25, 3);
  const updated = new Date(playback.updatedAt || now).getTime();
  const elapsed = playback.status === 'playing' ? Math.max(0, now - updated) * rate : 0;
  const position = base + elapsed;
  return clamp(durationMs > 0 ? Math.min(position, durationMs) : position, 0, MAX_POSITION_MS);
}

function presentPlayback(room, media, now = Date.now()) {
  const playback = room.playback || {};
  const durationMs = media?.durationMs || 0;
  return {
    roomId: room.roomId,
    mediaId: playback.media ? String(playback.media._id || playback.media) : null,
    media: media ? media.toPublicJSON() : null,
    status: playback.status || 'idle',
    positionMs: Math.max(0, Number(playback.positionMs) || 0),
    computedPositionMs: computedPosition(playback, durationMs, now),
    durationMs,
    rate: clamp(Number(playback.rate) || 1, 0.25, 3),
    updatedAt: new Date(playback.updatedAt || now).toISOString(),
    updatedBy: playback.updatedBy ? String(playback.updatedBy) : null,
    sequence: Number(playback.sequence) || 0,
    serverTime: now,
    startAtServerMs: playback.startAtServerMs || null,
  };
}

async function loadMedia(room, mediaId) {
  if (!mediaId) return null;
  const media = await MediaAsset.findOne({ _id: mediaId, room: room._id, deletedAt: null });
  if (!media) throw ApiError.badRequest('Media not found in this room', 'MEDIA_NOT_FOUND');
  return media;
}

async function cacheState(room, media, payload) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.setEx(
      `vibesync:playback:${room.roomId}`,
      CACHE_TTL_SECONDS,
      JSON.stringify({ payload, durationMs: media?.durationMs || 0 }),
    );
  } catch {
    // Playback authority remains Mongo-backed; cache failure must not fail control.
  }
}

async function invalidateCache(roomId) {
  const redis = getRedis();
  if (redis) await redis.del(`vibesync:playback:${roomId}`).catch(() => {});
}

async function getPlayback(room) {
  const media = room.playback?.media ? await loadMedia(room, room.playback.media) : null;
  const payload = presentPlayback(room, media);
  await cacheState(room, media, payload);
  return payload;
}

async function getPlaybackByRoomCode(roomId) {
  const room = await Room.findByRoomId(roomId);
  if (!room) throw ApiError.notFound('Room not found', 'ROOM_NOT_FOUND');
  return getPlayback(room);
}

function normalizePosition(value, durationMs) {
  const position = Number(value);
  if (!Number.isFinite(position) || position < 0) {
    throw ApiError.badRequest('positionMs must be a non-negative number', 'INVALID_POSITION');
  }
  return durationMs > 0 ? Math.min(position, durationMs) : Math.min(position, MAX_POSITION_MS);
}

async function applyHostCommand(room, userId, command) {
  if (room.status !== 'active') throw ApiError.conflict('Room has ended', 'ROOM_ENDED');
  if (room.host.toString() !== String(userId)) {
    throw ApiError.forbidden('Only the host can control playback', 'HOST_ONLY');
  }
  if (!(await RoomMember.exists({ room: room._id, user: userId, status: 'active', role: 'host' }))) {
    throw ApiError.forbidden('Host membership is no longer active', 'HOST_ONLY');
  }
  if (command.expectedSequence !== undefined && command.expectedSequence !== room.playback.sequence) {
    throw ApiError.conflict('Playback changed; refresh its state before retrying', 'STALE_PLAYBACK');
  }
  if (command.action === 'heartbeat' && command.sequence !== undefined && command.sequence !== room.playback.sequence) {
    throw ApiError.conflict('Ignoring an outdated playback heartbeat', 'STALE_PLAYBACK');
  }

  const playback = room.playback || {};
  const now = new Date();
  const previousMediaId = playback.media ? String(playback.media) : null;
  let media = previousMediaId ? await loadMedia(room, previousMediaId) : null;
  const duration = media?.durationMs || 0;
  const anchor = computedPosition(playback, duration, now.getTime());
  playback.startAtServerMs = null;

  switch (command.action) {
    case 'play': {
      if (!media) throw ApiError.badRequest('Select media before playing', 'NO_MEDIA');
      playback.status = 'playing';
      playback.positionMs =
        command.positionMs !== undefined ? normalizePosition(command.positionMs, duration) : anchor;
      if (command.startAtServerMs !== undefined) {
        if (command.startAtServerMs < now.getTime() - 500 || command.startAtServerMs > now.getTime() + 3000) {
          throw ApiError.badRequest('Scheduled starts must be within the next three seconds', 'INVALID_START_TIME');
        }
        playback.startAtServerMs = Math.max(now.getTime(), command.startAtServerMs);
      }
      break;
    }
    case 'pause': {
      playback.status = 'paused';
      playback.positionMs =
        command.positionMs !== undefined ? normalizePosition(command.positionMs, duration) : anchor;
      break;
    }
    case 'seek': {
      if (command.positionMs === undefined) {
        throw ApiError.badRequest('positionMs is required for seek', 'INVALID_POSITION');
      }
      playback.positionMs = normalizePosition(command.positionMs, duration);
      if (playback.status === 'ended') playback.status = 'paused';
      break;
    }
    case 'setMedia': {
      const selected = await loadMedia(room, command.mediaId);
      media = selected;
      playback.media = selected._id;
      playback.status = 'paused';
      playback.positionMs = 0;
      playback.rate = 1;
      break;
    }
    case 'setRate': {
      const rate = Number(command.rate);
      if (!Number.isFinite(rate) || rate < 0.25 || rate > 3) {
        throw ApiError.badRequest('Playback rate must be between 0.25 and 3', 'INVALID_RATE');
      }
      playback.rate = rate;
      playback.positionMs = anchor;
      break;
    }
    case 'ended': {
      playback.status = 'ended';
      playback.positionMs = duration || anchor;
      break;
    }
    case 'heartbeat': {
      // Host playback clock is the media source of truth. The server anchors it
      // to server time so late joiners and reconnecting clients converge.
      if (command.positionMs === undefined) {
        throw ApiError.badRequest('positionMs is required for heartbeat', 'INVALID_POSITION');
      }
      playback.positionMs = normalizePosition(command.positionMs, duration);
      if (media && duration && playback.positionMs >= duration - 250) {
        playback.status = 'ended';
      }
      break;
    }
    default:
      throw ApiError.badRequest('Unsupported playback action', 'INVALID_ACTION');
  }

  playback.updatedAt = new Date(playback.startAtServerMs || now.getTime());
  playback.updatedBy = userId;
  playback.sequence = (Number(playback.sequence) || 0) + 1;
  playback.rate = clamp(Number(playback.rate) || 1, 0.25, 3);
  room.playback = playback;
  room.lastActivityAt = now;
  await room.save();

  const payload = presentPlayback(room, media, now.getTime());
  afterCommit(() => cacheState(room, media, payload));
  publish('playback.updated', { room, playback: payload, action: command.action });
  return payload;
}

async function hostHeartbeat(room, userId, positionMs, sequence) {
  if (room.host.toString() !== String(userId)) {
    throw ApiError.forbidden('Only the host can report playback position', 'HOST_ONLY');
  }
  if (room.playback.status !== 'playing') return getPlayback(room);
  return applyHostCommand(room, userId, { action: 'heartbeat', positionMs, sequence });
}

async function resetPlaybackForMedia(room, mediaId) {
  if (String(room.playback?.media || '') !== String(mediaId)) return;
  room.playback.media = null;
  room.playback.status = 'idle';
  room.playback.positionMs = 0;
  room.playback.sequence += 1;
  room.playback.updatedAt = new Date();
  await room.save();
  afterCommit(() => invalidateCache(room.roomId));
  publish('playback.updated', { room, playback: presentPlayback(room, null), action: 'mediaRemoved' });
}

module.exports = {
  presentPlayback,
  computedPosition,
  getPlayback,
  getPlaybackByRoomCode,
  applyHostCommand: atomic(applyHostCommand),
  hostHeartbeat: atomic(hostHeartbeat),
  resetPlaybackForMedia: atomic(resetPlaybackForMedia),
  invalidateCache,
};
