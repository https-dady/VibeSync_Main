'use strict';

const Notification = require('../models/Notification');
const { publish } = require('../utils/transaction');
const ApiError = require('../utils/ApiError');

async function createNotification(userId, { type, title, body, data }) {
  const notification = await Notification.create({ user: userId, type, title, body, data });
  publish('notification.created', { notification });
  return notification;
}

async function listNotifications(userId, { unreadOnly = false, limit = 30 } = {}) {
  const query = { user: userId };
  if (unreadOnly) query.readAt = null;
  const notifications = await Notification.find(query)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 30, 100));
  const unreadCount = await Notification.countDocuments({ user: userId, readAt: null });
  return { data: notifications.map((item) => item.toPublicJSON()), unreadCount };
}

async function markRead(userId, notificationId) {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, user: userId },
    { $set: { readAt: new Date() } },
    { new: true },
  );
  if (!notification) throw ApiError.notFound('Notification not found', 'NOTIFICATION_NOT_FOUND');
  return notification.toPublicJSON();
}

async function markAllRead(userId) {
  await Notification.updateMany({ user: userId, readAt: null }, { $set: { readAt: new Date() } });
}

module.exports = { createNotification, listNotifications, markRead, markAllRead };
