import React, { useEffect, useRef, useState } from 'react';
import {
  useWindowDimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { colors, radius, spacing } from '../theme';
import AppText from '../components/AppText';
import Button from '../components/Button';
import Logo from '../components/Logo';
import { setOnboardingComplete } from '../services/storage';

const pages = [
  {
    eyebrow: 'PLAY TOGETHER',
    title: 'One room.\nEvery screen.',
    body: 'Share playback with your friends. VibeSync keeps devices close to a shared timeline and helps them recover when the connection changes.',
    art: 'sync',
  },
  {
    eyebrow: 'LISTEN & WATCH TOGETHER',
    title: 'Your people,\nin the same moment.',
    body: 'Host a room, invite friends with a code, pass the mic only when you want to, and keep private messages private.',
    art: 'people',
  },
  {
    eyebrow: 'ONLINE OR IN THE ROOM',
    title: 'Together,\nwherever you are.',
    body: 'Use encrypted online sessions for distance, or nearby mode for local playback without a cellular connection.',
    art: 'nearby',
  },
];

function Illustration({ type }) {
  if (type === 'sync') {
    return (
      <Svg width={260} height={210} viewBox="0 0 260 210">
        <Defs>
          <LinearGradient id="onboardSync" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.orange} />
            <Stop offset="1" stopColor={colors.yellow} />
          </LinearGradient>
        </Defs>
        <Circle cx="130" cy="105" r="98" fill={colors.orangeSoft} />
        <Rect x="30" y="54" width="68" height="112" rx="14" fill={colors.card} stroke={colors.borderStrong} />
        <Rect x="162" y="54" width="68" height="112" rx="14" fill={colors.card} stroke={colors.borderStrong} />
        <Rect x="45" y="72" width="38" height="5" rx="2.5" fill={colors.offWhite} opacity="0.55" />
        <Rect x="177" y="72" width="38" height="5" rx="2.5" fill={colors.offWhite} opacity="0.55" />
        <Rect x="45" y="136" width="26" height="3" rx="1.5" fill={colors.textFaint} />
        <Rect x="177" y="136" width="26" height="3" rx="1.5" fill={colors.textFaint} />
        <Rect x="43" y="87" width="8" height="30" rx="4" fill="url(#onboardSync)" />
        <Rect x="57" y="82" width="8" height="40" rx="4" fill="url(#onboardSync)" opacity="0.75" />
        <Rect x="71" y="91" width="8" height="22" rx="4" fill="url(#onboardSync)" opacity="0.5" />
        <Rect x="175" y="87" width="8" height="30" rx="4" fill="url(#onboardSync)" />
        <Rect x="189" y="82" width="8" height="40" rx="4" fill="url(#onboardSync)" opacity="0.75" />
        <Rect x="203" y="91" width="8" height="22" rx="4" fill="url(#onboardSync)" opacity="0.5" />
        <Path d="M104 105h48" stroke={colors.yellow} strokeWidth="2" strokeDasharray="3 5" />
        <Circle cx="104" cy="105" r="5" fill={colors.yellow} />
        <Circle cx="152" cy="105" r="5" fill={colors.yellow} />
        <Circle cx="130" cy="105" r="12" fill={colors.black} stroke={colors.yellow} strokeWidth="2" />
        <Path d="m127 100 7 5-7 5v-10Z" fill={colors.yellow} />
      </Svg>
    );
  }
  if (type === 'people') {
    return (
      <Svg width={260} height={210} viewBox="0 0 260 210">
        <Circle cx="130" cy="105" r="98" fill={colors.yellowSoft} />
        <Circle cx="130" cy="98" r="54" fill={colors.card} stroke={colors.borderStrong} />
        <Circle cx="130" cy="95" r="17" fill={colors.yellow} />
        <Circle cx="76" cy="112" r="13" fill={colors.orange} />
        <Circle cx="184" cy="112" r="13" fill={colors.offWhite} />
        <Path d="M108 135c0-12 9-21 22-21s22 9 22 21" stroke={colors.yellow} strokeWidth="7" strokeLinecap="round" />
        <Path d="M56 133c0-9 7-16 16-16s16 7 16 16" stroke={colors.orange} strokeWidth="6" strokeLinecap="round" />
        <Path d="M165 133c0-9 7-16 16-16s16 7 16 16" stroke={colors.offWhite} strokeWidth="6" strokeLinecap="round" />
        <Path d="M22 168h216" stroke={colors.borderStrong} strokeWidth="1" />
        <Rect x="36" y="164" width="5" height="18" rx="2.5" fill={colors.orange} />
        <Rect x="48" y="156" width="5" height="34" rx="2.5" fill={colors.orange} opacity="0.8" />
        <Rect x="60" y="162" width="5" height="22" rx="2.5" fill={colors.orange} opacity="0.6" />
        <Rect x="185" y="160" width="5" height="26" rx="2.5" fill={colors.yellow} />
        <Rect x="197" y="152" width="5" height="42" rx="2.5" fill={colors.yellow} opacity="0.8" />
        <Rect x="209" y="162" width="5" height="22" rx="2.5" fill={colors.yellow} opacity="0.6" />
      </Svg>
    );
  }
  return (
    <Svg width={260} height={210} viewBox="0 0 260 210">
      <Circle cx="130" cy="105" r="98" fill={colors.orangeSoft} />
      <Circle cx="130" cy="104" r="22" fill={colors.orange} />
      <Circle cx="130" cy="104" r="9" fill={colors.black} />
      <Path d="M130 126v36" stroke={colors.yellow} strokeWidth="3" strokeLinecap="round" />
      <Path d="M130 162h-28l-18 18" stroke={colors.yellow} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M130 162h28l18 18" stroke={colors.yellow} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M67 76a88 88 0 0 1 126 0" stroke={colors.offWhite} strokeWidth="2" opacity="0.25" strokeLinecap="round" />
      <Path d="M88 92a56 56 0 0 1 84 0" stroke={colors.offWhite} strokeWidth="2" opacity="0.45" strokeLinecap="round" />
      <Path d="M107 108a26 26 0 0 1 46 0" stroke={colors.yellow} strokeWidth="2" strokeLinecap="round" />
      <Circle cx="72" cy="126" r="7" fill={colors.offWhite} />
      <Circle cx="188" cy="126" r="7" fill={colors.yellow} />
      <Rect x="92" y="30" width="76" height="22" rx="11" fill={colors.card} stroke={colors.borderStrong} />
      <Circle cx="106" cy="41" r="3" fill={colors.orange} />
      <Rect x="116" y="38" width="38" height="5" rx="2.5" fill={colors.textMuted} />
    </Svg>
  );
}

