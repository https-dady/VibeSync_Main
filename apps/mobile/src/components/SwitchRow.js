import React from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { colors, spacing } from '../theme';
import AppText from './AppText';

export default function SwitchRow({
  title,
  description,
  value,
  onValueChange,
  disabled = false,
  style,
  icon,
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      onPress={() => !disabled && onValueChange?.(!value)}
      style={[styles.base, style]}
    >
      <View style={styles.text}>
        <View style={styles.titleRow}>
          {icon ? <AppText style={styles.icon}>{icon}</AppText> : null}
          <AppText variant="label" weight="700">
            {title}
          </AppText>
        </View>
        {description ? (
          <AppText variant="caption" color={colors.textMuted} style={{ marginTop: 3 }}>
            {description}
          </AppText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.raised, true: colors.orange }}
        thumbColor={value ? colors.offWhite : colors.textFaint}
        ios_backgroundColor={colors.raised}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 58,
  },
  text: {
    flex: 1,
  },
  titleRow: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  icon: {
    color: colors.yellow,
  },
});
