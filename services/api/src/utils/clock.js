'use strict';

/**
 * NTP-inspired clock sample filter. The lowest-RTT sample wins; remaining
 * samples form a small median band to reject network spikes.
 */
function selectBestClockSample(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const valid = samples.filter(
    (s) =>
      Number.isFinite(s.rtt) &&
      s.rtt >= 0 &&
      Number.isFinite(s.offset) &&
      Number.isFinite(s.clientSentAt),
  );
  if (!valid.length) return null;
  const sorted = [...valid].sort((a, b) => a.rtt - b.rtt);
  const bestBand = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
  const offsets = bestBand.map((s) => s.offset).sort((a, b) => a - b);
  const mid = Math.floor(offsets.length / 2);
  const offset =
    offsets.length % 2 === 0 ? (offsets[mid - 1] + offsets[mid]) / 2 : offsets[mid];
  return {
    offset,
    rtt: sorted[0].rtt,
    sampleCount: valid.length,
    capturedAt: Date.now(),
  };
}

function serverTimeFromSample(sample, now = Date.now()) {
  if (!sample) return now;
  return now + sample.offset;
}

module.exports = { selectBestClockSample, serverTimeFromSample };
