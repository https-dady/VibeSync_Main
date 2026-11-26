'use strict';

const mongoose = require('mongoose');

const speakRequestSchema = new mongoose.Schema(
  {
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'revoked'],
      default: 'pending',
      index: true,
    },
    note: { type: String, default: '', maxlength: 200 },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

speakRequestSchema.index({ room: 1, user: 1, status: 1 });
speakRequestSchema.index({ room: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('SpeakRequest', speakRequestSchema);
