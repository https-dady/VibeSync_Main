'use strict';

const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const pinoHttp = require('pino-http');
const config = require('./config/env');
const logger = require('./config/logger');
const sanitizeRequest = require('./middleware/sanitize');
const { notFoundHandler, errorHandler } = require('./middleware/error');
const { apiLimiter } = require('./middleware/rateLimits');
const authRoutes = require('./routes/auth.routes');
const roomRoutes = require('./routes/room.routes');
const mediaRoutes = require('./routes/media.routes');
const notificationRoutes = require('./routes/notification.routes');
const deviceRoutes = require('./routes/device.routes');
const rtcRoutes = require('./routes/rtc.routes');
const healthRoutes = require('./routes/health.routes');
const landingRoutes = require('./routes/landing.routes');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const supplied = req.headers['x-request-id'];
        const id = typeof supplied === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(supplied) ? supplied : crypto.randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: {
        ignore: (req) => req.url === '/api/health',
      },
    }),
  );
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.corsOrigins === '*' || config.corsOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error('Origin not allowed'));
      },
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Content-Range', 'Accept-Ranges'],
      maxAge: 86400,
    }),
  );
  app.use(compression());
  app.post('/api/rtc/livekit-webhook', express.raw({ type: ['application/webhook+json', 'application/json'], limit: '256kb' }), require('./services/sfu.service').webhook);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(sanitizeRequest);

  app.use('/api/health', healthRoutes);
  app.use('/api', apiLimiter);
  app.use('/api/auth', authRoutes);
  app.use('/api/rooms', roomRoutes);
  app.use('/api/media', mediaRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/devices', deviceRoutes);
  app.use('/api/rtc', rtcRoutes);
  app.use('/r', landingRoutes);
  app.get('/', (req, res) => {
    res.json({
      name: 'VibeSync API',
      version: '1.0.0',
      documentation: '/api/health',
      independent: true,
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
