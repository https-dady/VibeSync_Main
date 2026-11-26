import React, { useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { colors, radius, shadows, spacing } from '../theme';
import AppText from './AppText';
import Icon from './Icon';

export default function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  iconPosition = 'right',
  style,
  textStyle,
  accessibilityLabel,
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const isDisabled = disabled || loading;

  const animate = (toValue) => {
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      speed: 30,
      bounciness: 0,
    }).start();
  };

  const contentColor =
    variant === 'primary' || variant === 'gradient' || variant === 'accent'
      ? colors.black
      : variant === 'danger'
        ? colors.orange
        : colors.offWhite;

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || title}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        disabled={isDisabled}
        onPress={onPress}
        onPressIn={() => animate(0.975)}
        onPressOut={() => animate(1)}
        style={[
          styles.base,
          sizes[size],
          styles[variant],
          isDisabled && styles.disabled,
        ]}
      >
        {variant === 'gradient' && (
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
            <Defs>
              <LinearGradient id="buttonGradient" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={colors.orange} />
                <Stop offset="1" stopColor={colors.yellow} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" rx={radius.lg} fill="url(#buttonGradient)" />
          </Svg>
        )}
        {loading ? (
          <ActivityIndicator color={contentColor} />
        ) : (
          <>
            {icon && iconPosition === 'left' ? (
              <Icon name={icon} size={18} color={contentColor} />
            ) : null}
            {title ? (
              <AppText
                variant="label"
                weight="800"
                color={contentColor}
                style={[styles.title, textStyle]}
              >
                {title}
              </AppText>
            ) : null}
            {icon && iconPosition === 'right' ? (
              <Icon name={icon} size={18} color={contentColor} />
            ) : null}
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

const sizes = {
  sm: { minHeight: 42, paddingHorizontal: spacing.md, borderRadius: radius.md },
  md: { minHeight: 54, paddingHorizontal: spacing.lg, borderRadius: radius.lg },
  lg: { minHeight: 62, paddingHorizontal: spacing.xl, borderRadius: radius.lg },
};

const styles = StyleSheet.create({
  base: {
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    overflow: 'hidden',
  },
  primary: {
    backgroundColor: colors.orange,
    ...shadows.soft,
  },
  gradient: {
    backgroundColor: colors.orange,
    ...shadows.floating,
  },
  accent: {
    backgroundColor: colors.yellow,
  },
  secondary: {
    backgroundColor: colors.offWhiteSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  danger: {
    backgroundColor: colors.orangeSoft,
    borderWidth: 1,
    borderColor: 'rgba(253, 133, 73, 0.35)',
  },
  disabled: {
    opacity: 0.45,
  },
  title: {
    flexShrink: 1,
    minWidth: 0,
    textAlign: 'center',
  },
});
