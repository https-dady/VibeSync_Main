import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { colors, radius, spacing } from '../theme';
import Screen from '../components/Screen';
import AppText from '../components/AppText';
import Avatar from '../components/Avatar';
import Badge from '../components/Badge';
import Button from '../components/Button';
import Icon, { Waveform } from '../components/Icon';
import Input from '../components/Input';
import ListRow from '../components/ListRow';
import Logo from '../components/Logo';
import Sheet from '../components/Sheet';
import SyncIndicator from '../components/SyncIndicator';
import { useToast } from '../components/Toast';
import { useRoom } from '../context/RoomContext';
import { useSocket } from '../context/SocketContext';
import SyncedMediaPlayer from '../media/SyncedMediaPlayer';
import { expectedPosition } from '../sync/PlaybackSync';
import { formatDuration, readableFileName } from '../utils/format';
import { apiError } from '../api/client';
import useReducedMotion from '../hooks/useReducedMotion';
import { useAuth } from '../context/AuthContext';

const DRM_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'widevine', label: 'Widevine' },
  { value: 'fairplay', label: 'FairPlay' },
];

function RoundControl({ icon, label, onPress, active, disabled, size = 50, iconSize = 21 }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.roundControl,
        { width: size, height: size, borderRadius: size / 2 },
        active && styles.roundControlActive,
        disabled && { opacity: 0.35 },
        pressed && { opacity: 0.72 },
      ]}
    >
      <Icon
        name={icon}
        size={iconSize}
        color={active ? colors.black : colors.offWhite}
      />
    </Pressable>
  );
}

function formatClock(ms) {
  return formatDuration(ms);
}

