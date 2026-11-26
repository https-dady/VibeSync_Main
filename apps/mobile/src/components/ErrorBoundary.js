import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../theme';
import AppText from './AppText';
import Logo from './Logo';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (__DEV__) {
      // Keep the component trace visible for local debugging.
      console.error('VibeSync UI error', error, info?.componentStack);
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.base}>
        <Logo size={54} />
        <AppText variant="title" style={styles.title}>
          Something went off beat
        </AppText>
        <AppText variant="body" color={colors.textMuted} style={styles.body}>
          The screen hit an unexpected error. Your session is safe. Try rendering it again; if
          the problem persists, restarting the app will clear it.
        </AppText>
        {__DEV__ ? (
          <AppText variant="caption" color={colors.orange} style={styles.detail}>
            {String(this.state.error?.message || this.state.error)}
          </AppText>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading the screen"
          onPress={this.reset}
          style={({ pressed }) => [styles.action, pressed && { opacity: 0.85 }]}
        >
          <AppText variant="label" weight="800" color={colors.black}>
            Try again
          </AppText>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  base: {
    flex: 1,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  title: {
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  body: {
    marginTop: spacing.sm,
    textAlign: 'center',
    maxWidth: 340,
  },
  detail: {
    marginTop: spacing.md,
    textAlign: 'center',
    maxWidth: 340,
  },
  action: {
    marginTop: spacing.xl,
    minHeight: 50,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
