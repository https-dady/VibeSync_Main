'use strict';
const server = require('./testServer');
const { request, authed, register, startTestServer, stopTestServer, connectSocket, waitFor, emitAck } = server;
const Room = require('../src/models/Room');
const RoomMember = require('../src/models/RoomMember');
const Message = require('../src/models/Message');
const Notification = require('../src/models/Notification');
let counter = 0;
const newUser = () => register(`Client ${++counter}`, `client-${counter}@reliability.test`);
async function createRoom(host, extra = {}) {
  const response = await request(server.app).post('/api/rooms').set(authed(host.accessToken))
    .send({ name: 'Reliability room', maxParticipants: 10, ...extra }).expect(201);
  expect(response.body.room.hostId).toBe(host.user.id);
  return response.body.room;
}
const join = (user, code, body = {}) => request(server.app).post(`/api/rooms/${code}/join`).set(authed(user.accessToken)).send(body);
const addMedia = async (host, code) => {
  const result = await request(server.app).post(`/api/rooms/${code}/media/url`).set(authed(host.accessToken))
    .send({ title: 'Authorized MP4', type: 'video', url: 'https://media.example.com/owned.mp4', durationMs: 120000 }).expect(201);
  await request(server.app).post(`/api/rooms/${code}/playback/command`).set(authed(host.accessToken))
    .send({ action: 'setMedia', mediaId: result.body.media.id }).expect(200);
  return result.body.media;
};
beforeAll(startTestServer);
afterAll(stopTestServer);

test('health readiness detects service drain while liveness remains available', async () => {
  await request(server.app).get('/api/health/live').expect(200);
  await request(server.app).get('/api/health/ready').expect(200);
  server.app.set('draining', true);
  try { await request(server.app).get('/api/health/ready').expect(503); await request(server.app).get('/api/health').expect(503); }
  finally { server.app.set('draining', false); }
});

test('single-session logout revokes access from that token family', async () => {
  const user = await newUser();
  await request(server.app).post('/api/auth/logout').send({ refreshToken: user.refreshToken }).expect(204);
  await request(server.app).get('/api/auth/me').set(authed(user.accessToken)).expect(401);
});

test('LiveKit webhook uses official signature and original-body hash validation', async () => {
  const config = require('../src/config/env');
  const { AccessToken } = require('livekit-server-sdk'); const crypto = require('node:crypto');
  const saved = { livekitEnabled: config.livekitEnabled, LIVEKIT_API_KEY: config.LIVEKIT_API_KEY, LIVEKIT_API_SECRET: config.LIVEKIT_API_SECRET };
  Object.assign(config, { livekitEnabled: true, LIVEKIT_API_KEY: 'test-sfu-key', LIVEKIT_API_SECRET: 'test-sfu-secret-long-enough-for-signing' });
  try {
    const raw = JSON.stringify({ event: 'room_started', room: { name: 'unrelated-room' } });
    const signer = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, { ttl: '60s' });
    signer.sha256 = crypto.createHash('sha256').update(raw).digest('base64'); const token = await signer.toJwt();
    await request(server.app).post('/api/rtc/livekit-webhook').set('Content-Type', 'application/webhook+json').set('Authorization', token).send(raw).expect(204);
    await request(server.app).post('/api/rtc/livekit-webhook').set('Content-Type', 'application/webhook+json').set('Authorization', token).send(raw + ' ').expect(401);
    await request(server.app).post('/api/rtc/livekit-webhook').set('Content-Type', 'application/webhook+json').send(raw).expect(401);
  } finally { Object.assign(config, saved); }
});

test('normalizes room codes and rejects invalid or missing codes with bounded errors', async () => {
  const host = await newUser(); const guest = await newUser(); const room = await createRoom(host);
  await join(guest, room.roomId.toLowerCase()).expect(200);
  await join(guest, 'ABC').expect(400);
  await join(guest, 'ZZZZZZZ').expect(404);
  const state = await request(server.app).get(`/api/rooms/${room.roomId}`).set(authed(guest.accessToken)).expect(200);
  expect(state.body.membership.userId).toBe(guest.user.id);
});

