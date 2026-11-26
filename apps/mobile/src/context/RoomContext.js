import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { roomsApi, mediaApi, chatApi } from '../api/endpoints';
import { addRecentRoom } from '../services/storage';
import { CHAT_PAGE_SIZE } from '../config';
import { shouldApplyState } from '../sync/PlaybackSync';
import { createMessageId, mergeMessages, mergePlayback } from './roomState';
import { normalizeInviteCode } from '../utils/deepLinks';
import { VoiceEngine } from '../voice/VoiceEngine';
import { useAuth } from './AuthContext';
import { useSocket } from './SocketContext';

const RoomContext = createContext(null);

const EMPTY_VOICE = {
  active: false,
  canPublish: false,
  publishing: false,
  localStream: null,
  peerCount: 0,
  connectedPeers: 0,
  remoteSpeakerIds: [],
  status: 'idle',
};

const initialState = {
  room: null,
  membership: null,
  members: [],
  onlineUserIds: [],
  playback: null,
  media: [],
  messages: [],
  hostMessages: [],
  messagePaging: {
    room: { hasMore: false, nextBefore: null, loading: false },
    host: { hasMore: false, nextBefore: null, loading: false },
  },
  speakRequests: [],
  joinRequests: [],
  loading: false,
  activating: false,
  joined: false,
  error: null,
  evicted: null,
  pending: null,
  notice: null,
  micEnabled: false,
  voice: EMPTY_VOICE,
  remoteStreams: [],
  voiceError: null,
};

function uniqueMessages(existing, incoming) {
  const delivered = (Array.isArray(incoming) ? incoming : [incoming])
    .filter(Boolean).map((message) => ({ ...message, delivery: message.delivery || 'sent' }));
  return mergeMessages(existing, delivered);
}

function mergeMembers(existing, incoming) {
  const map = new Map(existing.map((member) => [String(member.userId), member]));
  (Array.isArray(incoming) ? incoming : [incoming]).forEach((member) => {
    if (member) map.set(String(member.userId), { ...map.get(String(member.userId)), ...member });
  });
  return [...map.values()].sort((a, b) => {
    if (a.role === b.role) return new Date(a.joinedAt || 0) - new Date(b.joinedAt || 0);
    return a.role === 'host' ? -1 : 1;
  });
}

function normalizeOnlineUsers(list = []) {
  return [...new Set((list || []).map((item) => String(item)))];
}

function friendlyError(error) {
  if (error?.code === 'NOT_CONNECTED') {
    return 'You are offline. Reconnect to control this online room.';
  }
  return error?.message || 'Something went wrong. Try again.';
}

