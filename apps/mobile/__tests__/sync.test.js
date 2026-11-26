import { ClockSync } from '../src/sync/ClockSync';
import { decideCorrection, expectedPosition } from '../src/sync/PlaybackSync';

describe('ClockSync', () => {
  test('estimates offset with symmetric latency', () => {
    const clock = new ClockSync();
    clock.addSample({ t0: 1000, serverTime: 1600, t2: 1200 });
    expect(clock.offsetMs).toBe(500);
    expect(clock.rttMs).toBe(200);
    expect(clock.serverNow(5000)).toBe(5500);
  });

  test('rejects invalid samples', () => {
    const clock = new ClockSync();
    expect(clock.addSample({ t0: 2000, serverTime: 1000, t2: 1000 })).toBeNull();
    expect(clock.sampleCount).toBeUndefined();
    expect(clock.samples).toHaveLength(0);
  });

  test('prefers low-RTT samples and reports quality', () => {
    const clock = new ClockSync();
    clock.addSample({ t0: 100, serverTime: 500, t2: 900 }); // rtt 800 offset 0
    clock.addSample({ t0: 1000, serverTime: 1350, t2: 1100 }); // rtt 100 offset 300
    clock.addSample({ t0: 2000, serverTime: 2380, t2: 2120 }); // rtt 120 offset 320
    expect(clock.rttMs).toBe(100);
    expect(clock.offsetMs).toBeGreaterThan(250);
    expect(clock.quality).toBe('good');
  });
});

describe('playback synchronization', () => {
  const playback = {
    status: 'playing',
    positionMs: 5000,
    updatedAt: new Date(10000).toISOString(),
    rate: 1,
    durationMs: 60000,
  };

  test('computes expected authoritative position', () => {
    expect(expectedPosition(playback, 12000)).toBe(7000);
    expect(expectedPosition(playback, 200000)).toBe(60000);
  });

  test('paused media does not advance', () => {
    expect(expectedPosition({ ...playback, status: 'paused' }, 50000)).toBe(5000);
  });

  test('seeks on large drift', () => {
    const correction = decideCorrection({
      currentPositionMs: 12000,
      targetPositionMs: 7000,
      playing: true,
    });
    expect(correction.type).toBe('seek');
    expect(correction.seekToMs).toBe(7000);
  });

  test('nudges rate for small drift', () => {
    const correction = decideCorrection({
      currentPositionMs: 7300,
      targetPositionMs: 7000,
      playing: true,
    });
    expect(correction.type).toBe('rate');
    expect(correction.rate).toBeLessThan(1);
    expect(correction.rate).toBeGreaterThan(0.94);
  });

  test('leaves already-synced media alone', () => {
    const correction = decideCorrection({
      currentPositionMs: 7050,
      targetPositionMs: 7000,
      playing: true,
    });
    expect(correction.type).toBe('none');
  });
});
