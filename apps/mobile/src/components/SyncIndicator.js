import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius } from '../theme';
import AppText from './AppText';
import { Dot } from './Icon';

export default function SyncIndicator({ state = 'synced', driftMs = 0, compact = false, style }) {
  const map = {
    synced: { color: colors.yellow, label: compact ? 'SYNCED' : 'In sync' },
    syncing: { color: colors.orange, label: compact ? 'SYNCING' : 'Syncing…' },
    drifting: { color: colors.orange, label: compact ? 'ADJUSTING' : 'Adjusting drift' },
    offline: { color: colors.textMuted, label: compact ? 'OFFLINE' : 'Offline playback' },
  };
  const theme = map[state] || map.synced;
  return (
    <View style={[styles.base, style]}>
      <Dot size={6} color={theme.color} />
      <AppText variant="micro" color={theme.color}>
        {theme.label}
      </AppText>
      {driftMs > 80 && !compact ? (
        <AppText variant="micro" color={colors.textFaint}>
          {Math.round(driftMs)}ms
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    minHeight: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.offWhiteSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
