'use strict';

const mongoose = require('mongoose');
const { AsyncLocalStorage } = require('node:async_hooks');
const bus = require('../realtime/bus');
const ApiError = require('./ApiError');

// Mongoose 8 attaches the transaction session to every query in this context.
mongoose.set('transactionAsyncLocalStorage', true);
const effects = new AsyncLocalStorage();

function publish(event, payload) {
  const queue = effects.getStore();
  if (queue) queue.push(() => bus.emit(event, payload));
  else bus.emit(event, payload);
}

function afterCommit(callback) {
  const queue = effects.getStore();
  if (queue) queue.push(callback);
  else return callback();
}

function atomic(operation) {
  return async (...args) => {
    if (effects.getStore()) return operation(...args);
    let committedEffects = [];
    const result = await mongoose.connection.transaction(async () => {
      const queue = [];
      committedEffects = queue;
      return effects.run(queue, async () => {
        const input = [...args];
        // Route documents were read before the transaction. Reload for each
        // retry so concurrent writes cannot be overwritten by a stale snapshot.
        if (input[0]?.constructor?.modelName === 'Room') {
          input[0] = await input[0].constructor.findById(input[0]._id);
          if (!input[0]) throw ApiError.notFound('Room not found', 'ROOM_NOT_FOUND');
        }
        return operation(...input);
      });
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 10000 });
    for (const effect of committedEffects) await effect();
    return result;
  };
}

module.exports = { atomic, publish, afterCommit };
