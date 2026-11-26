import { APP_SCHEME, WEB_URL } from '../config';

function buildTrustedHosts() {
  const hosts = new Set(['vibesync.app', 'www.vibesync.app', 'localhost', '127.0.0.1']);
  try {
    hosts.add(new URL(WEB_URL).hostname.toLowerCase());
  } catch {
    // The build-time web URL is validated by scripts/apply-env.js; keep the
    // defaults if it is ever malformed.
  }
  return hosts;
}

const WEB_HOSTS = buildTrustedHosts();
const INVITE_SCHEME = `${String(APP_SCHEME || 'vibesync').toLowerCase()}:`;

export function normalizeInviteCode(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return /^[A-Z2-9]{7}$/.test(normalized) ? normalized : '';
}

/**
 * Accepts every invite shape VibeSync produces:
 *   vibesync://room/ABC123
 *   vibesync://r/ABC123
 *   vibesync:///room/ABC123
 *   https://vibesync.app/r/ABC123
 *   http://localhost:4000/r/ABC123 (self-hosted web invite)
 */
export function parseInviteUrl(rawUrl) {
  if (!rawUrl) return null;
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    return null;
  }
  const protocol = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split('/').filter(Boolean);
  let candidate = null;

  if (protocol === INVITE_SCHEME || protocol === 'vibesync:') {
    if (host === 'room' || host === 'r') {
      candidate = segments[0];
    } else if (segments[0] === 'room' || segments[0] === 'r') {
      candidate = segments[1];
    }
  } else if (protocol === 'https:' || protocol === 'http:') {
    if (!WEB_HOSTS.has(host)) return null;
    if (segments[0] === 'r' || segments[0] === 'room') {
      candidate = segments[1];
    }
  }

  if (parsed.username || parsed.password) return null;
  // Reject trailing paths rather than silently joining a different room.
  const expectedSegments = host === 'room' || host === 'r' ? 1 : 2;
  if (segments.length !== expectedSegments) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(candidate || '');
  } catch {
    return null;
  }
  const code = normalizeInviteCode(decoded);
  if (code.length < 4) return null;
  return { roomCode: code, url: String(rawUrl) };
}
