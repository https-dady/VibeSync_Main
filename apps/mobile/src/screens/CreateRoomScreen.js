import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../theme';
import Screen from '../components/Screen';
import AppText from '../components/AppText';
import Button from '../components/Button';
import Header from '../components/Header';
import Input from '../components/Input';
import SegmentedControl from '../components/SegmentedControl';
import SwitchRow from '../components/SwitchRow';
import { useRoom } from '../context/RoomContext';
import { useToast } from '../components/Toast';
import { roomsApi } from '../api/endpoints';
import { apiError } from '../api/client';

function Stepper({ value, onChange, min = 2, max = 50 }) {
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Fewer participants"
        disabled={value <= min}
        onPress={() => onChange(Math.max(min, value - 1))}
        style={[styles.stepButton, value <= min && { opacity: 0.35 }]}
      >
        <AppText variant="section" color={colors.offWhite}>
          −
        </AppText>
      </Pressable>
      <View style={styles.stepValue}>
        <AppText variant="section">{value}</AppText>
        <AppText variant="micro" color={colors.textFaint}>
          PEOPLE
        </AppText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="More participants"
        disabled={value >= max}
        onPress={() => onChange(Math.min(max, value + 1))}
        style={[styles.stepButton, value >= max && { opacity: 0.35 }]}
      >
        <AppText variant="section" color={colors.offWhite}>
          +
        </AppText>
      </Pressable>
    </View>
  );
}

