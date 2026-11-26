'use strict';

const { EventEmitter } = require('node:events');

/**
 * In-process domain event bus. REST controllers and Socket.IO handlers both
 * publish here; the realtime bridge fans events out through the Redis-enabled
 * Socket.IO adapter. Keep services free from transport concerns.
 */
const bus = new EventEmitter();
bus.setMaxListeners(50);

module.exports = bus;
