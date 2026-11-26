import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors, spacing } from '../theme';
import AppText from '../components/AppText';
import Logo from '../components/Logo';
import useReducedMotion from '../hooks/useReducedMotion';

export default function SplashScreen() {
  const reduceMotion = useReducedMotion();
  const fade = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(14)).current;
  const glow = useRef(new Animated.Value(0.25)).current;

  useEffect(() => {
    if (reduceMotion) {
      fade.setValue(1);
      lift.setValue(0);
      glow.setValue(0.25);
      return undefined;
    }
    const animation = Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.spring(lift, { toValue: 0, speed: 12, bounciness: 5, useNativeDriver: true }),
      Animated.loop(
        Animated.sequence([
          Animated.timing(glow, { toValue: 0.7, duration: 1400, useNativeDriver: true }),
          Animated.timing(glow, { toValue: 0.25, duration: 1400, useNativeDriver: true }),
        ]),
      ),
    ]);
    animation.start();
    return () => animation.stop();
  }, [fade, glow, lift, reduceMotion]);

  return (
    <View style={styles.base}>
      <View style={styles.glowWrap} pointerEvents="none">
        <Animated.View style={[styles.glow, { opacity: glow }]} />
      </View>
      <Animated.View style={{ opacity: fade, transform: [{ translateY: lift }], alignItems: 'center' }}>
        <Logo size={82} />
        <AppText variant="display" style={styles.wordmark}>
          VibeSync
        </AppText>
        <AppText variant="body" color={colors.textMuted} style={styles.tagline}>
          Every beat. Every screen. Together.
        </AppText>
      </Animated.View>
      <AppText variant="micro" color={colors.textFaint} style={styles.footer}>
        SYNCHRONIZED LISTENING & WATCHING
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flex: 1,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  glowWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: colors.orangeSoft,
    transform: [{ scale: 1.7 }],
  },
  wordmark: {
    marginTop: spacing.lg,
    letterSpacing: -1.8,
  },
  tagline: {
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  footer: {
    position: 'absolute',
    bottom: 42,
    letterSpacing: 1.6,
  },
});
