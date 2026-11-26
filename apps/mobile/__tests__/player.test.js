jest.mock('react-native-video', () => {
  const React = require('react');
  const seek = jest.fn();
  return { __esModule: true, seek, default: React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ seek }));
    return React.createElement('Video', props);
  }) };
});
jest.mock('../src/api/endpoints', () => ({ mediaApi: { authHeaders: jest.fn().mockResolvedValue({ Authorization: 'Bearer token' }) } }));
jest.mock('../src/api/client', () => ({ absoluteMediaUrl: (path) => `https://api.example${path}` }));
jest.mock('../src/api/session', () => ({ getValidAccessToken: jest.fn().mockResolvedValue('token') }));
jest.mock('../src/services/authEvents', () => ({ subscribeAuthEvents: () => () => {} }));
jest.mock('../src/components/AppText', () => ({ __esModule: true, default: 'AppText' }));
jest.mock('../src/components/Icon', () => ({ __esModule: true, default: 'Icon', Waveform: 'Waveform' }));
jest.mock('@react-navigation/native', () => ({ DefaultTheme: { colors: {} } }));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import SyncedMediaPlayer from '../src/media/SyncedMediaPlayer';
import { seek } from 'react-native-video';

global.IS_REACT_ACT_ENVIRONMENT = true;

describe('native player lifecycle contract (player callbacks simulated)', () => {
  const media = { id: 'm1', source: 'external', url: 'https://media.example/music.mp4', type: 'video', durationMs: 60000 };
  const playback = { mediaId: 'm1', sequence: 1, status: 'playing', positionMs: 10000, updatedAt: new Date(1000).toISOString(), durationMs: 60000, rate: 1 };
  let tree;
  let serverTime;
  const renderPlayer = async (extra = {}) => {
    await act(async () => { tree = renderer.create(<SyncedMediaPlayer media={media} playback={playback} serverNow={() => serverTime} reduceMotion {...extra} />); });
    return tree.root.findByType('Video');
  };
  beforeEach(() => { jest.useFakeTimers(); seek.mockClear(); serverTime = 1000; });
  afterEach(async () => {
    if (tree) await act(async () => tree.unmount());
    tree = null;
    jest.useRealTimers();
  });
  test('waits for a native load callback before playing or seeking', async () => {
    const video = await renderPlayer();
    expect(video.props.paused).toBe(true);
    expect(seek).not.toHaveBeenCalled();
    await act(async () => video.props.onLoad({ duration: 60 }));
    expect(tree.root.findByType('Video').props.paused).toBe(false);
    expect(seek).toHaveBeenCalledWith(10);
  });
  test('starts at a scheduled server time after media is ready', async () => {
    const video = await renderPlayer({ playback: { ...playback, updatedAt: new Date(1600).toISOString(), startAtServerMs: 1600 } });
    await act(async () => video.props.onLoad({ duration: 60 }));
    expect(tree.root.findByType('Video').props.paused).toBe(true);
    serverTime = 1600;
    await act(async () => jest.advanceTimersByTime(600));
    expect(tree.root.findByType('Video').props.paused).toBe(false);
  });
  test('does not issue repeated drift seeks while native player buffers', async () => {
    const video = await renderPlayer();
    await act(async () => video.props.onLoad({ duration: 60 }));
    const before = seek.mock.calls.length;
    await act(async () => {
      tree.root.findByType('Video').props.onProgress({ currentTime: 0 });
      tree.root.findByType('Video').props.onBuffer({ isBuffering: true });
    });
    serverTime = 11000;
    await act(async () => jest.advanceTimersByTime(10000));
    expect(seek).toHaveBeenCalledTimes(before);
  });
  test('shows a bounded load failure and exposes a real retry', async () => {
    await renderPlayer();
    await act(async () => jest.advanceTimersByTime(25000));
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Retry playback' })).not.toHaveLength(0);
    const keyBefore = tree.root.findByType('Video').props.paused;
    expect(keyBefore).toBe(true);
    await act(async () => tree.root.findByProps({ accessibilityLabel: 'Retry playback' }).props.onPress());
    expect(tree.root.findByType('Video').props.paused).toBe(true);
  });
  test('never sends API bearer credentials to an external DRM license server', async () => {
    const video = await renderPlayer({ media: { ...media, drmScheme: 'widevine', drmLicenseUrl: 'https://license.example' } });
    expect(video.props.source.headers).toBeUndefined();
    expect(video.props.source.drm.headers).toBeUndefined();
  });
});
