import { DefaultTheme } from '@react-navigation/native';

export const colors = {
  black: '#000000',
  orange: '#FD8549',
  yellow: '#FFC123',
  offWhite: '#F1F3F5',
  // Surfaces are translucent off-white over black, keeping the palette to the
  // four brand colors while preserving depth.
  surface: 'rgba(241, 243, 245, 0.03)',
  card: 'rgba(241, 243, 245, 0.05)',
  raised: 'rgba(241, 243, 245, 0.08)',
  input: 'rgba(241, 243, 245, 0.04)',
  border: 'rgba(241, 243, 245, 0.10)',
  borderStrong: 'rgba(241, 243, 245, 0.20)',
  textMuted: 'rgba(241, 243, 245, 0.72)',
  textFaint: 'rgba(241, 243, 245, 0.60)',
  scrim: 'rgba(0, 0, 0, 0.72)',
  orangeSoft: 'rgba(253, 133, 73, 0.14)',
  yellowSoft: 'rgba(255, 193, 35, 0.12)',
  offWhiteSoft: 'rgba(241, 243, 245, 0.07)',
};

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 28,
  xxl: 36,
  pill: 999,
};

export const typography = {
  display: { fontSize: 42, lineHeight: 46, fontWeight: '800', letterSpacing: -1.4 },
  hero: { fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -1 },
  title: { fontSize: 27, lineHeight: 33, fontWeight: '800', letterSpacing: -0.6 },
  section: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.3 },
  bodyLarge: { fontSize: 17, lineHeight: 25, fontWeight: '500' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
  label: { fontSize: 14, lineHeight: 19, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  micro: { fontSize: 10, lineHeight: 14, fontWeight: '700', letterSpacing: 1.1 },
};

export const shadows = {
  floating: {
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.5,
    shadowRadius: 30,
    elevation: 14,
  },
  soft: {
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
};

export const layout = {
  screenPadding: 20,
  tabBarHeight: 74,
  headerHeight: 56,
};

// Navigation font weights use system fonts on both platforms.
export const fonts = {
  regular: { fontFamily: 'System', fontWeight: '400' },
  medium: { fontFamily: 'System', fontWeight: '500' },
  bold: { fontFamily: 'System', fontWeight: '700' },
  heavy: { fontFamily: 'System', fontWeight: '900' },
};

// Shared navigation theme.
export const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.orange,
    background: colors.black,
    card: colors.black,
    text: colors.offWhite,
    border: colors.borderStrong,
    notification: colors.yellow,
  },
  fonts: fonts,
};
