'use strict';

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 60,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      maxlength: 254,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    avatarColor: {
      type: String,
      enum: ['#FD8549', '#FFC123', '#F1F3F5'],
      default: '#FD8549',
    },
    bio: { type: String, default: '', maxlength: 280 },
    settings: {
      notificationsEnabled: { type: Boolean, default: true },
      reduceMotion: { type: Boolean, default: false },
      preferredMediaType: { type: String, enum: ['audio', 'video'], default: 'video' },
    },
    lastSeenAt: { type: Date, default: Date.now },
    disabledAt: { type: Date, default: null },
    tokenVersion: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, versionKey: false },
);

userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    avatarColor: this.avatarColor,
    bio: this.bio,
    settings: this.settings,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