export default function CreateRoomScreen({ navigation }) {
  const { enterCreatedRoom } = useRoom();
  const { showToast } = useToast();
  const [form, setForm] = useState({
    name: '',
    description: '',
    mode: 'online',
    mediaType: 'video',
    visibility: 'public',
    maxParticipants: 10,
    passwordEnabled: false,
    password: '',
    joinApproval: false,
    allowChat: true,
    allowMicRequests: true,
  });
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (submitting.current) return;
    setError('');
    if (form.name.trim().length < 2) {
      setError('Give your room a name (at least 2 characters).');
      return;
    }
    if (form.passwordEnabled && form.password.length < 4) {
      setError('Room passwords must be at least 4 characters.');
      return;
    }
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      mode: form.mode,
      mediaType: form.mediaType,
      visibility: form.visibility,
      maxParticipants: form.maxParticipants,
      password: form.passwordEnabled ? form.password : '',
      joinApproval: form.visibility === 'private' ? true : form.joinApproval,
      allowChat: form.allowChat,
      allowMicRequests: form.allowMicRequests,
    };
    submitting.current = true;
    setBusy(true);
    try {
      if (form.mode === 'nearby') {
        navigation.navigate('Main', {
          screen: 'Nearby',
          params: {
            hostConfig: {
              name: payload.name,
              mediaType: payload.mediaType,
              roomCode: null,
            },
          },
        });
        showToast('Ready to start a local session', 'success');
        return;
      }
      const created = await roomsApi.create(payload);
      await enterCreatedRoom(created);
      navigation.replace('Room', { roomCode: created.room.roomId });
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
      <Header title="Host a room" transparent />
      <View style={styles.heading}>
        <AppText variant="micro" color={colors.orange} style={styles.eyebrow}>
          SET THE SCENE
        </AppText>
        <AppText variant="title">Create a shared moment</AppText>
        <AppText variant="body" color={colors.textMuted} style={styles.subhead}>
          You control playback, invitations, chat, and who gets the mic.
        </AppText>
      </View>

      <View style={styles.section}>
        <AppText variant="micro" color={colors.textMuted} style={styles.sectionLabel}>
          CONNECTION
        </AppText>
        <SegmentedControl
          value={form.mode}
          onChange={set('mode')}
          options={[
            { value: 'online', label: 'Online', icon: 'globe' },
            { value: 'nearby', label: 'Nearby', icon: 'wifi' },
          ]}
        />
        <View style={styles.hintCard}>
          <AppText variant="caption" color={colors.textMuted}>
            {form.mode === 'online'
              ? 'Online rooms work across any distance. Media is relayed by the VibeSync server and playback is clock-synced.'
              : 'Nearby rooms run on your local network. No internet is needed for playback, but everyone must be within range and connected to the same Wi-Fi or hotspot.'}
          </AppText>
        </View>
      </View>

      <View style={styles.section}>
        <AppText variant="micro" color={colors.textMuted} style={styles.sectionLabel}>
          EXPERIENCE
        </AppText>
        <SegmentedControl
          value={form.mediaType}
          onChange={set('mediaType')}
          options={[
            { value: 'video', label: 'Watch', icon: 'video' },
            { value: 'audio', label: 'Listen', icon: 'music' },
          ]}
        />
      </View>

      <View style={styles.form}>
        <Input
          label="ROOM NAME"
          value={form.name}
          onChangeText={set('name')}
          placeholder="Friday night, no skips"
          maxLength={80}
          autoCapitalize="sentences"
          leftIcon="spark"
        />
        <Input
          label="DESCRIPTION (OPTIONAL)"
          value={form.description}
          onChangeText={set('description')}
          placeholder="What are we listening to or watching?"
          maxLength={400}
          multiline
        />

        <View>
          <AppText variant="caption" color={colors.textMuted} style={styles.fieldLabel}>
            VISIBILITY
          </AppText>
          <SegmentedControl
            value={form.visibility}
            onChange={(value) => {
              setForm((current) => ({
                ...current,
                visibility: value,
                joinApproval: value === 'private' ? true : current.joinApproval,
              }));
            }}
            options={[
              { value: 'public', label: 'Public', icon: 'globe' },
              { value: 'private', label: 'Private', icon: 'lock' },
            ]}
          />
          {form.visibility === 'private' ? (
            <AppText variant="caption" color={colors.textFaint} style={styles.helper}>
              Private rooms always require host approval to enter.
            </AppText>
          ) : null}
        </View>

        <View>
          <AppText variant="caption" color={colors.textMuted} style={styles.fieldLabel}>
            CAPACITY
          </AppText>
          <Stepper value={form.maxParticipants} onChange={set('maxParticipants')} />
        </View>

        <SwitchRow
          title="Require a password"
          description="Guests must enter this password before joining."
          value={form.passwordEnabled}
          onValueChange={set('passwordEnabled')}
        />
        {form.passwordEnabled ? (
          <Input
            label="ROOM PASSWORD"
            value={form.password}
            onChangeText={set('password')}
            placeholder="At least 4 characters"
            secureTextEntry
            maxLength={64}
            leftIcon="lock"
          />
        ) : null}

        <SwitchRow
          title="Approve each guest"
          description="Review every join request before they enter."
          value={form.visibility === 'private' ? true : form.joinApproval}
          onValueChange={set('joinApproval')}
          disabled={form.visibility === 'private'}
        />
        <SwitchRow
          title="Room chat"
          description="Allow participants to message the whole room."
          value={form.allowChat}
          onValueChange={set('allowChat')}
        />
        <SwitchRow
          title="Microphone requests"
          description="Participants can ask to speak; you always approve the mic."
          value={form.allowMicRequests}
          onValueChange={set('allowMicRequests')}
        />
      </View>

      {error ? (
        <View style={styles.error}>
          <AppText variant="caption" color={colors.orange}>
            {error}
          </AppText>
        </View>
      ) : null}

      <Button
        title={form.mode === 'nearby' ? 'Continue to nearby' : 'Create & go live'}
        icon={form.mode === 'nearby' ? 'wifi' : 'arrowRight'}
        onPress={submit}
        loading={busy}
        size="lg"
        style={{ marginTop: spacing.lg }}
      />
      <AppText variant="caption" color={colors.textFaint} style={styles.disclaimer}>
        Only stream media you own or are licensed to use. VibeSync does not bypass DRM or
        copy-protection.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.xxl,
  },
  heading: {
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  eyebrow: {
    letterSpacing: 1.6,
    marginBottom: spacing.xs,
  },
  subhead: {
    marginTop: spacing.xs,
  },
  section: {
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 1.2,
  },
  hintCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  form: {
    gap: spacing.sm,
  },
  fieldLabel: {
    marginBottom: spacing.xs,
    letterSpacing: 0.3,
  },
  helper: {
    marginTop: spacing.xs,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.input,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    minHeight: 62,
  },
  stepButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    alignItems: 'center',
  },
  error: {
    backgroundColor: colors.orangeSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(253,133,73,0.28)',
    padding: spacing.sm,
    marginTop: spacing.md,
  },
  disclaimer: {
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 16,
  },
});
