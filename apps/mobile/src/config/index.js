import { Platform } from 'react-native';
import buildEnv from './build.env';

export const API_PORT = 4000;

// Build-time configuration is generated from apps/mobile/.env by
// scripts/apply-env.js. The constants below are safe development fallbacks.
const PRODUCTION_API_URL = buildEnv.apiUrl || 'https://api.vibesync.app';
const DEV_HOST =
  buildEnv.devHost ||
  Platform.select({
    android: '10.0.2.2',
    ios: 'localhost',
    default: 'localhost',
  });

let runtimeBaseUrl = null;

export function getApiBaseUrl() {
  if (runtimeBaseUrl) return runtimeBaseUrl;
  if (__DEV__) return `http://${DEV_HOST}:${API_PORT}`;
  return PRODUCTION_API_URL;
}

export function normalizeApiUrl(value, { development = __DEV__ } = {}) {
  const input = String(value || '').trim().replace(/\/$/, '');
  if (!input) return null;
  if (!/^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i.test(input)) {
    throw new Error('Use an API origin such as https://api.example.com, without credentials, paths or query parameters.');
  }
  const port = input.match(/:(\d+)$/)?.[1];
  if (port && (Number(port) < 1 || Number(port) > 65535)) throw new Error('The API port must be between 1 and 65535.');
  if (!development && !/^https:\/\//i.test(input)) throw new Error('Release builds require an HTTPS API server.');
  return input;
}

export function setApiBaseUrl(url) {
  runtimeBaseUrl = normalizeApiUrl(url);
}

export function getSocketUrl() {
  return getApiBaseUrl();
}

export const WEB_URL = buildEnv.webUrl || 'https://vibesync.app';
export const APP_SCHEME = buildEnv.appScheme || 'vibesync';
export const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60 * 1000;
export const PLAYBACK_SYNC_INTERVAL_MS = 3000;
export const HOST_HEARTBEAT_INTERVAL_MS = 5000;
export const CHAT_PAGE_SIZE = 40;
