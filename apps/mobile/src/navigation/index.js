import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';

import {
  NavigationContainer,
  createNavigationContainerRef,
  DarkTheme,
} from '@react-navigation/native';

import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { colors } from '../theme';
import { useAuth } from '../context/AuthContext';
import useReducedMotion from '../hooks/useReducedMotion';

import {
  getOnboardingComplete,
  getPendingInvite,
  setPendingInvite,
} from '../services/storage';

import { parseInviteUrl } from '../utils/deepLinks';

import SplashScreen from '../screens/SplashScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';

import MainTabs from './MainTabs';

import CreateRoomScreen from '../screens/CreateRoomScreen';
import JoinRoomScreen from '../screens/JoinRoomScreen';
import RoomScreen from '../screens/RoomScreen';
import RoomChatScreen from '../screens/RoomChatScreen';
import HostChatScreen from '../screens/HostChatScreen';
import ParticipantsScreen from '../screens/ParticipantsScreen';
import HostControlsScreen from '../screens/HostControlsScreen';
import MicRequestsScreen from '../screens/MicRequestsScreen';
import JoinRequestsScreen from '../screens/JoinRequestsScreen';
import RoomSettingsScreen from '../screens/RoomSettingsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ShareRoomScreen from '../screens/ShareRoomScreen';
import NearbyScreen from '../screens/NearbyScreen';

const Stack = createNativeStackNavigator();

/**
 * Explicit React Navigation font configuration.
 * Prevents native-stack from receiving undefined fonts.
 */
const navFonts = Platform.select({
  ios: {
    regular: {
      fontFamily: 'System',
      fontWeight: '400',
    },
    medium: {
      fontFamily: 'System',
      fontWeight: '500',
    },
    bold: {
      fontFamily: 'System',
      fontWeight: '600',
    },
    heavy: {
      fontFamily: 'System',
      fontWeight: '700',
    },
  },

  default: {
    regular: {
      fontFamily: 'sans-serif',
      fontWeight: 'normal',
    },
    medium: {
      fontFamily: 'sans-serif-medium',
      fontWeight: 'normal',
    },
    bold: {
      fontFamily: 'sans-serif',
      fontWeight: '600',
    },
    heavy: {
      fontFamily: 'sans-serif',
      fontWeight: '700',
    },
  },
});

/**
 * Application navigation theme.
 */
const navigationTheme = {
  ...DarkTheme,

  dark: true,

  fonts: navFonts,

  colors: {
    ...DarkTheme.colors,

    primary: colors.orange,
    background: colors.black,
    card: colors.card,
    text: colors.offWhite,
    border: colors.border,
    notification: colors.orange,
  },
};

export const navigationRef = createNavigationContainerRef();

const baseScreenOptions = {
  headerShown: false,
  contentStyle: {
    backgroundColor: colors.black,
  },
  animation: 'slide_from_right',
};

