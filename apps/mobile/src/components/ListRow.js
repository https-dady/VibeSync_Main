import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../theme';
import AppText from './AppText';
import Icon from './Icon';

export default function ListRow({
  icon,
  title,
  subtitle,
  right,
  onPress,
  showChevron = Boolean(onPress),
  tone = 'default',
  style,
  disabled = false,
}) {
  const content = (
    <>
      {icon ? (
        <View style={[styles.icon, tone === 'danger' && styles.iconDanger]}>
          <Icon name={icon} size={18} color={tone === 'danger' ? colors.orange : colors.yellow} />
        </View>
      ) : null}
      <View style={styles.body}>
        <AppText variant="label" color={tone === 'danger' ? colors.orange : colors.offWhite}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right || null}
      {showChevron && !right ? (
        <Icon name="chevronRight" size={16} color={colors.textFaint} />
      ) : null}
    </>
  );

  if (!onPress) return <View style={[styles.base, style]}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        style,
        disabled && { opacity: 0.45 },
        pressed && { backgroundColor: colors.offWhiteSoft },
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 62,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.yellowSoft,
  },
  iconDanger: {
    backgroundColor: colors.orangeSoft,
  },
  body: {
    flex: 1,
  },
});
