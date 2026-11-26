'use strict';

const dns = require('node:dns');

// Configure DNS immediately, before MongoDB imports and connection.
const DEFAULT_DNS_SERVERS = ['1.1.1.1', '8.8.8.8'];

const dnsServers = process.env.MONGODB_DNS_SERVERS
  ? process.env.MONGODB_DNS_SERVERS
      .split(',')
      .map(server => server.trim())
      .filter(Boolean)
  : DEFAULT_DNS_SERVERS;

dns.setServers(dnsServers);

console.log('[DNS]', dns.getServers());

const mongoose = require('mongoose');
const config = require('./env');
const logger = require('./logger');

// Configure MongoDB DNS resolution
function configureDNS() {
  try {
    logger.info(
      { dnsServers: dns.getServers() },
      'DNS servers configured for MongoDB SRV resolution'
    );
  } catch (error) {
    logger.warn(
      { error: error.message },
      'Unable to configure custom DNS servers'
    );
  }
}

// Configure MongoDB connection
async function connectDatabase() {
  configureDNS();

  mongoose.set('strictQuery', true);
  mongoose.set('sanitizeFilter', true);

  try {
    await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 20000,
      connectTimeoutMS: 20000,
      socketTimeoutMS: 45000,
      maxPoolSize: config.isProduction ? 30 : 10,
      retryWrites: true,
    });

    const hello = await mongoose.connection.db.admin().command({
      hello: 1,
    });

    if (!hello.setName && hello.msg !== 'isdbgrid') {
      throw new Error(
        'VibeSync membership transactions require a MongoDB replica set or sharded cluster. See DEPLOYMENT.md.'
      );
    }

    logger.info(
      { database: mongoose.connection.name },
      'MongoDB connected successfully'
    );

    return mongoose.connection;
  } catch (error) {
    logger.error(
      {
        error: error.message,
        code: error.code,
      },
      'MongoDB connection failed'
    );

    throw error;
  }
}

async function disconnectDatabase() {
  await mongoose.disconnect();

  logger.info('MongoDB disconnected');
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
  mongoose,
};