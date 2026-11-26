import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radius, spacing } from '../theme';
import Screen from '../components/Screen';
import AppText from '../components/AppText';
import Badge from '../components/Badge';
import Button from '../components/Button';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import Header from '../components/Header';
import Icon from '../components/Icon';
import ListRow from '../components/ListRow';
import SwitchRow from '../components/SwitchRow';
import { useToast } from '../components/Toast';
import { useRoom } from '../context/RoomContext';
import { apiError } from '../api/client';

function Metric({ icon, value, label, tone = 'orange' }) {
  return (
    <View style={styles.metric}>
      <View style={[styles.metricIcon, tone === 'yellow' && styles.metricIconYellow]}>
        <Icon name={icon} size={17} color={tone === 'yellow' ? colors.yellow : colors.orange} />
      </View>
      <AppText variant="section">{value}</AppText>
      <AppText variant="micro" color={colors.textFaint}>
        {label.toUpperCase()}
      </AppText>
    </View>
  );
}

export default function HostControlsScreen({ navigation }) {
  const {
    room,
    members,
    onlineUserIds,
    speakRequests,
    joinRequests,
    isHost,
    playback,
    updateSettings,
    muteAll,
    endRoom,
    refreshSpeakRequests,
    refreshJoinRequests,
    refreshRoom,
  } = useRoom();
  const { showToast } = useToast();
  const [busy, setBusy] = useState('');
  const [ending, setEnding] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!isHost) return;
      Promise.allSettled([refreshSpeakRequests(), refreshJoinRequests(), refreshRoom()]);
    }, [isHost, refreshSpeakRequests, refreshJoinRequests, refreshRoom]),
  );

  const mutedCount = useMemo(
    () => members.filter((member) => member.role === 'host' || !member.permissions?.canSpeak).length,
    [members],
  );

  const run = async (key, action, successMessage) => {
    setBusy(key);
    try {
      await action();
      if (successMessage) showToast(successMessage, 'success');
    } catch (caught) {
      showToast(apiError(caught).message, 'error');
    } finally {
      setBusy('');
    }
  };

  const toggle = (settings, successMessage) =>
    run('settings', () => updateSettings(settings), successMessage);

  const confirmMuteAll = () => {
    Alert.alert(
      'Mute every participant?',
      'All participant microphones will turn off immediately. You stay unmuted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mute all',
          style: 'destructive',
          onPress: () => run('mute', muteAll, 'All participant microphones are muted'),
        },
      ],
    );
  };

  const confirmEnd = () => {
    Alert.alert(
      'End the room?',
      'Playback stops for everyone, live connections close, and the room can no longer be joined.',
      [
        { text: 'Keep hosting', style: 'cancel' },
        {
          text: 'End room',
          style: 'destructive',
          onPress: async () => {
            setEnding(true);
            try {
              await endRoom();
              showToast('Room ended for everyone', 'success');
              navigation.goBack();
            } catch (caught) {
              showToast(apiError(caught).message, 'error');
            } finally {
              setEnding(false);
            }
          },
        },
      ],
    );
  };

  if (!room) {
    return (
      <Screen>
        <Header title="Host controls" />
        <View style={styles.centered}>
          <EmptyState
            icon="shield"
            title="No active room"
            description="Create or join a room you host to access live controls."
            actionLabel="Create a room"
            onAction={() => navigation.navigate('CreateRoom')}
          />
        </View>
      </Screen>
    );
  }

  if (!isHost) {
    return (
      <Screen>
        <Header title="Host controls" />
        <View style={styles.centered}>
          <EmptyState
            icon="lock"
            title="Hosts only"
            description="Only the room host can use these controls. You can still ask for the microphone or chat with the host privately."
            actionLabel="Back to room"
            onAction={() => navigation.goBack()}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
      <Header
        title="Host controls"
        subtitle={`${room.roomId} · ${room.name}`}
        right={<Badge label="HOST" tone="orange" />}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.metrics}>
          <Metric
            icon="mic"
            value={speakRequests.length}
            label="Mic asks"
            tone={speakRequests.length ? 'orange' : 'yellow'}
          />
          <Metric
            icon="users"
            value={joinRequests.length}
            label="Join asks"
            tone={joinRequests.length ? 'orange' : 'yellow'}
          />
          <Metric icon="headphones" value={onlineUserIds.length} label="Listening" tone="yellow" />
          <Metric icon="micOff" value={mutedCount} label="Muted" tone="yellow" />
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <AppText variant="section">Requests</AppText>
            <AppText variant="caption" color={colors.textMuted}>
              Review before people enter or speak
            </AppText>
          </View>
          <Card padded={false}>
            <ListRow
              icon="mic"
              title="Microphone requests"
              subtitle={
                speakRequests.length
                  ? `${speakRequests.length} waiting for your decision`
                  : 'No pending microphone requests'
              }
              onPress={() => navigation.navigate('MicRequests')}
              right={
                speakRequests.length ? (
                  <Badge label={String(speakRequests.length)} tone="orange" />
                ) : undefined
              }
            />
            <View style={styles.divider} />
            <ListRow
              icon="users"
              title="Join requests"
              subtitle={
                joinRequests.length
                  ? `${joinRequests.length} people want to join`
                  : room.joinApproval
                    ? 'Approval is on — no one is waiting'
                    : 'Approval is off; new guests join instantly'
              }
              onPress={() => navigation.navigate('JoinRequests')}
              right={
                joinRequests.length ? (
                  <Badge label={String(joinRequests.length)} tone="orange" />
                ) : undefined
              }
            />
            <View style={styles.divider} />
            <ListRow
              icon="chat"
              title="Private host inbox"
              subtitle="Reply privately to participants"
              onPress={() => navigation.navigate('HostChat')}
            />
          </Card>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <AppText variant="section">Room rules</AppText>
            <AppText variant="caption" color={colors.textMuted}>
              Applied live to everyone
            </AppText>
          </View>
          <Card style={styles.rulesCard}>
            <SwitchRow
              title="Room chat"
              description="Let participants message the whole room."
              value={Boolean(room.allowChat)}
              onValueChange={(value) =>
                toggle(
                  { allowChat: value },
                  value ? 'Room chat is open' : 'Room chat is closed',
                )
              }
              disabled={busy === 'settings'}
            />
            <SwitchRow
              title="Microphone requests"
              description="Allow participants to ask you for the mic."
              value={Boolean(room.allowMicRequests)}
              onValueChange={(value) =>
                toggle(
                  { allowMicRequests: value },
                  value ? 'Mic requests are open' : 'Mic requests are closed',
                )
              }
              disabled={busy === 'settings'}
            />
            <SwitchRow
              title="Approve new guests"
              description="New participants wait for your approval before entering."
              value={Boolean(room.joinApproval)}
              onValueChange={(value) =>
                toggle(
                  { joinApproval: value },
                  value ? 'New guests now require approval' : 'New guests can join instantly',
                )
              }
              disabled={busy === 'settings'}
            />
          </Card>
        </View>

        <View style={styles.section}>
          <AppText variant="section" style={styles.sectionTitle}>
            Safety
          </AppText>
          <Card padded={false}>
            <ListRow
              icon="micOff"
              title="Mute all microphones"
              subtitle="Silence every participant at once"
              onPress={confirmMuteAll}
              disabled={busy === 'mute'}
            />
            <View style={styles.divider} />
            <ListRow
              icon="users"
              title="Manage participants"
              subtitle="Grant chat, remove, or ban members"
              onPress={() => navigation.navigate('Participants')}
            />
            <View style={styles.divider} />
            <ListRow
              icon="settings"
              title="Room settings"
              subtitle="Name, capacity, password, and chat pace"
              onPress={() => navigation.navigate('RoomSettings')}
            />
          </Card>
        </View>

        <Card style={styles.statusCard}>
          <View style={styles.statusRow}>
            <View style={styles.statusDot} />
            <View style={{ flex: 1 }}>
              <AppText variant="label" weight="700">
                {playback?.status === 'playing'
                  ? 'Playback is live'
                  : playback?.status === 'paused'
                    ? 'Playback is paused'
                    : 'Room is open'}
              </AppText>
              <AppText variant="caption" color={colors.textMuted}>
                {room.visibility === 'private' ? 'Private room' : 'Public room'} ·{' '}
                {room.memberCount}/{room.maxParticipants} seats ·{' '}
                {room.mode === 'nearby' ? 'Nearby mode' : 'Online'}
              </AppText>
            </View>
          </View>
          <Pressable
            onPress={() => navigation.navigate('ShareRoom', { roomCode: room.roomId })}
            style={styles.shareRow}
            accessibilityRole="button"
          >
            <Icon name="share" size={15} color={colors.orange} />
            <AppText variant="caption" color={colors.orange} weight="700">
              Invite more listeners
            </AppText>
            <Icon name="chevronRight" size={14} color={colors.orange} />
          </Pressable>
        </Card>

        <View style={styles.danger}>
          <AppText variant="micro" color={colors.textMuted} style={styles.dangerLabel}>
            DANGER ZONE
          </AppText>
          <Button
            title="End room for everyone"
            icon="power"
            variant="danger"
            onPress={confirmEnd}
            loading={ending}
          />
          <AppText variant="caption" color={colors.textFaint} style={styles.dangerHint}>
            Ending is permanent. Participants are disconnected and playback stops on every device.
          </AppText>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  centered: {
    paddingHorizontal: spacing.lg,
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  metric: {
    flex: 1,
    minWidth: 130,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.sm,
    gap: 2,
  },
  metricIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.orangeSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  metricIconYellow: {
    backgroundColor: colors.yellowSoft,
  },
  section: {
    gap: spacing.sm,
  },
  sectionHeader: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionTitle: {
    marginBottom: 0,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  rulesCard: {
    paddingVertical: spacing.xs,
  },
  statusCard: {
    gap: spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.yellow,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  danger: {
    marginTop: spacing.sm,
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(253,133,73,0.25)',
    backgroundColor: 'rgba(253,133,73,0.05)',
  },
  dangerLabel: {
    letterSpacing: 1.3,
  },
  dangerHint: {
    textAlign: 'center',
    lineHeight: 17,
  },
});
