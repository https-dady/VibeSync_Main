'use strict';

const mongoose = require('mongoose');

const playbackSchema = new mongoose.Schema(
  {
    media: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset', default: null },
    status: {
      type: String,
      enum: ['idle', 'playing', 'paused', 'ended'],
      default: 'idle',
    },
    positionMs: { type: Number, min: 0, default: 0 },
    rate: { type: Number, min: 0.25, max: 3, default: 1 },
    updatedAt: { type: Date, default: Date.now },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    sequence: { type: Number, default: 0 },
    startAtServerMs: { type: Number, default: null },
  },
  { _id: false },
);

const roomSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, unique: true, uppercase: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: '', maxlength: 400 },
    host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mode: { type: String, enum: ['online', 'nearby'], default: 'online', index: true },
    mediaType: { type: String, enum: ['audio', 'video'], default: 'video' },
    visibility: { type: String, enum: ['public', 'private'], default: 'public', index: true },
    status: { type: String, enum: ['active', 'ended'], default: 'active', index: true },
    maxParticipants: { type: Number, min: 2, max: 50, default: 10 },
    memberCount: { type: Number, min: 0, default: 1 },
    passwordHash: { type: String, default: null, select: false },
    hasPassword: { type: Boolean, default: false },
    joinApproval: { type: Boolean, default: false },
    allowChat: { type: Boolean, default: true },
    allowMicRequests: { type: Boolean, default: true },
    chatRateLimitPerMinute: { type: Number, min: 3, max: 60, default: 20 },
    roomChatEnabled: { type: Boolean, default: true },
    playback: { type: playbackSchema, default: () => ({}) },
    nearby: {
      sessionToken: { type: String, default: null, select: false },
      transport: { type: String, default: '' },
      lanHint: { type: String, default: '' },
    },
    endedAt: { type: Date, default: null },
    lastActivityAt: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false },
);

roomSchema.index({ visibility: 1, mode: 1, status: 1, lastActivityAt: -1 });
roomSchema.index({ host: 1, status: 1 });
// Active rooms must never disappear via a TTL index while files/members remain.
// Retention is handled by the explicit maintenance command.

roomSchema.methods.toPublicJSON = function toPublicJSON(hostUser) {
  return {
    id: this._id.toString(),
    roomId: this.roomId,
    name: this.name,
    description: this.description,
    hostId: String(this.host?._id || this.host),
    host: hostUser?.name ? { id: String(hostUser._id || hostUser.id), name: hostUser.name, avatarColor: hostUser.avatarColor } : null,
    mode: this.mode,
    mediaType: this.mediaType,
    visibility: this.visibility,
    status: this.status,
    maxParticipants: this.maxParticipants,
    memberCount: this.memberCount,
    hasPassword: Boolean(this.hasPassword),
    joinApproval: this.joinApproval,
    allowChat: this.allowChat,
    allowMicRequests: this.allowMicRequests,
    roomChatEnabled: this.roomChatEnabled,
    nearby: this.mode === 'nearby' ? { transport: this.nearby?.transport || 'native' } : undefined,
    playback: {
      mediaId: this.playback?.media ? this.playback.media.toString() : null,
      status: this.playback?.status || 'idle',
      positionMs: this.playback?.positionMs || 0,
      rate: this.playback?.rate || 1,
      updatedAt: this.playback?.updatedAt || this.createdAt,
      sequence: this.playback?.sequence || 0,
    },
    createdAt: this.createdAt,
    endedAt: this.endedAt,
  };
};

roomSchema.statics.findByRoomId = function findByRoomId(roomId) {
  const normalized = String(roomId).trim().toUpperCase();
  if (!/^[A-Z2-9]{7}$/.test(normalized)) {
    throw require('../utils/ApiError').badRequest('Enter a seven-character room code', 'INVALID_ROOM_CODE');
  }
  return this.findOne({ roomId: normalized });
};

module.exports = mongoose.model('Room', roomSchema);
