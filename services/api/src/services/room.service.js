'use strict';

const { trusted } = require('mongoose');
const Room = require('../models/Room');
const RoomMember = require('../models/RoomMember');
const MediaAsset = require('../models/MediaAsset');
const Notification = require('../models/Notification');
const ApiError = require('../utils/ApiError');
const { randomRoomId } = require('../utils/ids');
const { hashPassword, verifyPassword } = require('./password.service');
const { roomShareLink, roomDeepLink } = require('../utils/serializers');
const { atomic, publish, afterCommit } = require('../utils/transaction');
const sfu = require('./sfu.service');

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function uniqueRoomId() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = randomRoomId(7);
    if (!(await Room.exists({ roomId: candidate }))) return candidate;
  }
  throw ApiError.internal('Unable to allocate a room code');
}

async function findRoomOrThrow(roomId) {
  const room = await Room.findByRoomId(roomId);
  if (!room) throw ApiError.notFound('Room not found', 'ROOM_NOT_FOUND');
  return room;
}

async function getMembership(room, userId, { includeInactive = false } = {}) {
  const query = { room: room._id, user: userId };
  if (!includeInactive) query.status = trusted({ $in: ['active', 'pending'] });
  return RoomMember.findOne(query);
}

async function activeMemberOrThrow(room, userId) {
  const member = await RoomMember.findOne({ room: room._id, user: userId, status: 'active' });
  if (!member) throw ApiError.forbidden('You are not an active member of this room', 'NOT_A_MEMBER');
  return member;
}

async function hostMemberOrThrow(room, userId) {
  if (room.host.toString() !== String(userId)) {
    throw ApiError.forbidden('Only the host can perform this action', 'HOST_ONLY');
  }
  const member = await RoomMember.findOne({ room: room._id, user: userId, status: 'active' });
  if (!member) throw ApiError.forbidden('Host membership is not active', 'HOST_ONLY');
  return member;
}

async function reserveSeat(roomId) {
  return Room.findOneAndUpdate(
    {
      _id: roomId,
      status: 'active',
      $expr: trusted({ $lt: ['$memberCount', '$maxParticipants'] }),
    },
    { $inc: { memberCount: 1 }, $set: { lastActivityAt: new Date() } },
    { new: true },
  );
}

async function releaseSeat(roomId) {
  await Room.updateOne(
    { _id: roomId, memberCount: trusted({ $gt: 0 }) },
    { $inc: { memberCount: -1 }, $set: { lastActivityAt: new Date() } },
  );
}

async function createRoom(user, input) {
  const roomId = await uniqueRoomId();
  const passwordHash = input.password ? await hashPassword(input.password) : null;
  const room = await Room.create({
    roomId,
    name: input.name,
    description: input.description || '',
    host: user._id,
    mode: input.mode,
    mediaType: input.mediaType,
    visibility: input.visibility,
    maxParticipants: input.maxParticipants,
    passwordHash,
    hasPassword: Boolean(passwordHash),
    joinApproval: input.visibility === 'private' ? true : Boolean(input.joinApproval),
    allowChat: input.allowChat !== false,
    allowMicRequests: input.allowMicRequests !== false,
    roomChatEnabled: input.allowChat !== false,
    chatRateLimitPerMinute: input.chatRateLimitPerMinute || 20,
    memberCount: 1,
    playback: { status: 'idle', positionMs: 0, rate: 1, updatedAt: new Date() },
  });

  await RoomMember.create({
    room: room._id,
    user: user._id,
    role: 'host',
    status: 'active',
    permissions: {
      canChat: true,
      canSpeak: true,
      micApproved: true,
    },
  });

  return room;
}

async function getRoomPayload(room, userId) {
  await room.populate('host', 'name avatarColor');
  const member = await RoomMember.findOne({ room: room._id, user: userId });
  const currentMedia = member?.status === 'active' && room.playback?.media
    ? await MediaAsset.findOne({ _id: room.playback.media, deletedAt: null })
    : null;
  return {
    room: {
      ...room.toPublicJSON(room.host),
      shareLink: roomShareLink(room.roomId),
      deepLink: roomDeepLink(room.roomId),
      currentMedia: currentMedia ? currentMedia.toPublicJSON() : null,
      ...(member?.status !== 'active' ? { playback: null } : {}),
    },
    membership: member ? member.toPublicJSON() : null,
  };
}

