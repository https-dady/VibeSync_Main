import axios from 'axios';
import { getApiBaseUrl } from '../config';
import {
  getValidAccessToken,
  refreshSession,
  initializeSession,
} from './session';

export const api = axios.create({
  timeout: 20000,
  headers: { Accept: 'application/json' },
});

function isAuthEndpoint(url = '') {
  return /^\/api\/auth\/(login|register|refresh)(?:\?|$)/.test(url);
}

api.interceptors.request.use(async (config) => {
  config.baseURL = getApiBaseUrl();

  // Login and registration must work without an existing session.
  if (isAuthEndpoint(config.url)) {
    return config;
  }

  await initializeSession();

  try {
    const token = await getValidAccessToken();
    if (new URL(config.baseURL).origin !== new URL(getApiBaseUrl()).origin) {
      throw Object.assign(new Error('The API server changed during this request. Please retry.'), { code: 'SESSION_CHANGED' });
    }

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (error) {
    if (error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_CHANGED') {
      throw error;
    }
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    if (
      status === 401 &&
      original &&
      !original._retried &&
      !isAuthEndpoint(original.url) &&
      (await initializeSession())?.refreshToken
    ) {
      if (new URL(original.baseURL).origin !== new URL(getApiBaseUrl()).origin) return Promise.reject(error);
      original._retried = true;

      try {
        const token = await refreshSession();
        if (new URL(original.baseURL).origin !== new URL(getApiBaseUrl()).origin) return Promise.reject(error);

        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${token}`;

        return api(original);
      } catch (refreshError) {
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

export function apiError(error) {
  if (error?.friendlyMessage || (error?.code && !error?.isAxiosError && !error?.response)) {
    return { message: error.friendlyMessage || error.message, code: error.code || 'REQUEST_FAILED' };
  }
  if (error?.code === 'SESSION_EXPIRED') {
    return {
      message: 'Your session expired. Please sign in again.',
      code: 'SESSION_EXPIRED',
    };
  }

  if (error?.code === 'ECONNABORTED') {
    return {
      message: 'The request timed out. Check your connection.',
      code: 'TIMEOUT',
    };
  }

  if (!error?.response) {
    return {
      message: 'Cannot reach VibeSync. Check your internet connection or server address.',
      code: 'NETWORK_ERROR',
    };
  }

  const payload = error.response.data?.error;

  return {
    message: payload?.message || `Request failed (${error.response.status})`,
    code: payload?.code || 'REQUEST_FAILED',
    details: payload?.details,
    status: error.response.status,
  };
}

export function absoluteMediaUrl(path) {
  if (!path) return null;

  if (/^https?:\/\//i.test(path)) {
    return new URL(path).origin === new URL(getApiBaseUrl()).origin ? path : null;
  }

  return `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}
