import React from 'react';
import { Share, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { colors, radius, spacing } from '../theme';
import AppText from './AppText';
import Button from './Button';
import Icon from './Icon';
import { useToast } from './Toast';

export default function QRShareCard({ roomCode, shareLink, compact = false }) {
  const { showToast } = useToast();

  const onShare = async () => {
    try {
      await Share.share({
        title: `Join ${roomCode} on VibeSync`,
        message: `Join my synchronized VibeSync room ${roomCode}\n${shareLink}`,
        url: shareLink,
      });
    } catch (error) {
      showToast('Could not open the share sheet', 'error');
    }
  };

  return (
    <View style={[styles.base, compact && styles.compact]}>
      <View style={styles.qrWrap}>
        <QRCode
          value={shareLink || `vibesync://room/${roomCode}`}
          size={compact ? 104 : 150}
          color={colors.black}
          backgroundColor={colors.offWhite}
          ecl="M"
        />
      </View>
      <View style={styles.info}>
        <AppText variant="micro" color={colors.textMuted}>
          ROOM CODE
        </AppText>
        <AppText variant={compact ? 'section' : 'title'} style={styles.code}>
          {roomCode}
        </AppText>
        {!compact ? (
          <AppText variant="caption" color={colors.textMuted} style={{ marginBottom: spacing.md }}>
            Scan with a phone camera or share the invite link.
          </AppText>
        ) : null}
        <Button
          title="Share invite"
          icon="share"
          size="sm"
          variant="secondary"
          onPress={onShare}
          style={{ alignSelf: 'flex-start' }}
        />
      </View>
      {!compact ? (
        <View style={styles.hint}>
          <Icon name="qr" size={14} color={colors.yellow} />
          <AppText variant="caption" color={colors.textFaint}>
            Guests can also enter this code in Join Room.
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    alignItems: 'center',
  },
  compact: {
    padding: spacing.md,
  },
  qrWrap: {
    padding: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.offWhite,
  },
  info: {
    flex: 1,
    minWidth: 130,
  },
  code: {
    letterSpacing: 3,
    marginVertical: 4,
  },
  hint: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
});
