import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import Badge from '../components/Badge';
import EmptyState from '../components/EmptyState';
import Header from '../components/Header';
import Icon from '../components/Icon';
import { useToast } from '../components/Toast';
import { useSocket } from '../context/SocketContext';
import { useRoom } from '../context/RoomContext';
import { roomsApi } from '../api/endpoints';
import { apiError } from '../api/client';
import { formatRelative } from '../utils/format';

const TYPE_META = {
  join_request: { icon: 'users', label: 'Join request', tone: 'orange' },
  join_decision: { icon: 'check', label: 'Join update', tone: 'yellow' },
  speak_request: { icon: 'mic', label: 'Microphone', tone: 'yellow' },
  room_ended: { icon: 'power', label: 'Room ended', tone: 'neutral' },
  system: { icon: 'spark', label: 'VibeSync', tone: 'neutral' },
};

export default function NotificationsScreen({ navigation }) {
  const { socket } = useSocket();
  const { room, isHost } = useRoom();
  const { showToast } = useToast();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const result = await roomsApi.notifications();
      setItems(result.data || []);
      setUnread(result.unreadCount || 0);
    } catch (caught) {
      setError(apiError(caught).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (!socket) return undefined;
    const onNotification = (payload) => {
      const notification = payload?.notification;
      if (!notification) return;
      setItems((current) => [
        notification,
        ...current.filter((item) => item.id !== notification.id),
      ]);
      if (!notification.readAt) setUnread((value) => value + 1);
    };
    socket.on('notification', onNotification);
    return () => socket.off('notification', onNotification);
  }, [socket]);

  const refresh = () => {
    setRefreshing(true);
    load({ silent: true });
  };

  const markAll = async () => {
    try {
      await roomsApi.readAllNotifications();
      setItems((current) =>
        current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })),
      );
      setUnread(0);
      showToast('All notifications marked as read', 'success');
    } catch (caught) {
      showToast(apiError(caught).message, 'error');
    }
  };

  const open = async (notification) => {
    if (!notification.readAt) {
      try {
        await roomsApi.readNotification(notification.id);
        setItems((current) => current.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item));
        setUnread((value) => Math.max(0, value - 1));
      } catch (caught) {
        showToast(apiError(caught).message, 'error');
      }
    }
    const roomCode = notification.data?.roomId;
    if (!roomCode) return;
    if (
      room &&
      isHost &&
      String(room.roomId).toUpperCase() === String(roomCode).toUpperCase()
    ) {
      if (notification.type === 'join_request') {
        navigation.navigate('JoinRequests');
        return;
      }
      if (notification.type === 'speak_request') {
        navigation.navigate('MicRequests');
        return;
      }
    }
    navigation.navigate('JoinRoom', { roomCode });
  };

  const header = (
    <Header
      title="Notifications"
      subtitle={
        unread ? `${unread} unread update${unread === 1 ? '' : 's'}` : 'You are all caught up'
      }
      right={
        unread > 0 ? (
          <Pressable onPress={markAll} hitSlop={10} accessibilityRole="button">
            <AppText variant="micro" color={colors.orange}>
              MARK ALL
            </AppText>
          </Pressable>
        ) : (
          <Icon name="spark" size={18} color={colors.textMuted} />
        )
      }
    />
  );

  return (
    <Screen header={header} edges={['top']}>
      {loading && !items.length ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.orange} />
          <AppText variant="caption" color={colors.textMuted}>
            Checking for updates…
          </AppText>
        </View>
      ) : (
        <FlatList
          data={items}
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
          renderItem={({ item }) => {
            const meta = TYPE_META[item.type] || TYPE_META.system;
            const unreadItem = !item.readAt;
            return (
              <Pressable
                onPress={() => open(item)}
                style={({ pressed }) => [
                  styles.row,
                  unreadItem && styles.unreadRow,
                  pressed && { opacity: 0.84 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}${unreadItem ? ', unread' : ''}`}
              >
                <View
                  style={[
                    styles.icon,
                    meta.tone === 'orange' && styles.iconOrange,
                    meta.tone === 'yellow' && styles.iconYellow,
                  ]}
                >
                  <Icon
                    name={meta.icon}
                    size={18}
                    color={meta.tone === 'orange' ? colors.orange : colors.yellow}
                  />
                </View>
                <View style={styles.body}>
                  <View style={styles.top}>
                    <AppText
                      variant="label"
                      weight={unreadItem ? '800' : '600'}
                      numberOfLines={1}
                      style={styles.title}
                    >
                      {item.title}
                    </AppText>
                    <AppText variant="micro" color={colors.textFaint}>
                      {formatRelative(item.createdAt).toUpperCase()}
                    </AppText>
                  </View>
                  {item.body ? (
                    <AppText
                      variant="caption"
                      color={colors.textMuted}
                      numberOfLines={2}
                      style={styles.bodyText}
                    >
                      {item.body}
                    </AppText>
                  ) : null}
                  <View style={styles.footer}>
                    <Badge label={meta.label.toUpperCase()} tone={unreadItem ? 'orange' : 'neutral'} />
                    {item.data?.roomId ? (
                      <AppText variant="micro" color={colors.textFaint}>
                        {item.data.roomId}
                      </AppText>
                    ) : null}
                  </View>
                </View>
                {unreadItem ? <View style={styles.unreadDot} /> : null}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            error ? (
              <EmptyState
                icon="wifiOff"
                title="Couldn't load notifications"
                description={error}
                actionLabel="Try again"
                onAction={() => load()}
              />
            ) : (
              <EmptyState
                icon="spark"
                title="Nothing new"
                description="Join requests, microphone decisions, and room updates will appear here."
                actionLabel="Back home"
                onAction={() => navigation.navigate('Home')}
              />
            )
          }
          ListFooterComponent={
            items.length ? (
              <View style={styles.footerNote}>
                <Icon name="clock" size={15} color={colors.textFaint} />
                <AppText variant="caption" color={colors.textFaint} style={{ flex: 1 }}>
                  Tap a notification to open the related room or request. Notifications are kept
                  for your account only.
                </AppText>
              </View>
            ) : null
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    marginBottom: spacing.sm,
  },
  unreadRow: {
    borderColor: 'rgba(253,133,73,0.3)',
    backgroundColor: 'rgba(253,133,73,0.055)',
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.offWhiteSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconOrange: {
    backgroundColor: colors.orangeSoft,
  },
  iconYellow: {
    backgroundColor: colors.yellowSoft,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  top: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  title: {
    flexShrink: 1,
  },
  bodyText: {
    lineHeight: 19,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.orange,
    marginTop: 7,
  },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
});
