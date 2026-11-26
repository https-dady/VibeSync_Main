'use strict';

const config = require('../config/env');

function roomShareLink(roomId) {
  return `${config.PUBLIC_WEB_URL.replace(/\/$/, '')}/r/${roomId}`;
}

function roomDeepLink(roomId) {
  return `vibesync://room/${roomId}`;
}

function mediaStreamPath(mediaId) {
  return `/api/media/${mediaId}/stream`;
}

function publicUser(user) {
  if (!user) return null;
  const value = user.toObject ? user.toObject() : user;
  return {
    id: String(value._id || value.id),
    name: value.name,
    email: value.email,
    avatarColor: value.avatarColor,
    bio: value.bio || '',
    createdAt: value.createdAt,
  };
}

module.exports = { roomShareLink, roomDeepLink, mediaStreamPath, publicUser };
