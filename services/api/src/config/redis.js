'use strict';

const { createClient } = require('redis');
const config = require('./env');
const logger = require('./logger');

let client = null;
let publisher = null;
let subscriber = null;
let ready = false;
const states = { client: false, publisher: false, subscriber: false };

function observe(connection, name) {
  connection.on('error', (error) => { states[name] = false; logger.error({ err: error, redisConnection: name }, 'Redis connection error'); });
  connection.on('ready', () => { states[name] = true; });
  connection.on('end', () => { states[name] = false; });
  connection.on('reconnecting', () => { states[name] = false; });
}

async function connectRedis() {
  if (!config.REDIS_URL) {
    logger.warn('REDIS_URL not configured; using single-instance in-memory presence and Mongo playback persistence');
    return null;
  }

  client = createClient({ url: config.REDIS_URL, socket: { connectTimeout: 10000,
    reconnectStrategy: (retries) => retries > 5 ? new Error('Redis reconnect limit reached') : Math.min(500 * 2 ** retries, 10000) } });
  observe(client, 'client');
  client.on('error', (error) => {
    ready = false;
    logger.error({ err: error }, 'Redis client error');
  });
  client.on('ready', () => {
    ready = true;
    logger.info('Redis connected');
  });
  client.on('end', () => {
    ready = false;
  });
  await client.connect();

  publisher = client.duplicate();
  subscriber = client.duplicate();
  observe(publisher, 'publisher');
  observe(subscriber, 'subscriber');
  await Promise.all([publisher.connect(), subscriber.connect()]);
  return { client, publisher, subscriber };
}

function getRedis() {
  return ready ? client : null;
}

function isRedisReady() {
  return ready && states.client && states.publisher && states.subscriber;
}

async function closeRedis() {
  ready = false;
  states.client = states.publisher = states.subscriber = false;
  const clients = [subscriber, publisher, client].filter(Boolean);
  await Promise.allSettled(clients.map((c) => (c.isOpen ? c.quit() : Promise.resolve())));
  subscriber = null;
  publisher = null;
  client = null;
}

module.exports = {
  connectRedis,
  getRedis,
  isRedisReady,
  closeRedis,
  getRedisClients: () => ({ client, publisher, subscriber }),
};
