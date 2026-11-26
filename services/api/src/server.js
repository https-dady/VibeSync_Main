'use strict';

const http = require('node:http');
const config = require('./config/env');
const logger = require('./config/logger');
const { connectDatabase, disconnectDatabase } = require('./config/db');
const { connectRedis, closeRedis } = require('./config/redis');
const { createApp } = require('./app');
const { createRealtime } = require('./realtime');
const { ensureUploadDir } = require('./middleware/upload');
const sfu = require('./services/sfu.service');

async function start() {
  ensureUploadDir();
  await connectDatabase();
  await connectRedis().catch((error) => {
    if (config.isProduction) throw error;
    logger.warn({ err: error }, 'Redis unavailable; continuing without distributed presence');
  });

  const app = createApp();
  const server = http.createServer(app);
  const io = createRealtime(server);
  app.set('io', io);
  const stopSfuReconciliation = sfu.startReconciliation();

  await new Promise((resolve, reject) => {
    server.listen(config.PORT, () => {
      logger.info(
        { port: config.PORT, env: config.NODE_ENV },
        `VibeSync API listening on ${config.API_PUBLIC_URL}`,
      );
      resolve();
    });
    server.on('error', reject);
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    app.set('draining', true);
    stopSfuReconciliation();
    logger.info({ signal }, 'Graceful shutdown started');
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    try {
      io.disconnectSockets(true);
      await new Promise((resolve) => io.close(resolve));
      if (server.listening) await new Promise((resolve) => server.close(resolve));
      await closeRedis();
      await disconnectDatabase();
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Graceful shutdown failed');
      process.exit(1);
    }
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (error) => {
    logger.error({ err: error }, 'Unhandled promise rejection');
  });

  return { app, server, io };
}

if (require.main === module) {
  start().catch((error) => {
    logger.fatal({ err: error }, 'Failed to start VibeSync API');
    process.exit(1);
  });
}

module.exports = { start };
