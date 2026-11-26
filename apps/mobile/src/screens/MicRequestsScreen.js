import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radius, spacing } from '../theme';
import Screen from '../components/Screen';
import AppText from '../components/AppText';
import Avatar from '../components/Avatar';
import Badge from '../components/Badge';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';
import Header from '../components/Header';
import Icon from '../components/Icon';
import { useToast } from '../components/Toast';
import { useRoom } from '../context/RoomContext';
import { formatRelative } from '../utils/format';
import { apiError } from '../api/client';

export default function MicRequestsScreen({ navigation }) {
  const {
    room,
    isHost,
    speakRequests,
    members,
    refreshSpeakRequests,
    decideSpeak,
    setMemberMic,
    muteAll,
    connected,
  } = useRoom();
  const { showToast } = useToast();
  const [busyId, setBusyId] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [muting, setMuting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!isHost) return;
      refreshSpeakRequests().catch(() => {});
    }, [isHost, refreshSpeakRequests]),
  );

  const speakers = members.filter(
    (member) => member.role !== 'host' && member.permissions?.canSpeak,
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshSpeakRequests();
    } catch (caught) {
      showToast(apiError(caught).message, 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const decide = async (request, decision) => {
    setBusyId(request.id);
    try {
      await decideSpeak(request.id, decision);
      showToast(
        decision === 'approve'
          ? `${request.user?.name || 'Participant'} can speak now`
          : 'Microphone request declined',
        decision === 'approve' ? 'success' : 'default',
      );
    } catch (caught) {
      showToast(apiError(caught).message, 'error');
    } finally {
      setBusyId('');
    }
  };

  const revoke = (member) => {
    Alert.alert(
      `Revoke ${member.user?.name}'s mic?`,
      'They will be muted immediately and notified.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            setBusyId(member.id);
            try {
              await setMemberMic(member.userId, false);
              showToast('Microphone revoked', 'success');
            } catch (caught) {
              showToast(apiError(caught).message, 'error');
            } finally {
              setBusyId('');
            }
          },
        },
      ],
    );
  };

  const confirmMuteAll = () => {
    Alert.alert(
      'Mute every participant?',
      'All current speakers and pending requests will be closed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mute all',
          style: 'destructive',
          onPress: async () => {
            setMuting(true);
            try {
              await muteAll();
              showToast('All participant microphones are muted', 'success');
            } catch (caught) {
              showToast(apiError(caught).message, 'error');
            } finally {
              setMuting(false);
            }
          },
        },
      ],
    );
  };

  if (!room) {
    return (
      <Screen>
        <Header title="Mic requests" />
        <View style={styles.centered}>
          <EmptyState
            icon="mic"
            title="No active room"
            description="Open a room you host to manage microphone access."
            actionLabel="Browse rooms"
            onAction={() => navigation.navigate('Rooms')}
          />
        </View>
      </Screen>
    );
  }

  if (!isHost) {
    return (
      <Screen>
        <Header title="Mic requests" />
        <View style={styles.centered}>
          <EmptyState
            icon="lock"
            title="Hosts only"
            description="Only the host can review microphone requests. Ask for the mic from the room screen."
            actionLabel="Back to room"
            onAction={() => navigation.goBack()}
          />
        </View>
      </Screen>
    );
  }

  const header = (
    <Header
      title="Mic requests"
      subtitle={`${speakRequests.length} pending · ${speakers.length} speaking`}
      right={
        speakers.length || speakRequests.length ? (
          <Pressable
            onPress={confirmMuteAll}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Mute all microphones"
          >
            {muting ? (
              <ActivityIndicator color={colors.orange} size="small" />
            ) : (
              <Icon name="micOff" size={19} color={colors.textMuted} />
            )}
          </Pressable>
        ) : null
      }
    />
  );

  return (
    <Screen header={header} edges={['top']}>
      <FlatList
        data={speakRequests}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.orange}
            colors={[colors.orange]}
          />
        }
        ListHeaderComponent={
          speakers.length ? (
            <View style={styles.speakersSection}>
              <AppText variant="micro" color={colors.textMuted} style={styles.sectionLabel}>
                CURRENTLY SPEAKING
              </AppText>
              <View style={styles.speakersCard}>
                {speakers.map((member, index) => (
                  <View
                    key={member.id}
                    style={[styles.speakerRow, index > 0 && styles.speakerDivider]}
                  >
                    <Avatar
                      name={member.user?.name}
                      color={member.user?.avatarColor}
                      size={38}
                    />
                    <View style={{ flex: 1 }}>
                      <AppText variant="label" weight="700">
                        {member.user?.name}
                      </AppText>
                      <AppText variant="micro" color={colors.yellow}>
                        MIC OPEN
                      </AppText>
                    </View>
                    <Pressable
                      onPress={() => revoke(member)}
                      disabled={busyId === member.id}
                      style={styles.revokeButton}
                      accessibilityRole="button"
                      accessibilityLabel={`Revoke ${member.user?.name}'s microphone`}
                    >
                      {busyId === member.id ? (
                        <ActivityIndicator color={colors.orange} size="small" />
                      ) : (
                        <AppText variant="micro" color={colors.orange}>
                          REVOKE
                        </AppText>
                      )}
                    </Pressable>
                  </View>
                ))}
              </View>
              <AppText variant="micro" color={colors.textMuted} style={styles.requestsLabel}>
                WAITING FOR APPROVAL
              </AppText>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.requestCard}>
            <View style={styles.requestTop}>
              <Avatar name={item.user?.name} color={item.user?.avatarColor} size={46} />
              <View style={styles.requestBody}>
                <View style={styles.nameRow}>
                  <AppText variant="label" weight="800" numberOfLines={1} style={styles.name}>
                    {item.user?.name || 'Participant'}
                  </AppText>
                  <Badge label={formatRelative(item.createdAt).toUpperCase()} tone="neutral" />
                </View>
                <AppText
                  variant="body"
                  color={item.note ? colors.textMuted : colors.textFaint}
                  style={styles.note}
                >
                  {item.note ? `“${item.note}”` : 'No note included.'}
                </AppText>
              </View>
            </View>
            <View style={styles.requestActions}>
              <Button
                title="Decline"
                variant="secondary"
                size="sm"
                onPress={() => decide(item, 'reject')}
                disabled={Boolean(busyId)}
                style={{ flex: 1 }}
              />
              <Button
                title="Approve mic"
                icon="mic"
                size="sm"
                onPress={() => decide(item, 'approve')}
                loading={busyId === item.id}
                disabled={Boolean(busyId)}
                style={{ flex: 1.3 }}
              />
            </View>
          </View>
        )}
        ListEmptyComponent={
          <EmptyState
            icon={speakRequests.length ? 'mic' : 'headphones'}
            title={speakers.length ? 'No pending requests' : 'The room is quiet'}
            description={
              speakers.length
                ? 'Everyone who asked to speak has been reviewed. New requests appear here instantly.'
                : 'When a participant asks for the mic, you can approve or decline them here. Nothing is shared until you approve.'
            }
            actionLabel="Participants"
            onAction={() => navigation.navigate('Participants')}
          />
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <View style={styles.tip}>
              <Icon name="shield" size={16} color={colors.yellow} />
              <AppText variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
                {connected
                  ? 'Approved speakers are notified instantly. Their audio is live only while they keep the mic unmuted.'
                  : 'You are offline. Pending requests will refresh when the live connection returns.'}
              </AppText>
            </View>
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    paddingHorizontal: spacing.lg,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    flexGrow: 1,
  },
  speakersSection: {
    marginBottom: spacing.md,
  },
  sectionLabel: {
    letterSpacing: 1.3,
    marginBottom: spacing.xs,
  },
  requestsLabel: {
    letterSpacing: 1.3,
    marginTop: spacing.lg,
  },
  speakersCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  speakerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  speakerDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  revokeButton: {
    minWidth: 68,
    minHeight: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.orangeSoft,
    borderWidth: 1,
    borderColor: 'rgba(253,133,73,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  requestCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  requestTop: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  requestBody: {
    flex: 1,
    gap: 4,
  },
  nameRow: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  name: {
    flexShrink: 1,
  },
  note: {
    lineHeight: 21,
  },
  requestActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  footer: {
    marginTop: spacing.lg,
  },
  tip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
