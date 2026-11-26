'use strict';
const { getRedis } = require('../config/redis');
const localPresence = new Map();
const TTL_MS = 90000;
const redisKey = (room, user) => `vibesync:presence-v2:${room}:${user}`;
const localKey = (room, user) => `${room}:${user}`;
function prune() {
  const now = Date.now();
  for (const [key, sockets] of localPresence) {
    for (const [socket, expires] of sockets) if (expires <= now) sockets.delete(socket);
    if (!sockets.size) localPresence.delete(key);
  }
}
function touchLocal(room, user, socket) {
  prune(); const key = localKey(room, user); const sockets = localPresence.get(key) || new Map();
  const first = sockets.size === 0; sockets.set(socket, Date.now() + TTL_MS); localPresence.set(key, sockets); return first;
}
async function markOnline(room, user, socket) {
  const first = touchLocal(room, user, socket); const redis = getRedis(); if (!redis) return first;
  try {
    return Number(await redis.eval("redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1]); local n=redis.call('ZCARD',KEYS[1]); redis.call('ZADD',KEYS[1],ARGV[2],ARGV[3]); redis.call('PEXPIRE',KEYS[1],ARGV[4]); return n", {
      keys: [redisKey(room, user)], arguments: [String(Date.now()), String(Date.now() + TTL_MS), socket, String(TTL_MS)],
    })) === 0;
  } catch { return first; }
}
async function markOffline(room, user, socket) {
  prune(); const key = localKey(room, user); const sockets = localPresence.get(key);
  sockets?.delete(socket); const offline = !sockets?.size; if (offline) localPresence.delete(key);
  const redis = getRedis(); if (!redis) return offline;
  try {
    return Number(await redis.eval("redis.call('ZREM',KEYS[1],ARGV[1]); redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[2]); local n=redis.call('ZCARD',KEYS[1]); if n==0 then redis.call('DEL',KEYS[1]) end; return n", {
      keys: [redisKey(room, user)], arguments: [socket, String(Date.now())],
    })) === 0;
  } catch { return offline; }
}
async function onlineUsers(room) {
  prune(); const redis = getRedis();
  if (redis) try {
    const prefix = `vibesync:presence-v2:${room}:`; const users = [];
    for await (const batch of redis.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) for (const key of batch) {
      await redis.zRemRangeByScore(key, '-inf', Date.now());
      if (await redis.zCard(key)) users.push(key.slice(prefix.length));
    }
    return users;
  } catch { /* fall back to the local mirror */ }
  return [...localPresence.keys()].filter((key) => key.startsWith(`${room}:`)).map((key) => key.slice(room.length + 1));
}
async function touchPresence(room, user, socket) {
  if (!socket) return;
  touchLocal(room, user, socket); const redis = getRedis(); if (!redis) return;
  try {
    await redis.zAdd(redisKey(room, user), { score: Date.now() + TTL_MS, value: socket });
    await redis.pExpire(redisKey(room, user), TTL_MS);
  } catch { /* local mirror remains live */ }
}
module.exports = { markOnline, markOffline, onlineUsers, touchPresence };
