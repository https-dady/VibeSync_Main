import { ClockSync } from '../src/sync/ClockSync';
import { decideCorrection, expectedPosition, shouldApplyState } from '../src/sync/PlaybackSync';
import { normalizeInviteCode, parseInviteUrl } from '../src/utils/deepLinks';
import { mergeMessages, mergePlayback } from '../src/context/roomState';

describe('clock and playback regressions', () => {
  test('ages out old low latency samples after a clock/network change', () => {
    let now = 0;
    const clock = new ClockSync({ now: () => now, maxAgeMs: 1000 });
    clock.addSample({ t0: 100, serverTime: 160, t2: 120 });
    now = 1001;
    clock.addSample({ t0: 1000, serverTime: 1550, t2: 1100 });
    expect(clock.offsetMs).toBe(500);
    expect(clock.samples).toHaveLength(1);
  });
  test.each([{ buffering: true }, { loaded: false }])('defers correction while player is unavailable: %p', (state) => {
    expect(decideCorrection({ currentPositionMs: 0, targetPositionMs: 10000, playing: true, ...state }).type).toBe('none');
  });
  test('preserves selected playback speed inside drift tolerance', () => {
    expect(decideCorrection({ currentPositionMs: 1000, targetPositionMs: 1050, playing: true, rate: 1.5 }).rate).toBe(1.5);
  });
  test('scheduled playback stays at its anchor before the server start', () => {
    expect(expectedPosition({ status: 'playing', positionMs: 1000, updatedAt: new Date(10000).toISOString(), rate: 1 }, 9000)).toBe(1000);
  });
  test('rejects malformed, duplicate and stale sequences', () => {
    expect(shouldApplyState(3, 3)).toBe(false);
    expect(shouldApplyState(3, 2)).toBe(false);
    expect(shouldApplyState(undefined, undefined)).toBe(false);
    expect(shouldApplyState(undefined, null)).toBe(false);
    expect(shouldApplyState(3, 4)).toBe(true);
    expect(mergePlayback({ sequence: 5 }, { sequence: 4 })).toEqual({ sequence: 5 });
  });
});

describe('online invite validation', () => {
  test.each(['ABC2345', 'abc2345', ' ABC2345 '])('normalizes valid code %s', (value) => {
    expect(normalizeInviteCode(value)).toBe('ABC2345');
  });
  test.each(['ABCD', 'ABC1234', 'ABC2345extra', 'ABC-2345', 'ABC2345/'])('rejects invalid code without stripping into a different room: %s', (value) => {
    expect(normalizeInviteCode(value)).toBe('');
  });
  test.each(['vibesync://room/abc2345', 'vibesync://r/ABC2345', 'vibesync:///room/ABC2345', 'https://vibesync.app/r/ABC2345'])('accepts issued invite shape %s', (url) => {
    expect(parseInviteUrl(url)?.roomCode).toBe('ABC2345');
  });
  test.each(['https://evil.example/r/ABC2345', 'vibesync://r/ABC2345/extra', 'vibesync://r/%ZZ', 'https://user:pass@vibesync.app/r/ABC2345'])('rejects malformed or untrusted link %s', (url) => {
    expect(parseInviteUrl(url)).toBeNull();
  });
});

describe('chat acknowledgement merge', () => {
  const local = { id: 'local:c1', clientMessageId: 'c1', senderId: 'u1', optimistic: true, delivery: 'sending', body: 'hi', createdAt: '2026-01-01T00:00:00Z' };
  test('server echo replaces optimistic copy by client identity', () => {
    const sent = { ...local, id: 'server-id', optimistic: false, delivery: 'sent' };
    expect(mergeMessages([local], [sent, sent])).toEqual([sent]);
  });
  test('delayed acknowledgements cannot resurrect a moderated message', () => {
    const removed = { id: 'a', deleted: true, body: '', createdAt: local.createdAt };
    expect(mergeMessages([removed], [{ ...removed, deleted: false, body: 'hi' }])[0]).toEqual(removed);
  });
  test('orders equal timestamps deterministically and deduplicates one incoming page', () => {
    const a = { id: 'a', createdAt: local.createdAt };
    const b = { id: 'b', createdAt: local.createdAt };
    expect(mergeMessages([], [b, a, b]).map((message) => message.id)).toEqual(['a', 'b']);
  });
});
