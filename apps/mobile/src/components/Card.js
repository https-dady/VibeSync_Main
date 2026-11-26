import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, shadows, spacing } from '../theme';

export default function Card({ children, style, onPress, padded = true, variant = 'default', accessibilityLabel }) {
  const content = (
    <View
      style={[
        styles.base,
        padded && styles.padded,
        variant === 'raised' && styles.raised,
        variant === 'highlight' && styles.highlight,
        style,
      ]}
    >
      {children}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.xl,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  padded: {
    padding: spacing.lg,
  },
  raised: {
    backgroundColor: colors.raised,
    ...shadows.soft,
  },
  highlight: {
    backgroundColor: colors.orangeSoft,
    borderColor: 'rgba(253, 133, 73, 0.28)',
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.995 }],
  },
});