export default function RoomScreen({ navigation, route }) {
  const { user } = useAuth();
  const reduceMotion = useReducedMotion(user?.settings?.reduceMotion);
  const {
    room,
    membership,
    members,
    onlineUserIds,
    playback,
    media,
    messages,
    loading,
    activating,
    joined,
    error,
    evicted,
    notice,
    isHost,
    canSpeak,
    micEnabled,
    voice,
    voiceError,
    enterRoom,
    leaveRoom,
    endRoom,
    clearRoom,
    clearNotice,
    clearVoiceError,
    hostCommand,
    reportHostPosition,
    requestSync,
    addUrlMedia,
    uploadMedia,
    removeMedia,
    selectMedia,
    requestSpeak,
    enableMic,
    disableMic,
    audioOutputs,
    selectAudioOutput,
    showAudioRoutePicker,
  } = useRoom();
  const { connected, clock, connectionState } = useSocket();
  const { showToast } = useToast();

  const routeCode = String(route.params?.roomCode || '').toUpperCase();
  const [localError, setLocalError] = useState('');
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [sliding, setSliding] = useState(false);
  const [slideValue, setSlideValue] = useState(0);
  const [sheet, setSheet] = useState(null);
  const [requesting, setRequesting] = useState(false);
  const [speakNote, setSpeakNote] = useState('');
  const [queueTab, setQueueTab] = useState('library');
  const [urlForm, setUrlForm] = useState({
    title: '',
    artist: '',
    type: room?.mediaType || 'video',
    url: '',
    provider: '',
    drmScheme: '',
    drmLicenseUrl: '',
    drmCertificateUrl: '',
    drmContentId: '',
  });
  const [addingUrl, setAddingUrl] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ending, setEnding] = useState(false);
  const playerRef = useRef(null);
  const allowExit = useRef(false);
  const lastSequence = useRef(null);
  const enteredCode = useRef(null);

  const currentMedia =
    playback?.media || media.find((item) => String(item.id) === String(playback?.mediaId));
  const isPlaying = playback?.status === 'playing';
  const roomEnded = room?.status === 'ended' || (playback?.status === 'ended' && !joined);
  const totalDurationMs = durationMs || playback?.durationMs || currentMedia?.durationMs || 0;

  useEffect(() => {
    if (joined && room && (!routeCode || room.roomId === routeCode)) return;
    if (!routeCode) {
      setLocalError('No room code was supplied.');
      return;
    }
    if (enteredCode.current === routeCode) return;
    enteredCode.current = routeCode;
    setLocalError('');
    enterRoom(routeCode).catch((caught) => {
      setLocalError(caught.friendlyMessage || apiError(caught).message);
    });
  }, [activating, enterRoom, joined, loading, room, routeCode]);

  useEffect(() => {
    if (!notice) return;
    showToast(notice.message, notice.tone === 'success' ? 'success' : 'default');
    clearNotice();
  }, [notice, clearNotice, showToast]);

  useEffect(() => {
    if (!voiceError) return;
    showToast(voiceError.message, 'error');
    clearVoiceError();
  }, [voiceError, clearVoiceError, showToast]);

  useEffect(() => {
    if (!evicted) return;
    Alert.alert(
      evicted.reason === 'banned' ? 'Removed from room' : 'Access ended',
      evicted.reason === 'banned'
        ? 'The host banned you from this room.'
        : 'You no longer have access to this room.',
      [
        {
          text: 'Back home',
          onPress: () => {
            allowExit.current = true;
            clearRoom();
            navigation.popToTop();
          },
        },
      ],
      { cancelable: false },
    );
  }, [evicted, clearRoom, navigation]);

  useEffect(() => {
    setRequesting(Boolean(membership?.permissions?.micRequested));
  }, [membership?.permissions?.micRequested]);

  useEffect(() => {
    if (!lastSequence.current || lastSequence.current !== playback?.sequence) {
      lastSequence.current = playback?.sequence;
      if (playback && !sliding) {
        const target = expectedPosition(playback, Date.now() + (clock.offsetMs || 0));
        if (Number.isFinite(target)) setPositionMs(target);
      }
    }
  }, [playback, clock.offsetMs, sliding]);

  const doLeave = useCallback(async () => {
    allowExit.current = true;
    try {
      await leaveRoom();
    } finally {
      navigation.popToTop();
    }
  }, [leaveRoom, navigation]);

  const doEnd = useCallback(async () => {
    setEnding(true);
    try {
      await endRoom();
      allowExit.current = true;
      showToast('Room ended for everyone', 'success');
    } catch (caught) {
      showToast(apiError(caught).message, 'error');
    } finally {
      setEnding(false);
    }
  }, [endRoom, showToast]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (allowExit.current || !joined) return;
      event.preventDefault();
      if (isHost) {
        Alert.alert(
          'End this room?',
          'You are the host. Leaving will end the session for everyone.',
          [
            { text: 'Keep hosting', style: 'cancel' },
            {
              text: 'End & exit',
              style: 'destructive',
              onPress: () => {
                doEnd().then(() => {
                  allowExit.current = true;
                  navigation.dispatch(event.data.action);
                });
              },
            },
          ],
        );
      } else {
        Alert.alert('Leave the room?', 'Playback will stop on this device.', [
          { text: 'Stay', style: 'cancel' },
          {
            text: 'Leave',
            style: 'destructive',
            onPress: () => {
              allowExit.current = true;
              doLeave();
            },
          },
        ]);
      }
    });
    return unsubscribe;
  }, [doEnd, doLeave, isHost, joined, navigation]);

  const runCommand = useCallback(
    async (action, extras = {}) => {
      try {
        await hostCommand(action, extras);
      } catch (caught) {
        showToast(apiError(caught).message, 'error');
      }
    },
    [hostCommand, showToast],
  );

  const togglePlayback = () => {
    if (!isHost) {
      showToast('Only the host controls playback', 'default');
      return;
    }
    if (!currentMedia) {
      setSheet('queue');
      return;
    }
    const actual = playerRef.current?.getPositionMs() ?? positionMs;
    if (isPlaying) {
      runCommand('pause', { positionMs: actual });
    } else {
      const restart = playback?.status === 'ended';
      if (restart) playerRef.current?.seekTo(0, 0);
      runCommand('play', { positionMs: restart ? 0 : actual });
    }
  };

  const seekBy = (deltaMs) => {
    if (!isHost) return;
    const target = Math.max(0, Math.min(totalDurationMs || Number.MAX_SAFE_INTEGER, positionMs + deltaMs));
    playerRef.current?.seekTo(target, 0);
    setPositionMs(target);
    runCommand('seek', { positionMs: target });
  };

  const onSliderComplete = (value) => {
    setSliding(false);
    setPositionMs(value);
    if (!isHost) {
      showToast('Only the host can seek', 'default');
      return;
    }
    playerRef.current?.seekTo(value, 0);
    runCommand('seek', { positionMs: Math.round(value) });
  };

  const toggleMic = async () => {
    try {
      if (micEnabled) {
        await disableMic();
      } else {
        await enableMic();
      }
    } catch (caught) {
      showToast(caught.message, 'error');
    }
  };

  const submitSpeakRequest = async () => {
    try {
      const result = await requestSpeak(speakNote.trim());
      setRequesting(result?.status === 'pending');
      setSheet(null);
      setSpeakNote('');
      showToast(
        result?.status === 'approved'
          ? 'You can speak now'
          : 'Microphone request sent to the host',
        'success',
      );
    } catch (caught) {
      showToast(apiError(caught).message, 'error');
    }
  };

  const pickMedia = async () => {
    try {
      const [file] = await pick({
        type: [types.audio, types.video],
        mode: 'import',
        allowMultiSelection: false,
      });
      if (!file?.uri) return;
      const mime = file.type || (room?.mediaType === 'audio' ? 'audio/mpeg' : 'video/mp4');
      const fileType = mime.startsWith('audio') ? 'audio' : mime.startsWith('video') ? 'video' : room?.mediaType || 'video';
      setUploading(true);
      const uploaded = await uploadMedia(
        { uri: file.uri, name: file.name || 'media', type: mime },
        {
          title: readableFileName(file.name || 'Room media') || 'Room media',
          mediaType: fileType,
        },
      );
      await selectMedia(uploaded.id);
      showToast('Media added and selected', 'success');
      setQueueTab('library');
    } catch (caught) {
      if (isErrorWithCode(caught) && caught.code === errorCodes.OPERATION_CANCELED) return;
      showToast(apiError(caught).message || caught.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const submitUrl = async () => {
    if (!/^https?:\/\/\S+/i.test(urlForm.url.trim())) {
      showToast('Enter a valid https media URL', 'error');
      return;
    }
    if (!urlForm.title.trim()) {
      showToast('Give this media a title', 'error');
      return;
    }
    setAddingUrl(true);
    try {
      const item = await addUrlMedia({
        title: urlForm.title.trim(),
        artist: urlForm.artist.trim(),
        type: urlForm.type,
        url: urlForm.url.trim(),
        provider: urlForm.provider.trim(),
        drmScheme: urlForm.drmScheme,
        drmLicenseUrl: urlForm.drmLicenseUrl.trim(),
        drmCertificateUrl: urlForm.drmCertificateUrl.trim(),
        drmContentId: urlForm.drmContentId.trim(),
      });
      await selectMedia(item.id);
      setUrlForm({
        title: '',
        artist: '',
        type: room?.mediaType || 'video',
        url: '',
        provider: '',
        drmScheme: '',
        drmLicenseUrl: '',
        drmCertificateUrl: '',
        drmContentId: '',
      });
      setQueueTab('library');
      showToast('Media added and selected', 'success');
    } catch (caught) {
      showToast(apiError(caught).message, 'error');
    } finally {
      setAddingUrl(false);
    }
  };

  const confirmRemoveMedia = (item) => {
    Alert.alert('Remove media?', `${item.title} will be removed from the room.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => removeMedia(item.id).catch((caught) => showToast(apiError(caught).message, 'error')),
      },
    ]);
  };

  const activeSpeakers = members.filter((member) =>
    voice.remoteSpeakerIds?.map(String).includes(String(member.userId)),
  );
  const onlineMembers = members.filter((member) =>
    onlineUserIds.map(String).includes(String(member.userId)),
  );

  if ((loading || activating) && !room) {
    return (
      <Screen contentContainerStyle={styles.centered}>
        <Logo size={64} />
        <ActivityIndicator color={colors.orange} style={{ marginTop: 24 }} />
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: 12 }}>
          Tuning the room…
        </AppText>
      </Screen>
    );
  }

  if (!room) {
    return (
      <Screen contentContainerStyle={styles.centered}>
        <View style={styles.errorCircle}>
          <Icon name="wifiOff" size={30} color={colors.orange} />
        </View>
        <AppText variant="title" style={{ textAlign: 'center', marginTop: spacing.lg }}>
          Can't open this room
        </AppText>
        <AppText variant="body" color={colors.textMuted} style={styles.errorText}>
          {localError || error || 'The room may have ended or you may not have access.'}
        </AppText>
        <Button
          title="Try again"
          onPress={() => {
            enteredCode.current = null;
            if (routeCode) enterRoom(routeCode).catch(() => {});
          }}
          style={{ marginTop: spacing.lg, minWidth: 180 }}
        />
        <Button
          title="Back home"
          variant="ghost"
          onPress={() => navigation.popToTop()}
          style={{ marginTop: spacing.xs }}
        />
      </Screen>
    );
  }

  if (roomEnded && !joined) {
    return (
      <Screen contentContainerStyle={styles.centered}>
        <Logo size={58} />
        <Badge label="SESSION ENDED" tone="orange" style={{ marginTop: spacing.lg }} />
        <AppText variant="title" style={{ textAlign: 'center', marginTop: spacing.md }}>
          That's a wrap
        </AppText>
        <AppText variant="body" color={colors.textMuted} style={styles.errorText}>
          {room.name} has ended. Your playback stopped automatically and the room is no longer
          accepting listeners.
        </AppText>
        <Button
          title="Back home"
          icon="home"
          onPress={() => {
            allowExit.current = true;
            clearRoom();
            navigation.popToTop();
          }}
          style={{ marginTop: spacing.xl, minWidth: 200 }}
        />
      </Screen>
    );
  }

  const offline = !connected;
  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.iconButton}
          accessibilityLabel="Leave room"
          accessibilityRole="button"
        >
          <Icon name="arrowLeft" size={20} />
        </Pressable>
        <View style={styles.titleBlock}>
          <AppText variant="label" weight="800" numberOfLines={1}>
            {room.name}
          </AppText>
          <View style={styles.subline}>
            <AppText variant="micro" color={colors.orange} style={styles.roomCode}>
              {room.roomId}
            </AppText>
            <AppText variant="micro" color={colors.textFaint}>
              ·
            </AppText>
            <SyncIndicator
              state={offline ? 'offline' : connectionState === 'connected' ? 'synced' : 'syncing'}
              compact
            />
          </View>
        </View>
        <Pressable
          onPress={() => navigation.navigate('ShareRoom', { roomCode: room.roomId })}
          style={styles.iconButton}
          accessibilityLabel="Share room"
          accessibilityRole="button"
        >
          <Icon name="share" size={18} />
        </Pressable>
        <Pressable
          onPress={() => setSheet('actions')}
          style={styles.iconButton}
          accessibilityLabel="Room actions"
          accessibilityRole="button"
        >
          <Icon name="more" size={19} />
        </Pressable>
      </View>

      {offline ? (
        <View style={styles.offlineBanner}>
          <Icon name="wifiOff" size={16} color={colors.orange} />
          <AppText variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
            Live connection paused. Playback continues with the last synced state while we
            reconnect.
          </AppText>
          <Pressable onPress={requestSync} hitSlop={8}>
            <AppText variant="micro" color={colors.orange}>
              RESYNC
            </AppText>
          </Pressable>
        </View>
      ) : null}

      <Pressable
        onStartShouldSetResponder={() => false}
        style={styles.playerWrap}
      >
        <SyncedMediaPlayer
          connectionState={connectionState}
          ref={playerRef}
          playback={playback}
          media={currentMedia}
          isHost={isHost}
          serverNow={() => Date.now() + (clock.offsetMs || 0)}
          onCommand={runCommand}
          reportPosition={reportHostPosition}
          onPosition={(seconds) => {
            if (!sliding) setPositionMs(seconds * 1000);
          }}
          onDuration={(ms) => setDurationMs(ms)}
          reduceMotion={reduceMotion}
        />
        {currentMedia ? (
          <View style={styles.playerBadges} pointerEvents="none">
            <View style={styles.liveBadge}>
              <View style={[styles.liveDot, !isPlaying && styles.liveDotPaused]} />
              <AppText variant="micro" color={colors.offWhite}>
                {isPlaying ? 'LIVE' : playback?.status === 'idle' ? 'READY' : String(playback?.status || '').toUpperCase()}
              </AppText>
            </View>
            <View style={styles.qualityBadge}>
              <AppText variant="micro" color={colors.textMuted}>
                {clock.quality === 'unknown' ? 'SYNCING CLOCK' : `CLOCK ${clock.quality.toUpperCase()}`}
              </AppText>
            </View>
          </View>
        ) : null}
        {currentMedia?.type === 'video' ? (
          <Pressable
            onPress={() => playerRef.current?.enterFullscreen?.()}
            style={styles.fullscreenButton}
            accessibilityRole="button"
            accessibilityLabel="Play video fullscreen"
          >
            <Icon name="maximize" size={16} color={colors.offWhite} />
          </Pressable>
        ) : null}
      </Pressable>

      <View style={styles.nowPlaying}>
        <View style={{ flex: 1 }}>
          <AppText variant="micro" color={colors.orange} style={styles.nowEyebrow}>
            {isHost ? 'YOU ARE THE HOST' : 'SYNCED TO HOST'} · {currentMedia?.type === 'audio' ? 'AUDIO' : 'VIDEO'}
          </AppText>
          <AppText variant="section" numberOfLines={2} style={{ marginTop: 3 }}>
            {currentMedia?.title || (isHost ? 'Add something to the room' : 'Waiting for the host')}
          </AppText>
          {currentMedia?.artist ? (
            <AppText variant="caption" color={colors.textMuted} numberOfLines={1}>
              {currentMedia.artist}
            </AppText>
          ) : null}
        </View>
        <Pressable
          onPress={() => setSheet('queue')}
          style={styles.queueButton}
          accessibilityRole="button"
          accessibilityLabel="Open room queue"
        >
          <Icon name="music" size={16} color={colors.yellow} />
          <AppText variant="micro" color={colors.textMuted}>
            QUEUE {media.length}
          </AppText>
        </Pressable>
      </View>

      <View style={styles.progressWrap}>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={Math.max(totalDurationMs, 1)}
          value={sliding ? slideValue : Math.min(positionMs, Math.max(totalDurationMs, 1))}
          disabled={!isHost || !currentMedia}
          minimumTrackTintColor={colors.orange}
          maximumTrackTintColor={colors.borderStrong}
          thumbTintColor={isHost ? colors.yellow : colors.textFaint}
          onSlidingStart={() => {
            setSliding(true);
            setSlideValue(positionMs);
          }}
          onValueChange={setSlideValue}
          onSlidingComplete={onSliderComplete}
          accessibilityLabel="Playback position"
        />
        <View style={styles.timeRow}>
          <AppText variant="micro" color={colors.textMuted}>
            {formatClock(sliding ? slideValue : positionMs)}
          </AppText>
          <AppText variant="micro" color={colors.textFaint}>
            {formatClock(totalDurationMs)}
          </AppText>
        </View>
      </View>

      <View style={styles.controls}>
        <RoundControl
          icon="skipBack"
          label="Back 10 seconds"
          size={44}
          iconSize={18}
          onPress={() => seekBy(-10000)}
          disabled={!isHost || !currentMedia}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
          onPress={togglePlayback}
          disabled={!currentMedia && !isHost}
          style={({ pressed }) => [
            styles.playButton,
            !currentMedia && styles.playButtonIdle,
            pressed && { transform: [{ scale: 0.96 }] },
          ]}
        >
          <Icon
            name={isPlaying ? 'pause' : 'play'}
            size={29}
            color={currentMedia ? colors.black : colors.textMuted}
          />
        </Pressable>
        <RoundControl
          icon="skipForward"
          label="Forward 10 seconds"
          size={44}
          iconSize={18}
          onPress={() => seekBy(10000)}
          disabled={!isHost || !currentMedia}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Playback speed"
          disabled={!isHost}
          onPress={() => {
            const rates = [0.75, 1, 1.25, 1.5];
            const index = rates.indexOf(playback?.rate || 1);
            const next = rates[(index + 1) % rates.length];
            runCommand('setRate', { rate: next });
          }}
          style={styles.rateButton}
        >
          <AppText variant="caption" weight="800" color={isHost ? colors.offWhite : colors.textMuted}>
            {playback?.rate && playback.rate !== 1 ? `${playback.rate}×` : '1×'}
          </AppText>
        </Pressable>
      </View>

      <View style={styles.voiceBar}>
        <View style={styles.voiceInfo}>
          <Icon
            name={micEnabled ? 'mic' : canSpeak ? 'mic' : 'headphones'}
            size={16}
            color={micEnabled ? colors.yellow : colors.textMuted}
          />
          <View style={{ flex: 1 }}>
            <AppText variant="caption" weight="700" numberOfLines={1}>
              {micEnabled
                ? 'Your mic is live'
                : activeSpeakers.length
                  ? `${activeSpeakers.map((member) => member.user?.name?.split(' ')[0]).join(', ')} speaking`
                  : 'Voice chat'}
            </AppText>
            <AppText variant="micro" color={colors.textFaint} numberOfLines={1}>
              {micEnabled
                ? `${voice.transport === 'livekit' ? 'SFU' : 'Mesh'} · ${voice.connectedPeers || 0} connected`
                : canSpeak
                  ? 'You have mic access — tap to speak'
                  : membership?.permissions?.mutedByHost
                    ? 'The host muted your microphone'
                    : room.allowMicRequests
                      ? 'Ask the host for the microphone'
                      : 'Microphone requests are off'}
            </AppText>
          </View>
          {requesting ? <Badge label="REQUESTED" tone="yellow" /> : null}
        </View>

        {canSpeak ? (
          <Pressable
            onPress={toggleMic}
            style={[styles.micButton, micEnabled && styles.micButtonActive]}
            accessibilityRole="button"
            accessibilityLabel={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
          >
            <Icon name={micEnabled ? 'mic' : 'micOff'} size={19} color={colors.black} />
          </Pressable>
        ) : (
          <Pressable
            disabled={requesting || !room.allowMicRequests || membership?.permissions?.mutedByHost}
            onPress={() => setSheet('speak')}
            style={[
              styles.askButton,
              (requesting || !room.allowMicRequests || membership?.permissions?.mutedByHost) &&
                styles.askButtonDisabled,
            ]}
            accessibilityRole="button"
          >
            <AppText variant="micro" color={requesting ? colors.textMuted : colors.offWhite} weight="800">
              {requesting ? 'WAITING' : membership?.permissions?.mutedByHost ? 'MUTED' : 'REQUEST MIC'}
            </AppText>
          </Pressable>
        )}
      </View>

      <View style={styles.quickActions}>
        <Pressable style={styles.quick} accessibilityRole="button" accessibilityLabel="Choose voice audio output" onPress={async () => {
          try {
            const outputs = await audioOutputs();
            if (!outputs.length) { showToast('Join voice before selecting an output.', 'default'); return; }
            Alert.alert('Voice audio output', 'Choose an available output. Bluetooth and wired routing depend on the device.', [
              ...(Platform.OS === 'ios' ? [{ text: 'System audio routes', onPress: () => showAudioRoutePicker().catch((caught) => showToast(caught.message, 'error')) }] : []),
              ...outputs.map((output) => ({ text: output.replace(/_/g, ' '), onPress: () => selectAudioOutput(output).catch((caught) => showToast(caught.message, 'error')) })),
              { text: 'Cancel', style: 'cancel' },
            ]);
          } catch (caught) { showToast(caught.message, 'error'); }
        }}>
          <View style={styles.quickIcon}><Icon name="headphones" size={19} color={colors.orange} /></View>
          <AppText variant="caption">Audio output</AppText>
        </Pressable>
        <Pressable
          style={styles.quick}
          onPress={() => setSheet('queue')}
          accessibilityRole="button"
        >
          <View style={[styles.quickIcon, { backgroundColor: colors.orangeSoft }]}>
            <Icon name="music" size={19} color={colors.orange} />
          </View>
          <AppText variant="caption" weight="700">
            Queue
          </AppText>
          <AppText variant="micro" color={colors.textFaint}>
            {media.length} ITEMS
          </AppText>
        </Pressable>
        <Pressable
          style={styles.quick}
          onPress={() => navigation.navigate('RoomChat', { roomCode: room.roomId })}
          accessibilityRole="button"
        >
          <View style={[styles.quickIcon, { backgroundColor: colors.yellowSoft }]}>
            <Icon name="chat" size={19} color={colors.yellow} />
          </View>
          <AppText variant="caption" weight="700">
            Chat
          </AppText>
          <AppText variant="micro" color={colors.textFaint}>
            {messages.length} MSG
          </AppText>
        </Pressable>
        <Pressable
          style={styles.quick}
          onPress={() => navigation.navigate('Participants', { roomCode: room.roomId })}
          accessibilityRole="button"
        >
          <View style={[styles.quickIcon, { backgroundColor: colors.offWhiteSoft }]}>
            <Icon name="users" size={19} color={colors.offWhite} />
          </View>
          <AppText variant="caption" weight="700">
            People
          </AppText>
          <AppText variant="micro" color={colors.textFaint}>
            {onlineMembers.length} ONLINE
          </AppText>
        </Pressable>
        {isHost ? (
          <Pressable
            style={styles.quick}
            onPress={() => navigation.navigate('HostControls', { roomCode: room.roomId })}
            accessibilityRole="button"
          >
            <View style={[styles.quickIcon, { backgroundColor: colors.yellowSoft }]}>
              <Icon name="shield" size={19} color={colors.yellow} />
            </View>
            <AppText variant="caption" weight="700">
              Host
            </AppText>
            <AppText variant="micro" color={colors.textFaint}>
              CONTROLS
            </AppText>
          </Pressable>
        ) : (
          <Pressable
            style={styles.quick}
            onPress={() => navigation.navigate('HostChat', { roomCode: room.roomId })}
            accessibilityRole="button"
          >
            <View style={[styles.quickIcon, { backgroundColor: colors.orangeSoft }]}>
              <Icon name="lock" size={18} color={colors.orange} />
            </View>
            <AppText variant="caption" weight="700">
              Private
            </AppText>
            <AppText variant="micro" color={colors.textFaint}>
              HOST
            </AppText>
          </Pressable>
        )}
      </View>

      <View style={styles.peopleCard}>
        <View style={styles.sectionHeader}>
          <View>
            <AppText variant="section">In the room</AppText>
            <AppText variant="caption" color={colors.textMuted}>
              {onlineMembers.length} online · {members.length} members
            </AppText>
          </View>
          <Pressable
            onPress={() => navigation.navigate('Participants', { roomCode: room.roomId })}
            hitSlop={10}
          >
            <AppText variant="caption" color={colors.orange} weight="800">
              {isHost ? 'MANAGE' : 'VIEW ALL'}
            </AppText>
          </Pressable>
        </View>
        <View style={styles.memberRow}>
          {members.slice(0, 6).map((member) => {
            const online = onlineUserIds.map(String).includes(String(member.userId));
            return (
              <View key={member.id} style={styles.member}>
                <View>
                  <Avatar name={member.user?.name} color={member.user?.avatarColor} size={42} />
                  <View
                    style={[
                      styles.onlineDot,
                      { backgroundColor: online ? colors.yellow : colors.textFaint },
                    ]}
                  />
                </View>
                {member.permissions?.canSpeak ? (
                  <View style={styles.memberMic}>
                    <Icon name="mic" size={9} color={colors.black} />
                  </View>
                ) : null}
                <AppText
                  variant="micro"
                  color={colors.textMuted}
                  numberOfLines={1}
                  style={styles.memberName}
                >
                  {member.role === 'host' ? `${member.user?.name?.split(' ')[0] || 'Host'} · HOST` : member.user?.name?.split(' ')[0]}
                </AppText>
              </View>
            );
          })}
          {members.length > 6 ? (
            <Pressable
              onPress={() => navigation.navigate('Participants', { roomCode: room.roomId })}
              style={styles.moreMembers}
            >
              <AppText variant="label" weight="800">
                +{members.length - 6}
              </AppText>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.chatPreview}>
        <View style={styles.sectionHeader}>
          <AppText variant="section">Room chat</AppText>
          <Pressable
            onPress={() => navigation.navigate('RoomChat', { roomCode: room.roomId })}
            hitSlop={10}
          >
            <AppText variant="caption" color={colors.orange} weight="800">
              OPEN CHAT
            </AppText>
          </Pressable>
        </View>
        {messages.length === 0 ? (
          <Pressable
            style={styles.chatEmpty}
            onPress={() => navigation.navigate('RoomChat', { roomCode: room.roomId })}
          >
            <Waveform width={42} height={22} color={colors.textFaint} bars={7} />
            <AppText variant="caption" color={colors.textMuted}>
              Say hello. The room chat is open.
            </AppText>
          </Pressable>
        ) : (
          <View style={styles.previewMessages}>
            {messages.slice(-2).map((message) => (
              <View key={message.id} style={styles.previewMessage}>
                <Avatar
                  name={message.sender?.name}
                  color={message.sender?.avatarColor}
                  size={28}
                />
                <View style={{ flex: 1 }}>
                  <AppText variant="micro" color={message.senderId === membership?.userId ? colors.yellow : colors.textFaint}>
                    {message.sender?.name || 'Member'}
                  </AppText>
                  <AppText variant="caption" color={message.deleted ? colors.textFaint : colors.textMuted} numberOfLines={2}>
                    {message.deleted ? 'Message removed' : message.body}
                  </AppText>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {isHost ? (
        <View style={styles.hostFooter}>
          <Button
            title="Host controls"
            icon="shield"
            variant="secondary"
            onPress={() => navigation.navigate('HostControls', { roomCode: room.roomId })}
          />
          <Button
            title="End room"
            variant="danger"
            onPress={() => {
              Alert.alert('End this room?', 'Everyone will be disconnected and playback will stop.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'End room', style: 'destructive', onPress: doEnd },
              ]);
            }}
            loading={ending}
          />
        </View>
      ) : null}

      <Sheet visible={sheet === 'actions'} onClose={() => setSheet(null)} title="Room actions">
        <View style={styles.actionSheet}>
          <ListRow
            icon="qr"
            title="Share invite"
            subtitle={`Code ${room.roomId}`}
            onPress={() => {
              setSheet(null);
              navigation.navigate('ShareRoom', { roomCode: room.roomId });
            }}
          />
          <ListRow
            icon="users"
            title="Participants"
            subtitle={`${members.length} members, ${onlineMembers.length} online`}
            onPress={() => {
              setSheet(null);
              navigation.navigate('Participants', { roomCode: room.roomId });
            }}
          />
          {isHost ? (
            <>
              <ListRow
                icon="shield"
                title="Host controls"
                subtitle="Mic requests, join requests, and room safety"
                onPress={() => {
                  setSheet(null);
                  navigation.navigate('HostControls', { roomCode: room.roomId });
                }}
              />
              <ListRow
                icon="settings"
                title="Room settings"
                onPress={() => {
                  setSheet(null);
                  navigation.navigate('RoomSettings', { roomCode: room.roomId });
                }}
              />
            </>
          ) : (
            <ListRow
              icon="lock"
              title="Private host chat"
              subtitle="Only you and the host can read it"
              onPress={() => {
                setSheet(null);
                navigation.navigate('HostChat', { roomCode: room.roomId });
              }}
            />
          )}
          <ListRow
            icon="logout"
            tone="danger"
            title={isHost ? 'End room' : 'Leave room'}
            onPress={() => {
              setSheet(null);
              if (isHost) {
                Alert.alert('End this room?', 'Everyone will be disconnected.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'End room', style: 'destructive', onPress: doEnd },
                ]);
              } else {
                Alert.alert('Leave the room?', 'Playback will stop on this device.', [
                  { text: 'Stay', style: 'cancel' },
                  { text: 'Leave', style: 'destructive', onPress: doLeave },
                ]);
              }
            }}
          />
        </View>
      </Sheet>

      <Sheet visible={sheet === 'speak'} onClose={() => setSheet(null)} title="Request the mic">
        <AppText variant="body" color={colors.textMuted}>
          The host decides who can speak. Add a short note so they know why you're asking.
        </AppText>
        <Input
          label="NOTE TO HOST (OPTIONAL)"
          value={speakNote}
          onChangeText={setSpeakNote}
          placeholder="I'd like to say hi"
          maxLength={200}
          multiline
          style={{ marginTop: spacing.md }}
        />
        <Button
          title="Send request"
          icon="mic"
          onPress={submitSpeakRequest}
          style={{ marginTop: spacing.md, marginBottom: spacing.md }}
        />
      </Sheet>

      <Sheet visible={sheet === 'queue'} onClose={() => setSheet(null)} title="Room queue">
        <View style={styles.queueTabs}>
          <Pressable
            onPress={() => setQueueTab('library')}
            style={[styles.queueTab, queueTab === 'library' && styles.queueTabActive]}
          >
            <AppText variant="caption" weight="800" color={queueTab === 'library' ? colors.black : colors.textMuted}>
              LIBRARY
            </AppText>
          </Pressable>
          <Pressable
            onPress={() => setQueueTab('url')}
            style={[styles.queueTab, queueTab === 'url' && styles.queueTabActive]}
          >
            <AppText variant="caption" weight="800" color={queueTab === 'url' ? colors.black : colors.textMuted}>
              ADD URL
            </AppText>
          </Pressable>
        </View>

        {queueTab === 'library' ? (
          <ScrollView style={styles.mediaScroll} showsVerticalScrollIndicator={false}>
            {isHost ? (
              <Button
                title={uploading ? 'Uploading…' : 'Upload from device'}
                icon="plus"
                variant="secondary"
                onPress={pickMedia}
                loading={uploading}
                disabled={uploading}
                style={{ marginBottom: spacing.md }}
              />
            ) : (
              <AppText variant="caption" color={colors.textMuted} style={{ marginBottom: spacing.md }}>
                Only the host can add or select media.
              </AppText>
            )}
            {media.length === 0 ? (
              <View style={styles.queueEmpty}>
                <Icon name="music" size={26} color={colors.textFaint} />
                <AppText variant="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
                  Nothing queued yet.
                </AppText>
              </View>
            ) : (
              media.map((item) => {
                const active = String(item.id) === String(playback?.mediaId);
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => {
                      if (!isHost) return;
                      selectMedia(item.id)
                        .then(() => showToast(`Now playing ${item.title}`, 'success'))
                        .catch((caught) => showToast(apiError(caught).message, 'error'));
                      setSheet(null);
                    }}
                    style={[styles.mediaRow, active && styles.mediaRowActive]}
                  >
                    <View style={styles.mediaIcon}>
                      <Icon
                        name={item.type === 'audio' ? 'music' : 'video'}
                        size={17}
                        color={active ? colors.orange : colors.textMuted}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppText variant="label" numberOfLines={1} color={active ? colors.offWhite : undefined}>
                        {item.title}
                      </AppText>
                      <AppText variant="caption" color={colors.textMuted} numberOfLines={1}>
                        {item.artist || (item.source === 'upload' ? 'Uploaded file' : item.provider || 'External URL')}
                        {item.durationMs ? ` · ${formatDuration(item.durationMs)}` : ''}
                      </AppText>
                    </View>
                    {active ? <Badge label="PLAYING" tone="orange" /> : null}
                    {isHost ? (
                      <Pressable
                        onPress={() => confirmRemoveMedia(item)}
                        hitSlop={12}
                        accessibilityLabel={`Remove ${item.title}`}
                        accessibilityRole="button"
                      >
                        <Icon name="trash" size={17} color={colors.textFaint} />
                      </Pressable>
                    ) : null}
                  </Pressable>
                );
              })
            )}
            <View style={{ height: spacing.lg }} />
          </ScrollView>
        ) : (
          <ScrollView style={styles.mediaScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.urlForm}>
              <Input
                label="TITLE"
                value={urlForm.title}
                onChangeText={(value) => setUrlForm((current) => ({ ...current, title: value }))}
                placeholder="Track or film name"
                maxLength={160}
              />
              <Input
                label="ARTIST / PROVIDER"
                value={urlForm.artist}
                onChangeText={(value) => setUrlForm((current) => ({ ...current, artist: value }))}
                placeholder="Optional"
                maxLength={120}
              />
              <Input
                label="HTTPS MEDIA URL"
                value={urlForm.url}
                onChangeText={(value) => setUrlForm((current) => ({ ...current, url: value }))}
                placeholder="https://media.example/stream.m3u8"
                autoCapitalize="none"
                keyboardType="url"
              />
              <View style={styles.typeRow}>
                {['audio', 'video'].map((type) => (
                  <Pressable
                    key={type}
                    onPress={() => setUrlForm((current) => ({ ...current, type }))}
                    style={[styles.typeButton, urlForm.type === type && styles.typeButtonActive]}
                  >
                    <Icon
                      name={type === 'audio' ? 'music' : 'video'}
                      size={15}
                      color={urlForm.type === type ? colors.black : colors.textMuted}
                    />
                    <AppText
                      variant="caption"
                      weight="800"
                      color={urlForm.type === type ? colors.black : colors.textMuted}
                    >
                      {type.toUpperCase()}
                    </AppText>
                  </Pressable>
                ))}
              </View>
              <View>
                <AppText variant="caption" color={colors.textMuted} style={{ marginBottom: 6 }}>
                  DRM (OPTIONAL)
                </AppText>
                <View style={styles.drmChips}>
                  {DRM_OPTIONS.map((option) => (
                    <Pressable
                      key={option.value || 'none'}
                      onPress={() =>
                        setUrlForm((current) => ({
                          ...current,
                          drmScheme: option.value,
                          drmLicenseUrl: option.value ? current.drmLicenseUrl : '',
                        }))
                      }
                      style={[
                        styles.drmChip,
                        urlForm.drmScheme === option.value && styles.drmChipActive,
                      ]}
                    >
                      <AppText
                        variant="micro"
                        color={urlForm.drmScheme === option.value ? colors.black : colors.textMuted}
                      >
                        {option.label.toUpperCase()}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              </View>
              {urlForm.drmScheme ? (
                <Input
                  label="LICENSE URL"
                  value={urlForm.drmLicenseUrl}
                  onChangeText={(value) =>
                    setUrlForm((current) => ({ ...current, drmLicenseUrl: value }))
                  }
                  placeholder="https://provider.example/license"
                  autoCapitalize="none"
                  keyboardType="url"
                  hint="Provided by the content owner. VibeSync never bypasses DRM."
                />
              ) : null}
              {urlForm.drmScheme === 'fairplay' ? (
                <>
                  <Input label="FAIRPLAY CERTIFICATE URL" value={urlForm.drmCertificateUrl}
                    onChangeText={(value) => setUrlForm((current) => ({ ...current, drmCertificateUrl: value }))}
                    autoCapitalize="none" keyboardType="url" placeholder="https://provider.example/certificate" />
                  <Input label="FAIRPLAY CONTENT ID" value={urlForm.drmContentId}
                    onChangeText={(value) => setUrlForm((current) => ({ ...current, drmContentId: value }))}
                    autoCapitalize="none" placeholder="Provided by the licensed provider" />
                </>
              ) : null}
              <AppText variant="caption" color={colors.textMuted}>Widevine requires Android; FairPlay requires iOS and licensed certificate details. PlayReady and ClearKey are unavailable in this player.</AppText>
              <Button
                title="Add to queue"
                icon="plus"
                onPress={submitUrl}
                loading={addingUrl}
                style={{ marginBottom: spacing.lg }}
              />
            </View>
          </ScrollView>
        )}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxl,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    flex: 1,
    marginHorizontal: 4,
  },
  subline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  roomCode: {
    letterSpacing: 1.2,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.orangeSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(253,133,73,0.3)',
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  playerWrap: {
    borderRadius: radius.lg,
  },
  playerBadges: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(241,243,245,0.12)',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.orange,
  },
  liveDotPaused: {
    backgroundColor: colors.textMuted,
  },
  qualityBadge: {    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(241,243,245,0.12)',
  },
  nowPlaying: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  nowEyebrow: {
    letterSpacing: 1.2,
  },
  queueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 11,
    minHeight: 34,
  },
  progressWrap: {
    marginTop: spacing.xs,
  },
  slider: {
    width: '100%',
    height: 34,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -4,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  roundControl: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundControlActive: {
    backgroundColor: colors.offWhite,
  },
  playButton: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButtonIdle: {
    backgroundColor: colors.raised,
  },
  rateButton: {
    minWidth: 44,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.sm,
    paddingLeft: spacing.md,
    marginTop: spacing.lg,
  },
  voiceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButtonActive: {
    backgroundColor: colors.orange,
  },
  askButton: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  askButtonDisabled: {
    opacity: 0.45,
  },
  quickActions: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  quick: {
    flex: 1,
    minHeight: 88,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.sm,
    justifyContent: 'space-between',
  },
  quickIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  peopleCard: {
    marginTop: spacing.xl,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginTop: spacing.md,
    flexWrap: 'wrap',
  },
  member: {
    alignItems: 'center',
    width: 56,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.card,
  },
  memberMic: {
    position: 'absolute',
    top: 30,
    right: 3,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.card,
  },
  memberName: {
    marginTop: 5,
    textAlign: 'center',
  },
  moreMembers: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  chatPreview: {
    marginTop: spacing.lg,
  },
  chatEmpty: {
    marginTop: spacing.sm,
    minHeight: 72,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: spacing.md,
  },
  previewMessages: {
    marginTop: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  previewMessage: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  hostFooter: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  actionSheet: {
    paddingBottom: spacing.md,
  },
  queueTabs: {
    flexDirection: 'row',
    backgroundColor: colors.raised,
    borderRadius: radius.md,
    padding: 4,
    marginBottom: spacing.md,
  },
  queueTab: {
    flex: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  queueTabActive: {
    backgroundColor: colors.offWhite,
  },
  mediaScroll: {
    maxHeight: 460,
  },
  mediaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 58,
  },
  mediaRowActive: {
    backgroundColor: colors.orangeSoft,
    borderColor: 'rgba(253,133,73,0.28)',
  },
  mediaIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueEmpty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
  },
  urlForm: {
    gap: spacing.sm,
  },
  typeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  typeButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.raised,
  },
  typeButtonActive: {
    backgroundColor: colors.offWhite,
    borderColor: colors.offWhite,
  },
  drmChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  drmChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.raised,
  },
  drmChipActive: {
    backgroundColor: colors.offWhite,
    borderColor: colors.offWhite,
  },
  errorCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.orangeSoft,
    borderWidth: 1,
    borderColor: 'rgba(253,133,73,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 320,
  },
});
