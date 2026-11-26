/**
 * Translates authoritative playback snapshots into media-engine corrections.
 * The server sends an anchor position + server timestamp; the client derives
 * the expected position using its NTP-corrected clock. Hard seeks are reserved
 * for large drift, pause/play transitions and explicit seeks. Small drift is
 * corrected with a gentle temporary playback-rate nudge.
 */
export const SYNC_THRESHOLDS = {
  softDriftMs: 120,
  hardDriftMs: 850,
  maxRateDelta: 0.05,
  heartbeatGraceMs: 600,
};

export function expectedPosition(playback, serverNowMs, fallbackDurationMs = 0) {
  if (!playback) return 0;
  const base = Math.max(0, Number(playback.positionMs) || 0);
  const duration = Number(playback.durationMs || fallbackDurationMs) || 0;
  if (playback.status !== 'playing') return clamp(base, 0, duration);
  const updatedAt = new Date(playback.updatedAt).getTime();
  if (!Number.isFinite(updatedAt)) return base;
  const rate = clamp(Number(playback.rate) || 1, 0.25, 3);
  // updatedAt is absolute; derive elapsed on the server timeline. State events
  // also carry serverTime, but updatedAt remains valid after network delay.
  const elapsed = Math.max(0, serverNowMs - updatedAt) * rate;
  return clamp(base + elapsed, 0, duration);
}

export function driftMs(currentPositionMs, targetPositionMs) {
  return currentPositionMs - targetPositionMs;
}

export function decideCorrection({
  currentPositionMs,
  targetPositionMs,
  playing,
  rate = 1,
  buffering = false,
  loaded = true,
  thresholds = SYNC_THRESHOLDS,
}) {
  const drift = driftMs(currentPositionMs, targetPositionMs);
  const magnitude = Math.abs(drift);
  const baseRate = clamp(Number(rate) || 1, 0.25, 3);

  if (!loaded || buffering || !Number.isFinite(drift)) {
    return { type: 'none', driftMs: Number.isFinite(drift) ? drift : 0, rate: baseRate };
  }

  if (magnitude >= thresholds.hardDriftMs) {
    return {
      type: 'seek',
      seekToMs: Math.max(0, targetPositionMs),
      driftMs: drift,
      rate: baseRate,
    };
  }

  if (magnitude >= thresholds.softDriftMs && playing) {
    // Positive drift means the local player is ahead, so it must play slightly
    // slower to converge on the server's position (negative drift speeds up).
    const delta = clamp((drift / 1000) * 0.35, -thresholds.maxRateDelta, thresholds.maxRateDelta);
    return {
      type: 'rate',
      rate: clamp(baseRate - delta, 0.25, 3),
      driftMs: drift,
    };
  }

  return { type: 'none', driftMs: drift, rate: baseRate };
}

export function shouldApplyState(previousSequence, nextSequence) {
  if (nextSequence === undefined || nextSequence === null) return false;
  if (!Number.isSafeInteger(Number(nextSequence)) || Number(nextSequence) < 0) return false;
  if (previousSequence === undefined || previousSequence === null) return true;
  return Number(nextSequence) > Number(previousSequence);
}

export function clamp(value, min, max) {
  const upper = max > 0 ? max : Number.POSITIVE_INFINITY;
  return Math.min(Math.max(value, min), upper);
}

export function formatDrift(drift) {
  const value = Math.round(Math.abs(drift));
  return `${value} ms`;
}
