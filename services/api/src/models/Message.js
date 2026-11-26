'use strict';

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    channel: { type: String, enum: ['room', 'host'], default: 'room', index: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    clientMessageId: { type: String, maxlength: 80 },
    type: { type: String, enum: ['text', 'system'], default: 'text' },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, versionKey: false },
);

messageSchema.index({ room: 1, channel: 1, createdAt: -1 });
messageSchema.index({ room: 1, sender: 1, recipient: 1, createdAt: -1 });
messageSchema.index({ room: 1, sender: 1, clientMessageId: 1 }, { unique: true, partialFilterExpression: { clientMessageId: { $type: 'string' } } });
messageSchema.index({ room: 1, channel: 1, createdAt: -1, _id: -1 });

messageSchema.methods.toPublicJSON = function toPublicJSON(sender) {
  const value = sender && sender.toObject ? sender.toObject() : sender;
  return {
    id: this._id.toString(),
    roomId: this.room.toString(),
    channel: this.channel,
    senderId: String(this.sender?._id || this.sender),
    recipientId: this.recipient ? this.recipient.toString() : null,
    sender: value
      ? { id: String(value._id), name: value.name, avatarColor: value.avatarColor }
      : undefined,
    body: this.deletedAt ? '' : this.body,
    clientMessageId: this.clientMessageId || null,
    type: this.type,
    deleted: Boolean(this.deletedAt),
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('Message', messageSchema);
