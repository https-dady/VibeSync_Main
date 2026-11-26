import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../theme';
import AppText from './AppText';
import Avatar from './Avatar';
import Badge from './Badge';
import Icon from './Icon';

function statusLabel(playback) {
  if (!playback) return 'Waiting for media';
  if (playback.status === 'playing') return 'Live now';
  if (playback.status === 'paused') return 'Paused';
  if (playback.status === 'ended') return 'Ended';
  return 'Open room';
}

export default function RoomCard({ room, onPress, style }) {
  const hostName = room.host?.name || 'Host';
  const playing = room.playback?.status === 'playing';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${room.name}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        playing && styles.playingCard,
        style,
        pressed && { opacity: 0.86 },
      ]}
    >
      <View style={styles.topRow}>
        <View style={styles.titleWrap}>
          <View style={styles.titleRow}>
            <AppText variant="section" numberOfLines={1} style={styles.title}>
              {room.name}
            </AppText>
            {room.visibility === 'private' ? (
              <Icon name="lock" size={14} color={colors.textMuted} />
            ) : null}
          </View>
          <View style={styles.metaRow}>
            <AppText variant="micro" color={colors.orange} style={styles.code}>
              {room.roomId}
            </AppText>
            <View style={styles.dotSeparator} />
            <AppText variant="caption" color={colors.textMuted}>
              {room.memberCount}/{room.maxParticipants} here
            </AppText>
          </View>
        </View>
        <View style={[styles.liveDot, playing && styles.liveDotActive]} />
      </View>

      {room.description ? (
        <AppText variant="body" color={colors.textMuted} numberOfLines={2} style={styles.description}>
          {room.description}
        </AppText>
      ) : null}

      <View style={styles.footer}>
        <View style={styles.hostRow}>
          <Avatar name={hostName} color={room.host?.avatarColor} size={24} />
          <AppText variant="caption" color={colors.textMuted} numberOfLines={1}>
            {hostName}
          </AppText>
        </View>
        <View style={styles.badges}>
          <Badge
            label={room.mode === 'nearby' ? 'NEARBY' : 'ONLINE'}
            tone={room.mode === 'nearby' ? 'yellow' : 'neutral'}
            icon={room.mode === 'nearby' ? '◉' : '●'}
          />
          <Badge
            label={statusLabel(room.playback).toUpperCase()}
            tone={playing ? 'orange' : 'neutral'}
          />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  playingCard: {
    borderColor: 'rgba(253,133,73,0.25)',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  titleWrap: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flexShrink: 1,
  },
  metaRow: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 5,
  },
  code: {
    letterSpacing: 1.4,
    fontWeight: '800',
  },
  dotSeparator: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.textFaint,
  },
  liveDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.borderStrong,
    marginTop: 8,
  },
  liveDotActive: {
    backgroundColor: colors.orange,
  },
  description: {
    marginTop: 2,
  },
  footer: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: 4,
  },
  hostRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 1,
  },
  badges: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
});
