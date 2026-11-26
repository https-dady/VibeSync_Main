import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, layout, radius, spacing } from '../theme';
import AppText from './AppText';
import Icon from './Icon';

export default function Header({
  title,
  subtitle,
  right,
  onBack,
  showBack = true,
  transparent = false,
  style,
}) {
  const navigation = useNavigation();
  const canGoBack = navigation.canGoBack();
  return (
    <View style={[styles.base, !transparent && styles.solid, style]}>
      <View style={styles.side}>
        {showBack && canGoBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={onBack || (() => navigation.goBack())}
            hitSlop={10}
            style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
          >
            <Icon name="arrowLeft" size={21} />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.center}>
        {title ? (
          <AppText variant="label" weight="800" numberOfLines={1}>
            {title}
          </AppText>
        ) : null}
        {subtitle ? (
          <AppText variant="caption" color={colors.textMuted} numberOfLines={1} style={{ marginTop: 2 }}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: layout.headerHeight,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding,
    gap: spacing.sm,
  },
  solid: {
    backgroundColor: colors.black,
  },
  side: {
    minWidth: 44,
    maxWidth: '30%',
    flexShrink: 1,
    justifyContent: 'center',
  },
  right: {
    alignItems: 'flex-end',
  },
  center: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  back: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.offWhiteSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
