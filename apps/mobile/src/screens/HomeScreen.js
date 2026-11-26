import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import Icon from '../components/Icon';
import Logo from '../components/Logo';
import RoomCard from '../components/RoomCard';
import ResponsiveRow from '../components/ResponsiveRow';
import { useAuth } from '../context/AuthContext';
import { useRoom } from '../context/RoomContext';
import { useSocket } from '../context/SocketContext';
import { roomsApi } from '../api/endpoints';
import { getRecentRooms } from '../services/storage';
import { apiError } from '../api/client';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen({ navigation }) {
  const { user } = useAuth();
  const { room, joined, isHost } = useRoom();
  const { socket } = useSocket();
  const [rooms, setRooms] = useState([]);
  const [recent, setRecent] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const [roomResult, notificationResult, recentRooms] = await Promise.all([
        roomsApi.list({ limit: 4, mode: 'online' }),
        roomsApi.notifications(),
        getRecentRooms(),
      ]);
      setRooms(roomResult.data || []);
      setUnread(notificationResult.unreadCount || 0);
      setRecent(recentRooms);
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
      getRecentRooms().then(setRecent).catch(() => {});
    }, [load]),
  );

  useEffect(() => {
    if (!socket) return undefined;
    const onNotification = () => setUnread((value) => value + 1);
    socket.on('notification', onNotification);
    return () => socket.off('notification', onNotification);
  }, [socket]);

  const refresh = () => {
    setRefreshing(true);
    load({ silent: true });
  };

  const openRoom = (item) => {
    navigation.navigate('JoinRoom', { roomCode: item.roomId });
  };

  return (
    <Screen
      scroll
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor={colors.orange}
          colors={[colors.orange]}
        />
      }
    >
      <View style={styles.topBar}>
        <Pressable
          onPress={() => navigation.navigate('Profile')}
          accessibilityLabel="Open profile"
          accessibilityRole="button"
        >
          <Avatar name={user?.name} color={user?.avatarColor} size={42} ring />
        </Pressable>
        <Logo size={34} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Notifications${unread ? `, ${unread} unread` : ''}`}
          onPress={() => navigation.navigate('Notifications')}
          style={styles.notificationButton}
        >
          <Icon name="chat" size={19} color={colors.offWhite} />
          {unread > 0 ? (
            <View style={styles.unread}>
              <AppText variant="micro" color={colors.black} style={styles.unreadText}>
                {unread > 9 ? '9+' : unread}
              </AppText>
            </View>
          ) : null}
        </Pressable>
      </View>

      <View style={styles.greeting}>
        <AppText variant="micro" color={colors.orange} style={styles.eyebrow}>
          {greeting().toUpperCase()}
        </AppText>
        <AppText variant="title">
          {user?.name?.split(' ')[0] || 'Friend'}, what's the vibe?
        </AppText>
        <AppText variant="body" color={colors.textMuted} style={styles.greetingBody}>
          Start a synchronized room or drop into one that's already playing.
        </AppText>
      </View>

      {joined && room ? (
        <Pressable
          onPress={() => navigation.navigate('Room', { roomCode: room.roomId })}
          style={styles.resume}
          accessibilityRole="button"
          accessibilityLabel={`Resume ${room.name}`}
        >
          <View style={styles.resumeIcon}>
            <Icon name="headphones" size={20} color={colors.black} />
          </View>
          <View style={styles.resumeBody}>
            <AppText variant="micro" color={colors.black} style={styles.resumeEyebrow}>
              LIVE SESSION
            </AppText>
            <AppText variant="label" weight="800" color={colors.black} numberOfLines={1}>
              {room.name}
            </AppText>
          </View>
          <View style={styles.resumeAction}>
            <AppText variant="micro" color={colors.black} weight="800">
              {isHost ? 'HOSTING' : 'RESUME'}
            </AppText>
            <Icon name="arrowRight" size={15} color={colors.black} />
          </View>
        </Pressable>
      ) : null}

      <ResponsiveRow style={styles.actions}>
        <Pressable
          style={[styles.action, styles.actionPrimary]}
          onPress={() => navigation.navigate('CreateRoom')}
          accessibilityRole="button"
        >
          <View style={styles.actionIcon}>
            <Icon name="plus" size={21} color={colors.black} />
          </View>
          <AppText variant="label" weight="800" color={colors.black}>
            Host a room
          </AppText>
          <AppText variant="caption" color="rgba(0,0,0,0.58)">
            Pick media and invite friends
          </AppText>
        </Pressable>
        <Pressable
          style={styles.action}
          onPress={() => navigation.navigate('JoinRoom')}
          accessibilityRole="button"
        >
          <View style={[styles.actionIcon, styles.actionIconDark]}>
            <Icon name="qr" size={21} color={colors.yellow} />
          </View>
          <AppText variant="label" weight="800">
            Join with code
          </AppText>
          <AppText variant="caption" color={colors.textMuted}>
            Open an invite or type a room code
          </AppText>
        </Pressable>
      </ResponsiveRow>

      {recent.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <AppText variant="section">Jump back in</AppText>
            <Badge label={`${recent.length} RECENT`} />
          </View>
          <View style={styles.recentList}>
            {recent.slice(0, 3).map((item) => (
              <Pressable
                key={item.roomId}
                onPress={() => openRoom(item)}
                style={styles.recentRow}
                accessibilityRole="button"
              >
                <View style={styles.recentIcon}>
                  <Icon
                    name={item.mediaType === 'audio' ? 'music' : 'video'}
                    size={16}
                    color={colors.orange}
                  />
                </View>
                <View style={styles.recentBody}>
                  <AppText variant="label" numberOfLines={1}>
                    {item.name}
                  </AppText>
                  <AppText variant="caption" color={colors.textMuted}>
                    {item.roomId} · {item.role === 'host' ? 'Hosted by you' : 'You joined'}
                  </AppText>
                </View>
                <Icon name="chevronRight" size={16} color={colors.textFaint} />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View>
            <AppText variant="section">Live right now</AppText>
            <AppText variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
              Public rooms you can join
            </AppText>
          </View>
          <Pressable onPress={() => navigation.navigate('Rooms')} hitSlop={10}>
            <AppText variant="caption" color={colors.orange} weight="800">
              SEE ALL
            </AppText>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.orange} />
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            <Icon name="wifiOff" size={18} color={colors.orange} />
            <AppText variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
              {error}
            </AppText>
            <Button title="Retry" size="sm" variant="secondary" onPress={() => load()} />
          </View>
        ) : rooms.length === 0 ? (
          <View style={styles.emptyCard}>
            <Icon name="spark" size={20} color={colors.yellow} />
            <AppText variant="body" color={colors.textMuted} style={{ flex: 1 }}>
              No public rooms are live yet. Host the first one.
            </AppText>
            <Button
              title="Create"
              size="sm"
              variant="secondary"
              onPress={() => navigation.navigate('CreateRoom')}
            />
          </View>
        ) : (
          <View style={styles.roomList}>
            {rooms.map((item) => (
              <RoomCard key={item.id || item.roomId} room={item} onPress={() => openRoom(item)} />
            ))}
          </View>
        )}
      </View>

      <View style={styles.nearbyBanner}>
        <View style={styles.nearbyIcon}>
          <Icon name="bluetooth" size={20} color={colors.yellow} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="label" weight="700">
            No signal? Go nearby.
          </AppText>
          <AppText variant="caption" color={colors.textMuted}>
            Discover rooms on your local network without using mobile data.
          </AppText>
        </View>
        <Pressable
          onPress={() => navigation.navigate('Nearby')}
          accessibilityRole="button"
          accessibilityLabel="Open nearby mode"
          style={styles.nearbyArrow}
        >
          <Icon name="arrowRight" size={17} color={colors.offWhite} />
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.xs,
    paddingBottom: 32,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  notificationButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unread: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  unreadText: {
    fontSize: 8,
    lineHeight: 10,
    letterSpacing: 0,
  },
  greeting: {
    marginBottom: spacing.lg,
  },
  eyebrow: {
    letterSpacing: 1.6,
    marginBottom: spacing.xs,
  },
  greetingBody: {
    marginTop: spacing.xs,
    maxWidth: 340,
  },
  resume: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.xl,
    backgroundColor: colors.yellow,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  resumeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resumeBody: {
    flex: 1,
  },
  resumeEyebrow: {
    letterSpacing: 1.2,
    opacity: 0.65,
  },
  resumeAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  action: {
    flex: 1,
    minHeight: 148,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  actionPrimary: {
    backgroundColor: colors.orange,
    borderColor: colors.orange,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  actionIconDark: {
    backgroundColor: colors.yellowSoft,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  roomList: {
    gap: spacing.sm,
  },
  recentList: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
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
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.orangeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentBody: {
    flex: 1,
  },
  loading: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(253,133,73,0.28)',
    backgroundColor: colors.orangeSoft,
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  nearbyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  nearbyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.yellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nearbyArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
