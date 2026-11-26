'use strict';

const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema(
  {
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['host', 'participant'], default: 'participant' },
    status: {
      type: String,
      enum: ['pending', 'active', 'left', 'removed', 'banned'],
      default: 'active',
      index: true,
    },
    joinRequestMessage: { type: String, default: '', maxlength: 200 },
    permissions: {
      canChat: { type: Boolean, default: true },
      canSpeak: { type: Boolean, default: false },
      micRequested: { type: Boolean, default: false },
      micApproved: { type: Boolean, default: false },
      mutedByHost: { type: Boolean, default: false },
    },
    joinedAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    sfuTokenNotBefore: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false },
);

memberSchema.index({ room: 1, user: 1 }, { unique: true });
memberSchema.index({ room: 1, status: 1, joinedAt: 1 });

memberSchema.methods.toPublicJSON = function toPublicJSON(user) {
  const value = user && user.toObject ? user.toObject() : user;
  const populatedUser = this.user && this.user._id ? this.user : null;
  const userId = populatedUser ? populatedUser._id.toString() : this.user.toString();
  return {
    id: this._id.toString(),
    userId,
    role: this.role,
    status: this.status,
    user: value
      ? {
          id: String(value._id),
          name: value.name,
          avatarColor: value.avatarColor,
          lastSeenAt: value.lastSeenAt,
        }
      : populatedUser
        ? {
            id: populatedUser._id.toString(),
            name: populatedUser.name,
            avatarColor: populatedUser.avatarColor,
            lastSeenAt: populatedUser.lastSeenAt,
          }
        : undefined,
    permissions: this.permissions,
    joinedAt: this.joinedAt,
    lastSeenAt: this.lastSeenAt,
  };
};

module.exports = mongoose.model('RoomMember', memberSchema);
