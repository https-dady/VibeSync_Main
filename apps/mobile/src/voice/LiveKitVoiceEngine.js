import { AudioSession } from '@livekit/react-native';
import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client';
import { rtcApi } from '../api/endpoints';

/** Native audio playout is attached by the LiveKit React Native SDK. */
export class LiveKitVoiceEngine {
  constructor({ roomId, userId, onRemoteStream, onLocalStream, onState, onError }) {
    Object.assign(this, { roomId, userId, onRemoteStream, onLocalStream, onState, onError });
    this.room = null;
    this.active = false;
    this.canPublish = false;
    this.localStream = null;
    this.members = [];
    this.remoteStreams = new Map();
    this.listeners = [];
    this.generation = 0;
    this.micPromise = null;
    this.refreshPromise = null;
    this.recoveryTimer = null;
    this.recoveryAttempts = 0;
  }

  async start(members = []) {
    this.members = members;
    this.active = true;
    const generation = ++this.generation;
    const credentials = await rtcApi.livekitToken(this.roomId);
    if (!this.active || generation !== this.generation) return;
    this.canPublish = credentials.canPublish;
    const room = new Room({ adaptiveStream: false, dynacast: false, disconnectOnPageLeave: false });
    this.room = room;
    const listen = (event, handler) => {
      room.on(event, handler);
      this.listeners.push([event, handler]);
    };
    listen(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (track.kind !== Track.Kind.Audio) return;
      const stream = track.mediaStream;
      if (stream) {
        this.remoteStreams.set(participant.identity, stream);
        this.onRemoteStream?.(participant.identity, stream);
      }
      this._emitState();
    });
    listen(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      if (track.kind !== Track.Kind.Audio) return;
      this.remoteStreams.delete(participant.identity);
      this.onRemoteStream?.(participant.identity, null);
      this._emitState();
    });
    listen(RoomEvent.ParticipantDisconnected, (participant) => {
      this.remoteStreams.delete(participant.identity);
      this.onRemoteStream?.(participant.identity, null);
      this._emitState();
    });
    listen(RoomEvent.ConnectionStateChanged, () => this._emitState());
    listen(RoomEvent.MediaDevicesError, (error) => this.onError?.(error));
    listen(RoomEvent.Disconnected, () => {
      this.localStream = null;
      this.onLocalStream?.(null);
      for (const identity of this.remoteStreams.keys()) this.onRemoteStream?.(identity, null);
      this.remoteStreams.clear();
      this._emitState();
      this._scheduleRecovery();
    });
    try {
      await AudioSession.startAudioSession();
      await room.connect(credentials.url, credentials.token, { autoSubscribe: true });
      if (!this.active || generation !== this.generation) {
        await room.disconnect();
        return;
      }
      this._emitState();
      this.recoveryAttempts = 0;
    } catch (error) {
      await this.stop();
      this.onError?.(error);
      throw error;
    }
  }

  updateMembers(members = []) {
    this.members = members;
    const mine = members.find((member) => String(member.userId) === String(this.userId));
    if (mine && (!mine.permissions?.canSpeak || mine.permissions?.mutedByHost || mine.status !== 'active')) {
      this.canPublish = false;
      this.disableMic().catch((error) => this.onError?.(error));
    }
  }

  async enableMic() {
    if (this.micPromise) return this.micPromise;
    this.micPromise = (async () => {
      if (!this.active) throw new Error('Voice room is disconnected');
      const mine = this.members.find((member) => String(member.userId) === String(this.userId));
      if (!mine?.permissions?.canSpeak || mine.permissions?.mutedByHost) throw new Error('The host has not granted microphone access');
      // Reconnect with a fresh backend grant when a listener was promoted.
      if (!this.canPublish) await this.recover(this.members, true);
      if (!this.room || !this.canPublish) throw new Error('Microphone permission was not granted by the voice service');
      const publication = await this.room.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      });
      const latest = this.members.find((member) => String(member.userId) === String(this.userId));
      if (!this.active || !latest?.permissions?.canSpeak || latest.permissions?.mutedByHost) {
        await this.room?.localParticipant.setMicrophoneEnabled(false);
        return;
      }
      this.localStream = publication?.track?.mediaStream || null;
      this.onLocalStream?.(this.localStream);
      this._emitState();
    })().finally(() => { this.micPromise = null; });
    return this.micPromise;
  }

  async disableMic() {
    await this.room?.localParticipant.setMicrophoneEnabled(false);
    this.localStream = null;
    this.onLocalStream?.(null);
    this._emitState();
  }

  async recover(members = [], force = false) {
    this.updateMembers(members);
    if (!this.active || (!force && this.room?.state !== ConnectionState.Disconnected)) return;
    if (this.refreshPromise) return this.refreshPromise;
    const wasPublishing = Boolean(this.localStream);
    this.refreshPromise = (async () => {
      await this.stop();
      await this.start(members);
      if (wasPublishing && this.canPublish) await this.room.localParticipant.setMicrophoneEnabled(true);
    })().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  receiveSignal() { /* SFU negotiation is handled by the official SDK. */ }

  snapshot() {
    const connected = this.room?.state === ConnectionState.Connected;
    return {
      active: this.active, canPublish: this.canPublish,
      publishing: Boolean(this.room?.localParticipant.isMicrophoneEnabled), localStream: this.localStream,
      transport: 'livekit', peerCount: this.room?.remoteParticipants.size || 0,
      connectedPeers: connected ? this.room?.remoteParticipants.size || 0 : 0,
      remoteSpeakerIds: [...this.remoteStreams.keys()],
      status: !this.active ? 'idle' : connected ? 'connected'
        : this.room?.state === ConnectionState.Reconnecting ? 'reconnecting' : 'connecting',
    };
  }

  _emitState() { this.onState?.(this.snapshot()); }

  _scheduleRecovery() {
    if (!this.active || this.recoveryTimer || this.recoveryAttempts >= 3) return;
    this.recoveryAttempts += 1;
    this.recoveryTimer = setTimeout(async () => {
      this.recoveryTimer = null;
      try { await this.recover(this.members, true); }
      catch (error) {
        this.onError?.(error);
        if (this.active) this._scheduleRecovery();
      }
    }, 1000 * (2 ** this.recoveryAttempts) * (0.75 + Math.random() * 0.5));
  }

  async stop() {
    this.active = false;
    this.generation += 1;
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    const room = this.room;
    this.room = null;
    for (const [event, handler] of this.listeners) room?.off(event, handler);
    this.listeners = [];
    await room?.disconnect();
    this.localStream = null;
    this.canPublish = false;
    this.onLocalStream?.(null);
    for (const identity of this.remoteStreams.keys()) this.onRemoteStream?.(identity, null);
    this.remoteStreams.clear();
    await AudioSession.stopAudioSession();
    this._emitState();
  }
}
