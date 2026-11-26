import { Platform } from 'react-native';
import { api } from './client';
import { getValidAccessToken } from './session';
import { getDeviceId } from '../services/storage';

async function devicePayload() {
  return {
    deviceId: await getDeviceId(),
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    appVersion: '1.0.0',
    capabilities: {
      ble: true,
      // The nearby transport uses BLE discovery plus a local HTTP server.
      // Wi-Fi Direct and Apple MultipeerConnectivity are not implemented.
      wifiDirect: false,
      localHttp: true,
      multipeer: false,
    },
  };
}

export const authApi = {
  async register(payload) {
    const response = await api.post('/api/auth/register', {
      ...payload,
      device: await devicePayload(),
    });
    return response.data;
  },
  async login(email, password) {
    const response = await api.post('/api/auth/login', {
      email,
      password,
      device: await devicePayload(),
    });
    return response.data;
  },
  async me() {
    const response = await api.get('/api/auth/me');
    return response.data.user;
  },
  async updateProfile(updates) {
    const response = await api.patch('/api/auth/me', updates);
    return response.data.user;
  },
  async changePassword(currentPassword, newPassword) {
    await api.post('/api/auth/change-password', { currentPassword, newPassword });
  },
  async logout(refreshToken) {
    await api.post('/api/auth/logout', { refreshToken });
  },
  async logoutAll() {
    await api.post('/api/auth/logout-all');
  },
  async registerDevice() {
    const response = await api.post('/api/devices', await devicePayload());
    return response.data.device;
  },
};

export const roomsApi = {
  async list(params = {}) {
    const response = await api.get('/api/rooms', { params });
    return response.data;
  },
  async create(payload) {
    const response = await api.post('/api/rooms', payload);
    return response.data;
  },
  async get(roomCode) {
    const response = await api.get(`/api/rooms/${encodeURIComponent(roomCode)}`);
    return response.data;
  },
  async join(roomCode, payload = {}) {
    const response = await api.post(`/api/rooms/${encodeURIComponent(roomCode)}/join`, payload);
    return { ...response.data, httpStatus: response.status };
  },
  async leave(roomCode) {
    await api.post(`/api/rooms/${encodeURIComponent(roomCode)}/leave`);
  },
  async members(roomCode) {
    const response = await api.get(`/api/rooms/${encodeURIComponent(roomCode)}/members`);
    return response.data.data;
  },
  async joinRequests(roomCode) {
    const response = await api.get(`/api/rooms/${encodeURIComponent(roomCode)}/requests`);
    return response.data.data;
  },
  async myJoinRequest(roomCode) {
    const response = await api.get(`/api/rooms/${encodeURIComponent(roomCode)}/requests/mine`);
    return response.data.membership;
  },
  async decideJoinRequest(roomCode, memberId, decision, ban = false) {
    const response = await api.post(
      `/api/rooms/${encodeURIComponent(roomCode)}/requests/${memberId}/decision`,
      { decision, ban },
    );
    return response.data.member;
  },
  async setMemberPermissions(roomCode, memberId, permissions) {
    const response = await api.patch(
      `/api/rooms/${encodeURIComponent(roomCode)}/members/${memberId}/permissions`,
      permissions,
    );
    return response.data.member;
  },
  async grantMic(roomCode, userId, granted) {
    const response = await api.post(
      `/api/rooms/${encodeURIComponent(roomCode)}/members/${userId}/mic`,
      { granted },
    );
    return response.data.member;
  },
  async muteAll(roomCode) {
    const response = await api.post(`/api/rooms/${encodeURIComponent(roomCode)}/mic/mute-all`);
    return response.data;
  },
  async removeMember(roomCode, memberId, ban = false) {
    const response = await api.delete(
      `/api/rooms/${encodeURIComponent(roomCode)}/members/${memberId}`,
      { params: { ban } },
    );
    return response.data.member;
  },
  async updateSettings(roomCode, settings) {
    const response = await api.patch(`/api/rooms/${encodeURIComponent(roomCode)}/settings`, settings);
    return response.data.room;
  },
  async end(roomCode) {
    const response = await api.post(`/api/rooms/${encodeURIComponent(roomCode)}/end`);
    return response.data.room;
  },
  async playback(roomCode) {
    const response = await api.get(`/api/rooms/${encodeURIComponent(roomCode)}/playback`);
    return response.data.playback;
  },
  async playbackCommand(roomCode, command) {
    const response = await api.post(
      `/api/rooms/${encodeURIComponent(roomCode)}/playback/command`,
      command,
    );
    return response.data.playback;
  },
  async heartbeat(roomCode, positionMs) {
    const response = await api.post(
      `/api/rooms/${encodeURIComponent(roomCode)}/playback/heartbeat`,
      { positionMs },
    );
    return response.data.playback;
  },
  async speakRequests(roomCode) {
    const response = await api.get(`/api/rooms/${encodeURIComponent(roomCode)}/speak-requests`);
    return response.data.data;
  },
  async requestSpeak(roomCode, note = '') {
    const response = await api.post(`/api/rooms/${encodeURIComponent(roomCode)}/speak-requests`, {
      note,
    });
    return response.data;
  },
  async decideSpeak(roomCode, requestId, decision) {
    const response = await api.post(
      `/api/rooms/${encodeURIComponent(roomCode)}/speak-requests/${requestId}/decision`,
      { decision },
    );
    return response.data.request;
  },
  async notifications() {
    const response = await api.get('/api/notifications');
    return response.data;
  },
  async readNotification(id) {
    await api.post(`/api/notifications/${id}/read`);
  },
  async readAllNotifications() {
    await api.post('/api/notifications/read-all');
  },
};

