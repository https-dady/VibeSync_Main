import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../theme';
import Screen from '../components/Screen';
import AppText from '../components/AppText';
import Badge from '../components/Badge';
import Button from '../components/Button';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import Header from '../components/Header';
import Icon from '../components/Icon';
import Input from '../components/Input';
import SwitchRow from '../components/SwitchRow';
import { useToast } from '../components/Toast';
import { useRoom } from '../context/RoomContext';
import { apiError } from '../api/client';

function Stepper({ value, onChange, min, max, step = 1, suffix }) {
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${suffix || 'value'}`}
        disabled={value <= min}
        onPress={() => onChange(Math.max(min, value - step))}
        style={[styles.stepButton, value <= min && styles.stepDisabled]}
      >
        <Icon name="minimize" size={17} color={colors.offWhite} />
      </Pressable>
      <View style={styles.stepValue}>
        <AppText variant="section">{value}</AppText>
        {suffix ? (
          <AppText variant="micro" color={colors.textFaint}>
            {suffix.toUpperCase()}
          </AppText>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Increase ${suffix || 'value'}`}
        disabled={value >= max}
        onPress={() => onChange(Math.min(max, value + step))}
        style={[styles.stepButton, value >= max && styles.stepDisabled]}
      >
        <Icon name="plus" size={17} color={colors.offWhite} />
      </Pressable>
    </View>
  );
}

