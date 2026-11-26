'use strict';

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/authenticate');
const config = require('../config/env');
const { iceServers, livekitTokenFor } = require('../services/rtc.service');
const { findRoomOrThrow, activeMemberOrThrow } = require('../services/room.service');
const ApiError = require('../utils/ApiError');

const router = express.Router();
router.use(authenticate);

router.get(
  '/config',
  asyncHandler(async (req, res) => {
    res.json({
      ...iceServers(req.user._id.toString()),
      livekitUrl: config.livekitEnabled ? config.LIVEKIT_URL : null,
      turnConfigured: Boolean(config.TURN_URL),
      meshRecommendedMax: 6,
    });
  }),
);

router.post(
  '/livekit-token',
  asyncHandler(async (req, res) => {
    if (!config.livekitEnabled) throw ApiError.notFound('LiveKit is not configured', 'LIVEKIT_DISABLED');
    const { roomId } = req.body || {};
    if (!roomId) throw ApiError.badRequest('roomId is required', 'VALIDATION_ERROR');
    const room = await findRoomOrThrow(roomId);
    const member = await activeMemberOrThrow(room, req.user._id);
    const token = await livekitTokenFor(room, member, req.user);
    res.json(token);
  }),
);

module.exports = router;