async function listPublicRooms(query) {
  const filter = { visibility: 'public', status: 'active' };
  if (query.mode) filter.mode = query.mode;
  if (query.mediaType) filter.mediaType = query.mediaType;
  if (query.search) {
    filter.$or = [
      { name: trusted({ $regex: escapeRegex(query.search), $options: 'i' }) },
      { description: trusted({ $regex: escapeRegex(query.search), $options: 'i' }) },
      { roomId: trusted({ $regex: escapeRegex(query.search.toUpperCase()), $options: 'i' }) },
    ];
  }
  const limit = Math.min(Number(query.limit) || 20, 50);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const [rooms, total] = await Promise.all([
    Room.find(filter)
      .sort({ lastActivityAt: -1 })
      .skip(offset)
      .limit(limit)
      .populate('host', 'name avatarColor'),
    Room.countDocuments(filter),
  ]);
  return {
    data: rooms.map((room) => ({
      ...room.toPublicJSON(room.host),
      shareLink: roomShareLink(room.roomId),
    })),
    total,
    limit,
    offset,
    hasMore: offset + rooms.length < total,
  };
}

async function requestOrJoin(user, roomId, { password, message } = {}) {
  const room = await findRoomOrThrow(roomId);
  if (room.status !== 'active') throw ApiError.conflict('This room has ended', 'ROOM_ENDED');
  // Serialize membership decisions on the room document across API instances.
  // A retry reads the newly committed membership before reserving another seat.
  await Room.updateOne({ _id: room._id, status: 'active' }, { $set: { lastActivityAt: new Date() } });

  const existing = await RoomMember.findOne({ room: room._id, user: user._id });
  if (existing?.status === 'banned') {
    throw ApiError.forbidden('You were removed from this room', 'ROOM_BANNED');
  }
  if (existing?.status === 'active') {
    return { room, member: existing, state: 'joined' };
  }
  if (existing?.status === 'pending') {
    return { room, member: existing, state: 'pending' };
  }

  let passwordValid = true;
  if (room.hasPassword || room.passwordHash) {
    if (!password) throw ApiError.forbidden('This room requires a password', 'ROOM_PASSWORD_REQUIRED');
    const roomWithPassword = await Room.findById(room._id).select('+passwordHash');
    passwordValid = await verifyPassword(password, roomWithPassword.passwordHash);
    if (!passwordValid) throw ApiError.forbidden('Incorrect room password', 'ROOM_PASSWORD_INVALID');
  }

  const needsApproval = room.visibility === 'private' || room.joinApproval;

  if (needsApproval) {
    if (room.memberCount >= room.maxParticipants) {
      throw ApiError.conflict('This room is full', 'ROOM_FULL');
    }
    const member = await RoomMember.findOneAndUpdate(
      { room: room._id, user: user._id },
      {
        $set: {
          role: 'participant',
          status: 'pending',
          joinRequestMessage: message || '',
          permissions: { canChat: true, canSpeak: false, micRequested: false, micApproved: false, mutedByHost: false },
        },
        $setOnInsert: { room: room._id, user: user._id },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    const notification = await Notification.create({
      user: room.host,
      type: 'join_request',
      title: 'New join request',
      body: `${user.name} wants to join ${room.name}`,
      data: { roomId: room.roomId, memberId: member._id.toString() },
    });
    publish('room.joinRequested', {
      room,
      member,
      requester: user,
      notification,
    });
    return { room, member, state: 'pending' };
  }

  const reserved = await reserveSeat(room._id);
  if (!reserved) throw ApiError.conflict('This room is full', 'ROOM_FULL');

  let member;
  try {
    member = await RoomMember.findOneAndUpdate(
      { room: room._id, user: user._id },
      {
        $set: {
          role: 'participant',
          status: 'active',
          joinRequestMessage: '',
          joinedAt: new Date(),
          lastSeenAt: new Date(),
          permissions: { canChat: true, canSpeak: false, micRequested: false, micApproved: false, mutedByHost: false },
        },
        $setOnInsert: { room: room._id, user: user._id },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    await releaseSeat(room._id);
    throw error;
  }

  await member.populate('user', 'name avatarColor');
  publish('room.memberJoined', { room: reserved, member });
  return { room: reserved, member, state: 'joined' };
}

async function listJoinRequests(room, hostId) {
  await hostMemberOrThrow(room, hostId);
  const members = await RoomMember.find({ room: room._id, status: 'pending' })
    .sort({ createdAt: 1 })
    .populate('user', 'name email avatarColor');
  return members.map((member) => member.toPublicJSON(member.user));
}

async function decideJoinRequest(room, hostId, memberId, decision, { ban = false } = {}) {
  await hostMemberOrThrow(room, hostId);
  if (room.status !== 'active') throw ApiError.conflict('Room has ended', 'ROOM_ENDED');
  const member = await RoomMember.findOne({ _id: memberId, room: room._id });
  if (member?.status === 'active' && decision === 'approve') return member.populate('user', 'name avatarColor');
  if (!member || member.status !== 'pending') throw ApiError.notFound('Pending join request not found', 'REQUEST_NOT_FOUND');

  if (decision === 'approve') {
    const reserved = await reserveSeat(room._id);
    if (!reserved) throw ApiError.conflict('This room is full', 'ROOM_FULL');
    member.status = 'active';
    member.joinedAt = new Date();
    member.lastSeenAt = new Date();
    await member.save();
    await member.populate('user', 'name avatarColor');
    const notification = await Notification.create({
      user: member.user._id,
      type: 'join_decision',
      title: 'Join request approved',
      body: `You joined ${room.name}`,
      data: { roomId: room.roomId, memberId: member._id.toString(), decision: 'approved' },
    });
    publish('room.joinDecided', { room: reserved, member, decision: 'approved', notification });
    return member;
  }

  member.status = ban ? 'banned' : 'left';
  await member.save();
  await member.populate('user', 'name avatarColor');
  const notification = await Notification.create({
    user: member.user._id,
    type: 'join_decision',
    title: 'Join request declined',
    body: `Your request to join ${room.name} was declined`,
    data: { roomId: room.roomId, memberId: member._id.toString(), decision: 'rejected' },
  });
  publish('room.joinDecided', { room, member, decision: 'rejected', notification });
  return member;
}

async function listMembers(room, userId) {
  await activeMemberOrThrow(room, userId);
  const members = await RoomMember.find({ room: room._id, status: 'active' })
    .sort({ role: -1, joinedAt: 1 })
    .populate('user', 'name avatarColor lastSeenAt');
  return members.map((member) => member.toPublicJSON(member.user));
}

async function updateMemberPermissions(room, hostId, memberId, updates) {
  await hostMemberOrThrow(room, hostId);
  const member = await RoomMember.findOne({ _id: memberId, room: room._id, status: 'active' }).populate(
    'user',
    'name avatarColor',
  );
  if (!member) throw ApiError.notFound('Member not found', 'MEMBER_NOT_FOUND');
  if (member.role === 'host') throw ApiError.badRequest('Host permissions cannot be changed', 'HOST_IMMUTABLE');

  if (typeof updates.canChat === 'boolean') {
    member.permissions.canChat = updates.canChat;
    if (!updates.canChat) member.permissions.canSpeak = false;
  }
  if (typeof updates.canSpeak === 'boolean') {
    member.permissions.canSpeak = updates.canSpeak;
    member.permissions.micApproved = updates.canSpeak;
    if (!updates.canSpeak) {
      member.permissions.micRequested = false;
      member.permissions.mutedByHost = true;
    } else {
      member.permissions.mutedByHost = false;
    }
  }
  if (typeof updates.mutedByHost === 'boolean') {
    member.permissions.mutedByHost = updates.mutedByHost;
    if (updates.mutedByHost) member.permissions.canSpeak = false;
  }
  await member.save();
  if (!member.permissions.canSpeak || member.permissions.mutedByHost) {
    member.sfuTokenNotBefore = Math.floor(Date.now() / 1000) + 1;
    await member.save();
  }
  afterCommit(() => sfu.enforceMember(room, member, !member.permissions.canSpeak || member.permissions.mutedByHost));
  publish('room.memberUpdated', { room, member, updates });
  return member;
}

async function removeMember(room, actorId, memberId, { ban = false } = {}) {
  await hostMemberOrThrow(room, actorId);
  const member = await RoomMember.findOne({ _id: memberId, room: room._id });
  if (!member) throw ApiError.notFound('Member not found', 'MEMBER_NOT_FOUND');
  if (member.role === 'host' || member.user.toString() === String(actorId)) {
    throw ApiError.badRequest('The host cannot remove themselves', 'CANNOT_REMOVE_HOST');
  }
  const wasActive = member.status === 'active';
  member.status = ban ? 'banned' : 'removed';
  member.permissions.canSpeak = false;
  member.permissions.micApproved = false;
  member.permissions.micRequested = false;
  member.sfuTokenNotBefore = Math.floor(Date.now() / 1000) + 1;
  await member.save();
  if (wasActive) await releaseSeat(room._id);
  await member.populate('user', 'name avatarColor');
  afterCommit(() => sfu.removeParticipant(room, member.user._id, member.sfuTokenNotBefore));
  publish('room.memberRemoved', { room, member, ban });
  return member;
}

async function leaveRoom(room, userId) {
  const member = await RoomMember.findOne({ room: room._id, user: userId, status: 'active' });
  if (!member) return false;
  if (member.role === 'host') {
    throw ApiError.badRequest('End the room instead of leaving as host', 'HOST_MUST_END');
  }
  member.status = 'left';
  member.permissions.canSpeak = false;
  member.permissions.micApproved = false;
  member.sfuTokenNotBefore = Math.floor(Date.now() / 1000) + 1;
  await member.save();
  await releaseSeat(room._id);
  afterCommit(() => sfu.removeParticipant(room, userId, member.sfuTokenNotBefore));
  publish('room.memberLeft', { room, member });
  return true;
}

async function updateRoomSettings(room, hostId, updates) {
  await hostMemberOrThrow(room, hostId);
  if (updates.name !== undefined) room.name = updates.name;
  if (updates.description !== undefined) room.description = updates.description;
  if (updates.maxParticipants !== undefined) {
    if (updates.maxParticipants < room.memberCount) {
      throw ApiError.badRequest('Maximum participants cannot be below the current member count', 'INVALID_CAPACITY');
    }
    room.maxParticipants = updates.maxParticipants;
  }
  if (updates.allowChat !== undefined) {
    room.allowChat = updates.allowChat;
    room.roomChatEnabled = updates.allowChat;
  }
  if (updates.allowMicRequests !== undefined) room.allowMicRequests = updates.allowMicRequests;
  if (updates.joinApproval !== undefined) room.joinApproval = updates.joinApproval;
  if (updates.chatRateLimitPerMinute !== undefined) {
    room.chatRateLimitPerMinute = updates.chatRateLimitPerMinute;
  }
  if (updates.password !== undefined) {
    if (updates.password === null || updates.password === '') {
      room.passwordHash = null;
      room.hasPassword = false;
    } else {
      room.passwordHash = await hashPassword(updates.password);
      room.hasPassword = true;
    }
  }
  room.lastActivityAt = new Date();
  await room.save();
  publish('room.settingsUpdated', { room });
  return room;
}

async function endRoom(room, hostId) {
  await hostMemberOrThrow(room, hostId);
  room.status = 'ended';
  room.endedAt = new Date();
  room.playback.status = 'ended';
  room.playback.updatedAt = new Date();
  room.playback.sequence += 1;
  await room.save();
  await RoomMember.updateMany(
    { room: room._id, status: trusted({ $in: ['active', 'pending'] }) },
    { $set: { status: 'left', 'permissions.canSpeak': false, 'permissions.micApproved': false } },
  );
  room.memberCount = 0;
  await room.save();
  const notify = await Notification.insertMany(
    [room.host].map((userId) => ({
      user: userId,
      type: 'room_ended',
      title: 'Room ended',
      body: `${room.name} has ended`,
      data: { roomId: room.roomId },
    })),
  );
  publish('room.ended', { room, notification: notify[0] });
  afterCommit(() => sfu.closeRoom(room));
  return room;
}

async function pendingRequestsForUser(room, userId) {
  const member = await RoomMember.findOne({ room: room._id, user: userId });
  return member ? member.toPublicJSON() : null;
}

module.exports = {
  findRoomOrThrow,
  getMembership,
  activeMemberOrThrow,
  hostMemberOrThrow,
  createRoom: atomic(createRoom),
  getRoomPayload,
  listPublicRooms,
  requestOrJoin: atomic(requestOrJoin),
  listJoinRequests,
  decideJoinRequest: atomic(decideJoinRequest),
  listMembers,
  updateMemberPermissions: atomic(updateMemberPermissions),
  removeMember: atomic(removeMember),
  leaveRoom: atomic(leaveRoom),
  updateRoomSettings: atomic(updateRoomSettings),
  endRoom: atomic(endRoom),
  pendingRequestsForUser,
  reserveSeat,
  releaseSeat,
};
