import React from 'react';
import { Linking, Share, StyleSheet, View } from 'react-native';
import { colors, spacing } from '../theme';
import Screen from '../components/Screen';
import AppText from '../components/AppText';
import Badge from '../components/Badge';
import Button from '../components/Button';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import Header from '../components/Header';
import Icon from '../components/Icon';
import QRShareCard from '../components/QRShareCard';
import { useToast } from '../components/Toast';
import { useRoom } from '../context/RoomContext';
import { APP_SCHEME, WEB_URL } from '../config';

export default function ShareRoomScreen({ navigation, route }) {
  const { room, members, isHost } = useRoom();
  const { showToast } = useToast();
  const routeCode = String(route.params?.roomCode || '').toUpperCase();
  const roomCode = room?.roomId || routeCode;
  const shareLink = room?.shareLink || `${WEB_URL}/r/${roomCode}`;
  const deepLink = room?.deepLink || `${APP_SCHEME}://room/${roomCode}`;

  if (!roomCode) {
    return (
      <Screen>
        <Header title="Share room" />
        <View style={styles.centered}>
          <EmptyState
            icon="qr"
            title="No room to share"
            description="Join or host a room first, then invite people with a code or link."
            actionLabel="Browse rooms"
            onAction={() => navigation.navigate('Rooms')}
          />
        </View>
      </Screen>
    );
  }

  const share = async () => {
    try {
      await Share.share({
        title: `Join ${room?.name || 'my VibeSync room'}`,
        message: `Join my VibeSync room “${room?.name || roomCode}”\n\nRoom code: ${roomCode}\n${shareLink}`,
        url: shareLink,
      });
    } catch {
      showToast('Could not open the share sheet', 'error');
    }
  };

  const openInvitePage = async () => {
    try {
      const supported = await Linking.canOpenURL(shareLink);
      if (!supported) throw new Error('unsupported');
      await Linking.openURL(shareLink);
    } catch {
      showToast('Could not open the invite page', 'error');
    }
  };

  return (
    <Screen scroll edges={['top']}>
      <Header title="Share room" subtitle={`Invite people to ${room?.name || roomCode}`} />
      <View style={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Icon name="share" size={22} color={colors.black} />
          </View>
          <AppText variant="title" style={styles.heroTitle}>
            Bring the room to life
          </AppText>
          <AppText variant="body" color={colors.textMuted} style={styles.heroBody}>
            Share the code or link to invite guests. Password and approval rules still apply.
          </AppText>
        </View>

        <QRShareCard roomCode={roomCode} shareLink={shareLink} />

        <Button title="Share invite" icon="share" onPress={share} size="lg" />
        <Button
          title="Open web invite"
          icon="link"
          variant="secondary"
          onPress={openInvitePage}
        />

        <Card style={styles.infoCard}>
          <View style={styles.infoRow}>
            <View style={styles.infoIcon}>
              <Icon name="globe" size={17} color={colors.yellow} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="label" weight="700">
                Invite link
              </AppText>
              <AppText variant="caption" color={colors.textMuted} selectable>
                {shareLink}
              </AppText>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <View style={styles.infoIcon}>
              <Icon name="qr" size={17} color={colors.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="label" weight="700">
                App deep link
              </AppText>
              <AppText variant="caption" color={colors.textMuted} selectable>
                {deepLink}
              </AppText>
            </View>
          </View>
        </Card>

        <Card style={styles.tipsCard}>
          <AppText variant="micro" color={colors.textMuted} style={styles.tipsLabel}>
            INVITE TIPS
          </AppText>
          <View style={styles.tipRow}>
            <Icon name="lock" size={15} color={colors.orange} />
            <AppText variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
              {room?.visibility === 'private'
                ? 'This room is private. Guests wait for your approval and the invite does not bypass that.'
                : 'Share only with people you trust. Anyone with the code can request to enter.'}
            </AppText>
          </View>
          <View style={styles.tipRow}>
            <Icon name="users" size={15} color={colors.yellow} />
            <AppText variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
              {members?.length || 1} of {room?.maxParticipants || '—'} seats are in use.
              {isHost ? ' You can raise capacity in room settings.' : ''}
            </AppText>
          </View>
          <View style={styles.tipRow}>
            <Icon name="headphones" size={15} color={colors.offWhite} />
            <AppText variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
              Recipients need the VibeSync app for synchronized playback. The web invite page
              explains how to install it.
            </AppText>
          </View>
        </Card>

        {room?.mode === 'nearby' ? (
          <Card variant="highlight" style={styles.nearbyCard}>
            <Badge label="NEARBY ROOM" tone="yellow" />
            <AppText variant="caption" color={colors.offWhite} style={{ marginTop: spacing.xs }}>
              This room is designed for people on the same local network. Invite links work only
              where devices can reach the host directly.
            </AppText>
          </Card>
        ) : null}

        <Button
          title="Back to room"
          variant="ghost"
          onPress={() => navigation.goBack()}
          style={{ marginBottom: spacing.lg }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    paddingHorizontal: spacing.lg,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  hero: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  heroTitle: {
    textAlign: 'center',
  },
  heroBody: {
    textAlign: 'center',
    marginTop: spacing.xs,
    maxWidth: 330,
  },
  infoCard: {
    gap: spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  infoIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.offWhiteSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  tipsCard: {
    gap: spacing.sm,
  },
  tipsLabel: {
    letterSpacing: 1.3,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  nearbyCard: {
    gap: spacing.xs,
  },
});
