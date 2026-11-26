'use strict';

const express = require('express');
const { z } = require('zod');
const Room = require('../models/Room');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/authenticate');
const { writeLimiter, uploadLimiter, chatRestLimiter } = require('../middleware/rateLimits');
const { mediaUpload } = require('../middleware/upload');
const roomService = require('../services/room.service');
const playbackService = require('../services/playback.service');
const mediaService = require('../services/media.service');
const chatService = require('../services/chat.service');
const speakService = require('../services/speak.service');
const { listNotifications } = require('../services/notification.service');

const router = express.Router();

const roomIdParam = z.object({
  roomId: z.string().trim().toUpperCase().regex(/^[A-Z2-9]{7}$/),
});

function parseParams(schema, req) {
  const result = schema.safeParse(req.params);
  if (!result.success) throw ApiError.badRequest('Invalid route parameters', 'VALIDATION_ERROR');
  return result.data;
}

const roomCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).default(''),
  mode: z.enum(['online', 'nearby']).default('online'),
  mediaType: z.enum(['audio', 'video']).default('video'),
  visibility: z.enum(['public', 'private']).default('public'),
  maxParticipants: z.coerce.number().int().min(2).max(50).default(10),
  password: z.string().min(4).max(64).optional().or(z.literal('')),
  joinApproval: z.boolean().default(false),
  allowChat: z.boolean().default(true),
  allowMicRequests: z.boolean().default(true),
  chatRateLimitPerMinute: z.coerce.number().int().min(3).max(60).default(20),
});

const joinSchema = z.object({
  password: z.string().max(64).optional(),
  message: z.string().trim().max(200).optional(),
});

const settingsSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(400).optional(),
  maxParticipants: z.coerce.number().int().min(2).max(50).optional(),
  allowChat: z.boolean().optional(),
  allowMicRequests: z.boolean().optional(),
  joinApproval: z.boolean().optional(),
  chatRateLimitPerMinute: z.coerce.number().int().min(3).max(60).optional(),
  password: z.union([z.string().min(4).max(64), z.literal(''), z.null()]).optional(),
});

const playbackCommandSchema = z.object({
  action: z.enum(['play', 'pause', 'seek', 'setMedia', 'setRate', 'ended']),
  positionMs: z.number().min(0).max(86_400_000).optional(),
  mediaId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
  rate: z.number().min(0.25).max(3).optional(),
  expectedSequence: z.number().int().nonnegative().optional(),
  startAtServerMs: z.number().finite().optional(),
});

async function loadRoom(req, res, next) {
  try {
    const { roomId } = parseParams(roomIdParam, req);
    const room = await Room.findByRoomId(roomId);
    if (!room) throw ApiError.notFound('Room not found', 'ROOM_NOT_FOUND');
    req.room = room;
    next();
  } catch (error) {
    next(error);
  }
}

const requireHost = asyncHandler(async (req, res, next) => {
  await roomService.hostMemberOrThrow(req.room, req.user._id);
  next();
});

router.use(authenticate);
router.use('/:roomId', loadRoom);

