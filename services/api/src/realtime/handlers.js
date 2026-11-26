'use strict';

const Room = require('../models/Room');
const RoomMember = require('../models/RoomMember');
const ApiError = require('../utils/ApiError');
const roomService = require('../services/room.service');
const playbackService = require('../services/playback.service');
const chatService = require('../services/chat.service');
const speakService = require('../services/speak.service');
const presence = require('../services/presence.service');
const bus = require('./bus');
const logger = require('../config/logger');
const { consume } = require('./rateLimit');
const {
  socketValidate,
  roomEventSchema,
  playbackSchema,
  heartbeatSchema,
  chatSchema,
  messageIdSchema,
  speakRequestSchema,
  speakDecisionSchema,
  micSchema,
  signalSchema,
  clockSchema,
} = require('./schemas');

const lastHeartbeat = new WeakMap();

function roomChannel(room) {
  return `room:${room._id}`;
}

async function loadRoomByCode(roomId) {
  const room = await Room.findByRoomId(roomId);
  if (!room) throw ApiError.notFound('Room not found', 'ROOM_NOT_FOUND');
  return room;
}

async function targetMember(room, userId) {
  const member = await RoomMember.findOne({ room: room._id, user: userId, status: 'active' });
  if (!member) throw ApiError.notFound('Member is not active', 'MEMBER_NOT_FOUND');
  return member;
}

