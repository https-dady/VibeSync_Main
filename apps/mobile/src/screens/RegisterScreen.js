import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../theme';
import Screen from '../components/Screen';
import AppText from '../components/AppText';
import Button from '../components/Button';
import Input from '../components/Input';
import Header from '../components/Header';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { apiError } from '../api/client';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterScreen({ navigation }) {
  const { register } = useAuth();
  const { showToast } = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  const change = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (submitting.current) return;
    setError('');
    if (form.name.trim().length < 2) {
      setError('Enter your name (at least 2 characters).');
      return;
    }
    if (!EMAIL_RE.test(form.email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) {
      setError('Use at least 8 characters with a letter and a number.');
      return;
    }
    if (form.password !== form.confirm) {
      setError('Passwords do not match.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      await register({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
      });
      showToast('Your VibeSync account is ready', 'success');
    } catch (caught) {
      const normalized = apiError(caught);
      setError(normalized.message);
      showToast(normalized.message, 'error');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <Screen scroll keyboardAvoiding contentContainerStyle={styles.content}>
      <Header title="Create account" transparent />
      <View style={styles.heading}>
        <AppText variant="micro" color={colors.orange} style={styles.eyebrow}>
          YOUR PEOPLE ARE WAITING
        </AppText>
        <AppText variant="hero">Start a room.{'\n'}Share the moment.</AppText>
        <AppText variant="body" color={colors.textMuted} style={styles.subhead}>
          One account works on Android and iOS. Create your profile and invite friends to your
          next shared moment.
        </AppText>
      </View>

      <View style={styles.form}>
        <Input
          label="DISPLAY NAME"
          value={form.name}
          onChangeText={change('name')}
          placeholder="How friends see you"
          leftIcon="user"
          autoCapitalize="words"
          maxLength={60}
          textContentType="name"
        />
        <Input
          label="EMAIL"
          value={form.email}
          onChangeText={change('email')}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          leftIcon="user"
          textContentType="emailAddress"
        />
        <Input
          label="PASSWORD"
          value={form.password}
          onChangeText={change('password')}
          placeholder="At least 8 characters"
          secureTextEntry
          leftIcon="lock"
          textContentType="newPassword"
          hint="Must include a letter and a number."
        />
        <Input
          label="CONFIRM PASSWORD"
          value={form.confirm}
          onChangeText={change('confirm')}
          placeholder="Repeat your password"
          secureTextEntry
          leftIcon="lock"
          returnKeyType="go"
          onSubmitEditing={submit}
          textContentType="newPassword"
        />
        {error ? (
          <View style={styles.error}>
            <AppText variant="caption" color={colors.orange}>
              {error}
            </AppText>
          </View>
        ) : null}
        <Button title="Create account" onPress={submit} loading={busy} icon="arrowRight" />
      </View>

      <Pressable
        onPress={() => navigation.goBack()}
        style={styles.loginLink}
        accessibilityRole="button"
      >
        <AppText variant="caption" color={colors.textMuted}>
          Already have an account?{' '}
          <AppText variant="caption" color={colors.orange} weight="800">
            Sign in
          </AppText>
        </AppText>
      </Pressable>

      <AppText variant="micro" color={colors.textFaint} style={styles.legal}>
        BY CONTINUING YOU AGREE TO USE VIBESYNC RESPONSIBLY AND TO ONLY SHARE MEDIA YOU HAVE THE
        RIGHT TO STREAM.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.xxl,
  },
  heading: {
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  eyebrow: {
    letterSpacing: 1.6,
    marginBottom: spacing.sm,
  },
  subhead: {
    marginTop: spacing.md,
    maxWidth: 330,
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
  loginLink: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  legal: {
    marginTop: spacing.xxl,
    lineHeight: 17,
    letterSpacing: 0.8,
    textAlign: 'center',
  },
});
