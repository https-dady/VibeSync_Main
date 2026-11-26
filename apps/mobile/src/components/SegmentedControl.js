import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius } from '../theme';
import AppText from './AppText';
import Icon from './Icon';

export default function SegmentedControl({ options, value, onChange, style }) {
  return (
    <View style={[styles.base, style]}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.item, active && styles.activeItem]}
          >
            {option.icon ? (
              <Icon
                name={option.icon}
                size={16}
                color={active ? colors.black : colors.textMuted}
              />
            ) : null}
            <AppText
              variant="caption"
              weight="800"
              color={active ? colors.black : colors.textMuted}
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  item: {
    flex: 1,
    minHeight: 42,
    paddingVertical: 8,
    paddingHorizontal: 4,
    flexWrap: 'wrap',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.sm,
  },
  activeItem: {
    backgroundColor: colors.offWhite,
  },
});
