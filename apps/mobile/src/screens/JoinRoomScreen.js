import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { colors, radius, spacing } from '../theme';
import Screen from '../components/Screen';
import AppText from '../components/AppText';
import Avatar from '../components/Avatar';
import Badge from '../components/Badge';
import Button from '../components/Button';
import Header from '../components/Header';
import Icon from '../components/Icon';
import Input from '../components/Input';
import { useRoom } from '../context/RoomContext';
import { useSocket } from '../context/SocketContext';
import { useToast } from '../components/Toast';
import { roomsApi } from '../api/endpoints';
import { apiError } from '../api/client';
import { getRecentRooms } from '../services/storage';
import { normalizeInviteCode, parseInviteUrl } from '../utils/deepLinks';

export default function JoinRoomScreen({ navigation, route }) {
  const initialCode = route.params?.roomCode || '';
  const { enterRoom, loading, room: activeRoom, joined } = useRoom();
  const { socket } = useSocket();
  const { showToast } = useToast();
  const [code, setCode] = useState(String(initialCode).toUpperCase());
  const [details, setDetails] = useState(null);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [needPassword, setNeedPassword] = useState(false);
  const [pending, setPending] = useState(null);
  const [rejected, setRejected] = useState(false);
  const [looking, setLooking] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [recent, setRecent] = useState([]);
  const [waitingTooLong, setWaitingTooLong] = useState(false);
  const pollRef = useRef(null);
  const mounted = useRef(true);
  const lookupGeneration = useRef(0);
  const finishingRef = useRef(false);

  useEffect(
    () => {
      mounted.current = true;
      return () => {
      mounted.current = false;
      lookupGeneration.current += 1;
      if (pollRef.current) clearInterval(pollRef.current);
      };
    },
    [],
  );

  useEffect(() => {
    getRecentRooms().then(setRecent).catch(() => {});
  }, []);

  const lookUp = useCallback(
    async (rawCode = code) => {
      const normalized = normalizeInviteCode(rawCode) || parseInviteUrl(rawCode)?.roomCode;
      if (!normalized) {
        setError('Use the 7-character room code or paste a valid VibeSync invite link.');
        return;
      }
      const generation = ++lookupGeneration.current;
      setLooking(true);
      setError('');
      setRejected(false);
      try {
        const result = await roomsApi.get(normalized);
        if (!mounted.current || lookupGeneration.current !== generation) return;
        setDetails(result);
        setCode(normalized);
        setPassword('');
        setNeedPassword(Boolean(result.room?.hasPassword));
        if (result.room?.status === 'ended') {
          setError('This room has ended.');
        } else if (result.membership?.status === 'pending') {
          setPending(result);
        }
      } catch (caught) {
        if (!mounted.current || lookupGeneration.current !== generation) return;
        const normalizedError = apiError(caught);
        if (normalizedError.code === 'PRIVATE_ROOM') {
          setDetails({ room: { roomId: normalized, name: 'Private room', visibility: 'private' } });
          setNeedPassword(true);
          setError('This private room requires an invitation and approval.');
        } else {
          setDetails(null);
          setError(normalizedError.message);
        }
      } finally {
        if (mounted.current && lookupGeneration.current === generation) setLooking(false);
      }
    },
    [code],
  );

  useEffect(() => {
    if (initialCode) lookUp(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  const finishJoin = useCallback(
    async (roomCode) => {
      if (finishingRef.current) return;
      finishingRef.current = true;
      try {
        const result = await enterRoom(roomCode);
        if (mounted.current && result.membership?.status === 'active') navigation.replace('Room', { roomCode });
      } catch (caught) {
        const normalized = caught.friendlyMessage || apiError(caught).message;
        setError(normalized);
        showToast(normalized, 'error');
      } finally {
        finishingRef.current = false;
      }
    },
    [enterRoom, navigation, showToast],
  );

  const join = async () => {
    if (joining || loading) return;
    setError('');
    setRejected(false);
    const normalized = normalizeInviteCode(code) || parseInviteUrl(code)?.roomCode;
    if (!details?.room?.roomId) {
      await lookUp(normalized);
      return;
    }
    if (details.room.hasPassword && !password) {
      setNeedPassword(true);
      setError('Enter the room password.');
      return;
    }
    setJoining(true);
    try {
      const result = await enterRoom(normalized, { password, message });
      if (result?.state === 'pending' || result?.membership?.status === 'pending') {
        setPending(result);
        showToast('Join request sent. Waiting for the host.', 'success');
      } else {
        navigation.replace('Room', { roomCode: normalized });
      }
    } catch (caught) {
      const normalizedError = apiError(caught);
      if (normalizedError.code === 'ROOM_PASSWORD_REQUIRED') {
        setNeedPassword(true);
        setError('This room requires a password.');
      } else {
        const text = caught.friendlyMessage || normalizedError.message;
        setError(text);
        showToast(text, 'error');
      }
    } finally {
      setJoining(false);
    }
  };

  useEffect(() => {
    if (!pending) return undefined;
    let polling = false;
    let active = true;
    setWaitingTooLong(false);
    const normalized = String(pending.room?.roomId || code).toUpperCase();

    const onDecision = async (payload) => {
      if (!active) return;
      if (String(payload.roomId).toUpperCase() !== normalized) return;
      if (payload.decision === 'approved') {
        await finishJoin(normalized);
      } else if (payload.decision === 'rejected') {
        setRejected(true);
        setPending(null);
      }
    };
    socket?.on('join:decision', onDecision);
    pollRef.current = setInterval(async () => {
      if (polling || !active) return;
      polling = true;
      try {
        const membership = await roomsApi.myJoinRequest(normalized);
        if (!mounted.current) return;
        if (membership?.status === 'active') {
          clearInterval(pollRef.current);
          await finishJoin(normalized);
        } else if (membership?.status === 'banned' || membership?.status === 'left') {
          clearInterval(pollRef.current);
          setRejected(true);
          setPending(null);
        }
      } catch {
        // Polling is a resilience fallback while the socket reconnects.
      } finally {
        polling = false;
      }
    }, 4000);
    const waitTimer = setTimeout(() => {
      if (!active) return;
      clearInterval(pollRef.current);
      setWaitingTooLong(true);
    }, 90000);
    return () => {
      active = false;
      clearTimeout(waitTimer);
      socket?.off('join:decision', onDecision);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [pending, code, socket, finishJoin]);

  const room = details?.room;
  const alreadyMember = details?.membership?.status === 'active';
  const isCurrentRoom =
    joined && activeRoom && String(activeRoom.roomId) === String(room?.roomId || code);

  if (pending) {
    return (
      <Screen contentContainerStyle={styles.waitContent}>
        <Header title="Join requests" transparent />
        <View style={styles.waiting}>
          <View style={styles.waitPulse}>
            <Icon name="clock" size={28} color={colors.yellow} />
          </View>
          <AppText variant="title" style={{ textAlign: 'center' }}>
            Waiting for the host
          </AppText>
          <AppText variant="body" color={colors.textMuted} style={styles.waitText}>
            Your request to join {pending.room?.name || code} was sent. Keep this screen open —
            you'll enter automatically when approved.
          </AppText>
          {message ? (
            <View style={styles.messageEcho}>
              <AppText variant="micro" color={colors.textFaint}>
                YOUR NOTE
              </AppText>
              <AppText variant="caption" color={colors.textMuted}>
                {message}
              </AppText>
            </View>
          ) : null}
          {waitingTooLong ? (
            <>
              <AppText variant="caption" color={colors.textMuted}>The host has not replied yet. Your request is still saved.</AppText>
              <Button title="Check approval" variant="secondary" onPress={async () => {
                try {
                  const membership = await roomsApi.myJoinRequest(pending.room.roomId);
                  if (membership.status === 'active') await finishJoin(pending.room.roomId);
                  else showToast('Still waiting for the host. You can cancel or check again.', 'default');
                } catch (caught) { showToast(apiError(caught).message, 'error'); }
              }} />
            </>
          ) : <ActivityIndicator color={colors.orange} style={{ marginTop: spacing.lg }} />}
          <Button
            title="Cancel request"
            variant="ghost"
            onPress={async () => {
              try {
                await roomsApi.leave(pending.room?.roomId || code);
                setPending(null);
                navigation.goBack();
              } catch (caught) { showToast(apiError(caught).message, 'error'); }
            }}
            style={{ marginTop: spacing.md }}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll keyboardAvoiding contentContainerStyle={styles.content}>
      <Header title="Join a room" transparent />
      <View style={styles.heading}>
        <AppText variant="micro" color={colors.orange} style={styles.eyebrow}>
          ENTER THE ROOM
        </AppText>
        <AppText variant="title">Where are we headed?</AppText>
        <AppText variant="body" color={colors.textMuted} style={styles.subhead}>
          Type the code your host shared. If it's a private room, the host will approve you.
        </AppText>
      </View>

      <View style={styles.codeRow}>
        <Input
          label="ROOM CODE"
          value={code}
          onChangeText={(value) => {
            lookupGeneration.current += 1;
            setLooking(false);
            setCode(parseInviteUrl(value)?.roomCode || value.toUpperCase());
            setDetails(null);
            setError('');
            setNeedPassword(false);
          }}
          placeholder="ABC2345"
          autoCapitalize="characters"
          maxLength={256}
          leftIcon="qr"
          returnKeyType="search"
          onSubmitEditing={() => lookUp()}
          inputStyle={styles.codeInput}
          style={{ flex: 1 }}
        />
        <Button
          title="Find"
          variant="secondary"
          size="sm"
          onPress={() => lookUp()}
          loading={looking}
          style={{ marginTop: 22 }}
        />
      </View>

      {error && !needPassword ? (
        <View style={styles.error}>
          <Icon name="wifiOff" size={16} color={colors.orange} />
          <AppText variant="caption" color={colors.orange} style={{ flex: 1 }}>
            {error}
          </AppText>
        </View>
      ) : null}

      {rejected ? (
        <View style={styles.error}>
          <Icon name="close" size={16} color={colors.orange} />
          <AppText variant="caption" color={colors.orange} style={{ flex: 1 }}>
            The host did not approve this request. You can try another room.
          </AppText>
        </View>
      ) : null}

      {room ? (
        <View style={styles.preview}>
          <View style={styles.previewTop}>
            <View style={styles.previewIcon}>
              <Icon
                name={room.mediaType === 'audio' ? 'music' : room.mediaType === 'video' ? 'video' : 'rooms'}
                size={22}
                color={colors.orange}
              />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="section" numberOfLines={1}>
                {room.name}
              </AppText>
              <AppText variant="caption" color={colors.textMuted}>
                {room.roomId}
                {room.memberCount != null
                  ? ` · ${room.memberCount}/${room.maxParticipants} listeners`
                  : ''}
              </AppText>
            </View>
            {room.hasPassword ? <Icon name="lock" size={17} color={colors.yellow} /> : null}
          </View>
          {room.description ? (
            <AppText variant="body" color={colors.textMuted}>
              {room.description}
            </AppText>
          ) : null}
          <View style={styles.previewMeta}>
            {room.host ? (
              <View style={styles.host}>
                <Avatar name={room.host.name} color={room.host.avatarColor} size={26} />
                <AppText variant="caption" color={colors.textMuted}>
                  Hosted by {room.host.name}
                </AppText>
              </View>
            ) : null}
            <View style={styles.badges}>
              <Badge
                label={room.visibility === 'private' ? 'PRIVATE' : 'PUBLIC'}
                tone={room.visibility === 'private' ? 'yellow' : 'neutral'}
              />
              {room.mode === 'nearby' ? <Badge label="NEARBY" tone="yellow" /> : null}
            </View>
          </View>

          {(needPassword || room.hasPassword) && !alreadyMember ? (
            <Input
              label="ROOM PASSWORD"
              value={password}
              onChangeText={setPassword}
              placeholder="Enter the host's password"
              secureTextEntry
              leftIcon="lock"
            />
          ) : null}

          {room.joinApproval || room.visibility === 'private' ? (
            <Input
              label="NOTE TO HOST (OPTIONAL)"
              value={message}
              onChangeText={setMessage}
              placeholder="Let them know who you are"
              maxLength={200}
            />
          ) : null}

          {room.visibility === 'private' && !room.host ? (
            <AppText variant="caption" color={colors.textMuted}>
              Private rooms reveal details only after the host approves you.
            </AppText>
          ) : null}

          {error && needPassword ? (
            <AppText variant="caption" color={colors.orange}>
              {error}
            </AppText>
          ) : null}

          <Button
            title={
              alreadyMember && isCurrentRoom
                ? 'Resume room'
                : alreadyMember
                  ? 'Rejoin room'
                  : room.joinApproval || room.visibility === 'private'
                    ? 'Request to join'
                    : 'Join room'
            }
            icon="arrowRight"
            onPress={() => {
              if (alreadyMember) {
                finishJoin(room.roomId || code);
              } else {
                join();
              }
            }}
            loading={joining || loading}
            disabled={room.status === 'ended'}
          />
          {room.status === 'ended' ? (
            <AppText variant="caption" color={colors.orange} style={{ textAlign: 'center' }}>
              This room has ended.
            </AppText>
          ) : null}
        </View>
      ) : null}

      {!details && recent.length > 0 ? (
        <View style={styles.recentSection}>
          <AppText variant="micro" color={colors.textMuted}>
            RECENT ROOMS
          </AppText>
          <View style={styles.recentList}>
            {recent.map((item) => (
              <Pressable
                key={item.roomId}
                style={styles.recentRow}
                accessibilityRole="button"
                onPress={() => {
                  setCode(item.roomId);
                  lookUp(item.roomId);
                }}
              >
                <View style={styles.recentIcon}>
                  <Icon name="clock" size={15} color={colors.textMuted} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="label" numberOfLines={1}>
                    {item.name}
                  </AppText>
                  <AppText variant="caption" color={colors.textMuted}>
                    {item.roomId}
                  </AppText>
                </View>
                <Icon name="chevronRight" size={15} color={colors.textFaint} />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.tip}>
        <Icon name="qr" size={16} color={colors.yellow} />
        <AppText variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
          Have a VibeSync link? Opening it on this device takes you straight here with the code
          filled in.
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.xxl,
  },
  heading: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  eyebrow: {
    letterSpacing: 1.6,
    marginBottom: spacing.xs,
  },
  subhead: {
    marginTop: spacing.xs,
    maxWidth: 340,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  codeInput: {
    letterSpacing: 3,
    fontWeight: '800',
  },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.orangeSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(253,133,73,0.28)',
    padding: spacing.sm,
    marginTop: spacing.md,
  },
  preview: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  previewTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  previewIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.orangeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  host: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 1,
  },
  badges: {
    flexDirection: 'row',
    gap: 5,
  },
  recentSection: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  recentList: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  recentIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.xl,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  waitContent: {
    paddingBottom: spacing.xxl,
  },
  waiting: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  waitPulse: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: 'rgba(255,193,35,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  waitText: {
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 320,
  },
  messageEcho: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'stretch',
  },
});
