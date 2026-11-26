'use strict';

const {
  startTestServer,
  stopTestServer,
  register,
  authed,
  connectSocket,
  waitFor,
  emitAck,
  request,
} = require('./testServer');

const server = require('./testServer');

let host;
let alice;
let bob;
let roomCode;
let aliceMemberId;

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

describe('VibeSync API', () => {
  test('health endpoint reports the independent service', async () => {
    const response = await request(server.app).get('/api/health').expect(200);
    expect(response.body.service).toBe('vibesync-api');
    expect(response.body.database).toBe('connected');
  });

  test('registers users, rejects duplicate email and bad credentials', async () => {
    host = await register('Host User', 'host@vibesync.test');
    alice = await register('Alice Listener', 'alice@vibesync.test');
    bob = await register('Bob Listener', 'bob@vibesync.test');
    expect(host.user.email).toBe('host@vibesync.test');
    expect(host.accessToken).toBeTruthy();
    expect(host.refreshToken).toBeTruthy();
    expect(host.user.passwordHash).toBeUndefined();

    await request(server.app)
      .post('/api/auth/register')
      .send({ name: 'Duplicate', email: 'HOST@vibesync.test', password: 'Password123' })
      .expect(409);
    await request(server.app)
      .post('/api/auth/login')
      .send({ email: 'host@vibesync.test', password: 'WrongPassword1' })
      .expect(401);
    const login = await request(server.app)
      .post('/api/auth/login')
      .send({ email: 'HOST@vibesync.test', password: 'Password123' })
      .expect(200);
    expect(login.body.user.name).toBe('Host User');

    const sessions = await request(server.app)
      .get('/api/auth/sessions')
      .set(authed(host.accessToken))
      .expect(200);
    expect(sessions.body.count).toBeGreaterThanOrEqual(2);
    expect(sessions.body.data[0]).toHaveProperty('expiresAt');
    expect(JSON.stringify(sessions.body)).not.toContain(host.refreshToken);
  });

  test('rotates refresh tokens and detects token reuse', async () => {
    const rotated = await request(server.app)
      .post('/api/auth/refresh')
      .send({ refreshToken: bob.refreshToken })
      .expect(200);
    expect(rotated.body.refreshToken).not.toBe(bob.refreshToken);

    await request(server.app)
      .post('/api/auth/refresh')
      .send({ refreshToken: bob.refreshToken })
      .expect(401);

    // Reuse revoked the whole token family, including the newly issued token.
    await request(server.app)
      .post('/api/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
    await request(server.app).get('/api/auth/me').set(authed(bob.accessToken)).expect(401);
    const signedIn = await request(server.app).post('/api/auth/login')
      .send({ email: 'bob@vibesync.test', password: 'Password123' }).expect(200);
    bob = signedIn.body;
  });

  test('creates a public room and enforces host-only playback', async () => {
    const created = await request(server.app)
      .post('/api/rooms')
      .set(authed(host.accessToken))
      .send({
        name: 'Midnight Listening',
        description: 'A synchronized online room',
        mode: 'online',
        mediaType: 'video',
        visibility: 'public',
        maxParticipants: 8,
        allowChat: true,
        allowMicRequests: true,
      })
      .expect(201);
    roomCode = created.body.room.roomId;
    expect(roomCode).toMatch(/^[A-Z2-9]{7}$/);
    expect(created.body.room.shareLink).toContain('/r/' + roomCode);

    const joined = await request(server.app)
      .post(`/api/rooms/${roomCode}/join`)
      .set(authed(alice.accessToken))
      .send({})
      .expect(200);
    expect(joined.body.state).toBe('joined');
    aliceMemberId = joined.body.membership.id;

    const list = await request(server.app)
      .get('/api/rooms?mode=online')
      .set(authed(host.accessToken))
      .expect(200);
    expect(list.body.data.some((room) => room.roomId === roomCode)).toBe(true);

    const publicDetails = await request(server.app)
      .get(`/api/rooms/${roomCode}`)
      .set(authed(bob.accessToken))
      .expect(200);
    expect(publicDetails.body.membership).toBeNull();

    await request(server.app)
      .get(`/api/rooms/${roomCode}/playback`)
      .set(authed(host.accessToken))
      .expect(200);
    await request(server.app)
      .get(`/api/rooms/${roomCode}/playback`)
      .set(authed(bob.accessToken))
      .expect(403);
  });

  test('adds authorized media, streams byte ranges and synchronizes playback', async () => {
    const external = await request(server.app)
      .post(`/api/rooms/${roomCode}/media/url`)
      .set(authed(host.accessToken))
      .send({
        title: 'Licensed stream',
        type: 'video',
        url: 'https://media.example.com/licensed/master.m3u8',
        durationMs: 120000,
        provider: 'Example OTT',
        drmScheme: 'widevine',
        drmLicenseUrl: 'https://drm.example.com/license/widevine',
      })
      .expect(201);
    expect(external.body.media.drmScheme).toBe('widevine');
    expect(external.body.media.drmLicenseUrl).toBe(
      'https://drm.example.com/license/widevine',
    );
    expect(external.body.media.url).toContain('example.com');

    await request(server.app)
      .post(`/api/rooms/${roomCode}/media/upload`)
      .set(authed(alice.accessToken))
      .field('title', 'Nope')
      .attach('file', Buffer.from('ID3testaudio'), {
        filename: 'track.mp3',
        contentType: 'audio/mpeg',
      })
      .expect(403);

    const upload = await request(server.app)
      .post(`/api/rooms/${roomCode}/media/upload`)
      .set(authed(host.accessToken))
      .field('title', 'Owned local audio')
      .field('artist', 'Independent Artist')
      .field('durationMs', '90000')
      .attach('file', Buffer.from('ID3-a-real-owned-file-bytes'), {
        filename: 'owned.mp3',
        contentType: 'audio/mpeg',
      })
      .expect(201);
    const mediaId = upload.body.media.id;
    expect(upload.body.media.streamUrl).toBe(`/api/media/${mediaId}/stream`);

    const range = await request(server.app)
      .get(`/api/media/${mediaId}/stream`)
      .set(authed(host.accessToken))
      .set('Range', 'bytes=0-3')
      .expect(206);
    expect(range.headers['accept-ranges']).toBe('bytes');
    expect(range.headers['content-type']).toContain('audio/mpeg');

    await request(server.app)
      .post(`/api/rooms/${roomCode}/playback/command`)
      .set(authed(alice.accessToken))
      .send({ action: 'setMedia', mediaId })
      .expect(403);

    const select = await request(server.app)
      .post(`/api/rooms/${roomCode}/playback/command`)
      .set(authed(host.accessToken))
      .send({ action: 'setMedia', mediaId })
      .expect(200);
    expect(select.body.playback.status).toBe('paused');
    expect(select.body.playback.media.id).toBe(mediaId);

    const play = await request(server.app)
      .post(`/api/rooms/${roomCode}/playback/command`)
      .set(authed(host.accessToken))
      .send({ action: 'play', positionMs: 1500 })
      .expect(200);
    expect(play.body.playback.status).toBe('playing');
    expect(play.body.playback.positionMs).toBe(1500);
    expect(play.body.playback.serverTime).toBeGreaterThan(0);

    const paused = await request(server.app)
      .post(`/api/rooms/${roomCode}/playback/command`)
      .set(authed(host.accessToken))
      .send({ action: 'pause', positionMs: 3000 })
      .expect(200);
    expect(paused.body.playback.status).toBe('paused');

    const seek = await request(server.app)
      .post(`/api/rooms/${roomCode}/playback/command`)
      .set(authed(host.accessToken))
      .send({ action: 'seek', positionMs: 45000 })
      .expect(200);
    expect(seek.body.playback.positionMs).toBe(45000);

    const late = await request(server.app)
      .get(`/api/rooms/${roomCode}/playback`)
      .set(authed(alice.accessToken))
      .expect(200);
    expect(late.body.playback.status).toBe('paused');
    expect(late.body.playback.positionMs).toBe(45000);

    // Participant cannot overwrite authoritative state via heartbeat.
    await request(server.app)
      .post(`/api/rooms/${roomCode}/playback/heartbeat`)
      .set(authed(alice.accessToken))
      .send({ positionMs: 1 })
      .expect(403);
  });

  test('enforces room chat, private host messaging and chat permissions', async () => {
    await request(server.app)
      .post(`/api/rooms/${roomCode}/messages`)
      .set(authed(alice.accessToken))
      .send({ channel: 'room', body: 'Hello everyone' })
      .expect(201);

    const roomChat = await request(server.app)
      .get(`/api/rooms/${roomCode}/messages?channel=room`)
      .set(authed(host.accessToken))
      .expect(200);
    expect(roomChat.body.data.some((message) => message.body === 'Hello everyone')).toBe(true);

    await request(server.app)
      .post(`/api/rooms/${roomCode}/messages`)
      .set(authed(alice.accessToken))
      .send({ channel: 'host', body: 'Private question for the host' })
      .expect(201);

    const hostInbox = await request(server.app)
      .get(`/api/rooms/${roomCode}/messages?channel=host`)
      .set(authed(host.accessToken))
      .expect(200);
    expect(hostInbox.body.data.some((message) => message.body === 'Private question for the host')).toBe(
      true,
    );

    await request(server.app)
      .post(`/api/rooms/${roomCode}/join`)
      .set(authed(bob.accessToken))
      .send({})
      .expect(200);
    const bobChat = await request(server.app)
      .get(`/api/rooms/${roomCode}/messages?channel=host`)
      .set(authed(bob.accessToken))
      .expect(200);
    expect(bobChat.body.data).toHaveLength(0);

    await request(server.app)
      .patch(`/api/rooms/${roomCode}/members/${aliceMemberId}/permissions`)
      .set(authed(host.accessToken))
      .send({ canChat: false })
      .expect(200);
    await request(server.app)
      .post(`/api/rooms/${roomCode}/messages`)
      .set(authed(alice.accessToken))
      .send({ channel: 'room', body: 'Should be blocked' })
      .expect(403);
    await request(server.app)
      .patch(`/api/rooms/${roomCode}/members/${aliceMemberId}/permissions`)
      .set(authed(host.accessToken))
      .send({ canChat: true })
      .expect(200);
  });

  test('manages speak requests, permissions and host moderation', async () => {
    const requested = await request(server.app)
      .post(`/api/rooms/${roomCode}/speak-requests`)
      .set(authed(alice.accessToken))
      .send({ note: 'Can I read the liner notes?' })
      .expect(201);
    expect(requested.body.status).toBe('pending');

    const requests = await request(server.app)
      .get(`/api/rooms/${roomCode}/speak-requests`)
      .set(authed(host.accessToken))
      .expect(200);
    expect(requests.body.data).toHaveLength(1);
    const requestId = requests.body.data[0].id;

    await request(server.app)
      .post(`/api/rooms/${roomCode}/speak-requests/${requestId}/decision`)
      .set(authed(alice.accessToken))
      .send({ decision: 'approve' })
      .expect(403);

    await request(server.app)
      .post(`/api/rooms/${roomCode}/speak-requests/${requestId}/decision`)
      .set(authed(host.accessToken))
      .send({ decision: 'approve' })
      .expect(200);

    const members = await request(server.app)
      .get(`/api/rooms/${roomCode}/members`)
      .set(authed(host.accessToken))
      .expect(200);
    const aliceMember = members.body.data.find((member) => member.userId === alice.user.id);
    expect(aliceMember.permissions.canSpeak).toBe(true);

    await request(server.app)
      .post(`/api/rooms/${roomCode}/members/${alice.user.id}/mic`)
      .set(authed(host.accessToken))
      .send({ granted: false })
      .expect(200);

    await request(server.app)
      .post(`/api/rooms/${roomCode}/mic/mute-all`)
      .set(authed(host.accessToken))
      .expect(200);
  });

  test('supports private join requests and room passwords', async () => {
    const privateRoom = await request(server.app)
      .post('/api/rooms')
      .set(authed(host.accessToken))
      .send({
        name: 'Private Premiere',
        mode: 'online',
        mediaType: 'video',
        visibility: 'private',
        password: 'Secret123',
        maxParticipants: 5,
      })
      .expect(201);
    const code = privateRoom.body.room.roomId;
    expect(privateRoom.body.room.hasPassword).toBe(true);
    expect(privateRoom.body.room.joinApproval).toBe(true);

    await request(server.app)
      .get(`/api/rooms/${code}`)
      .set(authed(bob.accessToken))
      .expect(403);

    await request(server.app)
      .post(`/api/rooms/${code}/join`)
      .set(authed(bob.accessToken))
      .send({ password: 'Wrong123' })
      .expect(403);

    const pending = await request(server.app)
      .post(`/api/rooms/${code}/join`)
      .set(authed(bob.accessToken))
      .send({ password: 'Secret123', message: 'Please let me in' })
      .expect(202);
    expect(pending.body.state).toBe('pending');

    const pendingRequests = await request(server.app)
      .get(`/api/rooms/${code}/requests`)
      .set(authed(host.accessToken))
      .expect(200);
    expect(pendingRequests.body.data).toHaveLength(1);
    const memberId = pendingRequests.body.data[0].id;

    await request(server.app)
      .post(`/api/rooms/${code}/requests/${memberId}/decision`)
      .set(authed(host.accessToken))
      .send({ decision: 'approve' })
      .expect(200);

    const details = await request(server.app)
      .get(`/api/rooms/${code}`)
      .set(authed(bob.accessToken))
      .expect(200);
    expect(details.body.membership.status).toBe('active');
  });

  test('authenticates sockets, synchronizes clocks and relays room events', async () => {
    const hostSocket = connectSocket(host.accessToken);
    const aliceSocket = connectSocket(alice.accessToken);
    await Promise.all([waitFor(hostSocket, 'connected'), waitFor(aliceSocket, 'connected')]);

    const clock = await emitAck(hostSocket, 'clock:sync', { t0: Date.now() });
    expect(clock.ok).toBe(true);
    expect(clock.serverTime).toBeGreaterThan(0);

    const [hostJoin, aliceJoin] = await Promise.all([
      emitAck(hostSocket, 'room:join', { roomId: roomCode }),
      emitAck(aliceSocket, 'room:join', { roomId: roomCode }),
    ]);
    expect(hostJoin.ok).toBe(true);
    expect(aliceJoin.ok).toBe(true);
    expect(aliceJoin.playback).toBeTruthy();

    const stateEvent = waitFor(aliceSocket, 'playback:state');
    const command = await emitAck(hostSocket, 'playback:command', {
      roomId: roomCode,
      action: 'play',
      positionMs: 10000,
    });
    expect(command.ok).toBe(true);
    const state = await stateEvent;
    expect(state.playback.status).toBe('playing');
    expect(state.playback.positionMs).toBe(10000);

    const chatEvent = waitFor(hostSocket, 'chat:message');
    const sent = await emitAck(aliceSocket, 'chat:send', {
      roomId: roomCode,
      channel: 'room',
      body: 'Socket synchronized hello',
    });
    expect(sent.ok).toBe(true);
    const chat = await chatEvent;
    expect(chat.message.body).toBe('Socket synchronized hello');

    // Mic was revoked in the previous test. Request and approve over sockets.
    const speakNotify = waitFor(hostSocket, 'speak:request');
    const speakRequest = await emitAck(aliceSocket, 'speak:request', {
      roomId: roomCode,
      note: 'Socket mic request',
    });
    expect(speakRequest.ok).toBe(true);
    const requestEvent = await speakNotify;
    expect(requestEvent.request.userId).toBe(alice.user.id);

    const decisionEvent = waitFor(aliceSocket, 'speak:decision');
    const decision = await emitAck(hostSocket, 'speak:decision', {
      roomId: roomCode,
      requestId: requestEvent.request.id,
      decision: 'approve',
    });
    expect(decision.ok).toBe(true);
    const decided = await decisionEvent;
    expect(decided.decision).toBe('approve');

    // Approved speaker may send an offer; receivers enforce permission.
    const signalEvent = waitFor(hostSocket, 'webrtc:signal');
    const signal = await emitAck(aliceSocket, 'webrtc:signal', {
      roomId: roomCode,
      targetUserId: host.user.id,
      data: { type: 'offer', sdp: 'v=0\r\nfake-sdp-for-relay-test', sessionId: 'sess-1' },
    });
    expect(signal.ok).toBe(true);
    const relayed = await signalEvent;
    expect(relayed.fromUserId).toBe(alice.user.id);
    expect(relayed.data.sdp).toContain('fake-sdp');

    // Host removes Alice and her socket must lose access immediately.
    const accessRevoked = waitFor(aliceSocket, 'room:access-revoked');
    const members = await request(server.app)
      .get(`/api/rooms/${roomCode}/members`)
      .set(authed(host.accessToken))
      .expect(200);
    const membership = members.body.data.find((member) => member.userId === alice.user.id);
    await request(server.app)
      .delete(`/api/rooms/${roomCode}/members/${membership.id}`)
      .set(authed(host.accessToken))
      .expect(200);
    const revoked = await accessRevoked;
    expect(revoked.roomId).toBe(roomCode);

    hostSocket.close();
    aliceSocket.close();
  });

  test('ends the room and blocks further playback', async () => {
    await request(server.app)
      .post(`/api/rooms/${roomCode}/end`)
      .set(authed(host.accessToken))
      .expect(200);
    await request(server.app)
      .post(`/api/rooms/${roomCode}/playback/command`)
      .set(authed(host.accessToken))
      .send({ action: 'play' })
      .expect(409);
  });
});
