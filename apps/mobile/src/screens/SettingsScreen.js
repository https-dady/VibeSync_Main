import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../theme';
import Screen from '../components/Screen';
import AppText from '../components/AppText';
import Badge from '../components/Badge';
import Button from '../components/Button';
import ResponsiveRow from '../components/ResponsiveRow';
import Card from '../components/Card';
import Header from '../components/Header';
import Icon from '../components/Icon';
import Input from '../components/Input';
import ListRow from '../components/ListRow';
import SegmentedControl from '../components/SegmentedControl';
import SwitchRow from '../components/SwitchRow';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api/endpoints';
import { getApiBaseUrl, normalizeApiUrl, setApiBaseUrl } from '../config';
import {
  clearRecentRooms,
  getApiOverride,
  setApiOverride,
} from '../services/storage';
import { apiError } from '../api/client';

export default function SettingsScreen({ navigation }) {
  const { user, logout, updateProfile } = useAuth();
  const { showToast } = useToast();
  const [notifications, setNotifications] = useState(
    user?.settings?.notificationsEnabled !== false,
  );
  const [reduceMotion, setReduceMotion] = useState(
    Boolean(user?.settings?.reduceMotion),
  );
  const [preferredMediaType, setPreferredMediaType] = useState(
    user?.settings?.preferredMediaType || 'video',
  );
  const [saving, setSaving] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [serverSaving, setServerSaving] = useState(false);

  useEffect(() => {
    getApiOverride()
      .then((value) => setServerUrl(value || ''))
      .catch(() => {});
  }, []);

  const savePreferences = async () => {
    setSaving(true);
    try {
      await updateProfile({
        settings: {
          notificationsEnabled: notifications,
          reduceMotion,
          preferredMediaType,
        },
      });
      showToast('Preferences saved', 'success');
    } catch (caught) {
      showToast(apiError(caught).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveServer = async () => {
    setServerSaving(true);
    try {
      const value = normalizeApiUrl(serverUrl);
      // Clear credentials against the old server before switching origins.
      // Otherwise the API interceptor could send the old bearer token to it.
      await logout();
      await setApiOverride(value);
      setApiBaseUrl(value || null);
      showToast(
        value
          ? 'Server saved. Restart the app to reconnect to it.'
          : 'Server reset to the built-in default. Restart the app to apply it.',
        'success',
      );
    } catch (caught) {
      showToast(apiError(caught).message, 'error');
    } finally {
      setServerSaving(false);
    }
  };

  const signOutEverywhere = () => {
    Alert.alert(
      'Sign out on every device?',
      'Every refresh token for your account will be revoked, including this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out everywhere',
          style: 'destructive',
          onPress: async () => {
            try {
              await authApi.logoutAll();
              await logout();
              showToast('Signed out on all devices', 'success');
            } catch (caught) {
              showToast(`Could not revoke all sessions: ${apiError(caught).message}`, 'error');
            }
          },
        },
      ],
    );
  };

  const clearHistory = () => {
    Alert.alert('Clear recent rooms?', 'Rooms will disappear from this device’s history.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          try {
            await clearRecentRooms();
            showToast('Recent rooms cleared', 'success');
          } catch (caught) {
            showToast(apiError(caught).message, 'error');
          }
        },
      },
    ]);
  };

  return (
    <Screen scroll keyboardAvoiding edges={['top']}>
      <Header title="Settings" subtitle="Preferences, server, and session" />
      <View style={styles.content}>
        <View style={styles.section}>
          <AppText variant="micro" color={colors.textMuted} style={styles.sectionLabel}>
            EXPERIENCE
          </AppText>
          <Card style={styles.card}>
            <SwitchRow
              title="In-app notifications"
              description="Show join requests, microphone decisions, and room updates."
              value={notifications}
              onValueChange={setNotifications}
            />
            <SwitchRow
              title="Reduce motion"
              description="Use calmer transitions and avoid non-essential animation."
              value={reduceMotion}
              onValueChange={setReduceMotion}
            />
            <View style={styles.preference}>
              <AppText variant="label" weight="700">
                Preferred media
              </AppText>
              <AppText variant="caption" color={colors.textMuted} style={styles.preferenceHint}>
                Defaults new rooms toward audio or video.
              </AppText>
              <SegmentedControl
                value={preferredMediaType}
                onChange={setPreferredMediaType}
                options={[
                  { value: 'audio', label: 'Audio', icon: 'music' },
                  { value: 'video', label: 'Video', icon: 'video' },
                ]}
                style={{ marginTop: spacing.sm }}
              />
            </View>
          </Card>
          <Button
            title="Save preferences"
            icon="check"
            onPress={savePreferences}
            loading={saving}
          />
        </View>

        <View style={styles.section}>
          <AppText variant="micro" color={colors.textMuted} style={styles.sectionLabel}>
            CONNECTION
          </AppText>
          <Card style={styles.card}>
            <View style={styles.serverHeader}>
              <View style={styles.serverIcon}>
                <Icon name="globe" size={17} color={colors.yellow} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="label" weight="700">
                  API server
                </AppText>
                <AppText variant="caption" color={colors.textMuted}>
                  Currently {getApiBaseUrl()}
                </AppText>
              </View>
              <Badge label={serverUrl ? 'CUSTOM' : 'DEFAULT'} tone={serverUrl ? 'orange' : 'neutral'} />
            </View>
            <Input
              label="CUSTOM SERVER URL (OPTIONAL)"
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="https://api.example.com"
              autoCapitalize="none"
              keyboardType="url"
              leftIcon="link"
              hint="Useful for LAN development or a self-hosted VibeSync server. Restart after changing."
            />
            <ResponsiveRow style={styles.serverActions}>
              <Button
                title="Save server"
                variant="secondary"
                size="sm"
                onPress={saveServer}
                loading={serverSaving}
                style={{ flex: 1 }}
              />
              <Button
                title="Use default"
                variant="ghost"
                size="sm"
                onPress={() => {
                  setServerUrl('');
                  logout().then(() => {
                    setApiBaseUrl(null);
                    return setApiOverride(null);
                  })
                    .then(() =>
                      showToast('Default server restored. Restart to reconnect.', 'success'),
                    )
                    .catch((caught) => showToast(apiError(caught).message, 'error'));
                }}
                style={{ flex: 1 }}
              />
            </ResponsiveRow>
          </Card>
        </View>

        <View style={styles.section}>
          <AppText variant="micro" color={colors.textMuted} style={styles.sectionLabel}>
            DATA & PRIVACY
          </AppText>
          <Card padded={false}>
            <ListRow
              icon="clock"
              title="Clear recent rooms"
              subtitle="Remove this device's local room history"
              onPress={clearHistory}
            />
            <View style={styles.divider} />
            <ListRow
              icon="shield"
              title="Account security"
              subtitle="Session tokens stay in the OS keychain or keystore"
              showChevron={false}
              right={<Icon name="check" size={16} color={colors.yellow} />}
            />
            <View style={styles.divider} />
            <ListRow
              icon="lock"
              title="Privacy"
              subtitle="Private host messages are visible only to you and the host"
              showChevron={false}
            />
          </Card>
        </View>

        <View style={styles.section}>
          <AppText variant="micro" color={colors.textMuted} style={styles.sectionLabel}>
            SESSION
          </AppText>
          <Card padded={false}>
            <ListRow
              icon="logout"
              tone="danger"
              title="Sign out everywhere"
              subtitle="Revoke every session for your account"
              onPress={signOutEverywhere}
            />
            <View style={styles.divider} />
            <ListRow
              icon="user"
              title={user?.email || 'Signed in'}
              subtitle="Signed in on this device"
              showChevron={false}
            />
          </Card>
        </View>

        <View style={styles.about}>
          <View style={styles.aboutMark}>
            <Icon name="headphones" size={20} color={colors.black} />
          </View>
          <AppText variant="caption" color={colors.textMuted} style={styles.aboutText}>
            VibeSync 1.0.0 — synchronized media rooms for the people you share moments with.
            Only stream media you own or are licensed to use.
          </AppText>
        </View>

        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.backRow}
          accessibilityRole="button"
        >
          <Icon name="arrowLeft" size={15} color={colors.orange} />
          <AppText variant="caption" color={colors.orange} weight="700">
            Back
          </AppText>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 1.3,
  },
  card: {
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  preference: {
    paddingVertical: spacing.sm,
  },
  preferenceHint: {
    marginTop: 3,
  },
  serverHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  serverIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.yellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serverActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  about: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  aboutMark: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aboutText: {
    flex: 1,
    lineHeight: 18,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'center',
    padding: spacing.sm,
  },
});
