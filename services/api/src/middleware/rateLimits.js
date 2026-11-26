'use strict';

const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const config = require('../config/env');

function buildLimiter({ windowMs, max, message, keyGenerator }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => config.isTest,
    // express-rate-limit's default IPv6-safe IP key is used unless a user key is supplied.
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (req, res) => {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message },
      });
    },
  });
}

const authLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many authentication attempts. Try again later.',
});

const apiLimiter = buildLimiter({
  windowMs: 60 * 1000,
  max: 240,
  message: 'Too many requests. Slow down.',
});

const writeLimiter = buildLimiter({
  windowMs: 60 * 1000,
  max: 90,
  message: 'Too many write operations. Slow down.',
});

const uploadLimiter = buildLimiter({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: 'Too many uploads. Try again later.',
});

const chatRestLimiter = buildLimiter({
  windowMs: 60 * 1000,
  max: 40,
  message: 'Chat is rate limited.',
  keyGenerator: (req) =>
    req.user ? `user:${req.user._id.toString()}` : `ip:${ipKeyGenerator(req.ip)}`,
});

module.exports = { authLimiter, apiLimiter, writeLimiter, uploadLimiter, chatRestLimiter, buildLimiter };
