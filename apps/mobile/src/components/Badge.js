import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius } from '../theme';
import AppText from './AppText';

export default function Badge({ label, tone = 'neutral', icon, style }) {
  const tones = {
    neutral: { backgroundColor: colors.offWhiteSoft, color: colors.textMuted, borderColor: colors.border },
    orange: { backgroundColor: colors.orangeSoft, color: colors.orange, borderColor: 'rgba(253,133,73,0.3)' },
    yellow: { backgroundColor: colors.yellowSoft, color: colors.yellow, borderColor: 'rgba(255,193,35,0.3)' },
    solid: { backgroundColor: colors.offWhite, color: colors.black, borderColor: colors.offWhite },
  };
  const theme = tones[tone] || tones.neutral;
  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: theme.backgroundColor,
          borderColor: theme.borderColor,
        },
        style,
      ]}
    >
      {icon ? <AppText style={{ color: theme.color, fontSize: 10 }}>{icon}</AppText> : null}
      <AppText variant="micro" color={theme.color} style={styles.text}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  text: {
    letterSpacing: 0.7,
  },
});
