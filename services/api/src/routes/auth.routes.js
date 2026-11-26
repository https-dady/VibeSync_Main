'use strict';

const { trusted } = require('mongoose');
const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/authenticate');
const { authLimiter, writeLimiter } = require('../middleware/rateLimits');
const User = require('../models/User');
const Device = require('../models/Device');
const RefreshSession = require('../models/RefreshSession');
const ApiError = require('../utils/ApiError');
const { hashPassword, verifyPassword } = require('../services/password.service');
const {
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllSessions,
} = require('../services/token.service');
const router = express.Router();

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

const registerSchema = z.object({
  name: z.string().trim().min(2).max(60),
  email: z.string().trim().toLowerCase().email().max(254),
  password: passwordSchema,
  device: z
    .object({
      deviceId: z.string().min(4).max(128),
      platform: z.enum(['android', 'ios', 'web', 'unknown']).default('unknown'),
      appVersion: z.string().max(40).default(''),
      capabilities: z
        .object({
          ble: z.boolean().default(false),
          wifiDirect: z.boolean().default(false),
          localHttp: z.boolean().default(false),
          multipeer: z.boolean().default(false),
        })
        .optional(),
    })
    .optional(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
  device: registerSchema.shape.device,
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

async function upsertDevice(userId, device) {
  if (!device) return;
  await Device.findOneAndUpdate(
    { user: userId, deviceId: device.deviceId },
    {
      $set: {
        platform: device.platform,
        appVersion: device.appVersion,
        capabilities: device.capabilities || {},
        lastSeenAt: new Date(),
      },
      $setOnInsert: { user: userId, deviceId: device.deviceId },
    },
    { upsert: true },
  );
}

router.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { name, email, password, device } = req.body;
    const existing = await User.findOne({ email });
    if (existing) throw ApiError.conflict('An account with that email already exists', 'EMAIL_IN_USE');
    const user = await User.create({
      name,
      email,
      passwordHash: await hashPassword(password),
    });
    await upsertDevice(user._id, device);
    const tokens = await issueTokenPair(user, {
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
    });
    res.status(201).json({ user: user.toPublicJSON(), ...tokens });
  }),
);

router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password, device } = req.body;
    const user = await User.findOne({ email }).select('+passwordHash');
    const valid = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !valid || user.disabledAt) {
      throw ApiError.unauthorized('Email or password is incorrect', 'INVALID_CREDENTIALS');
    }
    user.lastSeenAt = new Date();
    if (!user.passwordHash.startsWith('v2$')) user.passwordHash = await hashPassword(password);
    await user.save();
    await upsertDevice(user._id, device);
    const tokens = await issueTokenPair(user, {
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
    });
    res.json({ user: user.toPublicJSON(), ...tokens });
  }),
);

router.post(
  '/refresh',
  authLimiter,
  validate(refreshSchema),
  asyncHandler(async (req, res) => {
    const tokens = await rotateRefreshToken(req.body.refreshToken, {
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
    });
    res.json(tokens);
  }),
);

router.post(
  '/logout',
  validate(z.object({ refreshToken: z.string().min(20).optional() })),
  asyncHandler(async (req, res) => {
    if (req.body.refreshToken) await revokeRefreshToken(req.body.refreshToken);
    res.status(204).end();
  }),
);

router.post(
  '/logout-all',
  authenticate,
  asyncHandler(async (req, res) => {
    await revokeAllSessions(req.user._id);
    req.app.get('io')?.in(`user:${req.user._id}`).disconnectSockets(true);
    res.status(204).end();
  }),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user.toPublicJSON() });
  }),
);

router.patch(
  '/me',
  authenticate,
  writeLimiter,
  validate(
    z.object({
      name: z.string().trim().min(2).max(60).optional(),
      bio: z.string().trim().max(280).optional(),
      avatarColor: z.enum(['#FD8549', '#FFC123', '#F1F3F5']).optional(),
      settings: z
        .object({
          notificationsEnabled: z.boolean().optional(),
          reduceMotion: z.boolean().optional(),
          preferredMediaType: z.enum(['audio', 'video']).optional(),
        })
        .optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const updates = req.body;
    if (updates.name !== undefined) req.user.name = updates.name;
    if (updates.bio !== undefined) req.user.bio = updates.bio;
    if (updates.avatarColor !== undefined) req.user.avatarColor = updates.avatarColor;
    if (updates.settings) {
      req.user.settings = { ...req.user.settings.toObject(), ...updates.settings };
    }
    await req.user.save();
    res.json({ user: req.user.toPublicJSON() });
  }),
);

router.post(
  '/change-password',
  authenticate,
  writeLimiter,
  validate(
    z.object({
      currentPassword: z.string().min(1).max(128),
      newPassword: passwordSchema,
    }),
  ),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).select('+passwordHash');
    const valid = await verifyPassword(req.body.currentPassword, user.passwordHash);
    if (!valid) throw ApiError.forbidden('Current password is incorrect', 'INVALID_PASSWORD');
    user.passwordHash = await hashPassword(req.body.newPassword);
    await user.save();
    await revokeAllSessions(user._id);
    req.app.get('io')?.in(`user:${user._id}`).disconnectSockets(true);
    res.status(204).end();
  }),
);

router.get(
  '/sessions',
  authenticate,
  asyncHandler(async (req, res) => {
    // Refresh tokens rotate on every use, so only the latest token in each
    // family is unrevoked. Listing unrevoked, unexpired rows therefore returns
    // one entry per active signed-in device/session.
    const sessions = await RefreshSession.find({
      user: req.user._id,
      revokedAt: null,
      expiresAt: trusted({ $gt: new Date() }),
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({
      data: sessions.map((session) => ({
        id: String(session._id),
        createdAt: session.createdAt,
        lastUsedAt: session.updatedAt,
        expiresAt: session.expiresAt,
        ip: session.ip || '',
        userAgent: session.userAgent || '',
      })),
      count: sessions.length,
    });
  }),
);

module.exports = router;
