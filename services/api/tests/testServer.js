'use strict';

const http = require('node:http');
const path = require('node:path');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { io: ioClient } = require('socket.io-client');

const { createApp } = require('../src/app');
const { createRealtime } = require('../src/realtime');
const { ensureUploadDir } = require('../src/middleware/upload');

let mongod;
let httpServer;
let io;
let app;
let baseUrl;

async function startTestServer() {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1, dbName: 'vibesync-test', storageEngine: 'wiredTiger' } });
  await mongoose.connect(mongod.getUri(), { serverSelectionTimeoutMS: 20000 });
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  ensureUploadDir();
  app = createApp();
  httpServer = http.createServer(app);
  io = createRealtime(httpServer);
  app.set('io', io);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer() {
  if (io) {
    io.disconnectSockets(true);
    await new Promise((resolve) => io.close(resolve));
  }
  if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

async function register(name, email, password = 'Password123') {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ name, email, password })
    .expect(201);
  return response.body;
}

function authed(token) {
  return { Authorization: `Bearer ${token}` };
}

function connectSocket(token) {
  return ioClient(baseUrl, {
    transports: ['websocket'],
    auth: { token },
    reconnection: false,
    timeout: 8000,
  });
}

function waitFor(socket, event, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeout);
    function handler(payload) {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

function emitAck(socket, event, payload, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Ack timeout for ${event}`)), timeout);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

module.exports = {
  startTestServer,
  stopTestServer,
  register,
  authed,
  connectSocket,
  waitFor,
  emitAck,
  get app() {
    return app;
  },
  get io() {
    return io;
  },
  get baseUrl() {
    return baseUrl;
  },
  get mongoose() {
    return mongoose;
  },
  path,
  request,
  ensureUploadDir,
};
