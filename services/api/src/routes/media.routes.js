'use strict';

const express = require('express');
const MediaAsset = require('../models/MediaAsset');
const Room = require('../models/Room');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/authenticate');
const { activeMemberOrThrow } = require('../services/room.service');
const { absoluteMediaPath } = require('../services/media.service');
const { apiLimiter } = require('../middleware/rateLimits');
const storage = require('../services/mediaStorage');

const router = express.Router();

async function streamMedia(req, res, next) {
  try {
    const media = await MediaAsset.findOne({
      _id: req.params.mediaId,
      deletedAt: null,
    }).select('+storageKey');
    if (!media) throw ApiError.notFound('Media not found', 'MEDIA_NOT_FOUND');
    const room = await Room.findById(media.room);
    if (!room) throw ApiError.notFound('Room not found', 'ROOM_NOT_FOUND');
    await activeMemberOrThrow(room, req.user._id);
    if (media.source !== 'upload') {
      throw ApiError.badRequest('This media is served by an external provider', 'EXTERNAL_MEDIA');
    }
    res.set({
      'Content-Type': media.mimeType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${encodeURIComponent(media.title).slice(0, 120)}"`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (media.storageDriver === 's3') {
      const object = await storage.stat(media);
      const range = storage.byteRange(req.headers.range, object.size);
      if (range === false) return res.status(416).set('Content-Range', `bytes */${object.size}`).end();
      const length = range ? range.end - range.start + 1 : object.size;
      res.status(range ? 206 : 200).set('Content-Length', String(length));
      if (range) res.set('Content-Range', `bytes ${range.start}-${range.end}/${object.size}`);
      if (req.method === 'HEAD') return res.end();
      const controller = new AbortController();
      let body;
      res.once('close', () => { if (!res.writableEnded) { controller.abort(); body?.destroy(); } });
      body = await storage.stream(media, range, controller.signal);
      body.once('error', (error) => { if (!res.headersSent) next(error); else res.destroy(error); });
      return body.pipe(res);
    }
    const absolute = absoluteMediaPath(media);
    if (!absolute) throw ApiError.notFound('Media file unavailable', 'MEDIA_FILE_MISSING');
    return res.sendFile(absolute, { dotfiles: 'deny' }, (error) => {
      if (error && !res.headersSent) {
        next(error.code === 'ENOENT' ? ApiError.notFound('Media file missing') : error);
      }
    });
  } catch (error) {
    next(error);
  }
}

router.get('/:mediaId/stream', authenticate, apiLimiter, asyncHandler(streamMedia));
router.head('/:mediaId/stream', authenticate, apiLimiter, asyncHandler(streamMedia));

module.exports = router;
