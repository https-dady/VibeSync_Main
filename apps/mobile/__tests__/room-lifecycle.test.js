jest.mock('../src/api/endpoints', () => ({ roomsApi: {
  get: jest.fn(), join: jest.fn(), members: jest.fn(), playback: jest.fn(), leave: jest.fn(),
}, mediaApi: { list: jest.fn() }, chatApi: { list: jest.fn(), send: jest.fn() } }));
jest.mock('../src/services/storage', () => ({ addRecentRoom: jest.fn().mockResolvedValue() }));
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'guest', name: 'Guest' } }) }));
jest.mock('../src/context/SocketContext', () => ({ useSocket: jest.fn() }));
jest.mock('../src/config', () => ({ CHAT_PAGE_SIZE: 40, APP_SCHEME: 'vibesync', WEB_URL: 'https://vibesync.app' }));
jest.mock('../src/voice/VoiceEngine', () => ({ VoiceEngine: class {
  constructor() { this.start = jest.fn().mockResolvedValue(); this.stop = jest.fn().mockResolvedValue(); this.recover = jest.fn().mockResolvedValue(); }
  updateMembers() {}
  receiveSignal() {}
  snapshot() { return { publishing: false }; }
} }));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { EventEmitter } from 'events';
import { RoomProvider, useRoom } from '../src/context/RoomContext';
import { useSocket } from '../src/context/SocketContext';
import { roomsApi, mediaApi, chatApi } from '../src/api/endpoints';

global.IS_REACT_ACT_ENVIRONMENT = true;
const room = { roomId: 'ABC2345', hostId: 'host', status: 'active' };
const membership = { id: 'member', userId: 'guest', status: 'active', role: 'participant', permissions: { canChat: true } };
const playback = { sequence: 1, mediaId: null, status: 'paused', positionMs: 0 };
const defer = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };

describe('room activation and reconnect lifecycle', () => {
  let context;
  let tree;
  let socket;
  let emitAck;
  const Consumer = () => { context = useRoom(); return null; };
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    socket = new EventEmitter(); socket.connected = true;
    emitAck = jest.fn().mockResolvedValue({ ok: true, playback, members: [membership], membership, onlineUsers: ['guest'] });
    useSocket.mockReturnValue({ socket, emitAck, connected: true, serverNow: () => Date.now() });
    roomsApi.get.mockResolvedValue({ room, membership });
    roomsApi.members.mockResolvedValue([membership]);
    roomsApi.playback.mockResolvedValue(playback);
    roomsApi.leave.mockResolvedValue();
    mediaApi.list.mockResolvedValue([]);
    chatApi.list.mockResolvedValue({ data: [], hasMore: false });
    await act(async () => { tree = renderer.create(<RoomProvider><Consumer /></RoomProvider>); });
  });
  afterEach(async () => {
    await act(async () => tree.unmount());
    jest.useRealTimers();
  });
  test('deduplicates concurrent room entry and creates one socket subscription', async () => {
    await act(async () => { await Promise.all([context.enterRoom('abc2345'), context.enterRoom('ABC2345')]); });
    expect(roomsApi.get).toHaveBeenCalledTimes(1);
    expect(emitAck).toHaveBeenCalledTimes(1);
    expect(context.joined).toBe(true);
    expect(context.loading).toBe(false);
  });
  test('a required playback request failure ends loading and reports failure', async () => {
    roomsApi.playback.mockRejectedValue(new Error('Playback service unavailable'));
    await act(async () => { await expect(context.enterRoom('ABC2345')).rejects.toThrow('Playback service unavailable'); });
    expect(context.joined).toBe(false);
    expect(context.loading).toBe(false);
    expect(context.error).toContain('unavailable');
  });
  test('clearing the room cancels delayed entry without restoring state', async () => {
    const lookup = defer(); roomsApi.get.mockReturnValue(lookup.promise);
    let result;
    await act(async () => {
      result = context.enterRoom('ABC2345').catch((error) => error);
      context.clearRoom();
      lookup.resolve({ room, membership });
      expect(await result).toMatchObject({ code: 'JOIN_CANCELLED' });
    });
    expect(context.room).toBeNull();
    expect(context.loading).toBe(false);
  });
  test('realtime snapshots received during preparation win over stale REST responses', async () => {
    const media = defer(); mediaApi.list.mockReturnValue(media.promise);
    await act(async () => {
      const entered = context.enterRoom('ABC2345');
      await Promise.resolve(); await Promise.resolve();
      socket.emit('playback:state', { roomId: room.roomId, playback: { ...playback, sequence: 8, positionMs: 8000 } });
      media.resolve([]);
      await entered;
    });
    expect(context.playback.sequence).toBe(8);
    expect(context.playback.positionMs).toBe(8000);
  });
  test('reconnect replaces verified chat history to reconcile missed moderation', async () => {
    const old = { id: 'old', senderId: 'host', body: 'removed later', createdAt: '2026-01-01T00:00:00Z' };
    chatApi.list.mockResolvedValue({ data: [old], hasMore: false });
    await act(async () => { await context.enterRoom('ABC2345'); });
    expect(context.messages.map((message) => message.id)).toContain('old');
    chatApi.list.mockResolvedValue({ data: [], hasMore: false });
    await act(async () => { socket.emit('connect'); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(context.messages).toEqual([]);
    expect(emitAck).toHaveBeenCalledTimes(2);
  });
});