export default function RoomSettingsScreen({ navigation }) {
  const { room, isHost, updateSettings } = useRoom();
  const { showToast } = useToast();
  const [form, setForm] = useState(() => ({
    name: room?.name || '',
    description: room?.description || '',
    maxParticipants: room?.maxParticipants || 10,
    allowChat: room?.allowChat !== false,
    allowMicRequests: room?.allowMicRequests !== false,
    joinApproval: Boolean(room?.joinApproval),
    chatRateLimitPerMinute: room?.chatRateLimitPerMinute || 20,
    passwordEnabled: Boolean(room?.hasPassword),
    password: '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

  if (!room) {
    return (
      <Screen>
        <Header title="Room settings" />
        <View style={styles.centered}>
          <EmptyState
            icon="settings"
            title="No active room"
            description="Open a room you host to change its settings."
            actionLabel="Browse rooms"
            onAction={() => navigation.navigate('Rooms')}
          />
        </View>
      </Screen>
    );
  }

  if (!isHost) {
    return (
      <Screen>
        <Header title="Room settings" />
        <View style={styles.centered}>
          <EmptyState
            icon="lock"
            title="Hosts only"
            description="Only the host can change room settings."
            actionLabel="Back to room"
            onAction={() => navigation.goBack()}
          />
        </View>
      </Screen>
    );
  }

  const validate = () => {
    if (form.name.trim().length < 2) return 'Room name must be at least 2 characters.';
    if (form.name.trim().length > 80) return 'Room name must be 80 characters or fewer.';
    if (form.description.trim().length > 400) return 'Description must be 400 characters or fewer.';
    if (form.maxParticipants < room.memberCount) {
      return `Capacity cannot be below the ${room.memberCount} people already here.`;
    }
    if (form.passwordEnabled && !room.hasPassword && form.password.length < 4) {
      return 'Set a password of at least 4 characters.';
    }
    if (form.passwordEnabled && form.password && form.password.length < 4) {
      return 'The new password must be at least 4 characters.';
    }
    return '';
  };

  const save = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      maxParticipants: form.maxParticipants,
      allowChat: form.allowChat,
      allowMicRequests: form.allowMicRequests,
      joinApproval: form.joinApproval,
      chatRateLimitPerMinute: form.chatRateLimitPerMinute,
    };
    if (form.passwordEnabled && form.password) payload.password = form.password;
    if (!form.passwordEnabled && room.hasPassword) payload.password = '';
    setBusy(true);
    try {
      await updateSettings(payload);
      showToast('Room settings saved', 'success');
      setForm((current) => ({ ...current, password: '', passwordEnabled: Boolean(payload.password) }));
      navigation.goBack();
    } catch (caught) {
      const normalized = apiError(caught);
      setError(normalized.message);
      showToast(normalized.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmRemovePassword = () => {
    Alert.alert(
      'Remove the room password?',
      'New guests will no longer need a password to join. This takes effect immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove password',
          style: 'destructive',
          onPress: () => setForm((current) => ({ ...current, passwordEnabled: false, password: '' })),
        },
      ],
    );
  };

  return (
    <Screen scroll keyboardAvoiding edges={['top']}>
      <Header title="Room settings" subtitle={room.roomId} />
      <View style={styles.content}>
        <Card style={styles.statusCard}>
          <View style={styles.statusTop}>
            <Badge label={room.visibility === 'private' ? 'PRIVATE' : 'PUBLIC'} tone="orange" />
            <Badge
              label={room.mode === 'nearby' ? 'NEARBY' : 'ONLINE'}
              tone={room.mode === 'nearby' ? 'yellow' : 'neutral'}
            />
            {room.hasPassword ? <Badge label="PASSWORD" tone="neutral" icon="lock" /> : null}
          </View>
          <AppText variant="caption" color={colors.textMuted}>
            {room.memberCount} of {room.maxParticipants} seats in use. Changes apply live and are
            visible to everyone in the room.
          </AppText>
        </Card>

        <View style={styles.section}>
          <AppText variant="micro" color={colors.textMuted} style={styles.sectionLabel}>
            THE ROOM
          </AppText>
          <Input
            label="ROOM NAME"
            value={form.name}
            onChangeText={set('name')}
            placeholder="Give the room a name"
            maxLength={80}
            autoCapitalize="sentences"
            leftIcon="spark"
          />
          <Input
            label="DESCRIPTION"
            value={form.description}
            onChangeText={set('description')}
            placeholder="What is happening in this room?"
            maxLength={400}
            multiline
          />
          <View>
            <AppText variant="caption" color={colors.textMuted} style={styles.fieldLabel}>
              CAPACITY
            </AppText>
            <Stepper
              value={form.maxParticipants}
              onChange={set('maxParticipants')}
              min={Math.max(2, room.memberCount)}
              max={50}
              suffix="seats"
            />
            <AppText variant="caption" color={colors.textFaint} style={styles.helper}>
              You cannot lower capacity below the {room.memberCount} people already here.
            </AppText>
          </View>
        </View>

        <View style={styles.section}>
          <AppText variant="micro" color={colors.textMuted} style={styles.sectionLabel}>
            ACCESS & PARTICIPATION
          </AppText>
          <Card style={styles.switchCard}>
            <SwitchRow
              title="Room chat"
              description="Participants can send messages to the whole room."
              value={form.allowChat}
              onValueChange={set('allowChat')}
            />
            <SwitchRow
              title="Microphone requests"
              description="Participants can ask you to speak."
              value={form.allowMicRequests}
              onValueChange={set('allowMicRequests')}
            />
            <SwitchRow
              title="Approve each guest"
              description={
                room.visibility === 'private'
                  ? 'Private rooms always require host approval.'
                  : 'Review join requests before guests enter.'
              }
              value={room.visibility === 'private' ? true : form.joinApproval}
              onValueChange={set('joinApproval')}
              disabled={room.visibility === 'private'}
            />
          </Card>
        </View>

        <View style={styles.section}>
          <AppText variant="micro" color={colors.textMuted} style={styles.sectionLabel}>
            CHAT PACE
          </AppText>
          <View>
            <AppText variant="caption" color={colors.textMuted} style={styles.fieldLabel}>
              MAXIMUM MESSAGES PER PERSON / MINUTE
            </AppText>
            <Stepper
              value={form.chatRateLimitPerMinute}
              onChange={set('chatRateLimitPerMinute')}
              min={3}
              max={60}
              step={1}
              suffix="per min"
            />
            <AppText variant="caption" color={colors.textFaint} style={styles.helper}>
              A lower pace keeps fast-moving rooms calm. This limit applies to every participant.
            </AppText>
          </View>
        </View>

        <View style={styles.section}>
          <AppText variant="micro" color={colors.textMuted} style={styles.sectionLabel}>
            ROOM PASSWORD
          </AppText>
          <Card style={styles.switchCard}>
            <SwitchRow
              title={room.hasPassword ? 'Password is on' : 'Require a password'}
              description="Guests must enter this password before they can join."
              value={form.passwordEnabled}
              onValueChange={(value) => {
                if (!value && room.hasPassword) {
                  confirmRemovePassword();
                } else {
                  setForm((current) => ({ ...current, passwordEnabled: value }));
                }
              }}
            />
          </Card>
          {form.passwordEnabled ? (
            <Input
              label={room.hasPassword ? 'NEW PASSWORD (OPTIONAL)' : 'PASSWORD'}
              value={form.password}
              onChangeText={set('password')}
              placeholder={room.hasPassword ? 'Leave blank to keep current password' : 'At least 4 characters'}
              secureTextEntry
              maxLength={64}
              leftIcon="lock"
              hint={
                room.hasPassword
                  ? 'Leave blank to keep the existing password. Changing it does not remove anyone.'
                  : 'Share this password only with people you trust.'
              }
            />
          ) : null}
        </View>

        {error ? (
          <View style={styles.error}>
            <Icon name="close" size={15} color={colors.orange} />
            <AppText variant="caption" color={colors.orange} style={{ flex: 1 }}>
              {error}
            </AppText>
          </View>
        ) : null}

        <Button
          title="Save changes"
          icon="check"
          onPress={save}
          loading={busy}
          size="lg"
        />
        <AppText variant="caption" color={colors.textFaint} style={styles.disclaimer}>
          Public/private visibility is fixed when a room is created so existing invite links keep
          working predictably. End this room to change its visibility.
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    paddingHorizontal: spacing.lg,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  statusCard: {
    gap: spacing.sm,
  },
  statusTop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 1.3,
  },
  fieldLabel: {
    marginBottom: spacing.xs,
    letterSpacing: 0.3,
  },
  helper: {
    marginTop: spacing.xs,
    lineHeight: 17,
  },
  switchCard: {
    paddingVertical: spacing.xs,
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
  stepDisabled: {
    opacity: 0.35,
  },
  stepValue: {
    alignItems: 'center',
  },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.orangeSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(253,133,73,0.28)',
    padding: spacing.sm,
  },
  disclaimer: {
    textAlign: 'center',
    lineHeight: 17,
  },
});
