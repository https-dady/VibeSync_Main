'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/authenticate');
const { writeLimiter } = require('../middleware/rateLimits');
const {
  listNotifications,
  markRead,
  markAllRead,
} = require('../services/notification.service');

const router = express.Router();
router.use(authenticate);

router.get(
  '/',
  validate(
    z.object({
      unreadOnly: z.enum(['true', 'false']).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const result = await listNotifications(req.user._id, {
      unreadOnly: req.validatedQuery.unreadOnly === 'true',
      limit: req.validatedQuery.limit,
    });
    res.json(result);
  }),
);

router.post(
  '/read-all',
  writeLimiter,
  asyncHandler(async (req, res) => {
    await markAllRead(req.user._id);
    res.status(204).end();
  }),
);

router.post(
  '/:notificationId/read',
  writeLimiter,
  asyncHandler(async (req, res) => {
    const notification = await markRead(req.user._id, req.params.notificationId);
    res.json({ notification });
  }),
);

module.exports = router;