test('parallel duplicate joins create one membership and reserve one seat', async () => {
  const host = await newUser(); const guest = await newUser(); const room = await createRoom(host, { maxParticipants: 2 });
  const results = await Promise.all(Array.from({ length: 8 }, () => join(guest, room.roomId)));
  expect(results.map((item) => item.status)).toEqual(Array(8).fill(200));
  const stored = await Room.findByRoomId(room.roomId);
  expect(stored.memberCount).toBe(2);
  expect(await RoomMember.countDocuments({ room: stored._id, status: 'active' })).toBe(2);
});

test('independent simultaneous clients cannot overfill a room', async () => {
  const host = await newUser(); const room = await createRoom(host, { maxParticipants: 3 });
  const guests = await Promise.all(Array.from({ length: 6 }, newUser));
  const results = await Promise.all(guests.map((guest) => join(guest, room.roomId)));
  expect(results.filter((item) => item.status === 200)).toHaveLength(2);
  expect(results.filter((item) => item.status === 409)).toHaveLength(4);
  const stored = await Room.findByRoomId(room.roomId);
  expect(stored.memberCount).toBe(3);
  expect(await RoomMember.countDocuments({ room: stored._id, status: 'active' })).toBe(3);
});

test('duplicate approval requests and decisions do not duplicate notifications or seats', async () => {
  const host = await newUser(); const guest = await newUser(); const room = await createRoom(host, { joinApproval: true });
  const pending = await Promise.all(Array.from({ length: 4 }, () => join(guest, room.roomId)));
  expect(pending.map((item) => item.status)).toEqual(Array(4).fill(202));
  expect(await Notification.countDocuments({ user: host.user.id, type: 'join_request' })).toBe(1);
  const id = pending[0].body.membership.id;
  const decisions = await Promise.all(Array.from({ length: 4 }, () => request(server.app)
    .post(`/api/rooms/${room.roomId}/requests/${id}/decision`).set(authed(host.accessToken)).send({ decision: 'approve' })));
  expect(decisions.map((item) => item.status)).toEqual(Array(4).fill(200));
  expect((await Room.findByRoomId(room.roomId)).memberCount).toBe(2);
});

test('concurrent leave is idempotent and banned guests cannot rejoin', async () => {
  const host = await newUser(); const guest = await newUser(); const room = await createRoom(host);
  const joined = await join(guest, room.roomId).expect(200);
  await Promise.all(Array.from({ length: 4 }, () => request(server.app).post(`/api/rooms/${room.roomId}/leave`).set(authed(guest.accessToken)).send({}).expect(204)));
  expect((await Room.findByRoomId(room.roomId)).memberCount).toBe(1);
  await request(server.app).delete(`/api/rooms/${room.roomId}/members/${joined.body.membership.id}?ban=true`).set(authed(host.accessToken)).expect(200);
  await join(guest, room.roomId).expect(403);
});

test('pending private members cannot see current media or playback', async () => {
  const host = await newUser(); const guest = await newUser(); const room = await createRoom(host, { visibility: 'private', password: 'Secret123' });
  await addMedia(host, room.roomId);
  await join(guest, room.roomId, { password: 'Wrong123' }).expect(403);
  const pending = await join(guest, room.roomId, { password: 'Secret123' }).expect(202);
  expect(pending.body.room.currentMedia).toBeNull(); expect(pending.body.room.playback).toBeNull();
  const details = await request(server.app).get(`/api/rooms/${room.roomId}`).set(authed(guest.accessToken)).expect(200);
  expect(details.body.room.currentMedia).toBeNull();
  await request(server.app).get(`/api/rooms/${room.roomId}/media`).set(authed(guest.accessToken)).expect(403);
});

test('parallel refresh reuse revokes the successor and its access token', async () => {
  const user = await newUser();
  const results = await Promise.all(Array.from({ length: 2 }, () => request(server.app).post('/api/auth/refresh').send({ refreshToken: user.refreshToken })));
  expect(results.map((item) => item.status).sort()).toEqual([200, 401]);
  const minted = results.find((item) => item.status === 200).body;
  await request(server.app).post('/api/auth/refresh').send({ refreshToken: minted.refreshToken }).expect(401);
  await request(server.app).get('/api/auth/me').set(authed(minted.accessToken)).expect(401);
});

