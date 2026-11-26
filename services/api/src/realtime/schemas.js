'use strict';

const { z } = require('zod');
const ApiError = require('../utils/ApiError');

function socketValidate(schema, payload) {
  const result = schema.safeParse(payload || {});
  if (!result.success) {
    throw ApiError.badRequest(
      'Invalid event payload',
      'VALIDATION_ERROR',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

const roomEventSchema = z.object({
  roomId: z.string().trim().toUpperCase().regex(/^[A-Z2-9]{7}$/),
});

const playbackSchema = roomEventSchema.extend({
  action: z.enum(['play', 'pause', 'seek', 'setMedia', 'setRate', 'ended']),
  positionMs: z.number().min(0).max(86_400_000).optional(),
  mediaId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
  rate: z.number().min(0.25).max(3).optional(),
  expectedSequence: z.number().int().nonnegative().optional(),
  startAtServerMs: z.number().finite().optional(),
});

const heartbeatSchema = roomEventSchema.extend({
  positionMs: z.number().min(0).max(86_400_000),
  sequence: z.number().int().nonnegative().optional(),
});

const chatSchema = roomEventSchema.extend({
  channel: z.enum(['room', 'host']).default('room'),
  body: z.string().trim().min(1).max(2000),
  targetUserId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
  clientMessageId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional(),
});

const messageIdSchema = roomEventSchema.extend({
  messageId: z.string().regex(/^[a-f0-9]{24}$/i),
});

const speakRequestSchema = roomEventSchema.extend({
  note: z.string().trim().max(200).default(''),
});

const speakDecisionSchema = roomEventSchema.extend({
  requestId: z.string().regex(/^[a-f0-9]{24}$/i),
  decision: z.enum(['approve', 'reject']),
});

const micSchema = roomEventSchema.extend({
  userId: z.string().regex(/^[a-f0-9]{24}$/i),
  granted: z.boolean(),
});

const signalSchema = roomEventSchema.extend({
  targetUserId: z.string().regex(/^[a-f0-9]{24}$/i),
  data: z
    .object({
      type: z.enum(['offer', 'answer', 'ice-candidate', 'renegotiate', 'bye']),
      sdp: z.union([z.string().max(60_000), z.record(z.string(), z.any())]).nullable().optional(),
      candidate: z.any().optional(),
      sessionId: z.string().max(80).nullable().optional(),
    })
    .strict(),
});

const clockSchema = z.object({
  t0: z.number().finite(),
});

module.exports = {
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
};
