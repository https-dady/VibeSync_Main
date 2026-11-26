import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../theme';
import AppText from './AppText';

const palette = {
  '#FD8549': { backgroundColor: colors.orange, color: colors.black },
  '#FFC123': { backgroundColor: colors.yellow, color: colors.black },
  '#F1F3F5': { backgroundColor: colors.offWhite, color: colors.black },
};

export default function Avatar({ name = '?', color = colors.orange, size = 44, ring = false, style }) {
  const initials = String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  const theme = palette[color] || palette['#FD8549'];
  return (
    <View
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.backgroundColor,
        },
        ring && styles.ring,
        style,
      ]}
    >
      <AppText
        allowFontScaling={false}
        weight="800"
        color={theme.color}
        style={{ fontSize: Math.max(11, size * 0.34), lineHeight: Math.max(14, size * 0.42), letterSpacing: -0.2 }}
      >
        {initials || '?'}
      </AppText>
    </View>
  );
}

export function AvatarStack({ users = [], size = 30, max = 4 }) {
  const visible = users.slice(0, max);
  return (
    <View style={styles.stack}>
      {visible.map((user, index) => (
        <Avatar
          key={`${user.id || user.userId}-${index}`}
          name={user.name}
          color={user.avatarColor}
          size={size}
          style={{ marginLeft: index === 0 ? 0 : -size * 0.3, borderWidth: 2, borderColor: colors.black }}
        />
      ))}
      {users.length > max ? (
        <View
          style={[
            styles.more,
            { width: size, height: size, borderRadius: size / 2, marginLeft: -size * 0.3 },
          ]}
        >
          <AppText variant="micro" color={colors.textMuted}>
            +{users.length - max}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    borderWidth: 2,
    borderColor: colors.yellow,
  },
  stack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  more: {
    backgroundColor: colors.raised,
    borderWidth: 2,
    borderColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