router.get(
  '/',
  validate(
    z.object({
      mode: z.enum(['online', 'nearby']).optional(),
      mediaType: z.enum(['audio', 'video']).optional(),
      search: z.string().trim().max(80).optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const result = await roomService.listPublicRooms(req.validatedQuery);
    res.json(result);
  }),
);

router.post(
  '/',
  writeLimiter,
  validate(roomCreateSchema),
  asyncHandler(async (req, res) => {
    const room = await roomService.createRoom(req.user, req.body);
    const payload = await roomService.getRoomPayload(room, req.user._id);
    res.status(201).json(payload);
  }),
);

router.get(
  '/:roomId',
  asyncHandler(async (req, res) => {
    const member = await roomService.getMembership(req.room, req.user._id, { includeInactive: true });
    if (req.room.visibility === 'private' && !['active', 'pending'].includes(member?.status)) {
      throw ApiError.forbidden('This is a private room', 'PRIVATE_ROOM');
    }
    if (member?.status === 'banned' || member?.status === 'removed') {
      throw ApiError.forbidden('You no longer have access to this room', 'ROOM_BANNED');
    }
    const payload = await roomService.getRoomPayload(req.room, req.user._id);
    res.json({ ...payload, shareLink: payload.room.shareLink });
  }),
);

router.post(
  '/:roomId/join',
  writeLimiter,
  validate(joinSchema),
  asyncHandler(async (req, res) => {
    const result = await roomService.requestOrJoin(req.user, req.room.roomId, req.body);
    await result.member.populate('user', 'name avatarColor');
    res.status(result.state === 'pending' ? 202 : 200).json({
      state: result.state,
      membership: result.member.toPublicJSON(result.member.user),
      room: (await roomService.getRoomPayload(result.room, req.user._id)).room,
    });
  }),
);

router.post(
  '/:roomId/leave',
  writeLimiter,
  asyncHandler(async (req, res) => {
    await roomService.leaveRoom(req.room, req.user._id);
    res.status(204).end();
  }),
);

router.get(
  '/:roomId/requests',
  asyncHandler(async (req, res) => {
    const requests = await roomService.listJoinRequests(req.room, req.user._id);
    res.json({ data: requests });
  }),
);

router.get(
  '/:roomId/requests/mine',
  asyncHandler(async (req, res) => {
    const membership = await roomService.pendingRequestsForUser(req.room, req.user._id);
    res.json({ membership });
  }),
);

router.post(
  '/:roomId/requests/:memberId/decision',
  writeLimiter,
  validate(z.object({ decision: z.enum(['approve', 'reject']), ban: z.boolean().default(false) })),
  asyncHandler(async (req, res) => {
    const member = await roomService.decideJoinRequest(
      req.room,
      req.user._id,
      req.params.memberId,
      req.body.decision,
      { ban: req.body.ban },
    );
    res.json({ member: member.toPublicJSON(member.user) });
  }),
);

router.get(
  '/:roomId/members',
  asyncHandler(async (req, res) => {
    const members = await roomService.listMembers(req.room, req.user._id);
    res.json({ data: members });
  }),
);

router.patch(
  '/:roomId/members/:memberId/permissions',
  writeLimiter,
  validate(
    z.object({
      canChat: z.boolean().optional(),
      canSpeak: z.boolean().optional(),
      mutedByHost: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const member = await roomService.updateMemberPermissions(
      req.room,
      req.user._id,
      req.params.memberId,
      req.body,
    );
    res.json({ member: member.toPublicJSON(member.user) });
  }),
);

router.delete(
  '/:roomId/members/:memberId',
  writeLimiter,
  asyncHandler(async (req, res) => {
    const member = await roomService.removeMember(req.room, req.user._id, req.params.memberId, {
      ban: req.query.ban === 'true',
    });
    res.json({ member: member.toPublicJSON(member.user) });
  }),
);

router.patch(
  '/:roomId/settings',
  writeLimiter,
  validate(settingsSchema),
  asyncHandler(async (req, res) => {
    const room = await roomService.updateRoomSettings(req.room, req.user._id, req.body);
    res.json({ room: room.toPublicJSON() });
  }),
);

router.post(
  '/:roomId/end',
  writeLimiter,
  asyncHandler(async (req, res) => {
    const room = await roomService.endRoom(req.room, req.user._id);
    res.json({ room: room.toPublicJSON(), state: 'ended' });
  }),
);

router.get(
  '/:roomId/playback',
  asyncHandler(async (req, res) => {
    await roomService.activeMemberOrThrow(req.room, req.user._id);
    const playback = await playbackService.getPlayback(req.room);
    res.json({ playback });
  }),
);

router.post(
  '/:roomId/playback/command',
  writeLimiter,
  validate(playbackCommandSchema),
  asyncHandler(async (req, res) => {
    const playback = await playbackService.applyHostCommand(req.room, req.user._id, req.body);
    res.json({ playback });
  }),
);

router.post(
  '/:roomId/playback/heartbeat',
  writeLimiter,
  validate(z.object({ positionMs: z.number().min(0).max(86_400_000), sequence: z.number().int().nonnegative().optional() })),
  asyncHandler(async (req, res) => {
    const playback = await playbackService.hostHeartbeat(req.room, req.user._id, req.body.positionMs, req.body.sequence);
    res.json({ playback });
  }),
);

router.get(
  '/:roomId/media',
  asyncHandler(async (req, res) => {
    const media = await mediaService.listMedia(req.room, req.user._id);
    res.json({ data: media });
  }),
);

router.post(
  '/:roomId/media/upload',
  uploadLimiter,
  requireHost,
  mediaUpload.single('file'),
  validate(
    z.object({
      title: z.string().trim().min(1).max(160).optional(),
      artist: z.string().trim().max(120).optional(),
      mediaType: z.enum(['audio', 'video']).optional(),
      durationMs: z.coerce.number().min(0).max(86_400_000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('A media file is required', 'FILE_REQUIRED');
    const media = await mediaService.addUploadedMedia(req.room, req.user._id, req.file, req.body);
    req.fileSaved = true;
    res.status(201).json({ media: media.toPublicJSON() });
  }),
);

router.post(
  '/:roomId/media/url',
  writeLimiter,
  validate(
    z.object({
      title: z.string().trim().min(1).max(160),
      artist: z.string().trim().max(120).default(''),
      type: z.enum(['audio', 'video']),
      url: z.string().url().max(2048),
      mimeType: z.string().max(120).optional(),
      durationMs: z.coerce.number().min(0).max(86_400_000).default(0),
      provider: z.string().max(80).default(''),
      drmScheme: z.enum(['', 'widevine', 'fairplay', 'playready', 'clearkey']).default(''),
      drmLicenseUrl: z.union([z.string().url().max(2048), z.literal('')]).default(''),
      drmCertificateUrl: z.union([z.string().url().max(2048), z.literal('')]).default(''),
      drmContentId: z.string().trim().max(2048).default(''),
    }),
  ),
  asyncHandler(async (req, res) => {
    const media = await mediaService.addUrlMedia(req.room, req.user._id, req.body);
    res.status(201).json({ media: media.toPublicJSON() });
  }),
);

router.delete(
  '/:roomId/media/:mediaId',
  writeLimiter,
  asyncHandler(async (req, res) => {
    await mediaService.deleteMedia(req.room, req.user._id, req.params.mediaId);
    res.status(204).end();
  }),
);

router.get(
  '/:roomId/messages',
  validate(
    z.object({
      channel: z.enum(['room', 'host']).default('room'),
      before: z.string().datetime().optional(),
      beforeId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const result = await chatService.listMessages(req.room, req.user._id, req.validatedQuery);
    res.json(result);
  }),
);

router.post(
  '/:roomId/messages',
  chatRestLimiter,
  validate(
    z.object({
      channel: z.enum(['room', 'host']).default('room'),
      body: z.string().trim().min(1).max(2000),
      targetUserId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
      clientMessageId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const message = await chatService.createMessage(req.room, req.user, req.body);
    res.status(201).json({ message });
  }),
);

router.delete(
  '/:roomId/messages/:messageId',
  writeLimiter,
  asyncHandler(async (req, res) => {
    await chatService.deleteMessage(req.room, req.user._id, req.params.messageId);
    res.status(204).end();
  }),
);

router.post(
  '/:roomId/messages/moderation',
  writeLimiter,
  validate(z.object({ action: z.enum(['clear']) })),
  asyncHandler(async (req, res) => {
    await chatService.updateModeration(req.room, req.user._id, null, req.body.action);
    res.status(204).end();
  }),
);

router.post(
  '/:roomId/speak-requests',
  writeLimiter,
  validate(z.object({ note: z.string().trim().max(200).default('') })),
  asyncHandler(async (req, res) => {
    const result = await speakService.requestToSpeak(req.room, req.user._id, req.body.note);
    res.status(201).json({ status: result.status, request: result.request });
  }),
);

router.get(
  '/:roomId/speak-requests',
  asyncHandler(async (req, res) => {
    const requests = await speakService.listSpeakRequests(req.room, req.user._id);
    res.json({ data: requests });
  }),
);

router.post(
  '/:roomId/speak-requests/:requestId/decision',
  writeLimiter,
  validate(z.object({ decision: z.enum(['approve', 'reject']) })),
  asyncHandler(async (req, res) => {
    const request = await speakService.decideSpeakRequest(
      req.room,
      req.user._id,
      req.params.requestId,
      req.body.decision,
    );
    res.json({ request });
  }),
);

router.post(
  '/:roomId/members/:userId/mic',
  writeLimiter,
  validate(z.object({ granted: z.boolean() })),
  asyncHandler(async (req, res) => {
    if (req.body.granted) {
      const member = await roomService.updateMemberPermissions(
        req.room,
        req.user._id,
        await findMemberId(req.room, req.params.userId),
        { canSpeak: true },
      );
      return res.json({ member: member.toPublicJSON(member.user) });
    }
    const member = await speakService.revokeMic(req.room, req.user._id, req.params.userId);
    return res.json({ member: member.toPublicJSON(member.user) });
  }),
);

router.post(
  '/:roomId/mic/mute-all',
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await speakService.muteAll(req.room, req.user._id));
  }),
);

router.get(
  '/:roomId/notifications',
  asyncHandler(async (req, res) => {
    const result = await listNotifications(req.user._id, { limit: 30 });
    res.json(result);
  }),
);

async function findMemberId(room, userId) {
  const RoomMember = require('../models/RoomMember');
  const member = await RoomMember.findOne({ room: room._id, user: userId, status: 'active' });
  if (!member) throw ApiError.notFound('Member not found', 'MEMBER_NOT_FOUND');
  return member._id;
}

module.exports = router;
