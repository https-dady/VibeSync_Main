'use strict';

const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const config = require('../config/env');
const { isRedisReady } = require('../config/redis');
const sfu = require('../services/sfu.service');

const router = express.Router();

router.get('/live', (req, res) => res.json({ status: 'alive', service: 'vibesync-api' }));
router.get('/ready', asyncHandler(async (req, res) => {
  let database = false;
  if (!req.app.get('draining') && mongoose.connection.readyState === 1) {
    try { await mongoose.connection.db.admin().command({ ping: 1 }, { maxTimeMS: 1000 }); database = true; } catch { /* reported below */ }
  }
  const redis = !config.REDIS_URL || isRedisReady();
  const ready = database && redis && sfu.isHealthy() && !req.app.get('draining');
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not-ready', database, redis, draining: Boolean(req.app.get('draining')) });
}));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const dbState = mongoose.connection.readyState;
    const healthy = dbState === 1 && (!config.REDIS_URL || isRedisReady()) && !req.app.get('draining');
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      service: 'vibesync-api',
      version: '1.0.0',
      time: new Date().toISOString(),
      database: dbState === 1 ? 'connected' : 'disconnected',
      redis: config.REDIS_URL ? (isRedisReady() ? 'connected' : 'disconnected') : 'not-configured',
      livekit: config.livekitEnabled ? 'configured' : 'not-configured',
    });
  }),
);

module.exports = router;
