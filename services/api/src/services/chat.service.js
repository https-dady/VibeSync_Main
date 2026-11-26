'use strict';

const { trusted } = require('mongoose');
const Message = require('../models/Message');
const ApiError = require('../utils/ApiError');
const bus = require('../realtime/bus');
const { getRedis } = require('../config/redis');
const { activeMemberOrThrow, hostMemberOrThrow } = require('./room.service');

const fallbackWindows = new Map();

function pruneFallback() {
  const now = Date.now();
  for (const [key, entry] of fallbackWindows) {
    if (entry.resetAt <= now) fallbackWindows.delete(key);
  }
}

async function rateLimit(room, userId) {
  const windowMs = 60 * 1000;
  const limit = room.chatRateLimitPerMinute || 20;
  const redis = getRedis();
  const key = `vibesync:chat-rate:${room._id}:${userId}`;
  if (redis) {
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.pExpire(key, windowMs);
      if (count > limit) throw ApiError.tooMany('You are sending messages too quickly', 'CHAT_RATE_LIMITED');
      return;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Redis failure falls through to the in-process limiter.
    }
  }
  pruneFallback();
  const now = Date.now();
  const entry = fallbackWindows.get(key) || { count: 0, resetAt: now + windowMs };
  entry.count += 1;
  fallbackWindows.set(key, entry);
  if (entry.count > limit) {
    throw ApiError.tooMany('You are sending messages too quickly', 'CHAT_RATE_LIMITED');
  }
}

function normalizeBody(body) {
  const value = String(body || '').trim();
  if (!value) throw ApiError.badRequest('Message cannot be empty', 'EMPTY_MESSAGE');
  if (value.length > 2000) throw ApiError.badRequest('Message is too long', 'MESSAGE_TOO_LONG');
  return value;
}

async function createMessage(room, sender, payload) {
  if (room.status !== 'active') throw ApiError.conflict('Room has ended', 'ROOM_ENDED');
  const member = await activeMemberOrThrow(room, sender._id);
  if (!member.permissions.canChat) {
    throw ApiError.forbidden('Chat permission has been disabled for you', 'CHAT_FORBIDDEN');
  }
  const channel = payload.channel === 'host' ? 'host' : 'room';
  const isHost = room.host.toString() === sender._id.toString();

  if (channel === 'room') {
    if (!room.allowChat || !room.roomChatEnabled) {
      throw ApiError.forbidden('Room chat is disabled', 'CHAT_DISABLED');
    }
  }

  let recipient = null;
  if (channel === 'host') {
    if (isHost) {
      const targetId = payload.targetUserId;
      if (!targetId) throw ApiError.badRequest('targetUserId is required for host replies', 'TARGET_REQUIRED');
      const target = await activeMemberOrThrow(room, targetId);
      if (target.role === 'host') {
        throw ApiError.badRequest('Select a participant to reply to', 'TARGET_REQUIRED');
      }
      recipient = target.user;
    } else {
      recipient = room.host;
    }
  }

  const body = normalizeBody(payload.body);
  const identity = payload.clientMessageId
    ? { room: room._id, sender: sender._id, clientMessageId: payload.clientMessageId }
    : null;
  async function replay(message) {
    if (message.channel !== channel || message.body !== body || String(message.recipient || '') !== String(recipient || '')) {
      throw ApiError.conflict('This message identifier was already used for another message', 'MESSAGE_ID_REUSED');
    }
    await message.populate('sender', 'name avatarColor');
    return message.toPublicJSON(message.sender);
  }
  if (identity) {
    const existing = await Message.findOne(identity);
    if (existing) return replay(existing);
  }

  await rateLimit(room, sender._id);
  let message;
  try {
    message = await Message.create({
    room: room._id,
    sender: sender._id,
    channel,
    recipient,
    body,
    ...(payload.clientMessageId ? { clientMessageId: payload.clientMessageId } : {}),
    type: 'text',
    });
  } catch (error) {
    if (identity && error.code === 11000) {
      const existing = await Message.findOne(identity);
      if (existing) return replay(existing);
    }
    throw error;
  }
  await message.populate('sender', 'name avatarColor');
  const publicMessage = message.toPublicJSON(message.sender);
  bus.emit('chat.message', { room, message: publicMessage, recipientId: recipient ? String(recipient) : null });
  return publicMessage;
}

async function listMessages(room, userId, { channel = 'room', before, beforeId, limit = 40 } = {}) {
  const member = await activeMemberOrThrow(room, userId);
  const isHost = room.host.toString() === String(userId);
  const safeLimit = Math.min(Math.max(Number(limit) || 40, 1), 100);
  const query = { room: room._id, channel, deletedAt: null };
  if (channel === 'host') {
    if (!member.permissions.canChat) {
      throw ApiError.forbidden('Chat permission disabled', 'CHAT_FORBIDDEN');
    }
    if (isHost) {
      // Host sees the whole private inbox for this room.
    } else {
      query.$or = [
        { sender: userId, recipient: room.host },
        { sender: room.host, recipient: userId },
      ];
    }
  }
  if (before) {
    const date = new Date(before);
    if (!Number.isNaN(date.getTime())) {
      if (beforeId) query.$and = [{ $or: [
        { createdAt: trusted({ $lt: date }) },
        { createdAt: date, _id: trusted({ $lt: beforeId }) },
      ] }];
      else query.createdAt = trusted({ $lt: date });
    }
  }
  const messages = await Message.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(safeLimit + 1)
    .populate('sender', 'name avatarColor');
  const hasMore = messages.length > safeLimit;
  const page = hasMore ? messages.slice(0, safeLimit) : messages;
  const oldest = page[page.length - 1];
  return {
    data: page.reverse().map((message) => message.toPublicJSON(message.sender)),
    hasMore,
    nextBefore: hasMore ? oldest?.createdAt : null,
    nextBeforeId: hasMore ? String(oldest?._id) : null,
  };
}

async function deleteMessage(room, userId, messageId) {
  await activeMemberOrThrow(room, userId);
  const isHost = room.host.toString() === String(userId);
  const message = await Message.findOne({ _id: messageId, room: room._id, deletedAt: null });
  if (!message) throw ApiError.notFound('Message not found', 'MESSAGE_NOT_FOUND');
  if (!isHost && message.sender.toString() !== String(userId)) {
    throw ApiError.forbidden('You can only delete your own messages', 'MESSAGE_FORBIDDEN');
  }
  if (message.channel === 'host' && !isHost) {
    throw ApiError.forbidden('Private host messages can only be removed by the host', 'MESSAGE_FORBIDDEN');
  }
  message.deletedAt = new Date();
  message.deletedBy = userId;
  await message.save();
  bus.emit('chat.deleted', {
    room,
    messageId: message._id.toString(),
    channel: message.channel,
    deletedBy: String(userId),
    recipientId: message.recipient ? String(message.recipient) : null,
    senderId: String(message.sender),
  });
  return true;
}

async function updateModeration(room, hostId, targetUserId, action) {
  await hostMemberOrThrow(room, hostId);
  if (action === 'clear') {
    await Message.updateMany(
      { room: room._id, channel: 'room', deletedAt: null },
      { $set: { deletedAt: new Date(), deletedBy: hostId } },
    );
    bus.emit('chat.cleared', { room });
    return true;
  }
  throw ApiError.badRequest('Unsupported moderation action', 'INVALID_ACTION');
}

module.exports = { createMessage, listMessages, deleteMessage, updateModeration };
