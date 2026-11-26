'use strict';

const pino = require('pino');
const config = require('./env');

const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'passwordHash',
      'refreshToken',
      'token',
      'accessToken',
      'req.body.password',
      'req.body.refreshToken',
    ],
    censor: '[redacted]',
  },
  base: { service: 'vibesync-api' },
});

module.exports = logger;
