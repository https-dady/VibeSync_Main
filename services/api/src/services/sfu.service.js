'use strict';
const { RoomServiceClient, TrackSource, WebhookReceiver } = require('livekit-server-sdk');
const config = require('../config/env');
const Room = require('../models/Room');
const RoomMember = require('../models/RoomMember');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
let client;
let healthy = true;
let receiver;
function service() {
  if (!client) client = new RoomServiceClient(config.LIVEKIT_URL.replace(/^ws/, 'http'), config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, { requestTimeout: 8 });
  return client;
}
const name = (room) => `vibesync:${room.roomId}`;
function absent(error) { return error.status === 404 || error.statusCode === 404 || error.code === 'not_found'; }

async function webhook(req, res, next) {
  try {
    if (!config.livekitEnabled) throw ApiError.notFound('LiveKit is not configured', 'LIVEKIT_DISABLED');
    if (!Buffer.isBuffer(req.body)) throw ApiError.badRequest('Webhook requires its original JSON body', 'INVALID_WEBHOOK');
    if (!receiver) receiver = new WebhookReceiver(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);
    let event;
    try { event = await receiver.receive(req.body.toString('utf8'), req.get('authorization')); }
    catch { throw ApiError.unauthorized('Webhook signature or body hash is invalid', 'INVALID_WEBHOOK_SIGNATURE'); }
    if (event.event === 'participant_joined' && event.room?.name?.startsWith('vibesync:') && event.participant) {
      const room = await Room.findOne({ roomId: event.room.name.slice(9) });
      if (!room || room.status !== 'active') await service().removeParticipant(event.room.name, event.participant.identity, { revokeTokenTs: BigInt(Math.floor(Date.now() / 1000) + 1) });
      else if (/^[a-f0-9]{24}$/i.test(event.participant.identity)) {
        const member = await RoomMember.findOne({ room: room._id, user: event.participant.identity });
        if (!member || member.status !== 'active') await removeParticipant(room, event.participant.identity, member?.sfuTokenNotBefore);
        else await enforceMember(room, member);
      } else await service().removeParticipant(event.room.name, event.participant.identity);
    }
    res.status(204).end();
  } catch (error) { next(error); }
}

async function removeParticipant(room, userId, cutoff = Math.floor(Date.now() / 1000) + 1) {
  if (!config.livekitEnabled) return;
  try {
    await service().removeParticipant(name(room), String(userId), { revokeTokenTs: BigInt(cutoff) });
    healthy = true;
  } catch (error) {
    if (absent(error)) return;
    healthy = false;
    logger.error({ err: error, roomId: room.roomId, userId: String(userId) }, 'SFU revocation failed');
    const failure = new ApiError(503, 'SFU_ENFORCEMENT_FAILED', 'Voice server could not confirm access revocation; retry moderation');
    failure.expose = true; throw failure;
  }
}

async function enforceMember(room, member, revoke = false) {
  if (!config.livekitEnabled) return;
  const userId = member.user?._id || member.user;
  const canPublish = member.status === 'active' && member.permissions.canSpeak && !member.permissions.mutedByHost;
  if (room.status !== 'active' || member.status !== 'active' || !canPublish && revoke) return removeParticipant(room, userId, member.sfuTokenNotBefore || undefined);
  try {
    await service().updateParticipant(name(room), String(userId), { permission: {
      canPublish: Boolean(canPublish), canPublishSources: canPublish ? [TrackSource.MICROPHONE] : [], canSubscribe: true, canPublishData: false,
    } });
    healthy = true;
  } catch (error) {
    if (absent(error)) return;
    healthy = false;
    logger.error({ err: error, roomId: room.roomId }, 'SFU permission update failed');
    const failure = new ApiError(503, 'SFU_ENFORCEMENT_FAILED', 'Voice permission update could not be confirmed; retry');
    failure.expose = true; throw failure;
  }
}

async function closeRoom(room) {
  if (!config.livekitEnabled) return;
  try { await service().deleteRoom(name(room)); healthy = true; }
  catch (error) {
    if (absent(error)) return;
    healthy = false; logger.error({ err: error, roomId: room.roomId }, 'SFU room cleanup failed');
    const failure = new ApiError(503, 'SFU_ENFORCEMENT_FAILED', 'Voice room cleanup could not be confirmed; retry');
    failure.expose = true; throw failure;
  }
}

function startReconciliation() {
  if (!config.livekitEnabled) return () => {};
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const rooms = await service().listRooms();
      for (const remote of rooms) {
        if (!remote.name.startsWith('vibesync:')) continue;
        const room = await Room.findOne({ roomId: remote.name.slice(9) });
        if (!room || room.status !== 'active') { await service().deleteRoom(remote.name); continue; }
        const peers = await service().listParticipants(remote.name);
        for (const peer of peers) {
          if (!/^[a-f0-9]{24}$/i.test(peer.identity)) { await service().removeParticipant(remote.name, peer.identity); continue; }
          const member = await RoomMember.findOne({ room: room._id, user: peer.identity });
          if (!member || member.status !== 'active') await removeParticipant(room, peer.identity, member?.sfuTokenNotBefore);
          else {
            const allowed = Boolean(member.permissions.canSpeak && !member.permissions.mutedByHost);
            if (Boolean(peer.permission?.canPublish) !== allowed) {
              if (!allowed) await removeParticipant(room, peer.identity, member.sfuTokenNotBefore);
              else await enforceMember(room, member);
            }
          }
        }
      }
      healthy = true;
    } catch (error) { healthy = false; logger.error({ err: error }, 'SFU permission reconciliation failed'); }
    finally { running = false; }
  }, 5000);
  timer.unref();
  return () => clearInterval(timer);
}
module.exports = { removeParticipant, enforceMember, closeRoom, startReconciliation, webhook, isHealthy: () => !config.livekitEnabled || healthy };