export const mediaApi = {
  async list(roomCode) {
    const response = await api.get(`/api/rooms/${encodeURIComponent(roomCode)}/media`);
    return response.data.data;
  },
  async addUrl(roomCode, payload) {
    const response = await api.post(`/api/rooms/${encodeURIComponent(roomCode)}/media/url`, payload);
    return response.data.media;
  },
  async upload(roomCode, file, fields = {}) {
    const form = new FormData();
    form.append('file', {
      uri: file.uri,
      name: file.name || 'media',
      type: file.type || 'application/octet-stream',
    });
    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        form.append(key, String(value));
      }
    });
    const response = await api.post(
      `/api/rooms/${encodeURIComponent(roomCode)}/media/upload`,
      form,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 10 * 60 * 1000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      },
    );
    return response.data.media;
  },
  async remove(roomCode, mediaId) {
    await api.delete(`/api/rooms/${encodeURIComponent(roomCode)}/media/${mediaId}`);
  },
  async authHeaders() {
    const token = await getValidAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
};

export const chatApi = {
  async list(roomCode, { channel = 'room', before, beforeId, limit = 40 } = {}) {
    const response = await api.get(`/api/rooms/${encodeURIComponent(roomCode)}/messages`, {
      params: { channel, before, beforeId, limit },
    });
    return response.data;
  },
  async send(roomCode, payload) {
    const response = await api.post(
      `/api/rooms/${encodeURIComponent(roomCode)}/messages`,
      payload,
    );
    return response.data.message;
  },
  async remove(roomCode, messageId) {
    await api.delete(
      `/api/rooms/${encodeURIComponent(roomCode)}/messages/${messageId}`,
    );
  },
  async clear(roomCode) {
    await api.post(`/api/rooms/${encodeURIComponent(roomCode)}/messages/moderation`, {
      action: 'clear',
    });
  },
};

export const rtcApi = {
  async config() {
    const response = await api.get('/api/rtc/config');
    return response.data;
  },
  async livekitToken(roomCode) {
    const response = await api.post('/api/rtc/livekit-token', { roomId: roomCode });
    return response.data;
  },
};