test('logout-all revokes REST access and disconnects authenticated sockets', async () => {
  const user = await newUser(); const socket = connectSocket(user.accessToken);
  try {
    await waitFor(socket, 'connected'); const disconnected = waitFor(socket, 'disconnect');
    await request(server.app).post('/api/auth/logout-all').set(authed(user.accessToken)).send({}).expect(204);
    await disconnected;
    await request(server.app).get('/api/auth/me').set(authed(user.accessToken)).expect(401);
  } finally { socket.close(); }
});

test('password changes revoke old access and refresh sessions', async () => {
  const user = await newUser();
  await request(server.app).post('/api/auth/change-password').set(authed(user.accessToken))
    .send({ currentPassword: 'Password123', newPassword: 'Replacement456' }).expect(204);
  await request(server.app).get('/api/auth/me').set(authed(user.accessToken)).expect(401);
  await request(server.app).post('/api/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);
  await request(server.app).post('/api/auth/login').send({ email: user.user.email, password: 'Replacement456' }).expect(200);
});

test('REST/socket retries use one message identity and cannot reuse it for different content', async () => {
  const host = await newUser(); const guest = await newUser(); const room = await createRoom(host);
  await join(guest, room.roomId).expect(200); const socket = connectSocket(guest.accessToken);
  try {
    await waitFor(socket, 'connected'); await emitAck(socket, 'room:join', { roomId: room.roomId });
    const payload = { channel: 'room', body: 'One durable message', clientMessageId: 'retry-message-123' };
    const [rest, realtime] = await Promise.all([
      request(server.app).post(`/api/rooms/${room.roomId}/messages`).set(authed(guest.accessToken)).send(payload),
      emitAck(socket, 'chat:send', { roomId: room.roomId, ...payload }),
    ]);
    expect(rest.status).toBe(201); expect(realtime.ok).toBe(true);
    expect(rest.body.message.id).toBe(realtime.message.id); expect(rest.body.message.senderId).toBe(guest.user.id);
    expect(await Message.countDocuments({ clientMessageId: payload.clientMessageId })).toBe(1);
    await request(server.app).post(`/api/rooms/${room.roomId}/messages`).set(authed(guest.accessToken)).send({ ...payload, body: 'Changed content' }).expect(409);
  } finally { socket.close(); }
});

test('message pagination preserves every message when creation timestamps tie', async () => {
  const host = await newUser(); const room = await createRoom(host); const stored = await Room.findByRoomId(room.roomId);
  const date = new Date('2026-11-18T00:00:00.000Z');
  const messages = await Message.insertMany(Array.from({ length: 5 }, (_, i) => ({ room: stored._id, sender: host.user.id, channel: 'room', body: `Page ${i}`, createdAt: date })));
  let before; let beforeId; const seen = [];
  do {
    const page = await request(server.app).get(`/api/rooms/${room.roomId}/messages`).query({ limit: 2, before, beforeId }).set(authed(host.accessToken)).expect(200);
    seen.push(...page.body.data.map((item) => item.id)); before = page.body.nextBefore; beforeId = page.body.nextBeforeId;
  } while (before);
  expect(new Set(seen).size).toBe(5); expect(seen.sort()).toEqual(messages.map((item) => String(item._id)).sort());
});

test('concurrent host commands use distinct sequences and late joiners get real computed position', async () => {
  const host = await newUser(); const room = await createRoom(host); await addMedia(host, room.roomId);
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => request(server.app).post(`/api/rooms/${room.roomId}/playback/command`)
    .set(authed(host.accessToken)).send({ action: 'seek', positionMs: 1000 * i }).expect(200)));
  expect(new Set(results.map((item) => item.body.playback.sequence)).size).toBe(6);
  const playing = await request(server.app).post(`/api/rooms/${room.roomId}/playback/command`).set(authed(host.accessToken)).send({ action: 'play', positionMs: 5000 }).expect(200);
  const snapshot = await request(server.app).get(`/api/rooms/${room.roomId}/playback`).set(authed(host.accessToken)).expect(200);
  expect(snapshot.body.playback.computedPositionMs).toBeGreaterThanOrEqual(5000);
  await request(server.app).post(`/api/rooms/${room.roomId}/playback/heartbeat`).set(authed(host.accessToken))
    .send({ positionMs: 0, sequence: playing.body.playback.sequence - 1 }).expect(409);
});

