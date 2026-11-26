'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/authenticate');
const { writeLimiter } = require('../middleware/rateLimits');
const Device = require('../models/Device');

const router = express.Router();
router.use(authenticate);

const deviceSchema = z.object({
  deviceId: z.string().min(4).max(128),
  platform: z.enum(['android', 'ios', 'web', 'unknown']),
  appVersion: z.string().max(40).default(''),
  pushToken: z.string().max(512).default(''),
  capabilities: z
    .object({
      ble: z.boolean().default(false),
      wifiDirect: z.boolean().default(false),
      localHttp: z.boolean().default(false),
      multipeer: z.boolean().default(false),
    })
    .default({}),
});

router.post(
  '/',
  writeLimiter,
  validate(deviceSchema),
  asyncHandler(async (req, res) => {
    const device = await Device.findOneAndUpdate(
      { user: req.user._id, deviceId: req.body.deviceId },
      { $set: { ...req.body, lastSeenAt: new Date() }, $setOnInsert: { user: req.user._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    res.status(201).json({
      device: {
        id: device._id.toString(),
        deviceId: device.deviceId,
        platform: device.platform,
        capabilities: device.capabilities,
        lastSeenAt: device.lastSeenAt,
      },
    });
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const devices = await Device.find({ user: req.user._id }).sort({ lastSeenAt: -1 });
    res.json({
      data: devices.map((device) => ({
        id: device._id.toString(),
        deviceId: device.deviceId,
        platform: device.platform,
        appVersion: device.appVersion,
        capabilities: device.capabilities,
        lastSeenAt: device.lastSeenAt,
      })),
    });
  }),
);

router.delete(
  '/:deviceId',
  writeLimiter,
  asyncHandler(async (req, res) => {
    await Device.deleteOne({ user: req.user._id, deviceId: req.params.deviceId });
    res.status(204).end();
  }),
);

module.exports = router;
