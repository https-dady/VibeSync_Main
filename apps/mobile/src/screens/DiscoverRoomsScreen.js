import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { colors, spacing } from '../theme';
import Screen from '../components/Screen';
import AppText from '../components/AppText';
import EmptyState from '../components/EmptyState';
import Input from '../components/Input';
import RoomCard from '../components/RoomCard';
import SegmentedControl from '../components/SegmentedControl';
import { roomsApi } from '../api/endpoints';
import { apiError } from '../api/client';

export default function DiscoverRoomsScreen({ navigation }) {
  const [rooms, setRooms] = useState([]);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const requestId = useRef(0);
  const appendInFlight = useRef(false);

  const load = useCallback(
    async ({ append = false, nextOffset = 0, silent = false } = {}) => {
      if (append && appendInFlight.current) return;
      if (append) appendInFlight.current = true;
      const id = ++requestId.current;
      if (!silent && !append) setLoading(true);
      if (append) setLoadingMore(true);
      setError('');
      try {
        const params = { limit: 12, offset: nextOffset };
        if (search.trim()) params.search = search.trim();
        if (type !== 'all') params.mediaType = type;
        const result = await roomsApi.list(params);
        if (id !== requestId.current) return;
        setRooms((current) => {
          const next = append ? [...current, ...(result.data || [])] : result.data || [];
          return [...new Map(next.map((item) => [item.id || item.roomId, item])).values()];
        });
        setHasMore(Boolean(result.hasMore));
        setOffset(nextOffset + (result.data?.length || 0));
      } catch (caught) {
        if (id === requestId.current) setError(apiError(caught).message);
      } finally {
        if (id === requestId.current) {
          appendInFlight.current = false;
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    [search, type],
  );

  useEffect(() => {
    requestId.current += 1;
    appendInFlight.current = false;
    setLoadingMore(false);
    const timer = setTimeout(() => load(), 350);
    return () => { clearTimeout(timer); requestId.current += 1; };
  }, [load]);

  const refresh = () => {
    setRefreshing(true);
    load({ silent: true });
  };

  const loadMore = () => {
    if (!hasMore || loading || loadingMore) return;
    load({ append: true, nextOffset: offset, silent: true });
  };

  const header = (
    <View style={styles.headerWrap}>
      <View style={styles.heading}>
        <AppText variant="micro" color={colors.orange} style={styles.eyebrow}>
          PUBLIC ROOMS
        </AppText>
        <AppText variant="title">Find a new vibe</AppText>
        <AppText variant="body" color={colors.textMuted} style={styles.subhead}>
          Join a room already in motion. Listeners sync to the host automatically.
        </AppText>
      </View>
      <Input
        value={search}
        onChangeText={setSearch}
        placeholder="Search rooms, hosts, or codes"
        leftIcon="search"
        autoCapitalize="none"
        returnKeyType="search"
      />
      <SegmentedControl
        value={type}
        onChange={setType}
        options={[
          { value: 'all', label: 'All' },
          { value: 'audio', label: 'Audio', icon: 'music' },
          { value: 'video', label: 'Video', icon: 'video' },
        ]}
        style={{ marginTop: spacing.sm }}
      />
    </View>
  );

  return (
    <Screen contentContainerStyle={styles.content}>
      <FlatList
        data={rooms}
        keyExtractor={(item) => item.id || item.roomId}
        renderItem={({ item }) => (
          <RoomCard
            room={item}
            onPress={() => navigation.navigate('JoinRoom', { roomCode: item.roomId })}
            style={styles.card}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.orange} />
              <AppText variant="caption" color={colors.textMuted}>
                Looking for rooms…
              </AppText>
            </View>
          ) : error ? (
            <EmptyState
              icon="wifiOff"
              title="Couldn't load rooms"
              description={error}
              actionLabel="Try again"
              onAction={() => load()}
            />
          ) : (
            <EmptyState
              icon="rooms"
              title={search ? 'No matches yet' : 'The rooms are quiet'}
              description={
                search
                  ? 'Try a different room name or code.'
                  : 'Be the first to host a public room and start the night.'
              }
              actionLabel="Host a room"
              onAction={() => navigation.navigate('CreateRoom')}
            />
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator color={colors.orange} style={{ marginVertical: spacing.lg }} />
          ) : null
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.orange}
            colors={[colors.orange]}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 0,
    paddingBottom: 0,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 40,
  },
  headerWrap: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  heading: {
    marginBottom: spacing.sm,
  },
  eyebrow: {
    letterSpacing: 1.6,
    marginBottom: spacing.xs,
  },
  subhead: {
    marginTop: spacing.xs,
    maxWidth: 340,
  },
  card: {
    marginBottom: spacing.sm,
  },
  loading: {
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
    gap: spacing.sm,
  },
});
