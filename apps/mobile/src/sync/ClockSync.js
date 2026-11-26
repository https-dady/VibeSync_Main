/**
 * NTP-style clock synchronization. Every sample estimates offset between the
 * client clock and the server clock:
 *   offset = serverTime - (clientSentAt + clientReceivedAt) / 2
 * Samples with the lowest round-trip time are retained, then a median offset is
 * used to reduce jitter. This is pure JavaScript so it can be tested offline.
 */
export class ClockSync {
  constructor({ maxSamples = 9, maxAgeMs = 120000, now = () => Date.now() } = {}) {
    this.maxSamples = maxSamples;
    this.maxAgeMs = maxAgeMs;
    this.now = now;
    this.samples = [];
    this.offsetMs = 0;
    this.rttMs = null;
    this.quality = 'unknown';
  }

  addSample({ t0, serverTime, t2 }) {
    const rtt = t2 - t0;
    if (![t0, serverTime, t2].every(Number.isFinite) || rtt < 0 || rtt > 60000) return null;
    const offset = serverTime - (t0 + t2) / 2;
    const capturedAt = this.now();
    this.samples = this.samples.filter((entry) => capturedAt - entry.capturedAt < this.maxAgeMs);
    const sample = { t0, serverTime, t2, rtt, offset, capturedAt };
    this.samples.push(sample);
    this.samples.sort((a, b) => a.rtt - b.rtt);
    if (this.samples.length > this.maxSamples) this.samples.length = this.maxSamples;
    this.recompute();
    return this.snapshot();
  }

  recompute() {
    if (!this.samples.length) return;
    const best = this.samples[0];
    this.rttMs = best.rtt;
    const band = this.samples.slice(0, Math.max(1, Math.ceil(this.samples.length / 2)));
    const offsets = band.map((sample) => sample.offset).sort((a, b) => a - b);
    const mid = Math.floor(offsets.length / 2);
    this.offsetMs =
      offsets.length % 2 === 0 ? (offsets[mid - 1] + offsets[mid]) / 2 : offsets[mid];
    this.quality = best.rtt < 120 ? 'good' : best.rtt < 400 ? 'fair' : 'poor';
  }

  serverNow(clientNow = Date.now()) {
    return clientNow + this.offsetMs;
  }

  clientFromServer(serverTime) {
    return serverTime - this.offsetMs;
  }

  snapshot() {
    return {
      offsetMs: this.offsetMs,
      rttMs: this.rttMs,
      quality: this.quality,
      sampleCount: this.samples.length,
    };
  }

  reset() {
    this.samples = [];
    this.offsetMs = 0;
    this.rttMs = null;
    this.quality = 'unknown';
  }
}
