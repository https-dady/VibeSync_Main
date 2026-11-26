import React from 'react';
import { Text } from 'react-native';
import { colors, typography } from '../theme';

const variants = {
  display: typography.display,
  hero: typography.hero,
  title: typography.title,
  section: typography.section,
  bodyLarge: typography.bodyLarge,
  body: typography.body,
  label: typography.label,
  caption: typography.caption,
  micro: typography.micro,
};

export default function AppText({
  variant = 'body',
  color = colors.offWhite,
  weight,
  style,
  children,
  numberOfLines,
  ...rest
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      {...rest}
      style={[variants[variant] || variants.body, { color }, weight ? { fontWeight: weight } : null, style]}
    >
      {children}
    </Text>
  );
}