export function RoomProvider({ children }) {
  const { user } = useAuth();
  const { socket, emitAck, connected, serverNow } = useSocket();
  const [state, setState] = useState(initialState);
  const stateRef = useRef(initialState);
  const voiceRef = useRef(null);
  const remoteStreamsRef = useRef(new Map());
  const socketRef = useRef(socket);
  const userRef = useRef(user);
  const joinedRef = useRef(false);
  const rejoinInFlight = useRef(false);
  const activationEpoch = useRef(0);
  const enterInFlight = useRef(null);
  const pendingSignals = useRef([]);
  const roomNeedsRecovery = useRef(false);

  const update = useCallback((patch) => {
    const next = typeof patch === 'function' ? patch(stateRef.current) : { ...stateRef.current, ...patch };
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  useEffect(() => {
    userRef.current = user;
    if (!user) {
      activationEpoch.current += 1;
      pendingSignals.current = [];
      joinedRef.current = false;
      if (voiceRef.current) {
        voiceRef.current.stop().catch(() => {});
        voiceRef.current = null;
      }
      remoteStreamsRef.current.clear();
      setState(initialState);
      stateRef.current = initialState;
    }
  }, [user]);

  const applyPlayback = useCallback(
    (playback) => {
      if (!playback) return;
      update((current) => {
        if (!current.room) return current;
        if (!shouldApplyState(current.playback?.sequence, playback.sequence)) return current;
        let media = current.media;
        if (playback.media?.id && !media.some((item) => item.id === playback.media.id)) {
          media = [playback.media, ...media];
        }
        return { ...current, playback, media };
      });
    },
    [update],
  );

  const stopVoice = useCallback(async () => {
    if (voiceRef.current) {
      await voiceRef.current.stop().catch(() => {});
      voiceRef.current = null;
    }
    remoteStreamsRef.current.clear();
    update({
      voice: EMPTY_VOICE,
      remoteStreams: [],
      micEnabled: false,
    });
  }, [update]);

  const createVoiceEngine = useCallback(
    (room, members) => {
      if (!user) return null;
      if (voiceRef.current) {
        voiceRef.current.updateMembers(members);
        return voiceRef.current;
      }
      const engine = new VoiceEngine({
        socket: socketRef.current,
        emitAck,
        roomId: room.roomId,
        userId: user.id,
        onRemoteStream: (userId, stream) => {
          if (stream) remoteStreamsRef.current.set(String(userId), stream);
          else remoteStreamsRef.current.delete(String(userId));
          update({ remoteStreams: [...remoteStreamsRef.current.entries()] });
        },
        onState: (voice) => update({ voice, micEnabled: Boolean(voice.publishing) }),
        onLocalStream: (stream) => {
          update({ voice: { ...stateRef.current.voice, localStream: stream } });
        },
        onError: (error) => {
          update({ voiceError: { id: Date.now(), message: error.message || 'Voice connection failed' } });
        },
      });
      voiceRef.current = engine;
      engine.start(members).catch(() => {});
      return engine;
    },
    [emitAck, update, user],
  );

  const activate = useCallback(
    async (roomPayload, membershipPayload) => {
      if (!user) throw new Error('Sign in to join a room');
      const room = roomPayload;
      const membership = membershipPayload;
      const epoch = ++activationEpoch.current;
      const assertActive = () => {
        if (activationEpoch.current !== epoch || !userRef.current) {
          const error = new Error('Room entry was cancelled');
          error.code = 'JOIN_CANCELLED';
          throw error;
        }
      };
      if (!membership || membership.status !== 'active') {
        throw new Error('Your membership is not active yet');
      }
      const previousRoom = stateRef.current.room;
      if (previousRoom?.roomId !== room.roomId) {
        if (previousRoom && socketRef.current?.connected) socketRef.current.emit('room:leave', { roomId: previousRoom.roomId }, () => {});
        await stopVoice();
      }
      pendingSignals.current = [];
      update({
        ...initialState,
        loading: true,
        activating: true,
        error: null,
        room,
        membership,
        pending: null,
        joined: false,
        evicted: null,
      });
      try {
        const subscription = socketRef.current?.connected
          ? emitAck('room:join', { roomId: room.roomId })
          : Promise.reject(Object.assign(new Error('Live connection unavailable'), { code: 'NOT_CONNECTED' }));
        const [mediaResult, membersResult, playbackResult, messagesResult, hostResult, speakResult, joinsResult, socketResult] = await Promise.allSettled([
          mediaApi.list(room.roomId),
          roomsApi.members(room.roomId),
          roomsApi.playback(room.roomId),
          chatApi.list(room.roomId, { channel: 'room', limit: CHAT_PAGE_SIZE }),
          membership.permissions?.canChat
            ? chatApi.list(room.roomId, { channel: 'host', limit: CHAT_PAGE_SIZE })
            : Promise.resolve({ data: [] }),
          membership.role === 'host' ? roomsApi.speakRequests(room.roomId) : Promise.resolve([]),
          membership.role === 'host' ? roomsApi.joinRequests(room.roomId) : Promise.resolve([]),
          subscription,
        ]);
        assertActive();
        if (membersResult.status === 'rejected') throw membersResult.reason;
        if (playbackResult.status === 'rejected') throw playbackResult.reason;
        if (socketResult.status === 'rejected' && ['NOT_A_MEMBER', 'ROOM_ENDED', 'ROOM_NOT_FOUND'].includes(socketResult.reason.code)) throw socketResult.reason;
        const response = socketResult.status === 'fulfilled' ? socketResult.value : {};
        roomNeedsRecovery.current = socketResult.status === 'rejected';
        const messagesPage = messagesResult.status === 'fulfilled' ? messagesResult.value : { data: [] };
        const hostPage = hostResult.status === 'fulfilled' ? hostResult.value : { data: [] };
        const members = response.members || membersResult.value;
        update((current) => ({
          ...current,
          room,
          membership: response.membership || membership,
          members,
          onlineUserIds: normalizeOnlineUsers([...current.onlineUserIds, user.id]),
          media: mediaResult.status === 'fulfilled' ? mediaResult.value : [],
          playback: mergePlayback(mergePlayback(current.playback, playbackResult.value), response.playback),
          messages: uniqueMessages(current.messages, messagesPage.data || []),
          hostMessages: uniqueMessages(current.hostMessages, hostPage.data || []),
          messagePaging: {
            room: {
              hasMore: Boolean(messagesPage.hasMore),
              nextBefore: messagesPage.nextBefore || null,
              nextBeforeId: messagesPage.nextBeforeId || null,
              loading: false,
            },
            host: {
              hasMore: Boolean(hostPage.hasMore),
              nextBefore: hostPage.nextBefore || null,
              nextBeforeId: hostPage.nextBeforeId || null,
              loading: false,
            },
          },
          speakRequests: speakResult.status === 'fulfilled' ? speakResult.value : [],
          joinRequests: joinsResult.status === 'fulfilled' ? joinsResult.value : [],
          notice: socketResult.status === 'rejected'
            ? { id: Date.now(), message: 'Room loaded. Reconnect to restore live updates.', tone: 'default' } : null,
          loading: false,
          activating: false,
          joined: true,
        }));
        joinedRef.current = true;
        await addRecentRoom({ ...room, role: membership.role }).catch(() => {});

        const engine = createVoiceEngine(room, members);
        if (engine) {
          engine.updateMembers(members);
          engine.start(members).then(async () => {
            if (activationEpoch.current !== epoch) return;
            const queued = pendingSignals.current;
            pendingSignals.current = [];
            for (const signal of queued) await engine.receiveSignal(signal);
          }).catch(() => {});
        }

        assertActive();
        update({ onlineUserIds: normalizeOnlineUsers(response.onlineUsers || stateRef.current.onlineUserIds) });
        return { room, membership };
      } catch (error) {
        if (epoch === activationEpoch.current) update({ loading: false, activating: false, error: friendlyError(error) });
        throw error;
      }
    },
    [createVoiceEngine, emitAck, stopVoice, update, user],
  );

  const enterRoom = useCallback(
    async (roomCode, { password, message, join = true } = {}) => {
      const code = normalizeInviteCode(roomCode);
      if (!code) throw new Error('Enter a valid 7-character room code (letters and digits 2–9)');
      if (enterInFlight.current) {
        if (enterInFlight.current.code === code) return enterInFlight.current.promise;
        throw new Error('Wait for the current room connection to finish');
      }
      const entryEpoch = activationEpoch.current;
      const assertEntry = () => {
        if (entryEpoch !== activationEpoch.current || !userRef.current) {
          throw Object.assign(new Error('Room entry was cancelled'), { code: 'JOIN_CANCELLED' });
        }
      };
      const operation = (async () => {
      update({ loading: true, error: null, evicted: null });
      try {
        let details = null;
        try {
          details = await roomsApi.get(code);
        } catch (error) {
          if (error?.response?.status !== 403 || error?.response?.data?.error?.code !== 'PRIVATE_ROOM') {
            throw error;
          }
          if (!join) throw error;
        }
        assertEntry();
        if (details?.membership?.status === 'active') {
          return await activate(details.room, details.membership);
        }
        if (details?.membership?.status === 'pending') {
          update({
            loading: false,
            pending: { room: details.room, membership: details.membership },
            room: details.room,
          });
          return { state: 'pending', room: details.room, membership: details.membership };
        }
        if (!join) {
          const error = new Error('Join this room to see the live session');
          error.code = 'NEED_JOIN';
          error.room = details?.room;
          throw error;
        }

        const joined = await roomsApi.join(code, { password, message });
        assertEntry();
        if (joined.state === 'pending' || joined.membership?.status === 'pending') {
          update({
            loading: false,
            pending: { room: joined.room, membership: joined.membership },
            room: joined.room,
          });
          return { state: 'pending', room: joined.room, membership: joined.membership };
        }
        return await activate(joined.room, joined.membership);
      } catch (error) {
        if (error.code !== 'JOIN_CANCELLED') update({ loading: false, error: friendlyError(error) });
        error.friendlyMessage = friendlyError(error);
        throw error;
      }
      })();
      enterInFlight.current = { code, promise: operation };
      try { return await operation; } finally {
        if (enterInFlight.current?.promise === operation) enterInFlight.current = null;
      }
    },
    [activate, update],
  );

  const enterCreatedRoom = useCallback(
    async (payload) => {
      if (!payload?.room || !payload?.membership) throw new Error('Room creation returned no membership');
      return activate(payload.room, payload.membership);
    },
    [activate],
  );

  const clearRoom = useCallback(() => {
    activationEpoch.current += 1;
    pendingSignals.current = [];
    joinedRef.current = false;
    if (voiceRef.current) {
      voiceRef.current.stop().catch(() => {});
      voiceRef.current = null;
    }
    remoteStreamsRef.current.clear();
    update(initialState);
  }, [update]);

  const leaveRoom = useCallback(async () => {
    const current = stateRef.current;
    if (!current.room) return;
    const activeSocket = socketRef.current;
    if (activeSocket?.connected) activeSocket.emit('room:leave', { roomId: current.room.roomId }, () => {});
    if (current.membership?.role !== 'host') {
      await roomsApi.leave(current.room.roomId).catch(() => {});
    }
    joinedRef.current = false;
    await stopVoice();
    clearRoom();
  }, [clearRoom, stopVoice]);

  const refreshRoom = useCallback(async () => {
    const current = stateRef.current;
    if (!current.room) return;
    const [details, members] = await Promise.all([
      roomsApi.get(current.room.roomId),
      roomsApi.members(current.room.roomId),
    ]);
    update({
      room: details.room,
      membership: details.membership || current.membership,
      members,
    });
    if (voiceRef.current) voiceRef.current.updateMembers(members);
    return details;
  }, [update]);

  const refreshSpeakRequests = useCallback(async () => {
    const current = stateRef.current;
    if (!current.room || current.membership?.role !== 'host') return;
    const requests = await roomsApi.speakRequests(current.room.roomId);
    update({ speakRequests: requests });
  }, [update]);

  const refreshJoinRequests = useCallback(async () => {
    const current = stateRef.current;
    if (!current.room || current.membership?.role !== 'host') return;
    const requests = await roomsApi.joinRequests(current.room.roomId);
    update({ joinRequests: requests });
  }, [update]);

  const onlineSocket = useCallback(async (event, payload, restFallback) => {
    const activeSocket = socketRef.current;
    if (activeSocket?.connected) {
      try {
        return await emitAck(event, payload);
      } catch (socketError) {
        if (socketError.code !== 'NOT_CONNECTED' && socketError.code !== 'REALTIME_TIMEOUT') {
          throw socketError;
        }
      }
    }
    if (restFallback) return restFallback();
    const error = new Error('The live service is unavailable');
    error.code = 'NOT_CONNECTED';
    throw error;
  }, [emitAck]);

  const hostCommand = useCallback(
    async (action, extras = {}) => {
      const current = stateRef.current;
      if (!current.room) throw new Error('No active room');
      const command = { action, expectedSequence: current.playback?.sequence, ...extras };
      if (action === 'play' && command.startAtServerMs === undefined) command.startAtServerMs = serverNow() + 600;
      const payload = { roomId: current.room.roomId, ...command };
      let response;
      try {
        response = await onlineSocket('playback:command', payload, () =>
          roomsApi.playbackCommand(current.room.roomId, command).then((playback) => ({ playback })),
        );
      } catch (error) {
        if (error.code === 'STALE_PLAYBACK' || error.response?.data?.error?.code === 'STALE_PLAYBACK') {
          const snapshot = await roomsApi.playback(current.room.roomId);
          applyPlayback(snapshot);
        }
        throw error;
      }
      if (response?.playback) applyPlayback(response.playback);
      return response?.playback;
    },
    [applyPlayback, onlineSocket, serverNow],
  );

  const reportHostPosition = useCallback(
    async (positionMs) => {
      const current = stateRef.current;
      if (!current.room || current.membership?.role !== 'host') return;
      if (current.playback?.status !== 'playing') return;
      const activeSocket = socketRef.current;
      if (!activeSocket?.connected) return;
      try {
        const response = await emitAck(
          'playback:heartbeat',
          { roomId: current.room.roomId, positionMs: Math.max(0, Math.round(positionMs)), sequence: current.playback.sequence },
          8000,
        );
        if (response?.playback) applyPlayback(response.playback);
      } catch {
        // Directional heartbeats are best effort; REST control still works.
      }
    },
    [applyPlayback, emitAck],
  );

  const requestSync = useCallback(async () => {
    const current = stateRef.current;
    if (!current.room) return;
    try {
      const response = await onlineSocket('playback:sync', { roomId: current.room.roomId }, () =>
        roomsApi.playback(current.room.roomId).then((playback) => ({ playback })),
      );
      if (response?.playback) applyPlayback(response.playback);
    } catch {
      // A later reconnect will resync.
    }
  }, [applyPlayback, onlineSocket]);

  const sendMessage = useCallback(
    async ({ channel = 'room', body, targetUserId, clientMessageId = createMessageId() }) => {
      const current = stateRef.current;
      if (!current.room) throw new Error('No active room');
      const text = String(body || '').trim();
      if (!text) throw new Error('Message cannot be empty');
      const roomId = current.room.roomId;
      const key = channel === 'host' ? 'hostMessages' : 'messages';
      const payload = { roomId, channel, body: text, clientMessageId };
      if (targetUserId) payload.targetUserId = targetUserId;
      const optimistic = {
        id: `local:${clientMessageId}`, clientMessageId, body: text, channel,
        senderId: userRef.current.id, sender: userRef.current,
        recipientId: targetUserId || (channel === 'host' ? current.room.hostId : null),
        createdAt: new Date().toISOString(), delivery: 'sending', optimistic: true,
      };
      update((existing) => ({ ...existing,
        [key]: mergeMessages(existing[key].filter((message) => message.id !== optimistic.id), optimistic),
      }));
      try {
        const response = await onlineSocket('chat:send', payload, () =>
          chatApi.send(roomId, payload).then((message) => ({ message })),
        );
        if (!response?.message) throw new Error('Message delivery was not acknowledged');
        if (stateRef.current.room?.roomId === roomId) {
          update((existing) => ({ ...existing, [key]: uniqueMessages(existing[key], response.message) }));
        }
        return response.message;
      } catch (error) {
        if (stateRef.current.room?.roomId === roomId) {
          update((existing) => ({ ...existing,
            [key]: existing[key].map((message) => message.id === optimistic.id
              ? { ...message, delivery: 'failed', error: friendlyError(error) } : message),
          }));
        }
        throw error;
      }
    },
    [onlineSocket, update],
  );

  const loadMoreMessages = useCallback(
    async (channel = 'room') => {
      const current = stateRef.current;
      if (!current.room) return;
      const paging = current.messagePaging[channel];
      if (!paging?.hasMore || paging.loading) return;
      update((existing) => ({
        ...existing,
        messagePaging: {
          ...existing.messagePaging,
          [channel]: { ...existing.messagePaging[channel], loading: true },
        },
      }));
      try {
        const result = await chatApi.list(current.room.roomId, {
          channel,
          before: paging.nextBefore,
          beforeId: paging.nextBeforeId,
          limit: CHAT_PAGE_SIZE,
        });
        update((existing) => {
          const key = channel === 'host' ? 'hostMessages' : 'messages';
          return {
            ...existing,
            [key]: uniqueMessages(result.data || [], existing[key]),
            messagePaging: {
              ...existing.messagePaging,
              [channel]: {
                hasMore: Boolean(result.hasMore),
                nextBefore: result.nextBefore || null,
                nextBeforeId: result.nextBeforeId || null,
                loading: false,
              },
            },
          };
        });
      } catch (error) {
        update((existing) => ({
          ...existing,
          messagePaging: {
            ...existing.messagePaging,
            [channel]: { ...existing.messagePaging[channel], loading: false },
          },
        }));
        throw error;
      }
    },
    [update],
  );

  const deleteMessage = useCallback(
    async (message, channel = 'room') => {
      const current = stateRef.current;
      if (!current.room) return;
      await onlineSocket(
        'chat:delete',
        { roomId: current.room.roomId, messageId: message.id },
        () => chatApi.remove(current.room.roomId, message.id),
      );
      update((existing) => ({
        ...existing,
        messages: existing.messages.map((item) =>
          item.id === message.id ? { ...item, deleted: true, body: '' } : item,
        ),
        hostMessages: existing.hostMessages.map((item) =>
          item.id === message.id ? { ...item, deleted: true, body: '' } : item,
        ),
      }));
    },
    [onlineSocket, update],
  );

  const clearChat = useCallback(async () => {
    const current = stateRef.current;
    if (!current.room) return;
    await chatApi.clear(current.room.roomId);
    update({ messages: [] });
  }, [update]);

  const requestSpeak = useCallback(
    async (note = '') => {
      const current = stateRef.current;
      if (!current.room) throw new Error('No active room');
      const response = await onlineSocket(
        'speak:request',
        { roomId: current.room.roomId, note },
        () => roomsApi.requestSpeak(current.room.roomId, note),
      );
      return response;
    },
    [onlineSocket],
  );

  const decideSpeak = useCallback(
    async (requestId, decision) => {
      const current = stateRef.current;
      if (!current.room) return;
      await onlineSocket(
        'speak:decision',
        { roomId: current.room.roomId, requestId, decision },
        () => roomsApi.decideSpeak(current.room.roomId, requestId, decision),
      );
      update((existing) => ({
        ...existing,
        speakRequests: existing.speakRequests.filter((item) => item.id !== requestId),
      }));
    },
    [onlineSocket, update],
  );

  const setMemberPermissions = useCallback(
    async (memberId, permissions) => {
      const current = stateRef.current;
      if (!current.room) return;
      const updated = await roomsApi.setMemberPermissions(
        current.room.roomId,
        memberId,
        permissions,
      );
      update((existing) => ({ ...existing, members: mergeMembers(existing.members, updated) }));
      return updated;
    },
    [update],
  );

  const setMemberMic = useCallback(
    async (userId, granted) => {
      const current = stateRef.current;
      if (!current.room) return;
      const response = await onlineSocket(
        'mic:set',
        { roomId: current.room.roomId, userId, granted },
        () => roomsApi.grantMic(current.room.roomId, userId, granted),
      );
      if (response?.member) {
        update((existing) => ({ ...existing, members: mergeMembers(existing.members, response.member) }));
      }
      await refreshRoom().catch(() => {});
      return response;
    },
    [onlineSocket, refreshRoom, update],
  );

  const muteAll = useCallback(async () => {
    const current = stateRef.current;
    if (!current.room) return;
    const response = await onlineSocket(
      'mic:mute-all',
      { roomId: current.room.roomId },
      () => roomsApi.muteAll(current.room.roomId),
    );
    update((existing) => ({
      ...existing,
      members: existing.members.map((member) =>
        member.role === 'participant'
          ? {
              ...member,
              permissions: {
                ...member.permissions,
                canSpeak: false,
                micApproved: false,
                micRequested: false,
                mutedByHost: true,
              },
            }
          : member,
      ),
      speakRequests: [],
    }));
    return response;
  }, [onlineSocket, update]);

  const removeMember = useCallback(
    async (memberId, ban = false) => {
      const current = stateRef.current;
      if (!current.room) return;
      await roomsApi.removeMember(current.room.roomId, memberId, ban);
      update((existing) => ({
        ...existing,
        members: existing.members.filter((member) => member.id !== memberId),
      }));
    },
    [update],
  );

  const decideJoin = useCallback(
    async (memberId, decision, ban = false) => {
      const current = stateRef.current;
      if (!current.room) return;
      await roomsApi.decideJoinRequest(current.room.roomId, memberId, decision, ban);
      update((existing) => ({
        ...existing,
        joinRequests: existing.joinRequests.filter((item) => item.id !== memberId),
      }));
    },
    [update],
  );

  const updateSettings = useCallback(
    async (settings) => {
      const current = stateRef.current;
      if (!current.room) return;
      const room = await roomsApi.updateSettings(current.room.roomId, settings);
      update({ room: { ...current.room, ...room } });
      return room;
    },
    [update],
  );

  const endRoom = useCallback(async () => {
    const current = stateRef.current;
    if (!current.room) return;
    const room = await roomsApi.end(current.room.roomId);
    joinedRef.current = false;
    await stopVoice();
    update({
      room: { ...current.room, ...room },
      playback: current.playback ? { ...current.playback, status: 'ended' } : current.playback,
      joined: false,
    });
  }, [stopVoice, update]);

  const addUrlMedia = useCallback(
    async (payload) => {
      const current = stateRef.current;
      if (!current.room) throw new Error('No active room');
      const media = await mediaApi.addUrl(current.room.roomId, payload);
      update((existing) => ({
        ...existing,
        media: [media, ...existing.media.filter((item) => item.id !== media.id)],
      }));
      return media;
    },
    [update],
  );

  const uploadMedia = useCallback(
    async (file, fields = {}) => {
      const current = stateRef.current;
      if (!current.room) throw new Error('No active room');
      const media = await mediaApi.upload(current.room.roomId, file, fields);
      update((existing) => ({
        ...existing,
        media: [media, ...existing.media.filter((item) => item.id !== media.id)],
      }));
      return media;
    },
    [update],
  );

  const removeMedia = useCallback(
    async (mediaId) => {
      const current = stateRef.current;
      if (!current.room) return;
      await mediaApi.remove(current.room.roomId, mediaId);
      update((existing) => ({
        ...existing,
        media: existing.media.filter((item) => item.id !== mediaId),
      }));
    },
    [update],
  );

  const selectMedia = useCallback(
    async (mediaId) => {
      const playback = await hostCommand('setMedia', { mediaId });
      return playback;
    },
    [hostCommand],
  );

  const enableMic = useCallback(async () => {
    const current = stateRef.current;
    if (!current.membership?.permissions?.canSpeak || current.membership?.permissions?.mutedByHost) {
      throw new Error('The host has not granted microphone access');
    }
    if (!voiceRef.current) {
      if (!current.room) throw new Error('No active room');
      createVoiceEngine(current.room, current.members);
    }
    if (!voiceRef.current) throw new Error('Voice engine is unavailable');
    await voiceRef.current.enableMic();
    update({ micEnabled: Boolean(voiceRef.current?.snapshot().publishing) });
  }, [createVoiceEngine, update]);

  const disableMic = useCallback(async () => {
    if (voiceRef.current) await voiceRef.current.disableMic();
    update({ micEnabled: false });
  }, [update]);

  const toggleMic = useCallback(async () => {
    if (stateRef.current.micEnabled) return disableMic();
    return enableMic();
  }, [disableMic, enableMic]);

  useEffect(() => {
    if (!socket) return undefined;
    let active = true;
    let reconnectTimer = null;
    let reconnectAttempts = 0;

    const inRoom = (payload) =>
      payload?.roomId &&
      stateRef.current.room &&
      String(payload.roomId).toUpperCase() === String(stateRef.current.room.roomId).toUpperCase();

    const onPlayback = (payload) => {
      if (inRoom(payload)) applyPlayback(payload.playback);
    };

    const onMemberJoined = (payload) => {
      if (!inRoom(payload) || !payload.member) return;
      update((current) => ({
        ...current,
        members: mergeMembers(current.members, payload.member),
      }));
      if (voiceRef.current) {
        voiceRef.current.updateMembers(
          mergeMembers(stateRef.current.members, payload.member),
        );
      }
    };

    const onMemberUpdated = (payload) => {
      if (!inRoom(payload) || !payload.member) return;
      const isSelf = String(payload.member.userId) === String(userRef.current?.id);
      update((current) => ({
        ...current,
        members: mergeMembers(current.members, payload.member),
        membership:
          isSelf && current.membership
            ? {
                ...current.membership,
                permissions: payload.member.permissions,
                role: payload.member.role || current.membership.role,
              }
            : current.membership,
      }));
      if (voiceRef.current) {
        voiceRef.current.updateMembers(
          mergeMembers(stateRef.current.members, payload.member),
        );
        if (
          isSelf &&
          (!payload.member.permissions?.canSpeak || payload.member.permissions?.mutedByHost) &&
          voiceRef.current.snapshot().publishing
        ) {
          voiceRef.current.disableMic();
          update({ micEnabled: false });
        }
      }
    };

    const onMemberLeft = (payload) => {
      if (!inRoom(payload)) return;
      update((current) => {
        const members = current.members.filter(
          (member) =>
            String(member.userId) !== String(payload.userId) &&
            String(member.id) !== String(payload.memberId),
        );
        if (voiceRef.current) voiceRef.current.updateMembers(members);
        return {
          ...current,
          members,
          onlineUserIds: current.onlineUserIds.filter(
            (id) => String(id) !== String(payload.userId),
          ),
          ...(payload.reason && payload.reason !== 'left'
            ? { notice: { id: Date.now(), message: 'A participant was removed.', tone: 'default' } }
            : {}),
        };
      });
    };

    const onPermissionUpdated = (payload) => {
      if (!inRoom(payload)) return;
      const isSelf = String(payload.userId || userRef.current?.id) === String(userRef.current?.id);
      if (!isSelf) return;
      update((current) => ({
        ...current,
        membership: current.membership
          ? {
              ...current.membership,
              permissions: payload.permissions,
              role: payload.role || current.membership.role,
            }
          : current.membership,
      }));
      if (voiceRef.current) {
        voiceRef.current.updateMembers(stateRef.current.members.map((member) =>
          String(member.userId) === String(userRef.current?.id) ? { ...member, permissions: payload.permissions } : member));
        if (!payload.permissions?.canSpeak || payload.permissions?.mutedByHost) {
          voiceRef.current.disableMic().catch(() => {});
          update({ micEnabled: false });
        }
      }
    };

    const onPresence = (payload) => {
      if (!inRoom(payload)) return;
      update((current) => {
        const set = new Set(current.onlineUserIds.map(String));
        if (payload.online) set.add(String(payload.userId));
        else set.delete(String(payload.userId));
        return { ...current, onlineUserIds: [...set] };
      });
    };

    const onChatMessage = (payload) => {
      if (!inRoom(payload) || !payload.message) return;
      const message = payload.message;
      if (message.channel === 'host') {
        const selfId = String(userRef.current?.id);
        const isHost = stateRef.current.membership?.role === 'host';
        const related =
          isHost || String(message.senderId) === selfId || String(message.recipientId) === selfId;
        if (!related) return;
        update((current) => ({
          ...current,
          hostMessages: uniqueMessages(current.hostMessages, message),
        }));
      } else {
        update((current) => ({ ...current, messages: uniqueMessages(current.messages, message) }));
      }
    };

    const onChatDeleted = (payload) => {
      if (!inRoom(payload)) return;
      update((current) => ({
        ...current,
        messages: current.messages.map((message) =>
          message.id === payload.messageId ? { ...message, deleted: true, body: '' } : message,
        ),
        hostMessages: current.hostMessages.map((message) =>
          message.id === payload.messageId ? { ...message, deleted: true, body: '' } : message,
        ),
      }));
    };

    const onChatCleared = (payload) => {
      if (inRoom(payload)) update({ messages: [] });
    };

    const onSpeakRequest = (payload) => {
      if (!inRoom(payload) || !payload.request) return;
      update((current) => ({
        ...current,
        speakRequests: [
          ...current.speakRequests.filter((item) => item.id !== payload.request.id),
          payload.request,
        ],
        notice: { id: Date.now(), message: 'New microphone request', tone: 'default' },
      }));
    };

    const onSpeakResolved = (payload) => {
      if (!inRoom(payload)) return;
      update((current) => ({
        ...current,
        speakRequests: current.speakRequests.filter(
          (item) => item.id !== payload.requestId,
        ),
      }));
    };

    const onSpeakDecision = (payload) => {
      if (!inRoom(payload)) return;
      if (
        String(payload.notification?.userId || '') === String(userRef.current?.id) ||
        payload.decision
      ) {
        update({
          notice: {
            id: Date.now(),
            message:
              payload.decision === 'approve'
                ? 'The host approved your microphone. Tap the mic to speak.'
                : 'The host declined your microphone request.',
            tone: payload.decision === 'approve' ? 'success' : 'default',
          },
        });
      }
    };

    const onMuteAll = (payload) => {
      if (!inRoom(payload)) return;
      if (voiceRef.current?.snapshot().publishing) voiceRef.current.disableMic();
      update((current) => ({
        ...current,
        micEnabled: false,
        members: current.members.map((member) =>
          member.role === 'host'
            ? member
            : {
                ...member,
                permissions: {
                  ...member.permissions,
                  canSpeak: false,
                  micApproved: false,
                  micRequested: false,
                  mutedByHost: true,
                },
              },
        ),
        membership:
          current.membership?.role === 'host'
            ? current.membership
            : {
                ...current.membership,
                permissions: {
                  ...current.membership?.permissions,
                  canSpeak: false,
                  micApproved: false,
                  micRequested: false,
                  mutedByHost: true,
                },
              },
        notice: { id: Date.now(), message: 'The host muted all microphones.', tone: 'default' },
      }));
    };

    const onMicRevoked = (payload) => {
      if (!inRoom(payload)) return;
      if (voiceRef.current?.snapshot().publishing) voiceRef.current.disableMic();
      update({
        micEnabled: false,
        notice: { id: Date.now(), message: 'Your microphone was revoked by the host.', tone: 'default' },
      });
    };

    const onJoinRequest = (payload) => {
      if (!inRoom(payload) || !payload.member) return;
      update((current) => ({
        ...current,
        joinRequests: [
          ...current.joinRequests.filter((item) => item.id !== payload.member.id),
          payload.member,
        ],
        notice: { id: Date.now(), message: `${payload.member.user?.name || 'Someone'} wants to join.`, tone: 'default' },
      }));
    };

    const onJoinResolved = (payload) => {
      if (!inRoom(payload)) return;
      update((current) => ({
        ...current,
        joinRequests: current.joinRequests.filter((item) => item.id !== payload.memberId),
      }));
    };

    const onRoomSettings = (payload) => {
      if (!inRoom(payload) || !payload.room) return;
      update({ room: payload.room });
    };

    const onEnded = (payload) => {
      if (!inRoom(payload)) return;
      joinedRef.current = false;
      if (voiceRef.current) voiceRef.current.stop().catch(() => {});
      update((current) => ({
        ...current,
        joined: false,
        playback: current.playback ? { ...current.playback, status: 'ended' } : current.playback,
        room: current.room ? { ...current.room, status: 'ended' } : current.room,
        notice: { id: Date.now(), message: 'The host ended this session.', tone: 'default' },
      }));
    };

    const onAccessRevoked = (payload) => {
      if (!inRoom(payload)) return;
      joinedRef.current = false;
      if (voiceRef.current) voiceRef.current.stop().catch(() => {});
      update((current) => ({ ...current, evicted: { reason: payload.reason || 'removed' }, joined: false,
        playback: current.playback ? { ...current.playback, status: 'paused' } : null,
        membership: current.membership ? { ...current.membership, status: 'left', permissions: { canSpeak: false, canChat: false } } : null,
      }));
    };

    const onMediaAdded = (payload) => {
      if (!inRoom(payload) || !payload.media) return;
      update((current) => ({
        ...current,
        media: [payload.media, ...current.media.filter((item) => item.id !== payload.media.id)],
      }));
    };

    const onMediaRemoved = (payload) => {
      if (!inRoom(payload)) return;
      update((current) => ({
        ...current,
        media: current.media.filter((item) => item.id !== payload.mediaId),
      }));
    };

    const onSignal = (payload) => {
      if (!inRoom(payload)) return;
      if (stateRef.current.activating || !voiceRef.current) {
        pendingSignals.current.push(payload);
        if (pendingSignals.current.length > 64) pendingSignals.current.shift();
      } else voiceRef.current.receiveSignal(payload);
    };

    const recoverMessages = async (roomId, channel) => {
      const key = channel === 'host' ? 'hostMessages' : 'messages';
      const previous = stateRef.current[key].filter((message) => !message.optimistic);
      const oldest = previous[0]?.createdAt;
      let page;
      let before;
      let beforeId;
      let recovered = [];
      for (let index = 0; index < 25; index += 1) {
        page = await chatApi.list(roomId, { channel, before, beforeId, limit: CHAT_PAGE_SIZE });
        if (!active || stateRef.current.room?.roomId !== roomId) return;
        recovered = uniqueMessages(recovered, page.data || []);
        if (!page.hasMore || !oldest || recovered.some((message) => new Date(message.createdAt) <= new Date(oldest))) break;
        before = page.nextBefore;
        beforeId = page.nextBeforeId;
      }
      update((existing) => ({ ...existing,
        [key]: uniqueMessages(existing[key].filter((message) => message.optimistic), recovered),
        messagePaging: { ...existing.messagePaging,
          [channel]: { ...existing.messagePaging[channel], hasMore: Boolean(page.hasMore),
            nextBefore: page.nextBefore || null, nextBeforeId: page.nextBeforeId || null },
        },
      }));
    };

    const onReconnect = async () => {
      const current = stateRef.current;
      if (!active || !socket.connected || !current.room || !joinedRef.current || rejoinInFlight.current) return;
      const roomId = current.room.roomId;
      rejoinInFlight.current = true;
      try {
        const response = await emitAck('room:join', { roomId });
        if (!active || stateRef.current.room?.roomId !== roomId) return;
        reconnectAttempts = 0;
        roomNeedsRecovery.current = false;
        update((existing) => ({
          ...existing,
          playback: mergePlayback(existing.playback, response.playback),
          members: response.members?.length ? response.members : existing.members,
          membership: response.membership || existing.membership,
          onlineUserIds: normalizeOnlineUsers(response.onlineUsers || existing.onlineUserIds),
        }));
        if (voiceRef.current) await voiceRef.current.recover(response.members || []);
        const recovery = await Promise.allSettled([
          recoverMessages(roomId, 'room'),
          current.membership.permissions?.canChat ? recoverMessages(roomId, 'host') : Promise.resolve(),
          mediaApi.list(roomId),
        ]);
        if (!active || stateRef.current.room?.roomId !== roomId) return;
        if (recovery[2].status === 'fulfilled') update({ media: recovery[2].value });
        if (recovery.some((result) => result.status === 'rejected')) {
          update({ notice: { id: Date.now(), message: 'Live updates restored. Some history could not be refreshed; retry reconnect.', tone: 'default' } });
        }
      } catch (error) {
        if (!active || stateRef.current.room?.roomId !== roomId) return;
        if (['NOT_A_MEMBER', 'ROOM_ENDED', 'ROOM_NOT_FOUND', 'ROOM_BANNED'].includes(error.code)) {
          joinedRef.current = false;
          await stopVoice();
          update((existing) => ({ ...existing, evicted: { reason: error.code }, joined: false,
            playback: existing.playback ? { ...existing.playback, status: 'paused' } : null,
          }));
        } else {
          reconnectAttempts += 1;
          update({ notice: { id: Date.now(), message: 'Restoring the room connection. You can retry from the connection banner.', tone: 'default' } });
          const delay = Math.min(15000, 800 * (2 ** Math.min(reconnectAttempts, 5))) * (0.75 + Math.random() * 0.5);
          reconnectTimer = setTimeout(onReconnect, delay);
        }
      } finally {
        rejoinInFlight.current = false;
      }
    };

    socket.on('playback:state', onPlayback);
    socket.on('room:member-joined', onMemberJoined);
    socket.on('member:updated', onMemberUpdated);
    socket.on('permission:updated', onPermissionUpdated);
    socket.on('room:member-left', onMemberLeft);
    socket.on('presence:update', onPresence);
    socket.on('chat:message', onChatMessage);
    socket.on('chat:deleted', onChatDeleted);
    socket.on('chat:cleared', onChatCleared);
    socket.on('speak:request', onSpeakRequest);
    socket.on('speak:request:resolved', onSpeakResolved);
    socket.on('speak:decision', onSpeakDecision);
    socket.on('speak:mute-all', onMuteAll);
    socket.on('mic:revoked', onMicRevoked);
    socket.on('join:request', onJoinRequest);
    socket.on('join:request:resolved', onJoinResolved);
    socket.on('room:settings', onRoomSettings);
    socket.on('room:ended', onEnded);
    socket.on('room:removed', onAccessRevoked);
    socket.on('room:access-revoked', onAccessRevoked);
    socket.on('media:added', onMediaAdded);
    socket.on('media:removed', onMediaRemoved);
    socket.on('webrtc:signal', onSignal);
    socket.on('connect', onReconnect);
    const onDisconnect = () => { roomNeedsRecovery.current = true; };
    socket.on('disconnect', onDisconnect);
    const recoveryInterval = setInterval(() => {
      if (roomNeedsRecovery.current && socket.connected) onReconnect();
    }, 6000);

    if (socket.connected && joinedRef.current) onReconnect();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(recoveryInterval);
      socket.off('playback:state', onPlayback);
      socket.off('room:member-joined', onMemberJoined);
      socket.off('member:updated', onMemberUpdated);
      socket.off('permission:updated', onPermissionUpdated);
      socket.off('room:member-left', onMemberLeft);
      socket.off('presence:update', onPresence);
      socket.off('chat:message', onChatMessage);
      socket.off('chat:deleted', onChatDeleted);
      socket.off('chat:cleared', onChatCleared);
      socket.off('speak:request', onSpeakRequest);
      socket.off('speak:request:resolved', onSpeakResolved);
      socket.off('speak:decision', onSpeakDecision);
      socket.off('speak:mute-all', onMuteAll);
      socket.off('mic:revoked', onMicRevoked);
      socket.off('join:request', onJoinRequest);
      socket.off('join:request:resolved', onJoinResolved);
      socket.off('room:settings', onRoomSettings);
      socket.off('room:ended', onEnded);
      socket.off('room:removed', onAccessRevoked);
      socket.off('room:access-revoked', onAccessRevoked);
      socket.off('media:added', onMediaAdded);
      socket.off('media:removed', onMediaRemoved);
      socket.off('webrtc:signal', onSignal);
      socket.off('connect', onReconnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [applyPlayback, emitAck, socket, stopVoice, update]);

  useEffect(
    () => () => {
      if (voiceRef.current) voiceRef.current.stop().catch(() => {});
    },
    [],
  );

  const value = useMemo(() => {
    const isHost = state.membership?.role === 'host';
    const canSpeak = Boolean(
      state.membership?.permissions?.canSpeak && !state.membership?.permissions?.mutedByHost,
    );
    const isOnline = state.onlineUserIds.map(String).includes(String(user?.id));
    return {
      ...state,
      isHost,
      canSpeak,
      isOnline,
      connected,
      serverNow,
      me: user,
      enterRoom,
      enterCreatedRoom,
      leaveRoom,
      clearRoom,
      refreshRoom,
      refreshSpeakRequests,
      refreshJoinRequests,
      hostCommand,
      reportHostPosition,
      requestSync,
      sendMessage,
      loadMoreMessages,
      deleteMessage,
      clearChat,
      requestSpeak,
      decideSpeak,
      setMemberPermissions,
      setMemberMic,
      muteAll,
      removeMember,
      decideJoin,
      updateSettings,
      endRoom,
      addUrlMedia,
      uploadMedia,
      removeMedia,
      selectMedia,
      enableMic,
      disableMic,
      toggleMic,
      audioOutputs: () => voiceRef.current?.audioOutputs() || Promise.resolve([]),
      selectAudioOutput: (output) => voiceRef.current?.selectAudioOutput(output),
      showAudioRoutePicker: () => voiceRef.current?.showAudioRoutePicker(),
      clearNotice: () => update({ notice: null }),
      clearVoiceError: () => update({ voiceError: null }),
    };
  }, [
    state,
    connected,
    serverNow,
    user,
    enterRoom,
    enterCreatedRoom,
    leaveRoom,
    clearRoom,
    refreshRoom,
    refreshSpeakRequests,
    refreshJoinRequests,
    hostCommand,
    reportHostPosition,
    requestSync,
    sendMessage,
    loadMoreMessages,
    deleteMessage,
    clearChat,
    requestSpeak,
    decideSpeak,
    setMemberPermissions,
    setMemberMic,
    muteAll,
    removeMember,
    decideJoin,
    updateSettings,
    endRoom,
    addUrlMedia,
    uploadMedia,
    removeMedia,
    selectMedia,
    enableMic,
    disableMic,
    toggleMic,
    update,
  ]);

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoom() {
  const value = useContext(RoomContext);
  if (!value) throw new Error('useRoom must be used inside RoomProvider');
  return value;
}
