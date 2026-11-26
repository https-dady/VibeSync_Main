import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { colors } from '../theme';
import AppText from './AppText';

export default function Logo({ size = 56, wordmark = false, subtitle, style }) {
  const mark = (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Defs>
          <LinearGradient id="logoGradient" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.orange} />
            <Stop offset="1" stopColor={colors.yellow} />
          </LinearGradient>
        </Defs>
        <Rect width="64" height="64" rx="20" fill="url(#logoGradient)" />
        <Circle cx="32" cy="32" r="19" fill={colors.black} opacity="0.12" />
        <Rect x="19" y="27" width="4" height="10" rx="2" fill={colors.black} />
        <Rect x="27" y="20" width="4" height="24" rx="2" fill={colors.black} />
        <Rect x="35" y="24" width="4" height="16" rx="2" fill={colors.black} />
        <Path d="M43 25.5 52 32l-9 6.5v-13Z" fill={colors.black} />
      </Svg>
    </View>
  );

  if (!wordmark) {
    return <View style={style}>{mark}</View>;
  }

  return (
    <View style={[styles.wordmarkWrap, style]}>
      {mark}
      <View>
        <AppText variant="title" style={styles.wordmark}>
          VibeSync
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color={colors.textMuted}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wordmarkWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  wordmark: {
    letterSpacing: -1,
  },
});
