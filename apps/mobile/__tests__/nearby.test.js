jest.mock('react-native', () => ({ NativeModules: { VibeSyncNearby: {
  verifyHostProof: jest.fn((key, challenge, proof) => Promise.resolve(require('crypto').createHmac('sha256', key).update(challenge).digest('hex') === proof)),
} }, NativeEventEmitter: jest.fn(), Platform: { OS: 'android' } }));

import { expectedNearbyPosition, fetchNearbySession, joinNearbyRoom, normalizeNearbyAddress, nearbyMediaUrl, sendNearbyMessage, moderateNearbyRoom, verifyNearbyHost } from '../src/services/nearby';

describe('local room address and playback protocol', () => {
  test.each(['192.168.1.20:8787', '10.0.0.2:8080', '172.16.1.2:4000'])('accepts local IPv4 %s', (value) => {
    expect(normalizeNearbyAddress(value)).toBe(`http://${value}`);
  });
  test('accepts literal local IPv6 and trims paths', () => {
    expect(normalizeNearbyAddress('https://[fd00::1]:8080/vibesync/media')).toBe('https://[fd00::1]:8080');
  });
  test.each(['https://evil.example:443', '8.8.8.8:8787', '192.168.999.1:8787', '192.168.1.20', '192.168.1.20:65536', 'http://user:pass@192.168.1.20:8787'])('rejects malformed or public destination %s', (value) => {
    expect(() => normalizeNearbyAddress(value)).toThrow();
  });
  test('local playback uses host timeline and pause position', () => {
    expect(expectedNearbyPosition({ status: 'playing', positionMs: 1000, updatedAt: 1800000000000, rate: 1 }, 1800000000900, 100)).toBe(2000);
    expect(expectedNearbyPosition({ status: 'paused', positionMs: 1000, updatedAt: 1800000000000 }, 1800000000900, 100)).toBe(1000);
  });
  test('scheduled playback does not advance before host start deadline', () => {
    expect(expectedNearbyPosition({ status: 'playing', positionMs: 1000, updatedAt: 1800000001000 }, 1800000000000)).toBe(1000);
  });
  test('media resolves to host path', () => {
    expect(nearbyMediaUrl('http://192.168.1.20:8787', { media: { url: '/vibesync/media' } })).toBe('http://192.168.1.20:8787/vibesync/media');
  });
  test('never attaches session credentials to arbitrary external media', () => {
    expect(nearbyMediaUrl('http://192.168.1.20:8787', { media: { url: 'https://evil.example/media' } })).toBeNull();
  });
});

describe('nearby fetch lifecycle and admission', () => {
  beforeEach(() => { global.fetch = jest.fn(); });
  afterEach(() => { jest.useRealTimers(); });

  test('join code normalization and one request ID for retry prevent duplicate admission', async () => {
    const response = { token: 'native-random-token', memberId: 'm1', session: { code: 'ABCD' } };
    global.fetch.mockRejectedValueOnce(new TypeError('disconnected')).mockResolvedValueOnce({ ok: true, json: async () => response });
    const joined = await joinNearbyRoom('192.168.1.20:8787', 'Guest', 'abcd');
    expect(joined.token).toBe(response.token);
    const firstBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    const secondBody = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(firstBody.code).toBe('ABCD');
    expect(firstBody.requestId).toBe(secondBody.requestId);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('rejects admission with incomplete state', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    await expect(joinNearbyRoom('192.168.1.20:8787', 'Guest', 'ABCD')).rejects.toThrow('incomplete join response');
  });

  test('does not retry an authorization rejection', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ ok: false, error: 'Wrong code', code: 'NEARBY_CODE_REQUIRED' }) });
    await expect(joinNearbyRoom('192.168.1.20:8787', 'Guest', 'ABCD')).rejects.toMatchObject({ code: 'NEARBY_CODE_REQUIRED' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('rejects malformed JSON instead of fake success', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('bad json'); } });
    await expect(fetchNearbySession('192.168.1.20:8787', 'token')).rejects.toMatchObject({ code: 'NEARBY_INVALID_RESPONSE' });
  });

  test('aborts stalled network request and releases deadline', async () => {
    jest.useFakeTimers();
    global.fetch.mockImplementation((url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))));
    const pending = fetchNearbySession('192.168.1.20:8787', 'token');
    const settled = pending.catch((error) => error);
    jest.advanceTimersByTime(8000);
    expect(await settled).toMatchObject({ code: 'NEARBY_TIMEOUT' });
    expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('measures round trip and authenticates session read', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ serverNow: Date.now(), session: { revision: 1 } }) });
    const result = await fetchNearbySession('192.168.1.20:8787', 'token');
    expect(result.rttMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.offsetMs)).toBe(true);
    expect(global.fetch.mock.calls[0][1].headers['X-VibeSync-Token']).toBe('token');
  });

  test('message retry carries same idempotency key and server confirmation', async () => {
    global.fetch.mockRejectedValueOnce(new TypeError('disconnected')).mockResolvedValueOnce({ ok: true, json: async () => ({ message: { id: 'server-message-1' } }) });
    const message = await sendNearbyMessage('192.168.1.20:8787', 'token', 'hello', 'message_1234567890123456');
    expect(message.id).toBe('server-message-1');
    const first = JSON.parse(global.fetch.mock.calls[0][1].body);
    const second = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(first.clientMessageId).toBe(second.clientMessageId);
    expect(first.body).toBe('hello');
  });
  test('host moderation uses authenticated endpoint', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, session: { revision: 2 } }) });
    await moderateNearbyRoom('192.168.1.20:8787', 'host-token', 'kick', 'guest1');
    expect(global.fetch.mock.calls[0][0]).toBe('http://192.168.1.20:8787/vibesync/moderation');
    expect(global.fetch.mock.calls[0][1].headers['X-VibeSync-Token']).toBe('host-token');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ action: 'kick', targetId: 'guest1' });
  });
  test('verifies rediscovered host without sending recovery key or bearer token', async () => {
    global.fetch.mockImplementation(async (url, { body }) => ({ ok: true, json: async () => ({
      proof: require('crypto').createHmac('sha256', 'private-recovery-key').update(JSON.parse(body).challenge).digest('hex'),
    }) }));
    await expect(verifyNearbyHost('192.168.1.20:8787', 'private-recovery-key')).resolves.toBe(true);
    expect(global.fetch.mock.calls[0][1].body).not.toContain('private-recovery-key');
    expect(global.fetch.mock.calls[0][1].headers['X-VibeSync-Token']).toBeUndefined();
  });
  test('rejects host proof from another room before moving credentials', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ proof: '00'.repeat(32) }) });
    await expect(verifyNearbyHost('192.168.1.20:8787', 'private-recovery-key')).resolves.toBe(false);
  });
});
