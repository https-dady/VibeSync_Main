import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadows, spacing } from '../theme';
import AppText from './AppText';
import Icon from './Icon';

const ToastContext = createContext({ showToast: () => {} });

export function ToastProvider({ children }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(18)).current;
  const timerRef = useRef(null);

  const hide = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 12, duration: 160, useNativeDriver: true }),
    ]).start(() => setToast(null));
  }, [opacity, translateY]);

  const showToast = useCallback(
    (message, tone = 'default') => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast({ message, tone });
      opacity.setValue(0);
      translateY.setValue(18);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          speed: 22,
          bounciness: 4,
        }),
      ]).start();
      timerRef.current = setTimeout(hide, 3200);
    },
    [hide, opacity, translateY],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={[
            styles.toast,
            {
              bottom: insets.bottom + 24,
              opacity,
              transform: [{ translateY }],
            },
            toast.tone === 'error' && styles.error,
            toast.tone === 'success' && styles.success,
          ]}
        >
          <Icon
            name={toast.tone === 'error' ? 'close' : toast.tone === 'success' ? 'check' : 'spark'}
            size={17}
            color={toast.tone === 'error' ? colors.orange : colors.yellow}
          />
          <AppText variant="caption" weight="600" style={styles.message}>
            {toast.message}
          </AppText>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    minHeight: 50,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadows.floating,
  },
  success: {
    borderColor: 'rgba(255,193,35,0.4)',
  },
  error: {
    borderColor: 'rgba(253,133,73,0.5)',
  },
  message: {
    flex: 1,
  },
});
