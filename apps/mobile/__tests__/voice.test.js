jest.mock('@livekit/react-native', () => ({ AudioSession: {
  startAudioSession: jest.fn().mockResolvedValue(), stopAudioSession: jest.fn().mockResolvedValue(),
  getAudioOutputs: jest.fn().mockResolvedValue(['speaker', 'bluetooth']), selectAudioOutput: jest.fn().mockResolvedValue(),
} }));
jest.mock('../src/api/endpoints', () => ({ rtcApi: { config: jest.fn(), livekitToken: jest.fn() } }));
jest.mock('livekit-client', () => {
  const { EventEmitter } = require('events');
  class Room extends EventEmitter {
    static instances = [];
    constructor(options) {
      super();
      this.options = options;
      this.state = 'disconnected';
      this.remoteParticipants = new Map();
      this.localParticipant = {
        isMicrophoneEnabled: false,
        setMicrophoneEnabled: jest.fn(async (enabled) => {
          this.localParticipant.isMicrophoneEnabled = enabled;
          return { track: { mediaStream: { id: 'microphone' } } };
        }),
      };
      this.connect = jest.fn(async () => { this.state = 'connected'; this.emit('state'); });
      this.disconnect = jest.fn(async () => { this.state = 'disconnected'; });
      Room.instances.push(this);
    }
  }
  return { Room, ConnectionState: { Connected: 'connected', Disconnected: 'disconnected', Reconnecting: 'reconnecting' },
    Track: { Kind: { Audio: 'audio' } }, RoomEvent: { TrackSubscribed: 'sub', TrackUnsubscribed: 'unsub', ParticipantDisconnected: 'left', ConnectionStateChanged: 'state', MediaDevicesError: 'error', Disconnected: 'disconnected' } };
});
jest.mock('@livekit/react-native-webrtc', () => {
  class Peer {
    static instances = [];
    constructor() {
      this.connectionState = 'new'; this.signalingState = 'stable';
      this.close = jest.fn(); this.getSenders = jest.fn(() => []);
      this.addTrack = jest.fn(); this.addIceCandidate = jest.fn().mockResolvedValue();
      this.createOffer = jest.fn().mockResolvedValue({ type: 'offer', sdp: 'audio' });
      this.setLocalDescription = jest.fn(async (description) => { this.localDescription = description; });
      Peer.instances.push(this);
    }
  }
  return { RTCPeerConnection: Peer, mediaDevices: { getUserMedia: jest.fn() }, RTCIceCandidate: class { constructor(candidate) { Object.assign(this, candidate); } }, RTCSessionDescription: class {}, MediaStream: class {} };
});

import { VoiceEngine } from '../src/voice/VoiceEngine';
import { LiveKitVoiceEngine } from '../src/voice/LiveKitVoiceEngine';
import { rtcApi } from '../src/api/endpoints';
import { AudioSession } from '@livekit/react-native';
import { Room } from 'livekit-client';
import { mediaDevices, RTCPeerConnection } from '@livekit/react-native-webrtc';

const members = (canSpeak = true) => [
  { userId: 'z-host', status: 'active', permissions: { canSpeak } },
  { userId: 'a-guest', status: 'active', permissions: { canSpeak: true } },
];
const options = () => ({ roomId: 'ABC2345', userId: 'z-host', emitAck: jest.fn().mockResolvedValue({ ok: true }), onState: jest.fn(), onRemoteStream: jest.fn(), onError: jest.fn() });

