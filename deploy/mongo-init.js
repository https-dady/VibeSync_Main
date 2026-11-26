/* global db, rs, sleep, print */
'use strict';

// mongosh initialization for both development and authenticated production.
const admin = db.getSiblingDB('admin');
if (process.env.MONGO_INITDB_ROOT_PASSWORD) {
  admin.auth(process.env.MONGO_INITDB_ROOT_USERNAME || 'vibesync-admin', process.env.MONGO_INITDB_ROOT_PASSWORD);
}
try {
  rs.status();
} catch (error) {
  if (error.code !== 94) throw error;
  rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] });
}
let primary = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (admin.runCommand({ hello: 1 }).isWritablePrimary) { primary = true; break; }
  sleep(1000);
}
if (!primary) throw new Error('MongoDB replica set did not elect a primary within 60 seconds');
if (process.env.MONGO_APP_PASSWORD) {
  const appDb = db.getSiblingDB('vibesync');
  const user = process.env.MONGO_APP_USER || 'vibesync';
  if (!appDb.getUser(user)) appDb.createUser({ user, pwd: process.env.MONGO_APP_PASSWORD, roles: [{ role: 'readWrite', db: 'vibesync' }] });
}
print('VibeSync replica set initialization complete');
