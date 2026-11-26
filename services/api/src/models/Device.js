'use strict';

const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    deviceId: { type: String, required: true, maxlength: 128 },
    platform: { type: String, enum: ['android', 'ios', 'web', 'unknown'], default: 'unknown' },
    appVersion: { type: String, default: '', maxlength: 40 },
    pushToken: { type: String, default: '', maxlength: 512 },
    capabilities: {
      ble: { type: Boolean, default: false },
      wifiDirect: { type: Boolean, default: false },
      localHttp: { type: Boolean, default: false },
      multipeer: { type: Boolean, default: false },
    },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false },
);

deviceSchema.index({ user: 1, deviceId: 1 }, { unique: true });
deviceSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

module.exports = mongoose.model('Device', deviceSchema);