describe('LiveKit SDK lifecycle contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Room.instances.length = 0;
    rtcApi.livekitToken.mockResolvedValue({ token: 'authorized-test-token', url: 'wss://voice.example', canPublish: true });
  });
  test('connects with backend-issued credentials and subscribes', async () => {
    const callbacks = options();
    const engine = new LiveKitVoiceEngine(callbacks);
    await engine.start(members());
    const room = Room.instances[0];
    expect(room.connect).toHaveBeenCalledWith('wss://voice.example', 'authorized-test-token', { autoSubscribe: true });
    room.emit('sub', { kind: 'audio', mediaStream: { id: 'remote-audio' } }, {}, { identity: 'a-guest' });
    expect(callbacks.onRemoteStream).toHaveBeenCalledWith('a-guest', { id: 'remote-audio' });
    expect(engine.snapshot().transport).toBe('livekit');
    await engine.stop();
  });
  test('publishes microphone and responds to mute', async () => {
    const engine = new LiveKitVoiceEngine(options());
    await engine.start(members());
    await engine.enableMic();
    expect(engine.snapshot().publishing).toBe(true);
    await engine.disableMic();
    expect(engine.snapshot().publishing).toBe(false);
    await engine.stop();
  });
  test('listener cannot publish without host grant', async () => {
    const engine = new LiveKitVoiceEngine(options());
    rtcApi.livekitToken.mockResolvedValue({ token: 'listener-token', url: 'wss://voice.example', canPublish: false });
    await engine.start(members(false));
    await expect(engine.enableMic()).rejects.toThrow('not granted');
    expect(Room.instances[0].localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true, expect.anything());
    await engine.stop();
  });
  test('moderation disables an active mic', async () => {
    const engine = new LiveKitVoiceEngine(options());
    await engine.start(members());
    await engine.enableMic();
    engine.updateMembers(members(false));
    await Promise.resolve();
    expect(Room.instances[0].localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    await engine.stop();
  });
  test('disconnect removes SDK event listeners and audio session', async () => {
    const engine = new LiveKitVoiceEngine(options());
    await engine.start(members());
    const room = Room.instances[0];
    await engine.stop();
    expect(room.eventNames()).toEqual([]);
    expect(room.disconnect).toHaveBeenCalledTimes(1);
    expect(AudioSession.stopAudioSession).toHaveBeenCalled();
  });
});

describe('mesh lifecycle regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    RTCPeerConnection.instances.length = 0;
    rtcApi.config.mockResolvedValue({ voiceTransport: 'mesh', meshMaxParticipants: 6, iceServers: [{ urls: 'turn:relay.example' }] });
    const track = { id: 'mic', kind: 'audio', stop: jest.fn() };
    mediaDevices.getUserMedia.mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track], release: jest.fn() });
  });
  test('uses actual selected SFU transport when configured', async () => {
    rtcApi.config.mockResolvedValue({ voiceTransport: 'livekit', sfuTokenEndpointConfigured: true });
    const engine = new VoiceEngine(options());
    await engine.start(members());
    expect(engine.snapshot().transport).toBe('livekit');
    await engine.stop();
  });
  test('offers to a permitted but currently silent lower-ID member', async () => {
    const callbacks = options();
    const engine = new VoiceEngine(callbacks);
    await engine.start(members());
    await engine.enableMic();
    expect(callbacks.emitAck).toHaveBeenCalledWith('webrtc:signal', expect.objectContaining({ targetUserId: 'a-guest', data: expect.objectContaining({ type: 'offer' }) }));
    await engine.stop();
  });
  test('simultaneous microphone enable does not create multiple streams', async () => {
    const engine = new VoiceEngine(options());
    await engine.start(members());
    await Promise.all([engine.enableMic(), engine.enableMic()]);
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    await engine.stop();
  });
  test('does not enable mesh publishing above documented capacity', async () => {
    const engine = new VoiceEngine(options());
    await engine.start(Array.from({ length: 7 }, (_, index) => ({ userId: String(index), status: 'active', permissions: {} })));
    await expect(engine.enableMic()).rejects.toThrow('up to 6');
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
    await engine.stop();
  });
  test('departure closes and releases peer handlers', async () => {
    const engine = new VoiceEngine(options());
    await engine.start(members());
    await engine.enableMic();
    const peer = RTCPeerConnection.instances[0];
    engine.updateMembers([members()[0]]);
    expect(peer.close).toHaveBeenCalledTimes(1);
    expect(peer.ontrack).toBeNull();
    expect(engine.peers.size).toBe(0);
    await engine.stop();
  });
  test('unnegotiated candidate queue is bounded', async () => {
    const engine = new VoiceEngine(options());
    await engine.start(members());
    for (let index = 0; index < 100; index += 1) await engine.receiveSignal({ fromUserId: 'a-guest', data: { type: 'ice-candidate', candidate: { candidate: String(index) } } });
    expect(engine.pendingCandidates.get('a-guest')).toHaveLength(64);
    await engine.stop();
  });
});
