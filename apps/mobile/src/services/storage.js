import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

const KEYCHAIN_SERVICE = 'com.vibesync.session';
const FALLBACK_TOKEN_KEY = 'vibesync.tokens.v1';
const TOKEN_USERNAME = 'vibesync-session';

export async function saveSessionTokens(tokens) {
  const serialized = JSON.stringify(tokens);
  try {
    await Keychain.setGenericPassword(TOKEN_USERNAME, serialized, {
      service: KEYCHAIN_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
    });
  } catch {
    // Emulators and some Android devices have no secure hardware keystore.
    // Still use the OS keystore (hardware-backed when available), never plain
    // AsyncStorage for credentials.
    await Keychain.setGenericPassword(TOKEN_USERNAME, serialized, {
      service: KEYCHAIN_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
  // Remove tokens written by pre-1.0 development builds.
  await AsyncStorage.removeItem(FALLBACK_TOKEN_KEY);
  return true;
}

export async function loadSessionTokens() {
  const credentials = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
  if (!credentials || !credentials.password) return null;
  return JSON.parse(credentials.password);
}

export async function clearSessionTokens() {
  await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
  await AsyncStorage.removeItem(FALLBACK_TOKEN_KEY);
}

export async function cacheUser(user) {
  if (!user) {
    await AsyncStorage.removeItem('vibesync.user.v1');
    return;
  }
  await AsyncStorage.setItem('vibesync.user.v1', JSON.stringify(user));
}

export async function getCachedUser() {
  const raw = await AsyncStorage.getItem('vibesync.user.v1');
  return raw ? JSON.parse(raw) : null;
}

export async function getOnboardingComplete() {
  return (await AsyncStorage.getItem('vibesync.onboarding.v1')) === 'true';
}

export async function setOnboardingComplete() {
  await AsyncStorage.setItem('vibesync.onboarding.v1', 'true');
}

export async function getDeviceId() {
  let deviceId = await AsyncStorage.getItem('vibesync.deviceId.v1');
  if (!deviceId) {
    const random = Math.random().toString(36).slice(2, 10);
    deviceId = `vs-${Date.now().toString(36)}-${random}`;
    await AsyncStorage.setItem('vibesync.deviceId.v1', deviceId);
  }
  return deviceId;
}

export async function getRecentRooms() {
  const raw = await AsyncStorage.getItem('vibesync.recentRooms.v1');
  return raw ? JSON.parse(raw) : [];
}

export async function addRecentRoom(room) {
  const existing = await getRecentRooms();
  const next = [
    {
      roomId: room.roomId,
      name: room.name,
      mediaType: room.mediaType,
      mode: room.mode,
      role: room.role || 'participant',
      openedAt: Date.now(),
    },
    ...existing.filter((item) => item.roomId !== room.roomId),
  ].slice(0, 6);
  await AsyncStorage.setItem('vibesync.recentRooms.v1', JSON.stringify(next));
  return next;
}

export async function clearRecentRooms() {
  await AsyncStorage.removeItem('vibesync.recentRooms.v1');
}

export async function getApiOverride() {
  return AsyncStorage.getItem('vibesync.apiBaseUrl.v1');
}

export async function setApiOverride(url) {
  if (url) await AsyncStorage.setItem('vibesync.apiBaseUrl.v1', url);
  else await AsyncStorage.removeItem('vibesync.apiBaseUrl.v1');
}

export async function setPendingInvite(roomCode) {
  if (roomCode) await AsyncStorage.setItem('vibesync.pendingInvite.v1', roomCode);
  else await AsyncStorage.removeItem('vibesync.pendingInvite.v1');
}

export async function getPendingInvite() {
  return AsyncStorage.getItem('vibesync.pendingInvite.v1');
}
