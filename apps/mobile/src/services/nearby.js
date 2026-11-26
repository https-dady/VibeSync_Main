import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

const nativeModule = NativeModules.VibeSyncNearby || null;
const emitter = nativeModule ? new NativeEventEmitter(nativeModule) : null;

const REQUEST_TIMEOUT_MS = 8000;

export const NEARBY_SUPPORTED = Boolean(nativeModule);

export const nearbyEvents = {
  PEER_FOUND: 'VibeSyncNearbyPeer',
  PEER_LOST: 'VibeSyncNearbyPeerLost',
  SCAN_STATE: 'VibeSyncNearbyScanState',
  HOST_STATE: 'VibeSyncNearbyHostState',
};

function requireNative() {
  if (!nativeModule) {
    const error = new Error(
      'Nearby mode needs the VibeSync native module. Build and run the Android or iOS app to use it.',
    );
    error.code = 'NEARBY_UNAVAILABLE';
    throw error;
  }
  return nativeModule;
}

async function request(baseUrl, path, { method = 'GET', token, body } = {}) {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const headers = { Accept: 'application/json' };
  if (token) headers['X-VibeSync-Token'] = token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
        method,
        headers,
        signal: controller.signal,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      const invalid = new Error('The host returned an invalid response. Restart the nearby room.');
      invalid.code = 'NEARBY_INVALID_RESPONSE';
      throw invalid;
    }
    if (!response.ok || payload?.ok === false) {
      const error = new Error(payload?.error || `Local room request failed (${response.status})`);
      error.code = payload?.code || 'NEARBY_REQUEST_FAILED';
      error.status = response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (controller.signal.aborted) {
      const timedOut = new Error('The host did not respond within 8 seconds. Check the shared Wi-Fi or hotspot and try again.');
      timedOut.code = 'NEARBY_TIMEOUT';
      throw timedOut;
    }
    if (error.code) throw error;
    const networkError = new Error(
      'Could not reach the host. Use the same Wi-Fi or hotspot, allow local-network access, and check that router client isolation is off.',
    );
    networkError.code = 'NEARBY_UNREACHABLE';
    throw networkError;
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeNearbyAddress(value) {
  let input = String(value || '').trim();
  if (!input) throw new Error('Enter the host address');
  if (!/^https?:\/\//i.test(input)) input = `http://${input}`;
  // React Native's URL polyfill does not reliably expose .port/.origin, so the
  // address is parsed explicitly instead.
  const match = input.match(/^(https?):\/\/([^/\s:?#]+|\[[^\]]+\])(?::(\d{1,5}))?(?:[/?#].*)?$/i);
  if (!match) throw new Error('Enter an address like 192.168.1.20:8787');
  const [, protocol, host, port] = match;
  // Tokens are local session credentials. Never send them to an arbitrary
  // public hostname; support literal private/link-local LAN addresses only.
  const octets = host.split('.').map(Number);
  const validIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) && octets.every((octet) => octet >= 0 && octet <= 255);
  const privateIpv4 = validIpv4 && (octets[0] === 10 || octets[0] === 127 ||
    (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 169 && octets[1] === 254));
  const localIpv6 = /^\[(?:fd[0-9a-f]{2}|fc[0-9a-f]{2}|fe[89ab][0-9a-f]):[0-9a-f:]+\]$/i.test(host) || host === '[::1]';
  if (!privateIpv4 && !localIpv6) throw new Error('Use the host’s private Wi-Fi or hotspot IP address, for example 192.168.1.20:8787');
  if (!port) throw new Error('Include the host port, for example 192.168.1.20:8787');
  if (Number(port) < 1 || Number(port) > 65535) throw new Error('The host port must be between 1 and 65535');
  return `${protocol.toLowerCase()}://${host}:${port}`;
}

export function nearbyMediaUrl(baseUrl, session) {
  const source = session?.media?.url;
  if (!source) return null;
  if (!baseUrl) return null;
  const origin = normalizeNearbyAddress(baseUrl);
  // Never attach a room bearer token to a URL supplied by another website.
  if (source !== '/vibesync/media') return null;
  return `${origin}${source}`;
}

export async function getCapabilities() {
  if (!nativeModule) {
    return {
      supported: false,
      ble: false,
      localServer: false,
      wifiDirect: false,
      platform: Platform.OS,
      reason: 'Native nearby transport is not compiled into this build.',
    };
  }
  try {
    const capabilities = await nativeModule.getCapabilities();
    return { supported: true, platform: Platform.OS, ...capabilities };
  } catch (error) {
    return {
      supported: false,
      ble: false,
      localServer: false,
      wifiDirect: false,
      platform: Platform.OS,
      reason: error?.message || 'Nearby transport is unavailable.',
    };
  }
}

export async function startHost(options) {
  const module = requireNative();
  return module.startHost(options);
}

export async function stopHost() {
  if (!nativeModule) return;
  await nativeModule.stopHost();
}

export async function getHostSession() {
  const module = requireNative();
  return module.getSession();
}

export async function updatePlayback(playback) {
  const module = requireNative();
  return module.updatePlayback(playback);
}

export async function sendHostMessage(body) {
  const module = requireNative();
  return module.sendHostMessage(body);
}

export async function startDiscovery(displayName = '') {
  const module = requireNative();
  return module.startScan({ displayName });
}

export async function stopDiscovery() {
  if (!nativeModule) return;
  await nativeModule.stopScan();
}

export async function fetchNearbyInfo(baseUrl) {
  return request(normalizeNearbyAddress(baseUrl), '/vibesync/info');
}

export async function verifyNearbyHost(baseUrl, recoveryKey) {
  if (!recoveryKey || !nativeModule?.verifyHostProof) return false;
  const challenge = newNearbyRequestId('proof');
  const result = await request(normalizeNearbyAddress(baseUrl), '/vibesync/proof', { method: 'POST', body: { challenge } });
  return nativeModule.verifyHostProof(recoveryKey, challenge, result?.proof || '');
}

export function newNearbyRequestId(prefix = 'message') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

export async function joinNearbyRoom(baseUrl, name, code) {
  const origin = normalizeNearbyAddress(baseUrl);
  const roomCode = formatNearbyCode(code);
  if (!/^[A-Z0-9]{4}$/.test(roomCode)) throw new Error('Enter the four-character nearby room code.');
  // This key deduplicates one join attempt and its network retry. The native
  // host issues the cryptographically random bearer token after admission.
  const requestId = newNearbyRequestId('join');
  const options = {
    method: 'POST',
    body: { name: String(name || '').trim() || 'Guest', code: roomCode, requestId },
  };
  let result;
  try {
    result = await request(origin, '/vibesync/join', options);
  } catch (error) {
    if (!['NEARBY_TIMEOUT', 'NEARBY_UNREACHABLE'].includes(error.code)) throw error;
    result = await request(origin, '/vibesync/join', options);
  }
  if (!result?.token || !result?.memberId || !result?.session) {
    throw new Error('The host returned an incomplete join response. Try joining again.');
  }
  return { ...result, baseUrl: origin };
}

export async function fetchNearbySession(baseUrl, token) {
  const origin = normalizeNearbyAddress(baseUrl);
  const sentAt = Date.now();
  const result = await request(origin, '/vibesync/session', { token });
  const receivedAt = Date.now();
  return {
    ...result,
    baseUrl: origin,
    receivedAt,
    sentAt,
    rttMs: receivedAt - sentAt,
    // The host stamps serverNow while handling the request, so the midpoint
    // of the request window cancels most of the local round-trip latency.
    offsetMs: Number(result.serverNow || 0) - (sentAt + receivedAt) / 2,
  };
}

export async function sendNearbyMessage(baseUrl, token, body, clientMessageId = newNearbyRequestId()) {
  const origin = normalizeNearbyAddress(baseUrl);
  const options = {
    method: 'POST',
    token,
    body: { body: String(body || '').trim(), clientMessageId },
  };
  let result;
  try { result = await request(origin, '/vibesync/messages', options); } catch (error) {
    if (!['NEARBY_TIMEOUT', 'NEARBY_UNREACHABLE'].includes(error.code)) throw error;
    result = await request(origin, '/vibesync/messages', options);
  }
  if (!result?.message?.id) throw new Error('The host did not confirm message delivery. Retry the message.');
  return result.message;
}

export async function moderateNearbyRoom(baseUrl, token, action, targetId) {
  return request(normalizeNearbyAddress(baseUrl), '/vibesync/moderation', { method: 'POST', token, body: { action, targetId } });
}

export async function leaveNearbyRoom(baseUrl, token) {
  const origin = normalizeNearbyAddress(baseUrl);
  await request(origin, '/vibesync/leave', { method: 'POST', token }).catch(() => {});
}

export function subscribePeerFound(listener) {
  if (!emitter) return () => {};
  const subscription = emitter.addListener(nearbyEvents.PEER_FOUND, listener);
  return () => subscription.remove();
}

export function subscribePeerLost(listener) {
  if (!emitter) return () => {};
  const subscription = emitter.addListener(nearbyEvents.PEER_LOST, listener);
  return () => subscription.remove();
}

export function subscribeScanState(listener) {
  if (!emitter) return () => {};
  const subscription = emitter.addListener(nearbyEvents.SCAN_STATE, listener);
  return () => subscription.remove();
}

export function subscribeHostState(listener) {
  if (!emitter) return () => {};
  const subscription = emitter.addListener(nearbyEvents.HOST_STATE, listener);
  return () => subscription.remove();
}

export function expectedNearbyPosition(sessionOrPlayback, localNow, offsetMs = 0) {
  // Support both a complete session and a direct playback object.
  const playback = sessionOrPlayback?.playback ?? sessionOrPlayback;

  if (!playback) return 0;

  const base = Math.max(0, Number(playback.positionMs) || 0);

  if (playback.status !== 'playing') {
    return base;
  }

  const rawUpdatedAt = playback.updatedAt;

  let updatedAt = Number(rawUpdatedAt);

  // Support ISO timestamps as well as numeric timestamps.
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    updatedAt = new Date(rawUpdatedAt).getTime();
  }

  // Convert Unix seconds to milliseconds when necessary.
  if (Number.isFinite(updatedAt) && updatedAt > 0 && updatedAt < 1e12) {
    updatedAt *= 1000;
  }

  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return base;
  }

  const serverNow = Number(localNow) + (Number(offsetMs) || 0);
  const elapsed = Math.max(0, serverNow - updatedAt);
  const rate = Math.max(0.25, Math.min(3, Number(playback.rate) || 1));

  return base + elapsed * rate;
}

export function formatNearbyCode(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}
