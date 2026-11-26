import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  SectionList,
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
import Sheet from '../components/Sheet';
import SwitchRow from '../components/SwitchRow';
import { useToast } from '../components/Toast';
import { useRoom } from '../context/RoomContext';
import { formatRelative } from '../utils/format';
import { apiError } from '../api/client';

function MemberBadge({ member, online }) {
  if (member.role === 'host') return <Badge label="HOST" tone="orange" />;
  if (member.permissions?.canSpeak) return <Badge label="MIC ON" tone="yellow" />;
  if (member.permissions?.micRequested) return <Badge label="REQUESTED" tone="neutral" />;
  if (!online) return <Badge label="OFFLINE" tone="neutral" />;
  return null;
}

export default function ParticipantsScreen({ navigation }) {
  const {
    room,
    membership,
    members,
    onlineUserIds,
    isHost,
    connected,
    refreshRoom,
    setMemberPermissions,
    setMemberMic,
    muteAll,
    removeMember,
  } = useRoom();
  const { showToast } = useToast();
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshRoom().catch(() => {});
    }, [refreshRoom]),
  );

  const onlineSet = useMemo(() => new Set(onlineUserIds.map(String)), [onlineUserIds]);

  const sections = useMemo(() => {
    const withOnline = members.map((member) => ({
      ...member,
      online: onlineSet.has(String(member.userId)),
    }));
    const hosts = withOnline.filter((member) => member.role === 'host');
    const online = withOnline
      .filter((member) => member.role !== 'host' && member.online)
      .sort((a, b) => {
        if (Boolean(a.permissions?.canSpeak) !== Boolean(b.permissions?.canSpeak)) {
          return a.permissions?.canSpeak ? -1 : 1;
        }
        return (a.user?.name || '').localeCompare(b.user?.name || '');
      });
    const offline = withOnline
      .filter((member) => member.role !== 'host' && !member.online)
      .sort((a, b) => (a.user?.name || '').localeCompare(b.user?.name || ''));
    return [
      { title: 'Host', data: hosts },
      { title: `Online · ${online.length}`, data: online },
      ...(offline.length ? [{ title: `Offline · ${offline.length}`, data: offline }] : []),
    ].filter((section) => section.data.length);
  }, [members, onlineSet]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshRoom();
    } catch (caught) {
      showToast(apiError(caught).message, 'error');
    } finally {
      setRefreshing(false);
    }
  };

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

  const toggleChat = (member) => {
    const next = !member.permissions?.canChat;
    run(
      'chat',
      () => setMemberPermissions(member.id, { canChat: next }),
      next ? `Chat enabled for ${member.user?.name}` : `Chat disabled for ${member.user?.name}`,
    );
  };

  const toggleMic = (member) => {
    const next = !member.permissions?.canSpeak;
    if (!next) {
      Alert.alert(
        `Revoke ${member.user?.name}'s microphone?`,
        'They will be muted immediately and notified.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Revoke',
            style: 'destructive',
            onPress: () =>
              run(
                'mic',
                () => setMemberMic(member.userId, false),
                'Microphone revoked',
              ),
          },
        ],
      );
      return;
    }
    run(
      'mic',
      () => setMemberMic(member.userId, true),
      `${member.user?.name} can speak now`,
    );
  };

  const confirmRemove = (member, ban) => {
    Alert.alert(
      ban ? `Ban ${member.user?.name}?` : `Remove ${member.user?.name}?`,
      ban
        ? 'They will be removed now and cannot rejoin this room.'
        : 'They will be removed from the room but may request to join again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: ban ? 'Ban member' : 'Remove',
          style: 'destructive',
          onPress: () =>
            run(
              'remove',
              () => removeMember(member.id, ban),
              ban ? 'Member banned' : 'Member removed',
            ).then(() => setSelected(null)),
        },
      ],
    );
  };

  const confirmMuteAll = () => {
    Alert.alert(
      'Mute every participant?',
      'All microphones will be disabled. Participants can request the mic again when requests are enabled.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mute all',
          style: 'destructive',
          onPress: () => run('muteAll', muteAll, 'All participant microphones are muted'),
        },
      ],
    );
  };

  const header = (
    <Header
      title="Participants"
      subtitle={room ? `${members.length} members · ${onlineUserIds.length} online` : ''}
      right={
        isHost && members.length > 1 ? (
          <Pressable
            onPress={confirmMuteAll}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Mute all participants"
          >
            <Icon name="micOff" size={19} color={colors.textMuted} />
          </Pressable>
        ) : null
      }
    />
  );

  return (
    <Screen header={header} edges={['top']}>
      {!room ? (
        <View style={styles.centered}>
          <EmptyState
            icon="users"
            title="No active room"
            description="Join a room to see who is listening with you."
            actionLabel="Browse rooms"
            onAction={() => navigation.navigate('Rooms')}
          />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={colors.orange}
              colors={[colors.orange]}
            />
          }
          renderSectionHeader={({ section }) => (
            <AppText variant="micro" color={colors.textMuted} style={styles.sectionLabel}>
              {section.title.toUpperCase()}
            </AppText>
          )}
          renderItem={({ item }) => {
            const isMe = String(item.userId) === String(membership?.userId);
            const canManage = isHost && !isMe && item.role !== 'host';
            return (
              <Pressable
                onPress={() => canManage && setSelected(item)}
                disabled={!canManage}
                accessibilityRole={canManage ? 'button' : undefined}
                accessibilityLabel={
                  canManage ? `Manage ${item.user?.name || 'participant'}` : undefined
                }
                style={({ pressed }) => [
                  styles.row,
                  item.online && styles.rowOnline,
                  pressed && { opacity: 0.82 },
                ]}
              >
                <View>
                  <Avatar name={item.user?.name} color={item.user?.avatarColor} size={46} />
                  <View
                    style={[
                      styles.presence,
                      { backgroundColor: item.online ? colors.yellow : colors.textFaint },
                    ]}
                  />
                </View>
                <View style={styles.body}>
                  <View style={styles.nameRow}>
                    <AppText variant="label" weight="700" numberOfLines={1} style={styles.name}>
                      {item.user?.name || 'Member'}
                      {isMe ? ' (you)' : ''}
                    </AppText>
                    <MemberBadge member={item} online={item.online} />
                  </View>
                  <View style={styles.metaRow}>
                    <Icon
                      name={item.permissions?.canChat ? 'chat' : 'lock'}
                      size={11}
                      color={colors.textFaint}
                    />
                    <AppText variant="micro" color={colors.textFaint}>
                      {item.permissions?.canChat ? 'CHAT ON' : 'CHAT OFF'}
                    </AppText>
                    <AppText variant="micro" color={colors.textFaint}>
                      ·
                    </AppText>
                    <AppText variant="micro" color={colors.textFaint}>
                      JOINED {formatRelative(item.joinedAt).toUpperCase()}
                    </AppText>
                  </View>
                </View>
                {canManage ? (
                  <Icon name="chevronRight" size={16} color={colors.textFaint} />
                ) : null}
              </Pressable>
            );
          }}
          ListFooterComponent={
            isHost ? (
              <View style={styles.footer}>
                <AppText variant="caption" color={colors.textFaint} style={styles.footerText}>
                  Tap a participant to manage their chat and microphone access. Changes take
                  effect instantly.
                </AppText>
                <Button
                  title="Mute all microphones"
                  icon="micOff"
                  variant="secondary"
                  onPress={confirmMuteAll}
                />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="users"
              title="No one else is here yet"
              description="Share the room code to bring friends into the session."
              actionLabel="Share invite"
              onAction={() => navigation.navigate('ShareRoom', { roomCode: room.roomId })}
            />
          }
        />
      )}

      <Sheet
        visible={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.user?.name || 'Participant'}
      >
        {selected ? (
          <View>
            <View style={styles.sheetIdentity}>
              <Avatar name={selected.user?.name} color={selected.user?.avatarColor} size={56} />
              <View style={{ flex: 1 }}>
                <AppText variant="label" weight="800">
                  {selected.user?.name}
                </AppText>
                <AppText variant="caption" color={colors.textMuted}>
                  {selected.online ? 'Online now' : 'Currently offline'} · joined{' '}
                  {formatRelative(selected.joinedAt)}
                </AppText>
              </View>
              <Badge
                label={selected.permissions?.canSpeak ? 'MIC ON' : 'LISTENER'}
                tone={selected.permissions?.canSpeak ? 'yellow' : 'neutral'}
              />
            </View>

            <View style={styles.sheetSection}>
              <SwitchRow
                title="Room chat"
                description="Allow this participant to send messages to everyone."
                value={Boolean(selected.permissions?.canChat)}
                onValueChange={() => toggleChat(selected)}
                disabled={busy === 'chat'}
              />
              <SwitchRow
                title="Microphone"
                description={
                  selected.permissions?.mutedByHost
                    ? 'Muted by host. Granting the mic clears the mute.'
                    : 'Let this participant speak in the voice channel.'
                }
                value={Boolean(selected.permissions?.canSpeak)}
                onValueChange={() => toggleMic(selected)}
                disabled={busy === 'mic'}
              />
            </View>

            <View style={styles.sheetActions}>
              <Button
                title="Remove from room"
                icon="logout"
                variant="secondary"
                onPress={() => confirmRemove(selected, false)}
                loading={busy === 'remove'}
              />
              <Button
                title="Ban from room"
                icon="shield"
                variant="danger"
                onPress={() => confirmRemove(selected, true)}
                loading={busy === 'remove'}
              />
            </View>
            <AppText variant="caption" color={colors.textFaint} style={styles.sheetHint}>
              {connected
                ? 'Changes are delivered live to the participant.'
                : 'You are offline. Reconnect before changing permissions.'}
            </AppText>
          </View>
        ) : null}
      </Sheet>
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
  sectionLabel: {
    letterSpacing: 1.3,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.lg,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowOnline: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  presence: {
    position: 'absolute',
    right: 0,
    bottom: 1,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.black,
  },
  body: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  name: {
    flexShrink: 1,
  },
  metaRow: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  footer: {
    marginTop: spacing.xl,
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  footerText: {
    lineHeight: 18,
  },
  sheetIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetSection: {
    marginTop: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
  },
  sheetActions: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  sheetHint: {
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 17,
  },
});
