'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');

const ROUNDS = 12;

async function hashPassword(password) {
  // bcrypt truncates inputs at 72 bytes. Versioned prehashing protects long
  // Unicode passwords and retains verification of legacy bcrypt accounts.
  const digest = crypto.createHash('sha256').update(password, 'utf8').digest('base64');
  return `v2$${await bcrypt.hash(digest, ROUNDS)}`;
}

async function verifyPassword(password, hash) {
  if (!hash) return false;
  if (hash.startsWith('v2$')) {
    const digest = crypto.createHash('sha256').update(password, 'utf8').digest('base64');
    return bcrypt.compare(digest, hash.slice(3));
  }
  return bcrypt.compare(password, hash);
}

module.exports = { hashPassword, verifyPassword };