function reply(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

function wrap(socket, eventName, limit, handler) {
  return async (payload, ack) => {
    try {
      if (!consume(socket, eventName, limit)) {
        throw ApiError.tooMany('Too many realtime events; slow down', 'SOCKET_RATE_LIMITED');
      }
      const result = await handler(payload, ack);
      if (result !== undefined) reply(ack, { ok: true, ...result });
    } catch (error) {
      if (!error.status || error.status >= 500) logger.error({ err: error, event: eventName, socketId: socket.id }, 'Realtime operation failed');
      reply(ack, {
        ok: false,
        error: {
          code: error.code || 'REALTIME_ERROR',
          message: error.expose ? error.message : 'Realtime operation failed',
          ...(error.details ? { details: error.details } : {}),
        },
      });
      socket.emit('event:error', {
        event: eventName,
        code: error.code || 'REALTIME_ERROR',
        message: error.expose ? error.message : 'Realtime operation failed',
      });
    }
  };
}

async function evictUser(io, room, userId) {
  const channel = roomChannel(room);
  const sockets = await io.in(channel).fetchSockets();
  await Promise.all(
    sockets
      .filter((item) => String(item.data.userId) === String(userId))
      .map((item) => {
        item.leave(channel);
        item.data.rooms = (item.data.rooms || []).filter((id) => id !== room.roomId);
        item.emit('room:access-revoked', { roomId: room.roomId });
        return Promise.resolve();
      }),
  );
}

async function evictAll(io, room) {
  const channel = roomChannel(room);
  const sockets = await io.in(channel).fetchSockets();
  await Promise.all(
    sockets.map((item) => {
      item.leave(channel);
      item.data.rooms = (item.data.rooms || []).filter((id) => id !== room.roomId);
      return Promise.resolve();
    }),
  );
}

function registerHandlers(io, socket) {
  const user = socket.user;

  socket.on(
    'clock:sync',
    wrap(socket, 'clock:sync', 120, async (payload) => {
      const data = socketValidate(clockSchema, payload || {});
      if (Math.abs(Date.now() - data.t0) > 24 * 60 * 60 * 1000) {
        throw ApiError.badRequest('Clock sample outside accepted window', 'CLOCK_SKEW');
      }
      // t1 is stamped as late as possible, immediately before the ack.
      return { t0: data.t0, serverTime: Date.now() };
    }),
  );

  socket.on(
    'room:join',
    wrap(socket, 'room:join', 30, async (payload) => {
      const data = socketValidate(roomEventSchema, payload);
      const room = await loadRoomByCode(data.roomId);
      if (room.status !== 'active') throw ApiError.conflict('Room has ended', 'ROOM_ENDED');
      const member = await RoomMember.findOne({
        room: room._id,
        user: user._id,
        status: 'active',
      }).populate('user', 'name avatarColor');
      if (!member) throw ApiError.forbidden('You are not an active member', 'NOT_A_MEMBER');

      const channel = roomChannel(room);
      await socket.join(channel);
      if (!socket.data.rooms) socket.data.rooms = [];
      if (!socket.data.rooms.includes(room.roomId)) socket.data.rooms.push(room.roomId);
      await RoomMember.updateOne({ _id: member._id, status: 'active' }, { $set: { lastSeenAt: new Date() } });
      // Recheck after subscription so a kick racing the initial lookup cannot
      // subscribe a former member after the eviction broadcast has completed.
      if (!(await RoomMember.exists({ _id: member._id, status: 'active' }))) {
        await socket.leave(channel);
        socket.data.rooms = socket.data.rooms.filter((id) => id !== room.roomId);
        throw ApiError.forbidden('Room access changed while connecting', 'NOT_A_MEMBER');
      }

      const firstSession = await presence.markOnline(room.roomId, String(user._id), socket.id);
      const playback = await playbackService.getPlayback(room);
      const members = await roomService.listMembers(room, user._id);
      if (firstSession) {
        io.to(channel).emit('presence:update', {
          roomId: room.roomId,
          userId: String(user._id),
          online: true,
          at: Date.now(),
        });
      }
      return {
        roomId: room.roomId,
        playback,
        members,
        membership: member.toPublicJSON(member.user),
        onlineUsers: await presence.onlineUsers(room.roomId),
      };
    }),
  );

  socket.on(
    'room:leave',
    wrap(socket, 'room:leave', 60, async (payload) => {
      const data = socketValidate(roomEventSchema, payload);
      const room = await Room.findByRoomId(data.roomId);
      if (!room) return { left: true };
      const channel = roomChannel(room);
      socket.leave(channel);
      socket.data.rooms = (socket.data.rooms || []).filter((id) => id !== room.roomId);
      const offline = await presence.markOffline(room.roomId, String(user._id), socket.id);
      if (offline) {
        io.to(channel).emit('presence:update', {
          roomId: room.roomId,
          userId: String(user._id),
          online: false,
          at: Date.now(),
        });
      }
      return { left: true };
    }),
  );

  socket.on(
    'playback:command',
    wrap(socket, 'playback:command', 60, async (payload) => {
      const data = socketValidate(playbackSchema, payload);
      const room = await loadRoomByCode(data.roomId);
      const { roomId: _roomId, ...command } = data;
      const playback = await playbackService.applyHostCommand(room, user._id, command);
      return { playback };
    }),
  );

  socket.on(
    'playback:heartbeat',
    wrap(socket, 'playback:heartbeat', 30, async (payload) => {
      const data = socketValidate(heartbeatSchema, payload);
      const bucket = lastHeartbeat.get(socket) || {};
      if (bucket[data.roomId] && Date.now() - bucket[data.roomId] < 2500) {
        return { throttled: true };
      }
      bucket[data.roomId] = Date.now();
      lastHeartbeat.set(socket, bucket);
      const room = await loadRoomByCode(data.roomId);
      const playback = await playbackService.hostHeartbeat(room, user._id, data.positionMs, data.sequence);
      return { playback };
    }),
  );

  socket.on(
    'playback:sync',
    wrap(socket, 'playback:sync', 120, async (payload) => {
      const data = socketValidate(roomEventSchema, payload);
      const room = await loadRoomByCode(data.roomId);
      await roomService.activeMemberOrThrow(room, user._id);
      const playback = await playbackService.getPlayback(room);
      return { playback };
    }),
  );

  socket.on(
    'chat:send',
    wrap(socket, 'chat:send', 30, async (payload) => {
      const data = socketValidate(chatSchema, payload);
      const room = await loadRoomByCode(data.roomId);
      const message = await chatService.createMessage(room, user, data);
      return { message };
    }),
  );

  socket.on(
    'chat:delete',
    wrap(socket, 'chat:delete', 30, async (payload) => {
      const data = socketValidate(messageIdSchema, payload);
      const room = await loadRoomByCode(data.roomId);
      await chatService.deleteMessage(room, user._id, data.messageId);
      return { deleted: true };
    }),
  );

  socket.on(
    'speak:request',
    wrap(socket, 'speak:request', 10, async (payload) => {
      const data = socketValidate(speakRequestSchema, payload);
      const room = await loadRoomByCode(data.roomId);
      const result = await speakService.requestToSpeak(room, user._id, data.note);
      return {
        status: result.status,
        request: result.request ? String(result.request._id) : null,
      };
    }),
  );

  socket.on(
    'speak:decision',
    wrap(socket, 'speak:decision', 30, async (payload) => {
      const data = socketValidate(speakDecisionSchema, payload);
      const room = await loadRoomByCode(data.roomId);
      const request = await speakService.decideSpeakRequest(
        room,
        user._id,
        data.requestId,
        data.decision,
      );
      return { requestId: String(request._id), status: request.status };
    }),
  );

  socket.on(
    'mic:set',
    wrap(socket, 'mic:set', 30, async (payload) => {
      const data = socketValidate(micSchema, payload);
      const room = await loadRoomByCode(data.roomId);
      if (data.userId === String(user._id) && !data.granted) {
        // Participants may always stop their own track, but cannot grant it.
        await speakService.revokeMicSelf(room, user._id);
        return { userId: data.userId, granted: false };
      }
      if (data.granted) {
        const member = await targetMember(room, data.userId);
        const updated = await roomService.updateMemberPermissions(room, user._id, member._id, {
          canSpeak: true,
        });
        return { userId: data.userId, granted: updated.permissions.canSpeak };
      }
      const member = await speakService.revokeMic(room, user._id, data.userId);
      return { userId: data.userId, granted: member.permissions.canSpeak };
    }),
  );

  socket.on(
    'mic:mute-all',
    wrap(socket, 'mic:mute-all', 10, async (payload) => {
      const data = socketValidate(roomEventSchema, payload);
      const room = await loadRoomByCode(data.roomId);
      return speakService.muteAll(room, user._id);
    }),
  );

  socket.on(
    'webrtc:signal',
    wrap(socket, 'webrtc:signal', 240, async (payload) => {
      const data = socketValidate(signalSchema, payload);
      if (data.targetUserId === String(user._id)) {
        throw ApiError.badRequest('Cannot signal yourself', 'INVALID_TARGET');
      }
      const room = await loadRoomByCode(data.roomId);
      const sender = await targetMember(room, user._id);
      const target = await targetMember(room, data.targetUserId);
      if (data.data.type === 'offer') {
        if (
          sender.role !== 'host' &&
          (!sender.permissions.canSpeak || sender.permissions.mutedByHost)
        ) {
          throw ApiError.forbidden('Microphone permission is required to publish', 'MIC_FORBIDDEN');
        }
      }
      const signal = {
        type: data.data.type,
        sdp: data.data.sdp || null,
        candidate: data.data.candidate || null,
        sessionId: data.data.sessionId || null,
      };
      io.to(`user:${data.targetUserId}`).emit('webrtc:signal', {
        roomId: room.roomId,
        fromUserId: String(user._id),
        fromName: user.name,
        data: signal,
      });
      // Speaker/audience role is authoritative from the database; receivers can
      // decide whether to accept an audio transceiver from a remote peer.
      return {
        delivered: true,
        targetUserId: data.targetUserId,
        targetCanSpeak: Boolean(target.permissions.canSpeak && !target.permissions.mutedByHost),
      };
    }),
  );

  socket.on('disconnect', async () => {
    const rooms = [...(socket.data.rooms || [])];
    await Promise.all(
      rooms.map(async (roomId) => {
        const room = await Room.findOne({ roomId });
        if (!room) return;
        const offline = await presence.markOffline(roomId, String(user._id), socket.id);
        if (offline) {
          io.to(roomChannel(room)).emit('presence:update', {
            roomId,
            userId: String(user._id),
            online: false,
            at: Date.now(),
          });
        }
      }),
    ).catch(() => {});
    await RoomMember.updateMany(
      { user: user._id, status: 'active' },
      { $set: { lastSeenAt: new Date() } },
    ).catch(() => {});
  });
}

function registerBridge(io) {
  bus.on('room.joinRequested', ({ room, member }) => {
    io.to(`user:${room.host}`).emit('join:request', {
      roomId: room.roomId,
      roomName: room.name,
      member: member.toPublicJSON ? member.toPublicJSON() : member,
    });
  });

  bus.on('room.joinDecided', ({ room, member, decision, notification }) => {
    const userId = member.user?._id || member.user;
    io.to(`user:${userId}`).emit('join:decision', {
      roomId: room.roomId,
      roomName: room.name,
      decision,
      membership: member.toPublicJSON?.(member.user) || null,
      notification: notification?.toPublicJSON?.() || null,
    });
    io.to(`user:${room.host}`).emit('join:request:resolved', {
      roomId: room.roomId,
      memberId: String(member._id),
      decision,
    });
    if (decision === 'approved') {
      io.to(`user:${userId}`).emit('room:approved', { roomId: room.roomId });
    }
  });

  bus.on('room.memberJoined', ({ room, member }) => {
    io.to(roomChannel(room)).emit('room:member-joined', {
      roomId: room.roomId,
      member: member.toPublicJSON(member.user),
    });
  });

  bus.on('room.memberUpdated', ({ room, member, updates }) => {
    const payload = {
      roomId: room.roomId,
      member: member.toPublicJSON(member.user),
      updates,
    };
    io.to(roomChannel(room)).emit('member:updated', payload);
    io.to(`user:${member.user?._id || member.user}`).emit('permission:updated', {
      roomId: room.roomId,
      permissions: member.permissions,
      role: member.role,
    });
    if (updates && updates.mutedByHost) {
      io.to(`user:${member.user?._id || member.user}`).emit('mic:revoked', {
        roomId: room.roomId,
        reason: 'muted_by_host',
      });
    }
  });

  bus.on('room.memberRemoved', async ({ room, member, ban }) => {
    const userId = member.user?._id || member.user;
    await evictUser(io, room, userId);
    io.to(`user:${userId}`).emit('room:removed', {
      roomId: room.roomId,
      banned: Boolean(ban),
      reason: ban ? 'banned' : 'removed_by_host',
    });
    io.to(roomChannel(room)).emit('room:member-left', {
      roomId: room.roomId,
      userId: String(userId),
      memberId: String(member._id),
      reason: ban ? 'banned' : 'removed',
    });
  });

  bus.on('room.memberLeft', async ({ room, member }) => {
    const userId = member.user?._id || member.user;
    await evictUser(io, room, userId);
    io.to(roomChannel(room)).emit('room:member-left', {
      roomId: room.roomId,
      userId: String(userId),
      memberId: String(member._id),
      reason: 'left',
    });
  });

  bus.on('room.ended', async ({ room }) => {
    io.to(roomChannel(room)).emit('room:ended', {
      roomId: room.roomId,
      endedAt: room.endedAt,
    });
    await evictAll(io, room);
  });

  bus.on('room.settingsUpdated', ({ room }) => {
    io.to(roomChannel(room)).emit('room:settings', {
      roomId: room.roomId,
      room: room.toPublicJSON(),
    });
  });

  bus.on('playback.updated', ({ room, playback, action }) => {
    io.to(roomChannel(room)).emit('playback:state', {
      roomId: room.roomId,
      playback,
      action,
    });
  });

  bus.on('chat.message', ({ room, message, recipientId }) => {
    if (message.channel === 'room') {
      io.to(roomChannel(room)).emit('chat:message', { roomId: room.roomId, message });
      return;
    }
    const recipients = new Set([String(room.host), message.senderId]);
    if (recipientId) recipients.add(String(recipientId));
    recipients.forEach((userId) => {
      io.to(`user:${userId}`).emit('chat:message', { roomId: room.roomId, message });
    });
  });

  bus.on('chat.deleted', ({ room, messageId, channel, senderId, recipientId }) => {
    if (channel === 'room') {
      io.to(roomChannel(room)).emit('chat:deleted', { roomId: room.roomId, messageId });
      return;
    }
    const recipients = new Set([String(room.host), String(senderId)]);
    if (recipientId) recipients.add(String(recipientId));
    recipients.forEach((userId) => {
      io.to(`user:${userId}`).emit('chat:deleted', { roomId: room.roomId, messageId });
    });
  });

  bus.on('chat.cleared', ({ room }) => {
    io.to(roomChannel(room)).emit('chat:cleared', { roomId: room.roomId });
  });

  bus.on('speak.requested', ({ room, request, member }) => {
    io.to(`user:${room.host}`).emit('speak:request', {
      roomId: room.roomId,
      request: {
        id: String(request._id),
        userId: String(member.user?._id || member.user),
        user: member.user?.name
          ? {
              id: String(member.user._id),
              name: member.user.name,
              avatarColor: member.user.avatarColor,
            }
          : undefined,
        note: request.note,
        status: request.status,
        createdAt: request.createdAt,
      },
    });
  });

  bus.on('speak.decided', ({ room, request, decision, notification }) => {
    const userId = request.user?._id || request.user;
    io.to(`user:${userId}`).emit('speak:decision', {
      roomId: room.roomId,
      requestId: String(request._id),
      decision,
      notification: notification?.toPublicJSON?.() || null,
    });
    io.to(`user:${room.host}`).emit('speak:request:resolved', {
      roomId: room.roomId,
      requestId: String(request._id),
      decision,
    });
  });

  bus.on('speak.muteAll', ({ room }) => {
    io.to(roomChannel(room)).emit('speak:mute-all', { roomId: room.roomId });
  });

  bus.on('media.added', ({ room, media }) => {
    io.to(roomChannel(room)).emit('media:added', {
      roomId: room.roomId,
      media: media.toPublicJSON(),
    });
  });

  bus.on('media.removed', ({ room, mediaId }) => {
    io.to(roomChannel(room)).emit('media:removed', { roomId: room.roomId, mediaId });
  });

  bus.on('notification.created', ({ notification }) => {
    io.to(`user:${notification.user?._id || notification.user}`).emit('notification', {
      notification: notification.toPublicJSON(),
    });
  });
}

function emitToUser(io, userId, event, payload) {
  io.to(`user:${userId}`).emit(event, payload);
}

module.exports = {
  registerHandlers,
  registerBridge,
  evictUser,
  evictAll,
  emitToUser,
  roomChannel,
};
