import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../theme';
import Screen from '../components/Screen';
import AppText from '../components/AppText';
import Button from '../components/Button';
import Input from '../components/Input';
import Logo from '../components/Logo';
import Sheet from '../components/Sheet';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { apiError } from '../api/client';
import { getApiBaseUrl, normalizeApiUrl, setApiBaseUrl } from '../config';
import { getApiOverride, setApiOverride } from '../services/storage';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen({ navigation }) {
  const { login, notice, clearNotice } = useAuth();
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [serverSheet, setServerSheet] = useState(false);
  const [serverUrl, setServerUrl] = useState(getApiBaseUrl());

  useEffect(() => {
    getApiOverride()
      .then((value) => setServerUrl(value || getApiBaseUrl()))
      .catch(() => {});
  }, []);

  const submit = async () => {
    if (submitting.current) return;
    clearNotice?.();
    setError('');
    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (caught) {
      const normalized = apiError(caught);
      setError(normalized.message);
      showToast(normalized.message, 'error');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const saveServer = async () => {
    if (busy) return;
    try {
      const normalized = normalizeApiUrl(serverUrl);
      await setApiOverride(normalized);
      setApiBaseUrl(normalized);
      setServerSheet(false);
      showToast('Server address updated', 'success');
    } catch (caught) {
      showToast(caught.message, 'error');
    }
  };

  return (
    <Screen scroll keyboardAvoiding contentContainerStyle={styles.content}>
      <View style={styles.brandRow}>
        <Logo size={54} />
        <View style={styles.brandText}>
          <AppText variant="title" style={styles.wordmark}>
            VibeSync
          </AppText>
          <AppText variant="caption" color={colors.textMuted}>
            Together, precisely.
          </AppText>
        </View>
      </View>

      <View style={styles.heading}>
        <AppText variant="micro" color={colors.orange} style={styles.eyebrow}>
          WELCOME BACK
        </AppText>
        <AppText variant="hero">Pick up the vibe.</AppText>
        <AppText variant="body" color={colors.textMuted} style={styles.subhead}>
          Sign in to host rooms, join friends, and control every speaker from one place.
        </AppText>
      </View>

      {notice ? (
        <View style={styles.notice}>
          <AppText variant="caption" color={colors.yellow}>
            {notice}
          </AppText>
        </View>
      ) : null}

      <View style={styles.form}>
        <Input
          label="EMAIL"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          leftIcon="user"
          returnKeyType="next"
          textContentType="emailAddress"
        />
        <Input
          label="PASSWORD"
          value={password}
          onChangeText={setPassword}
          placeholder="Your password"
          secureTextEntry
          leftIcon="lock"
          returnKeyType="go"
          onSubmitEditing={submit}
          textContentType="password"
        />
        {error ? (
          <View style={styles.error}>
            <AppText variant="caption" color={colors.orange}>
              {error}
            </AppText>
          </View>
        ) : null}
        <Button title="Sign in" onPress={submit} loading={busy} icon="arrowRight" />
      </View>

      <View style={styles.links}>
        <Button
          title="Use nearby offline"
          variant="secondary"
          icon="nearby"
          onPress={() => navigation.navigate('NearbyGuest')}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('Register')}
          hitSlop={8}
        >
          <AppText variant="caption" color={colors.textMuted}>
            New to VibeSync? <AppText variant="caption" color={colors.orange} weight="800">Create an account</AppText>
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setServerSheet(true)}
          hitSlop={8}
          style={styles.serverLink}
        >
          <AppText variant="micro" color={colors.textFaint}>
            CONNECTION SETTINGS
          </AppText>
        </Pressable>
      </View>

      <View style={styles.footerNote}>
        <View style={styles.rule} />
        <AppText variant="micro" color={colors.textFaint} style={styles.footerText}>
          YOUR ACCOUNT · EVERY DEVICE
        </AppText>
      </View>

      <Sheet visible={serverSheet} onClose={() => setServerSheet(false)} title="Connection settings">
        <AppText variant="body" color={colors.textMuted} style={{ marginBottom: spacing.md }}>
          On a physical device during development, use your computer's LAN address
          (for example http://192.168.1.20:4000). Production builds require HTTPS.
        </AppText>
        <Input
          label="API BASE URL"
          value={serverUrl}
          onChangeText={setServerUrl}
          placeholder="https://api.vibesync.app"
          autoCapitalize="none"
          leftIcon="globe"
          autoCorrect={false}
        />
        <View style={styles.sheetActions}>
          <Button
            title="Use default"
            variant="secondary"
            size="sm"
            onPress={() => setServerUrl('')}
          />
          <Button title="Save address" size="sm" onPress={saveServer} />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.lg,
    minHeight: '100%',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xxl,
  },
  brandText: {
    gap: 1,
  },
  wordmark: {
    letterSpacing: -1,
  },
  heading: {
    marginBottom: spacing.xl,
  },
  eyebrow: {
    letterSpacing: 1.6,
    marginBottom: spacing.sm,
  },
  subhead: {
    marginTop: spacing.sm,
    maxWidth: 320,
  },
  notice: {
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: 'rgba(255,193,35,0.28)',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  form: {
    gap: spacing.md,
  },
  error: {
    backgroundColor: colors.orangeSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(253,133,73,0.28)',
    padding: spacing.sm,
  },
  links: {
    marginTop: spacing.xl,
    alignItems: 'center',
    gap: spacing.lg,
  },
  serverLink: {
    paddingVertical: spacing.sm,
  },
  footerNote: {
    marginTop: 'auto',
    paddingTop: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  rule: {
    width: 36,
    height: 1,
    backgroundColor: colors.borderStrong,
  },
  footerText: {
    letterSpacing: 1.4,
    textAlign: 'center',
  },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