export default function OnboardingScreen({ navigation }) {
  const { width } = useWindowDimensions();
  const scrollRef = useRef(null);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    scrollRef.current?.scrollTo({ x: index * width, animated: false });
  }, [index, width]);

  const finish = async () => {
    try {
      await setOnboardingComplete();
    } finally {
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
    }
  };

  const next = () => {
    if (index >= pages.length - 1) {
      finish();
      return;
    }
    const nextIndex = index + 1;
    scrollRef.current?.scrollTo({ x: nextIndex * width, animated: true });
    setIndex(nextIndex);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Logo size={38} />
        <Pressable onPress={finish} hitSlop={12} accessibilityRole="button">
          <AppText variant="caption" color={colors.textMuted} weight="700">
            SKIP
          </AppText>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => {
          setIndex(Math.round(event.nativeEvent.contentOffset.x / width));
        }}
      >
        {pages.map((page) => (
          <ScrollView key={page.title} style={{ width }} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
            <View style={styles.art}>
              <Illustration type={page.art} />
            </View>
            <AppText variant="micro" color={colors.orange} style={styles.eyebrow}>
              {page.eyebrow}
            </AppText>
            <AppText variant="hero" style={styles.title}>
              {page.title}
            </AppText>
            <AppText variant="bodyLarge" color={colors.textMuted} style={styles.body}>
              {page.body}
            </AppText>
          </ScrollView>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {pages.map((page, dotIndex) => (
            <View
              key={page.title}
              style={[styles.dot, dotIndex === index && styles.dotActive]}
            />
          ))}
        </View>
        <Button
          title={index === pages.length - 1 ? 'Find your vibe' : 'Continue'}
          icon="arrowRight"
          onPress={next}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.black,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  page: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    justifyContent: 'center',
  },
  art: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  eyebrow: {
    letterSpacing: 1.6,
    marginBottom: spacing.sm,
  },
  title: {
    letterSpacing: -1.2,
  },
  body: {
    marginTop: spacing.md,
    maxWidth: 340,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
    gap: spacing.lg,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 7,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.borderStrong,
  },
  dotActive: {
    width: 24,
    backgroundColor: colors.orange,
    borderRadius: radius.pill,
  },
});
