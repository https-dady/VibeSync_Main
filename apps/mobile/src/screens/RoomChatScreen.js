import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import Header from '../components/Header';
import Icon from '../components/Icon';
import { useToast } from '../components/Toast';
import { useRoom } from '../context/RoomContext';
import { formatClockTime } from '../utils/format';
import { apiError } from '../api/client';

export default function RoomChatScreen() {
  const {
    room,
    membership,
    messages,
    messagePaging,
    sendMessage,
    loadMoreMessages,
    deleteMessage,
    clearChat,
    isHost,
  } = useRoom();
  const { showToast } = useToast();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const stickRef = useRef(true);
  const lastCount = useRef(0);

  const canChat = Boolean(membership?.permissions?.canChat && room?.allowChat);

  const scrollToEnd = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  useEffect(() => {
    if (messages.length > lastCount.current) {
      if (stickRef.current) scrollToEnd(lastCount.current > 0);
      lastCount.current = messages.length;
    }
  }, [messages.length, scrollToEnd]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setText('');
    stickRef.current = true;
    try {
      await sendMessage({ channel: 'room', body });
      scrollToEnd();
    } catch (caught) {
      showToast(apiError(caught).message, 'error');
    } finally {
      setSending(false);
    }
  };

  const confirmDelete = (message) => {
    if (message.optimistic) return;
    if (!isHost && String(message.senderId) !== String(membership?.userId)) return;
    Alert.alert('Delete message?', 'This removes it for everyone in the room.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteMessage(message, 'room').catch((caught) =>
            showToast(apiError(caught).message, 'error'),
          );
        },
      },
    ]);
  };

  const confirmClear = () => {
    Alert.alert('Clear room chat?', 'All messages in the room chat will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear chat',
        style: 'destructive',
        onPress: () => {
          clearChat().catch((caught) => showToast(apiError(caught).message, 'error'));
        },
      },
    ]);
  };

  const header = (
    <Header
      title="Room chat"
      subtitle={room ? `${room.roomId} · everyone can see this` : ''}
      right={
        isHost && messages.length > 0 ? (
          <Pressable onPress={confirmClear} hitSlop={10} accessibilityLabel="Clear room chat">
            <Icon name="trash" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null
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
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            stickRef.current =
              contentSize.height - contentOffset.y - layoutMeasurement.height < 120;
          }}
          scrollEventThrottle={100}
          ListHeaderComponent={
            messagePaging.room.hasMore ? (
              <Pressable
                style={styles.loadMore}
                onPress={() =>
                  loadMoreMessages('room').catch((caught) =>
                    showToast(apiError(caught).message, 'error'),
                  )
                }
                disabled={messagePaging.room.loading}
              >
                {messagePaging.room.loading ? (
                  <ActivityIndicator color={colors.orange} size="small" />
                ) : (
                  <AppText variant="caption" color={colors.orange} weight="700">
                    Load earlier messages
                  </AppText>
                )}
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Icon name="chat" size={26} color={colors.yellow} />
              </View>
              <AppText variant="section" style={{ textAlign: 'center' }}>
                The room is listening
              </AppText>
              <AppText variant="body" color={colors.textMuted} style={styles.emptyText}>
                Be the first to say something. Please keep it kind.
              </AppText>
            </View>
          }
          renderItem={({ item, index }) => {
            const previous = messages[index - 1];
            const mine = String(item.senderId) === String(membership?.userId);
            const grouped =
              previous &&
              String(previous.senderId) === String(item.senderId) &&
              new Date(item.createdAt).getTime() - new Date(previous.createdAt).getTime() < 120000;
            return (
              <Pressable
                onLongPress={() => confirmDelete(item)}
                delayLongPress={350}
                style={[styles.messageRow, grouped && { marginTop: 2 }]}
              >
                <View style={styles.avatarSlot}>
                  {!grouped ? (
                    <Avatar
                      name={item.sender?.name}
                      color={item.sender?.avatarColor}
                      size={32}
                    />
                  ) : null}
                </View>
                <View style={{ flex: 1 }}>
                  {!grouped ? (
                    <View style={styles.meta}>
                      <AppText variant="caption" weight="800" color={mine ? colors.yellow : colors.offWhite}>
                        {mine ? 'You' : item.sender?.name || 'Member'}
                      </AppText>
                      <AppText variant="micro" color={colors.textFaint}>
                        {formatClockTime(item.createdAt)}
                      </AppText>
                    </View>
                  ) : null}
                  <AppText
                    variant="body"
                    color={item.deleted ? colors.textFaint : grouped ? colors.textMuted : colors.offWhite}
                    style={[styles.body, item.deleted && styles.deleted]}
                  >
                    {item.deleted ? 'Message removed' : item.body}
                  </AppText>
                  {mine ? (
                    <Pressable disabled={item.delivery !== 'failed'} onPress={() =>
                      sendMessage({ channel: 'room', body: item.body, clientMessageId: item.clientMessageId })
                        .catch((caught) => showToast(apiError(caught).message, 'error'))
                    } accessibilityRole={item.delivery === 'failed' ? 'button' : undefined} accessibilityLabel={item.delivery === 'failed' ? 'Retry failed message' : undefined}>
                      <AppText variant="micro" color={item.delivery === 'failed' ? colors.orange : colors.textFaint}>
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
                placeholder="Message the room…"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                multiline
                maxLength={2000}
                selectionColor={colors.orange}
                accessibilityLabel="Room message"
              />
            </View>
            <Pressable
              onPress={send}
              disabled={!text.trim() || sending}
              style={[
                styles.sendButton,
                (!text.trim() || sending) && styles.sendButtonDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Send message"
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
              {room?.allowChat === false
                ? 'Room chat is turned off by the host.'
                : 'The host disabled chat for your account.'}
            </AppText>
          </View>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    flexGrow: 1,
  },
  loadMore: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  messageRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  avatarSlot: {
    width: 32,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: spacing.xs,
    marginBottom: 3,
  },
  body: {
    lineHeight: 22,
  },
  deleted: {
    fontStyle: 'italic',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    paddingHorizontal: spacing.xl,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.yellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: spacing.xs,
    maxWidth: 280,
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
  sendButtonDisabled: {
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
