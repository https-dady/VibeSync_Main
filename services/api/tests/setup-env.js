'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/vibesync-test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-which-is-long-enough';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-which-is-long-enough';
process.env.LOG_LEVEL = 'silent';
process.env.REDIS_URL = '';
process.env.PUBLIC_WEB_URL = 'http://localhost:4000';
process.env.MEDIA_STORAGE_DIR =
  process.env.MEDIA_STORAGE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'vibesync-test-uploads-'));
process.env.MONGO_MEMORY_SERVER_DOWNLOAD_DIR =
  process.env.MONGO_MEMORY_SERVER_DOWNLOAD_DIR || path.join(os.tmpdir(), 'vibesync-mongodb-binaries');
// MongoDB 8.2 enforces a client-metadata check that the driver's handshake
// fails under Jest's VM context. MongoDB 8.0 has identical app semantics and
// is the supported integration-test server for this suite.
process.env.MONGOMS_VERSION = process.env.MONGOMS_VERSION || '8.0.14';