test('scheduled playback anchors in server time and stale commands cannot override it', async () => {
  const host = await newUser(); const room = await createRoom(host); await addMedia(host, room.roomId);
  const time = Date.now() + 1500;
  const play = await request(server.app).post(`/api/rooms/${room.roomId}/playback/command`).set(authed(host.accessToken))
    .send({ action: 'play', positionMs: 4000, startAtServerMs: time, expectedSequence: 1 }).expect(200);
  expect(play.body.playback.startAtServerMs).toBe(time); expect(play.body.playback.computedPositionMs).toBe(4000);
  await request(server.app).post(`/api/rooms/${room.roomId}/playback/command`).set(authed(host.accessToken))
    .send({ action: 'pause', expectedSequence: 1 }).expect(409);
});

test('provider contracts reject web pages/private addresses and declare platform capabilities', async () => {
  const host = await newUser(); const room = await createRoom(host);
  const post = (url, extra = {}) => request(server.app).post(`/api/rooms/${room.roomId}/media/url`).set(authed(host.accessToken)).send({ title: 'Authorized source', type: 'video', url, ...extra });
  for (const url of ['https://youtube.com/watch?v=123', 'https://127.0.0.1/file.mp4', 'https://[::1]/file.mp4', 'https://media.example.com/page']) await post(url).expect(400);
  const dash = await post('https://media.example.com/file.mpd').expect(201);
  expect(dash.body.media.playbackCapabilities.supportedPlatforms).toEqual(['android']);
  const hls = await post('https://media.example.com/file.m3u8').expect(201);
  expect(hls.body.media.playbackCapabilities.supportedPlatforms).toEqual(['android', 'ios']);
  await post('https://media.example.com/file.mpd', { drmScheme: 'fairplay', drmLicenseUrl: 'https://license.example.com/path' }).expect(400);
  await post('https://media.example.com/file.m3u8', { drmScheme: 'fairplay', drmLicenseUrl: 'https://license.example.com/path' }).expect(400);
  const fairplay = await post('https://media.example.com/file.m3u8', { drmScheme: 'fairplay', drmLicenseUrl: 'https://license.example.com/path', drmCertificateUrl: 'https://license.example.com/certificate', drmContentId: 'owned-content-123' }).expect(201);
  expect(fairplay.body.media.drmCertificateUrl).toBe('https://license.example.com/certificate');
  expect(fairplay.body.media.playbackCapabilities.supportedPlatforms).toEqual(['ios']);
});

test('media HEAD/range is authenticated and MIME spoofing is rejected', async () => {
  const host = await newUser(); const room = await createRoom(host);
  await request(server.app).post(`/api/rooms/${room.roomId}/media/upload`).set(authed(host.accessToken))
    .attach('file', Buffer.from('<html>not media</html>'), { filename: 'fake.mp3', contentType: 'audio/mpeg' }).expect(400);
  const upload = await request(server.app).post(`/api/rooms/${room.roomId}/media/upload`).set(authed(host.accessToken))
    .attach('file', Buffer.from('ID3-owned-test-fixture'), { filename: 'owned.mp3', contentType: 'audio/mpeg' }).expect(201);
  const path = upload.body.media.streamUrl;
  const head = await request(server.app).head(path).set(authed(host.accessToken)).expect(200);
  expect(Number(head.headers['content-length'])).toBe(22);
  await request(server.app).get(path).expect(401);
  const range = await request(server.app).get(path).set(authed(host.accessToken)).set('Range', 'bytes=3-7').expect(206);
  expect(range.headers['content-range']).toBe('bytes 3-7/22');
  await request(server.app).get(path).set(authed(host.accessToken)).set('Range', 'bytes=1000-2000').expect(416);
});
