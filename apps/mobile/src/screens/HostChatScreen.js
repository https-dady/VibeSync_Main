import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { colors, radius, spacing, typography } from '../theme';
import Screen from '../components/Screen';
import AppText from '../components/AppText';
import Avatar from '../components/Avatar';
import Badge from '../components/Badge';
import EmptyState from '../components/EmptyState';
import Header from '../components/Header';
import Icon from '../components/Icon';
import { useToast } from '../components/Toast';
import { useRoom } from '../context/RoomContext';
import { formatClockTime, formatRelative } from '../utils/format';
import { apiError } from '../api/client';

function relatedTo(message, userId) {
  return (
    String(message.senderId) === String(userId) ||
    String(message.recipientId) === String(userId)
  );
}

export default function HostChatScreen({ navigation }) {
  const {
    room,
    me,
    membership,
    members,
    hostMessages,
    messagePaging,
    isHost,
    sendMessage,
    loadMoreMessages,
    deleteMessage,
  } = useRoom();
  const { showToast } = useToast();
  const [selectedId, setSelectedId] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const stickRef = useRef(true);
  const lastCount = useRef(0);

  const participants = useMemo(
    () => members.filter((member) => member.role !== 'host'),
    [members],
  );
  const selected = useMemo(
    () => participants.find((member) => String(member.userId) === String(selectedId)),
    [participants, selectedId],
  );

  useEffect(() => {
    if (isHost && selectedId && !selected) setSelectedId(null);
  }, [isHost, selected, selectedId]);

  const thread = useMemo(() => {
    if (!isHost) {
      const hostId = String(room?.hostId);
      return hostMessages.filter(
        (message) =>
          String(message.senderId) === hostId ||
          String(message.recipientId) === hostId ||
          relatedTo(message, me?.id),
      );
    }
    if (!selected) return hostMessages;
    return hostMessages.filter((message) => relatedTo(message, selected.userId));
  }, [hostMessages, isHost, me?.id, room?.hostId, selected]);

  const conversations = useMemo(() => {
    return participants
      .map((member) => {
        const messages = hostMessages.filter((message) => relatedTo(message, member.userId));
        const last = messages[messages.length - 1];
        return { member, last, count: messages.length };
      })
      .sort((a, b) => {
        const aTime = a.last ? new Date(a.last.createdAt).getTime() : 0;
        const bTime = b.last ? new Date(b.last.createdAt).getTime() : 0;
        if (aTime !== bTime) return bTime - aTime;
        return (a.member.user?.name || '').localeCompare(b.member.user?.name || '');
      });
  }, [hostMessages, participants]);

  const scrollToEnd = useCallback((animated = true) => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }));
  }, []);

  useEffect(() => {
    if (thread.length > lastCount.current) {
      if (stickRef.current) scrollToEnd(lastCount.current > 0);
      lastCount.current = thread.length;
    }
  }, [thread.length, scrollToEnd]);

  useEffect(() => {
    lastCount.current = 0;
    stickRef.current = true;
    const timer = selectedId ? setTimeout(() => scrollToEnd(false), 120) : null;
    return () => { if (timer) clearTimeout(timer); };
  }, [selectedId, scrollToEnd]);

  const canChat = Boolean(membership?.permissions?.canChat);
  const hostName = room?.host?.name || 'the host';
  const counterpart = isHost
    ? selected?.user?.name || 'Select a participant'
    : hostName;

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    if (isHost && !selected) {
      showToast('Choose a participant to reply to', 'default');
      return;
    }
    setSending(true);
    setText('');
    stickRef.current = true;
    try {
      await sendMessage({
        channel: 'host',
        body,
        targetUserId: isHost ? selected.userId : undefined,
      });
      scrollToEnd();
    } catch (caught) {
      showToast(apiError(caught).message, 'error');
    } finally {
      setSending(false);
    }
  };

  if (!room) {
    return (
      <Screen>
        <Header title="Private chat" />
        <View style={styles.centered}>
          <EmptyState
            icon="lock"
            title="No active room"
            description="Join a room to open a private conversation with its host."
            actionLabel="Browse rooms"
            onAction={() => navigation.navigate('Main', { screen: 'Rooms' })}
          />
        </View>
      </Screen>
    );
  }

  if (isHost && !selected) {
    return (
      <Screen edges={['top']}>
        <Header
          title="Host inbox"
          subtitle="Private conversations · only you and each guest"
          right={<Badge label={`${conversations.length}`} tone="orange" />}
        />
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.member.id}
          contentContainerStyle={styles.inbox}
          ListHeaderComponent={
            <View style={styles.inboxIntro}>
              <View style={styles.lockBadge}>
                <Icon name="lock" size={18} color={colors.yellow} />
              </View>
              <AppText variant="body" color={colors.textMuted} style={styles.inboxIntroText}>
                Messages here are private between you and each participant. Room chat is separate.
              </AppText>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => setSelectedId(item.member.userId)}
              style={({ pressed }) => [styles.conversation, pressed && { opacity: 0.82 }]}
              accessibilityRole="button"
              accessibilityLabel={`Open private chat with ${item.member.user?.name || 'participant'}`}
            >
              <Avatar
                name={item.member.user?.name}
                color={item.member.user?.avatarColor}
                size={46}
              />
              <View style={styles.conversationBody}>
                <View style={styles.conversationTop}>
                  <AppText variant="label" weight="800" numberOfLines={1} style={styles.name}>
                    {item.member.user?.name || 'Participant'}
                  </AppText>
                  {item.last ? (
                    <AppText variant="micro" color={colors.textFaint}>
                      {formatRelative(item.last.createdAt).toUpperCase()}
                    </AppText>
                  ) : null}
                </View>
                <AppText
                  variant="caption"
                  color={item.last ? colors.textMuted : colors.textFaint}
                  numberOfLines={1}
                  style={styles.preview}
                >
                  {item.last
                    ? `${String(item.last.senderId) === String(me?.id) ? 'You: ' : ''}${
                        item.last.deleted ? 'Message removed' : item.last.body
                      }`
                    : 'Start a private conversation'}
                </AppText>
              </View>
              <Icon name="chevronRight" size={16} color={colors.textFaint} />
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="chat"
              title="No participants yet"
              description="When people join your room, you can start a private conversation with each of them here."
              actionLabel="Share invite"
              onAction={() => navigation.navigate('ShareRoom', { roomCode: room.roomId })}
            />
          }
          ListFooterComponent={
            <View style={styles.inboxTip}>
              <Icon name="shield" size={15} color={colors.orange} />
              <AppText variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
                Participants can always message you privately. You choose who to reply to.
              </AppText>
            </View>
          }
        />
      </Screen>
    );
  }

  const header = (
    <Header
      title={counterpart}
      subtitle={
        isHost
          ? 'Private participant conversation'
          : 'Only you and the host can read this'
      }
      onBack={isHost ? () => setSelectedId(null) : undefined}
      right={
        isHost ? (
          <Pressable
            onPress={() => setSelectedId(null)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back to host inbox"
          >
            <Icon name="users" size={19} color={colors.textMuted} />
          </Pressable>
        ) : (
          <Icon name="lock" size={17} color={colors.textMuted} />
        )
      }
    />
  );

  return (
    <Screen header={header} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 4 : 0}
      >
        <FlatList
          ref={listRef}
          data={thread}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.thread}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            stickRef.current =
              contentSize.height - contentOffset.y - layoutMeasurement.height < 120;
          }}
          scrollEventThrottle={100}
          ListHeaderComponent={
            <View style={styles.threadHeader}>
              {messagePaging.host.hasMore ? (
                <Pressable
                  style={styles.loadMore}
                  onPress={() =>
                    loadMoreMessages('host').catch((caught) =>
                      showToast(apiError(caught).message, 'error'),
                    )
                  }
                  disabled={messagePaging.host.loading}
                >
                  {messagePaging.host.loading ? (
                    <ActivityIndicator color={colors.orange} size="small" />
                  ) : (
                    <AppText variant="caption" color={colors.orange} weight="700">
                      Load earlier messages
                    </AppText>
                  )}
                </Pressable>
              ) : null}
              <View style={styles.privacyNote}>
                <Icon name="lock" size={13} color={colors.textFaint} />
                <AppText variant="caption" color={colors.textFaint} style={{ flex: 1 }}>
                  {isHost
                    ? `Private with ${selected?.user?.name || 'this participant'}. Not visible in room chat.`
                    : `Private with ${hostName}. Other participants cannot see this conversation.`}
                </AppText>
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyThread}>
              <Avatar name={counterpart} color={selected?.user?.avatarColor} size={58} />
              <AppText variant="section" style={{ marginTop: spacing.md }}>
                {isHost ? `Say hello to ${selected?.user?.name?.split(' ')[0] || 'your guest'}` : `Message ${hostName}`}
              </AppText>
              <AppText variant="body" color={colors.textMuted} style={styles.emptyText}>
                {isHost
                  ? 'Private replies are delivered only to this participant.'
                  : 'Have a question or need help? The host will see this privately.'}
              </AppText>
            </View>
          }
          renderItem={({ item, index }) => {
            const mine = String(item.senderId) === String(me?.id);
            const previous = thread[index - 1];
            const grouped =
              previous &&
              String(previous.senderId) === String(item.senderId) &&
              new Date(item.createdAt).getTime() - new Date(previous.createdAt).getTime() < 120000;
            return (
              <Pressable style={[styles.messageRow, grouped && { marginTop: 2 }, mine && styles.mineRow]} onLongPress={() => {
                if (item.optimistic || (!isHost && !mine)) return;
                Alert.alert('Delete private message?', 'This removes it from this private conversation.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => deleteMessage(item, 'host').catch((caught) => showToast(apiError(caught).message, 'error')) },
                ]);
              }}>
                {!mine ? (
                  <View style={styles.avatarSlot}>
                    {!grouped ? (
                      <Avatar
                        name={item.sender?.name}
                        color={item.sender?.avatarColor}
                        size={30}
                      />
                    ) : null}
                  </View>
                ) : null}
                <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                  {!grouped ? (
                    <View style={styles.meta}>
                      <AppText
                        variant="micro"
                        color={mine ? colors.black : colors.textMuted}
                        weight="800"
                      >
                        {mine ? 'YOU' : item.sender?.name?.toUpperCase() || 'MEMBER'}
                      </AppText>
                      <AppText
                        variant="micro"
                        color={mine ? 'rgba(0,0,0,0.45)' : colors.textFaint}
                      >
                        {formatClockTime(item.createdAt)}
                      </AppText>
                    </View>
                  ) : null}
                  <AppText
                    variant="body"
                    color={
                      item.deleted
                        ? mine
                          ? 'rgba(0,0,0,0.45)'
                          : colors.textFaint
                        : mine
                          ? colors.black
                          : colors.offWhite
                    }
                    style={item.deleted && styles.deleted}
                  >
                    {item.deleted ? 'Message removed' : item.body}
                  </AppText>
                  {mine ? (
                    <Pressable disabled={item.delivery !== 'failed'} onPress={() =>
                      sendMessage({ channel: 'host', body: item.body, targetUserId: item.recipientId, clientMessageId: item.clientMessageId })
                        .catch((caught) => showToast(apiError(caught).message, 'error'))
                    } accessibilityRole={item.delivery === 'failed' ? 'button' : undefined} accessibilityLabel={item.delivery === 'failed' ? 'Retry failed private message' : undefined}>
                      <AppText variant="micro" color={colors.black}>
                        {item.delivery === 'sending' ? 'Sending…' : item.delivery === 'failed' ? 'Failed · Tap to retry' : 'Sent'}
                      </AppText>
                    </Pressable>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
        />

        {canChat ? (
          <View style={styles.composer}>
            <View style={styles.inputWrap}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={isHost ? `Reply to ${selected?.user?.name?.split(' ')[0] || 'guest'}…` : 'Message the host…'}
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                multiline
                maxLength={2000}
                selectionColor={colors.orange}
                accessibilityLabel="Private message"
              />
            </View>
            <Pressable
              onPress={send}
              disabled={!text.trim() || sending}
              style={[styles.sendButton, (!text.trim() || sending) && styles.sendDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Send private message"
            >
              {sending ? (
                <ActivityIndicator color={colors.black} size="small" />
              ) : (
                <Icon name="send" size={19} color={colors.black} />
              )}
            </Pressable>
          </View>
        ) : (
          <View style={styles.disabledComposer}>
            <Icon name="lock" size={16} color={colors.textFaint} />
            <AppText variant="caption" color={colors.textMuted}>
              The host disabled your chat permission. Private messages are unavailable.
            </AppText>
          </View>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    paddingHorizontal: spacing.lg,
  },
  inbox: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    flexGrow: 1,
  },
  inboxIntro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  lockBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.yellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inboxIntroText: {
    flex: 1,
    lineHeight: 21,
  },
  conversation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    marginBottom: 6,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  conversationBody: {
    flex: 1,
  },
  conversationTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  name: {
    flexShrink: 1,
  },
  preview: {
    marginTop: 2,
  },
  inboxTip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thread: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    flexGrow: 1,
  },
  threadHeader: {
    paddingTop: spacing.xs,
  },
  loadMore: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.offWhiteSoft,
    marginBottom: spacing.sm,
  },
  emptyThread: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 70,
    paddingHorizontal: spacing.xl,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: spacing.xs,
    maxWidth: 290,
  },
  messageRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
    alignItems: 'flex-end',
  },
  mineRow: {
    justifyContent: 'flex-end',
  },
  avatarSlot: {
    width: 30,
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  mine: {
    backgroundColor: colors.orange,
    borderBottomRightRadius: 5,
    marginLeft: 'auto',
  },
  theirs: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 5,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 6,
    marginBottom: 3,
  },
  deleted: {
    fontStyle: 'italic',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.black,
  },
  inputWrap: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  input: {
    ...typography.body,
    color: colors.offWhite,
    paddingVertical: 10,
    maxHeight: 100,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: {
    opacity: 0.4,
  },
  disabledComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.md,
    paddingBottom: spacing.lg,
  },
});