export default function RootNavigator() {
  const { booting, isAuthenticated, user } = useAuth();
  const reduceMotion = useReducedMotion(user?.settings?.reduceMotion);

  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [navigationReady, setNavigationReady] = useState(false);

  const initialLinkHandled = useRef(false);
  const pendingNavigation = useRef(false);

  useEffect(() => {
    let mounted = true;

    getOnboardingComplete()
      .then((value) => {
        if (mounted) {
          setOnboardingComplete(Boolean(value));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) {
          setOnboardingChecked(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (isAuthenticated) return;

    getOnboardingComplete()
      .then((value) => {
        setOnboardingComplete(Boolean(value));
      })
      .catch(() => {});
  }, [isAuthenticated]);

  const openInvite = useCallback((roomCode) => {
    if (!navigationRef.isReady()) return false;

    navigationRef.navigate('JoinRoom', { roomCode });

    return true;
  }, []);

  const handleUrl = useCallback(
    async (url) => {
      const invite = parseInviteUrl(url);

      if (!invite) return;

      if (isAuthenticated) {
        const opened = openInvite(invite.roomCode);

        if (!opened) {
          await setPendingInvite(invite.roomCode);
        }
      } else {
        await setPendingInvite(invite.roomCode).catch(() => {});
      }
    },
    [isAuthenticated, openInvite],
  );

  useEffect(() => {
    const subscription = Linking.addEventListener('url', (event) => {
      handleUrl(event.url).catch(() => {});
    });

    if (!initialLinkHandled.current) {
      initialLinkHandled.current = true;

      Linking.getInitialURL()
        .then((url) => handleUrl(url))
        .catch(() => {});
    }

    return () => subscription.remove();
  }, [handleUrl]);

  useEffect(() => {
    if (
      !isAuthenticated ||
      !navigationReady ||
      booting ||
      !onboardingChecked
    ) {
      return;
    }

    if (pendingNavigation.current) return;

    let active = true;

    const consume = async () => {
      try {
        const pending = await getPendingInvite();

        if (!active || !pending) return;

        pendingNavigation.current = true;

        await setPendingInvite(null);

        if (navigationRef.isReady() && isAuthenticated) {
          const currentRoute = navigationRef.getCurrentRoute();

          if (currentRoute?.name !== 'JoinRoom') {
            openInvite(String(pending).toUpperCase());
          }
        }
      } catch {
        // A malformed or stale invite must never block sign-in.
      } finally {
        pendingNavigation.current = false;
      }
    };

    const timer = setTimeout(consume, 180);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    booting,
    isAuthenticated,
    navigationReady,
    onboardingChecked,
    openInvite,
  ]);

  if (booting || !onboardingChecked) {
    return <SplashScreen />;
  }

  const initialRouteName = !onboardingComplete
    ? 'Onboarding'
    : !isAuthenticated
      ? 'Login'
      : 'Main';

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => setNavigationReady(true)}
      fallback={<SplashScreen />}
      theme={navigationTheme}
    >
      <Stack.Navigator
        initialRouteName={initialRouteName}
        screenOptions={{ ...baseScreenOptions, animation: reduceMotion ? 'none' : baseScreenOptions.animation }}
      >
        {!isAuthenticated ? (
          <>
            {!onboardingComplete ? (
              <Stack.Screen
                name="Onboarding"
                component={OnboardingScreen}
              />
            ) : null}

            <Stack.Screen
              name="Login"
              component={LoginScreen}
            />

            <Stack.Screen
              name="Register"
              component={RegisterScreen}
              options={{
                animation: reduceMotion ? 'none' : 'slide_from_bottom',
              }}
            />
            <Stack.Screen name="NearbyGuest" component={NearbyScreen} />
          </>
        ) : (
          <>
            <Stack.Screen
              name="Main"
              component={MainTabs}
            />

            <Stack.Screen
              name="CreateRoom"
              component={CreateRoomScreen}
            />

            <Stack.Screen
              name="JoinRoom"
              component={JoinRoomScreen}
              options={{
                animation: reduceMotion ? 'none' : 'slide_from_bottom',
              }}
            />

            <Stack.Screen
              name="Room"
              component={RoomScreen}
              options={{
                gestureEnabled: false,
              }}
            />

            <Stack.Screen
              name="RoomChat"
              component={RoomChatScreen}
            />

            <Stack.Screen
              name="HostChat"
              component={HostChatScreen}
            />

            <Stack.Screen
              name="Participants"
              component={ParticipantsScreen}
            />

            <Stack.Screen
              name="HostControls"
              component={HostControlsScreen}
            />

            <Stack.Screen
              name="MicRequests"
              component={MicRequestsScreen}
            />

            <Stack.Screen
              name="JoinRequests"
              component={JoinRequestsScreen}
            />

            <Stack.Screen
              name="RoomSettings"
              component={RoomSettingsScreen}
            />

            <Stack.Screen
              name="Notifications"
              component={NotificationsScreen}
            />

            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
            />

            <Stack.Screen
              name="ShareRoom"
              component={ShareRoomScreen}
              options={{
                presentation: 'modal',
                animation: reduceMotion ? 'none' : 'slide_from_bottom',
              }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.black,
  },
});

export function RootFallback() {
  return <View style={styles.splash} />;
}
