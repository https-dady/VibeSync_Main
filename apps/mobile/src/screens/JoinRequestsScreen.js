import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
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
import { useToast } from '../components/Toast';
import { useRoom } from '../context/RoomContext';
import { formatRelative } from '../utils/format';
import { apiError } from '../api/client';

export default function JoinRequestsScreen({ navigation }) {
  const {
    room,
    isHost,
    joinRequests,
    members,
    refreshJoinRequests,
    decideJoin,
    connected,
  } = useRoom();
  const { showToast } = useToast();
  const [busyId, setBusyId] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!isHost) return;
      refreshJoinRequests().catch(() => {});
    }, [isHost, refreshJoinRequests]),
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshJoinRequests();
    } catch (caught) {
      showToast(apiError(caught).message, 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const decide = async (request, decision, ban = false) => {
    setBusyId(request.id);
    try {
      await decideJoin(request.id, decision, ban);
      showToast(
        decision === 'approve'
          ? `${request.user?.name || 'Guest'} joined the room`
          : ban
            ? 'Request declined and guest banned'
            : 'Join request declined',
        decision === 'approve' ? 'success' : 'default',
      );
    } catch (caught) {
      showToast(apiError(caught).message, 'error');
    } finally {
      setBusyId('');
    }
  };

  const decline = (request) => {
    Alert.alert(
      `Decline ${request.user?.name || 'this guest'}?`,
      'You can let them ask again later or stop them from requesting this room.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline & ban',
          style: 'destructive',
          onPress: () => decide(request, 'reject', true),
        },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: () => decide(request, 'reject', false),
        },
      ],
    );
  };

  if (!room) {
    return (
      <Screen>
        <Header title="Join requests" />
        <View style={styles.centered}>
          <EmptyState
            icon="users"
            title="No active room"
            description="Open a room you host to review guests waiting to enter."
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
        <Header title="Join requests" />
        <View style={styles.centered}>
          <EmptyState
            icon="lock"
            title="Hosts only"
            description="Only the host reviews join requests for this room."
            actionLabel="Back to room"
            onAction={() => navigation.goBack()}
          />
        </View>
      </Screen>
    );
  }

  const header = (
    <Header
      title="Join requests"
      subtitle={`${joinRequests.length} waiting · ${members.length}/${room.maxParticipants} seats`}
      right={<Badge label={`${room.memberCount}/${room.maxParticipants}`} tone="neutral" />}
    />
  );

  return (
    <Screen header={header} edges={['top']}>
      <FlatList
        data={joinRequests}
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
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.top}>
              <Avatar name={item.user?.name} color={item.user?.avatarColor} size={48} />
              <View style={styles.body}>
                <View style={styles.nameRow}>
                  <AppText variant="label" weight="800" numberOfLines={1} style={styles.name}>
                    {item.user?.name || 'Guest'}
                  </AppText>
                  <Badge label={formatRelative(item.joinedAt || item.createdAt).toUpperCase()} />
                </View>
                <AppText
                  variant="body"
                  color={item.joinRequestMessage ? colors.textMuted : colors.textFaint}
                  style={styles.message}
                >
                  {item.joinRequestMessage
                    ? `“${item.joinRequestMessage}”`
                    : 'No message included with this request.'}
                </AppText>
              </View>
            </View>
            <View style={styles.meta}>
              <View style={styles.metaItem}>
                <View style={styles.dot} />
                <AppText variant="micro" color={colors.textFaint}>
                  WANTS TO JOIN
                </AppText>
              </View>
              {room.hasPassword ? (
                <AppText variant="micro" color={colors.textFaint}>
                  PASSWORD CHECK PASSED
                </AppText>
              ) : null}
            </View>
            <View style={styles.actions}>
              <Button
                title="Decline"
                variant="secondary"
                size="sm"
                onPress={() => decline(item)}
                disabled={Boolean(busyId)}
                style={{ flex: 1 }}
              />
              <Button
                title="Let in"
                icon="check"
                size="sm"
                onPress={() => decide(item, 'approve')}
                loading={busyId === item.id}
                disabled={Boolean(busyId)}
                style={{ flex: 1.15 }}
              />
            </View>
          </View>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="users"
            title="No one is waiting"
            description={
              room.joinApproval
                ? 'New guests will appear here for your approval before they enter the room.'
                : 'Join approval is off, so new guests enter immediately. Turn it on in room settings to review guests first.'
            }
            actionLabel="Room settings"
            onAction={() => navigation.navigate('RoomSettings')}
          />
        }
        ListFooterComponent={
          <View style={styles.tip}>
            <AppText variant="caption" color={colors.textMuted} style={styles.tipText}>
              {connected
                ? 'Approved guests join immediately. Declining keeps them out; banning also blocks future requests.'
                : 'You are offline. Requests refresh when the live connection returns.'}
            </AppText>
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
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  body: {
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
  message: {
    lineHeight: 21,
  },
  meta: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.orange,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tip: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  tipText: {
    lineHeight: 18,
  },
});
