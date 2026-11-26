import axios from 'axios';
import { getApiBaseUrl } from '../config';
import {
  clearSessionTokens,
  loadSessionTokens,
  saveSessionTokens,
} from '../services/storage';
import { emitAuthEvent } from '../services/authEvents';

let currentSession = null;
let refreshPromise = null;
let initialized = false;
let initializePromise = null;
let sessionEpoch = 0;
let storageQueue = Promise.resolve();

function storeInOrder(operation) {
  const next = storageQueue.then(operation, operation);
  storageQueue = next.catch(() => {});
  return next;
}

function sessionChanged() {
  const error = new Error('The session changed. Please try again.');
  error.code = 'SESSION_CHANGED';
  return error;
}

function apiOrigin() { return new URL(getApiBaseUrl()).origin; }

async function verifyOrigin() {
  if (currentSession && currentSession.apiOrigin !== apiOrigin()) {
    await clearSession();
    emitAuthEvent({ type: 'session:expired', reason: 'server_changed' });
    const error = new Error('The API server changed. Sign in to this server again.');
    error.code = 'SESSION_EXPIRED';
    throw error;
  }
}

function accessIsFresh(marginMs = 45000) {
  if (!currentSession?.accessToken) return false;
  if (!currentSession.accessExpiresAt) return true;
  return new Date(currentSession.accessExpiresAt).getTime() - Date.now() > marginMs;
}

function refreshIsValid() {
  if (!currentSession?.refreshToken) return false;
  if (!currentSession.refreshExpiresAt) return true;
  return new Date(currentSession.refreshExpiresAt).getTime() > Date.now();
}

export async function initializeSession() {
  if (initialized) return currentSession;
  if (!initializePromise) {
    const epoch = sessionEpoch;
    initializePromise = loadSessionTokens().then(async (tokens) => {
      if (epoch === sessionEpoch) {
        currentSession = tokens;
        initialized = true;
        // An old session without an origin needs a fresh sign-in.
        await verifyOrigin();
      }
      return currentSession;
    }).finally(() => { initializePromise = null; });
  }
  return initializePromise;
}

export async function persistSession(tokens) {
  sessionEpoch += 1;
  currentSession = {
    accessToken: tokens.accessToken,
    accessExpiresAt: tokens.accessExpiresAt,
    refreshToken: tokens.refreshToken,
    refreshExpiresAt: tokens.refreshExpiresAt,
    apiOrigin: apiOrigin(),
  };
  initialized = true;
  const nextSession = currentSession;
  try { await storeInOrder(() => saveSessionTokens(nextSession)); }
  catch (error) {
    sessionEpoch += 1;
    currentSession = null;
    emitAuthEvent({ type: 'session:expired', reason: 'secure_storage_failed' });
    throw error;
  }
  emitAuthEvent({ type: 'session:updated' });
  return currentSession;
}

export async function clearSession() {
  sessionEpoch += 1;
  currentSession = null;
  initialized = true;
  try { await storeInOrder(() => clearSessionTokens()); }
  finally { emitAuthEvent({ type: 'session:cleared' }); }
}

export function getSessionSnapshot() {
  return currentSession;
}

export async function refreshSession() {
  if (refreshPromise) return refreshPromise;
  await initializeSession();
  await verifyOrigin();
  if (refreshPromise) return refreshPromise;
  const epoch = sessionEpoch;
  const refreshToken = currentSession?.refreshToken;
  const origin = apiOrigin();
  refreshPromise = (async () => {
    if (!currentSession?.refreshToken) {
      await clearSession();
      emitAuthEvent({ type: 'session:expired', reason: 'missing_refresh' });
      const error = new Error('Session expired');
      error.code = 'SESSION_EXPIRED';
      throw error;
    }
    if (!refreshIsValid()) {
      await clearSession();
      emitAuthEvent({ type: 'session:expired', reason: 'refresh_expired' });
      const error = new Error('Session expired');
      error.code = 'SESSION_EXPIRED';
      throw error;
    }

    try {
      const response = await axios.post(
        `${origin}/api/auth/refresh`,
        { refreshToken },
        {
          timeout: 15000,
          headers: { 'Content-Type': 'application/json' },
        },
      );
      if (epoch !== sessionEpoch || origin !== apiOrigin()) throw sessionChanged();
      currentSession = {
        ...currentSession,
        accessToken: response.data.accessToken,
        accessExpiresAt: response.data.accessExpiresAt,
        refreshToken: response.data.refreshToken,
        refreshExpiresAt: response.data.refreshExpiresAt,
      };
      const nextSession = currentSession;
      try { await storeInOrder(() => saveSessionTokens(nextSession)); }
      catch (error) {
        sessionEpoch += 1;
        currentSession = null;
        emitAuthEvent({ type: 'session:expired', reason: 'secure_storage_failed' });
        throw error;
      }
      if (epoch !== sessionEpoch) throw sessionChanged();
      emitAuthEvent({ type: 'session:refreshed' });
      return currentSession.accessToken;
    } catch (error) {
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        if (epoch !== sessionEpoch) throw sessionChanged();
        await clearSession();
        emitAuthEvent({
          type: 'session:expired',
          reason: error.response?.data?.error?.code || 'refresh_rejected',
        });
        const sessionError = new Error('Session expired. Please sign in again.');
        sessionError.code = 'SESSION_EXPIRED';
        throw sessionError;
      }
      throw error;
    }
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function getValidAccessToken({ forceRefresh = false } = {}) {
  await initializeSession();
  await verifyOrigin();
  if (!forceRefresh && accessIsFresh()) return currentSession?.accessToken || null;
  return refreshSession();
}
