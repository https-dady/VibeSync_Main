'use strict';

const { trusted } = require('mongoose');
const SpeakRequest = require('../models/SpeakRequest');
const RoomMember = require('../models/RoomMember');
const ApiError = require('../utils/ApiError');
const { atomic, publish, afterCommit } = require('../utils/transaction');
const sfu = require('./sfu.service');
const { createNotification } = require('./notification.service');
const {
  activeMemberOrThrow,
  hostMemberOrThrow,
  updateMemberPermissions,
} = require('./room.service');

async function requestToSpeak(room, userId, note = '') {
  if (room.status !== 'active') throw ApiError.conflict('Room has ended', 'ROOM_ENDED');
  if (!room.allowMicRequests) throw ApiError.forbidden('Microphone requests are disabled', 'MIC_DISABLED');
  const member = await activeMemberOrThrow(room, userId);
  if (member.role === 'host' || member.permissions.canSpeak) {
    return { status: 'approved', request: null };
  }
  const existing = await SpeakRequest.findOne({
    room: room._id,
    user: userId,
    status: 'pending',
  });
  if (existing) return { status: 'pending', request: existing };

  const request = await SpeakRequest.create({
    room: room._id,
    user: userId,
    note: String(note || '').slice(0, 200),
  });
  member.permissions.micRequested = true;
  await member.save();
  await member.populate('user', 'name avatarColor');
  const notification = await createNotification(room.host, {
    type: 'speak_request',
    title: 'Microphone request',
    body: `${member.user.name} requested to speak`,
    data: { roomId: room.roomId, requestId: request._id.toString() },
  });
  publish('speak.requested', { room, request, member, notification });
  return { status: 'pending', request };
}

async function decideSpeakRequest(room, hostId, requestId, decision) {
  await hostMemberOrThrow(room, hostId);
  if (!['approve', 'reject'].includes(decision)) {
    throw ApiError.badRequest('Decision must be approve or reject', 'INVALID_DECISION');
  }
  const request = await SpeakRequest.findOne({
    _id: requestId,
    room: room._id,
    status: 'pending',
  });
  if (!request) throw ApiError.notFound('Pending microphone request not found', 'REQUEST_NOT_FOUND');
  const member = await activeMemberOrThrow(room, request.user);
  request.status = decision === 'approve' ? 'approved' : 'rejected';
  request.reviewedBy = hostId;
  request.reviewedAt = new Date();
  await request.save();

  member.permissions.canSpeak = decision === 'approve';
  member.permissions.micApproved = decision === 'approve';
  member.permissions.micRequested = false;
  member.permissions.mutedByHost = false;
  if (decision !== 'approve') member.sfuTokenNotBefore = Math.floor(Date.now() / 1000) + 1;
  await member.save();
  await member.populate('user', 'name avatarColor');

  const notification = await createNotification(request.user, {
    type: 'speak_request',
    title: decision === 'approve' ? 'You can speak now' : 'Microphone request declined',
    body:
      decision === 'approve'
        ? `The host approved your microphone in ${room.name}`
        : `The host declined your microphone request in ${room.name}`,
    data: { roomId: room.roomId, requestId: request._id.toString(), decision },
  });
  afterCommit(() => sfu.enforceMember(room, member));
  publish('speak.decided', { room, request, member, decision, notification });
  return request;
}

async function revokeMic(room, hostId, targetUserId) {
  await hostMemberOrThrow(room, hostId);
  const member = await updateMemberPermissions(room, hostId, await memberIdFor(room, targetUserId), {
    canSpeak: false,
    mutedByHost: true,
  });
  await SpeakRequest.updateMany(
    { room: room._id, user: targetUserId, status: trusted({ $in: ['pending', 'approved'] }) },
    { $set: { status: 'revoked', reviewedBy: hostId, reviewedAt: new Date() } },
  );
  await createNotification(targetUserId, {
    type: 'speak_request',
    title: 'Microphone revoked',
    body: `Your microphone access was revoked in ${room.name}`,
    data: { roomId: room.roomId, decision: 'revoked' },
  });
  // updateMemberPermissions queues SFU enforcement after the transaction.
  return member;
}

async function revokeMicSelf(room, userId) {
  const member = await RoomMember.findOne({ room: room._id, user: userId, status: 'active' });
  if (!member) throw ApiError.badRequest('Not an active member', 'NOT_A_MEMBER');
  member.permissions.canSpeak = false;
  member.permissions.micApproved = false;
  member.permissions.micRequested = false;
  member.permissions.mutedByHost = false;
  member.sfuTokenNotBefore = Math.floor(Date.now() / 1000) + 1;
  await member.save();
  await member.populate('user', 'name avatarColor');
  await SpeakRequest.updateMany(
    { room: room._id, user: userId, status: 'pending' },
    { $set: { status: 'revoked', reviewedAt: new Date() } },
  );
  afterCommit(() => sfu.enforceMember(room, member, true));
  publish('room.memberUpdated', { room, member, updates: { canSpeak: false, self: true } });
  return member;
}

async function memberIdFor(room, userId) {
  const mongoose = require('mongoose');
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw ApiError.badRequest('Invalid user identifier', 'INVALID_ID');
  }
  const member = await RoomMember.findOne({ room: room._id, user: userId, status: 'active' });
  if (!member) throw ApiError.notFound('Member not found', 'MEMBER_NOT_FOUND');
  return member._id;
}

async function revokeSfuPublish(room, userId) {
  return sfu.removeParticipant(room, userId);
}

async function muteAll(room, hostId) {
  await hostMemberOrThrow(room, hostId);
  const cutoff = Math.floor(Date.now() / 1000) + 1;
  const result = await RoomMember.updateMany({ room: room._id, status: 'active', role: 'participant' }, { $set: {
    'permissions.canSpeak': false, 'permissions.micApproved': false, 'permissions.micRequested': false,
    'permissions.mutedByHost': true, sfuTokenNotBefore: cutoff,
  } });
  const members = await RoomMember.find({ room: room._id, status: 'active', role: 'participant' });
  await SpeakRequest.updateMany({ room: room._id, status: trusted({ $in: ['pending', 'approved'] }) }, { $set: { status: 'revoked', reviewedBy: hostId, reviewedAt: new Date() } });
  afterCommit(() => Promise.all(members.map((member) => sfu.enforceMember(room, member, true))));
  publish('speak.muteAll', { room, modified: result.modifiedCount });
  return { muted: result.modifiedCount };
}

async function listSpeakRequests(room, hostId) {
  await hostMemberOrThrow(room, hostId);
  const requests = await SpeakRequest.find({ room: room._id, status: 'pending' })
    .sort({ createdAt: 1 })
    .populate('user', 'name avatarColor');
  return requests.map((request) => ({
    id: request._id.toString(),
    userId: request.user._id ? request.user._id.toString() : request.user.toString(),
    user: request.user._id
      ? { id: request.user._id.toString(), name: request.user.name, avatarColor: request.user.avatarColor }
      : undefined,
    note: request.note,
    status: request.status,
    createdAt: request.createdAt,
  }));
}

module.exports = {
  requestToSpeak: atomic(requestToSpeak),
  decideSpeakRequest: atomic(decideSpeakRequest),
  revokeMic: atomic(revokeMic),
  revokeMicSelf: atomic(revokeMicSelf),
  muteAll: atomic(muteAll),
  listSpeakRequests,
  revokeSfuPublish,
};
