'use strict';

const config = require('../config/env');
const ApiError = require('../utils/ApiError');
const Room = require('../models/Room');
const RoomMember = require('../models/RoomMember');

const VALID_TYPES = new Set(['offer', 'answer', 'ice-candidate', 'renegotiate', 'bye']);

function sanitizeSignal(data) {
  if (!data || typeof data !== 'object') {
    throw ApiError.badRequest('Signal payload required', 'INVALID_SIGNAL');
  }
  const type = data.type;
  if (!VALID_TYPES.has(type)) throw ApiError.badRequest('Unsupported signal type', 'INVALID_SIGNAL');
  const serialized = JSON.stringify(data);
  if (Buffer.byteLength(serialized) > 64 * 1024) {
    throw ApiError.badRequest('Signal payload too large', 'INVALID_SIGNAL');
  }
  return { type, sdp: data.sdp || null, candidate: data.candidate || null, sessionId: data.sessionId || null };
}

function turnCredentials(userId) {
  if (config.TURN_SECRET) {
    // coturn REST API ephemeral credentials (RFC 5766 long-term credentials).
    const username = `${Math.floor(Date.now() / 1000) + config.TURN_TTL_SECONDS}:${userId}`;
    const credential = require('node:crypto')
      .createHmac('sha1', config.TURN_SECRET)
      .update(username)
      .digest('base64');
    return { username, credential };
  }
  return {
    username: config.TURN_USERNAME || undefined,
    credential: config.TURN_CREDENTIAL || undefined,
  };
}

function iceServers(userId) {
  const servers = [{ urls: config.stunUrls }];
  if (config.TURN_URL) {
    const { username, credential } = turnCredentials(userId);
    servers.push({
      urls: config.TURN_URL.split(',').map((url) => url.trim()).filter(Boolean),
      username,
      credential,
    });
  }
  return {
    iceServers: servers,
    voiceTransport: config.livekitEnabled ? 'livekit' : 'mesh',
    sfuTokenEndpointConfigured: config.livekitEnabled,
    userId,
  };
}

async function livekitTokenFor(room, member, user) {
  if (!config.livekitEnabled) {
    throw ApiError.notFound('LiveKit is not configured', 'LIVEKIT_DISABLED');
  }
  // Lazy require keeps LiveKit an optional dependency until configured.
  let AccessToken;
  let TrackSource;
  try {
    ({ AccessToken, TrackSource } = require('livekit-server-sdk'));
  } catch {
    throw ApiError.internal('LiveKit SDK is not installed on the server');
  }
  if (room.status !== 'active') throw ApiError.conflict('Room has ended', 'ROOM_ENDED');
  const wait = Math.max(0, (member.sfuTokenNotBefore || 0) * 1000 - Date.now());
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 1500)));
  // A grant can change while waiting for a revocation cutoff. Never mint a
  // token from permissions read before that wait.
  member = await RoomMember.findOne({ room: room._id, user: user._id, status: 'active' });
  room = await Room.findOne({ _id: room._id, status: 'active' });
  if (!member || !room) throw ApiError.forbidden('Room access has changed', 'NOT_A_MEMBER');
  const canPublish = Boolean(member.permissions.canSpeak && !member.permissions.mutedByHost);
  const token = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, {
    identity: String(user._id),
    name: user.name,
    ttl: '60s',
    metadata: JSON.stringify({ roomId: room.roomId, role: member.role }),
  });
  token.addGrant({
    roomJoin: true,
    room: `vibesync:${room.roomId}`,
    canPublish,
    canPublishSources: canPublish ? [TrackSource.MICROPHONE] : [],
    canPublishData: false,
    canSubscribe: true,
    roomAdmin: false,
  });
  return {
    token: await token.toJwt(),
    url: config.LIVEKIT_URL,
    roomName: `vibesync:${room.roomId}`,
    canPublish,
  };
}

module.exports = { sanitizeSignal, iceServers, livekitTokenFor };
