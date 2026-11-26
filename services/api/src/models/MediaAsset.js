'use strict';

const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema(
  {
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    artist: { type: String, default: '', maxlength: 120 },
    type: { type: String, enum: ['audio', 'video'], required: true },
    source: { type: String, enum: ['upload', 'url'], required: true },
    url: { type: String, default: '' },
    storageKey: { type: String, default: null, select: false },
    storageDriver: { type: String, enum: ['local', 's3'], default: 'local' },
    mimeType: { type: String, default: '' },
    sizeBytes: { type: Number, default: 0, min: 0 },
    durationMs: { type: Number, default: 0, min: 0 },
    provider: { type: String, default: '' },
    playbackCapabilities: { type: mongoose.Schema.Types.Mixed, default: null },
    drmScheme: { type: String, default: '' },
    drmLicenseUrl: { type: String, default: '' },
    drmCertificateUrl: { type: String, default: '' },
    drmContentId: { type: String, default: '' },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

mediaSchema.index({ room: 1, deletedAt: 1, createdAt: -1 });

mediaSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    roomId: this.room.toString(),
    title: this.title,
    artist: this.artist,
    type: this.type,
    source: this.source,
    url: this.url || null,
    streamUrl: this.source === 'upload' ? `/api/media/${this._id}/stream` : null,
    mimeType: this.mimeType,
    sizeBytes: this.sizeBytes,
    durationMs: this.durationMs,
    provider: this.provider,
    playbackCapabilities: this.playbackCapabilities,
    drmScheme: this.drmScheme,
    drmLicenseUrl: this.drmLicenseUrl || null,
    drmCertificateUrl: this.drmCertificateUrl || null,
    drmContentId: this.drmContentId || null,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('MediaAsset', mediaSchema);
