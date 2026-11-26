import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../theme';
import AppText from './AppText';
import Button from './Button';
import Icon from './Icon';

export default function EmptyState({
  icon = 'headphones',
  title,
  description,
  actionLabel,
  onAction,
  style,
}) {
  return (
    <View style={[styles.base, style]}>
      <View style={styles.iconWrap}>
        <Icon name={icon} size={30} color={colors.orange} />
      </View>
      <AppText variant="section" style={styles.title}>
        {title}
      </AppText>
      {description ? (
        <AppText variant="body" color={colors.textMuted} style={styles.description}>
          {description}
        </AppText>
      ) : null}
      {actionLabel ? (
        <Button
          title={actionLabel}
          onPress={onAction}
          variant="secondary"
          size="sm"
          style={{ marginTop: spacing.lg }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.orangeSoft,
    borderWidth: 1,
    borderColor: 'rgba(253,133,73,0.25)',
    marginBottom: spacing.md,
  },
  title: {
    textAlign: 'center',
  },
  description: {
    textAlign: 'center',
    marginTop: spacing.xs,
    maxWidth: 280,
  },
});
