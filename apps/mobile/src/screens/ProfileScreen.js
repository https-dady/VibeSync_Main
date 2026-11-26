import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing } from '../theme';
import Screen from '../components/Screen';
import AppText from '../components/AppText';
import Avatar from '../components/Avatar';
import Badge from '../components/Badge';
import Button from '../components/Button';
import ResponsiveRow from '../components/ResponsiveRow';
import Card from '../components/Card';
import Icon from '../components/Icon';
import Input from '../components/Input';
import ListRow from '../components/ListRow';
import Sheet from '../components/Sheet';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { useRoom } from '../context/RoomContext';
import { getRecentRooms } from '../services/storage';
import { apiError } from '../api/client';
import { WEB_URL } from '../config';

const AVATAR_COLORS = [
  { value: '#FD8549', label: 'Orange' },
  { value: '#FFC123', label: 'Yellow' },
  { value: '#F1F3F5', label: 'Off white' },
];

export default function ProfileScreen({ navigation }) {
  const { user, logout, updateProfile, refreshUser } = useAuth();
  const { joined, room } = useRoom();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [recent, setRecent] = useState([]);
  const [form, setForm] = useState({
    name: user?.name || '',
    bio: user?.bio || '',
    avatarColor: user?.avatarColor || colors.orange,
  });

  useEffect(() => {
    setForm({
      name: user?.name || '',
      bio: user?.bio || '',
      avatarColor: user?.avatarColor || colors.orange,
    });
  }, [user?.name, user?.bio, user?.avatarColor]);

  useFocusEffect(
    useCallback(() => {
      getRecentRooms().then(setRecent).catch(() => {});
      refreshUser().catch(() => {});
    }, [refreshUser]),
  );

  const openEdit = () => {
    setForm({
      name: user?.name || '',
      bio: user?.bio || '',
      avatarColor: user?.avatarColor || colors.orange,
    });
    setEditing(true);
  };

  const saveProfile = async () => {
    if (form.name.trim().length < 2) {
      showToast('Your name must be at least 2 characters', 'error');
      return;
    }
    setSaving(true);
    try {
      await updateProfile({
        name: form.name.trim(),
        bio: form.bio.trim(),
        avatarColor: form.avatarColor,
      });
      setEditing(false);
      showToast('Profile updated', 'success');
    } catch (caught) {
      showToast(apiError(caught).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmLogout = () => {
    Alert.alert('Sign out?', 'Your secure session tokens will be removed from this device.', [
      { text: 'Stay signed in', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          try {
            await logout();
          } catch (caught) {
            showToast(apiError(caught).message, 'error');
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  };

  const shareApp = async () => {
    try {
      await Share.share({
        title: 'VibeSync',
        message: `Watch and listen together with VibeSync. ${WEB_URL}`,
        url: WEB_URL,
      });
    } catch {
      showToast('Could not open the share sheet', 'error');
    }
  };

  const joinedDate = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString([], { month: 'short', year: 'numeric' })
    : '—';

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <View style={styles.topBar}>
        <AppText variant="micro" color={colors.orange} style={styles.eyebrow}>
          YOUR ACCOUNT
        </AppText>
        <Pressable
          onPress={() => navigation.navigate('Settings')}
          style={styles.settingsButton}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
        >
          <Icon name="settings" size={19} color={colors.offWhite} />
        </Pressable>
      </View>

      <View style={styles.identity}>
        <Avatar
          name={user?.name}
          color={user?.avatarColor}
          size={88}
          ring
          style={styles.bigAvatar}
        />
        <View style={styles.identityText}>
          <AppText variant="title" numberOfLines={1}>
            {user?.name || 'VibeSync member'}
          </AppText>
          <AppText variant="caption" color={colors.textMuted} numberOfLines={1}>
            {user?.email}
          </AppText>
          <View style={styles.badges}>
            <Badge label="SIGNED IN" tone="yellow" />
            {joined && room ? <Badge label="IN A ROOM" tone="orange" /> : null}
          </View>
        </View>
      </View>

      {user?.bio ? (
        <Card style={styles.bioCard}>
          <AppText variant="micro" color={colors.textMuted}>
            BIO
          </AppText>
          <AppText variant="body" color={colors.textMuted} style={styles.bio}>
            {user.bio}
          </AppText>
        </Card>
      ) : null}

      <ResponsiveRow style={styles.quickActions}>
        <Button
          title="Edit profile"
          icon="edit"
          variant="secondary"
          onPress={openEdit}
          style={{ flex: 1 }}
        />
        <Button
          title="Settings"
          icon="settings"
          variant="secondary"
          onPress={() => navigation.navigate('Settings')}
          style={{ flex: 1 }}
        />
      </ResponsiveRow>

      <View style={styles.section}>
        <AppText variant="section">Your activity</AppText>
        <Card padded={false}>
          <ListRow
            icon="clock"
            title="Recent rooms"
            subtitle={
              recent.length
                ? `${recent.length} room${recent.length === 1 ? '' : 's'} on this device`
                : 'Rooms you join will appear here'
            }
            right={<Badge label={String(recent.length)} />}
            onPress={() => navigation.navigate('Home')}
          />
          <View style={styles.divider} />
          <ListRow
            icon="calendar"
            title="Member since"
            subtitle={joinedDate}
            showChevron={false}
            right={<Icon name="spark" size={16} color={colors.textFaint} />}
          />
          <View style={styles.divider} />
          <ListRow
            icon="chat"
            title="Notifications"
            subtitle="Join requests and microphone updates"
            onPress={() => navigation.navigate('Notifications')}
          />
        </Card>
      </View>

      {recent.length ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <AppText variant="section">Jump back in</AppText>
            <AppText variant="caption" color={colors.textMuted}>
              On this device
            </AppText>
          </View>
          <Card padded={false}>
            {recent.slice(0, 3).map((item, index) => (
              <React.Fragment key={item.roomId}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <ListRow
                  icon={item.mediaType === 'audio' ? 'music' : 'video'}
                  title={item.name}
                  subtitle={`${item.roomId} · ${item.role === 'host' ? 'Hosted by you' : 'Joined'}`}
                  onPress={() => navigation.navigate('JoinRoom', { roomCode: item.roomId })}
                />
              </React.Fragment>
            ))}
          </Card>
        </View>
      ) : null}

      <View style={styles.section}>
        <AppText variant="section">More</AppText>
        <Card padded={false}>
          <ListRow
            icon="share"
            title="Share VibeSync"
            subtitle="Invite friends to watch and listen together"
            onPress={shareApp}
          />
          <View style={styles.divider} />
          <ListRow
            icon="settings"
            title="App settings"
            subtitle="Notifications, motion, server, and session"
            onPress={() => navigation.navigate('Settings')}
          />
          <View style={styles.divider} />
          <ListRow
            icon="shield"
            title="Security"
            subtitle="Session tokens are stored in the device keychain"
            showChevron={false}
            right={<Icon name="check" size={16} color={colors.yellow} />}
          />
        </Card>
      </View>

      <Button
        title="Sign out"
        icon="logout"
        variant="danger"
        onPress={confirmLogout}
        loading={signingOut}
        style={styles.signOut}
      />
      <AppText variant="caption" color={colors.textFaint} style={styles.version}>
        VibeSync 1.0.0 · Made for shared moments
      </AppText>

      <Sheet visible={editing} onClose={() => setEditing(false)} title="Edit profile">
        <View style={styles.editAvatarRow}>
          <Avatar name={form.name || user?.name} color={form.avatarColor} size={64} ring />
          <View style={styles.colorChoices}>
            {AVATAR_COLORS.map((choice) => (
              <Pressable
                key={choice.value}
                onPress={() => setForm((current) => ({ ...current, avatarColor: choice.value }))}
                style={[
                  styles.colorChoice,
                  { backgroundColor: choice.value },
                  form.avatarColor === choice.value && styles.colorChoiceActive,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Use ${choice.label} avatar color`}
              >
                {form.avatarColor === choice.value ? (
                  <Icon name="check" size={16} color={colors.black} />
                ) : null}
              </Pressable>
            ))}
          </View>
        </View>
        <Input
          label="NAME"
          value={form.name}
          onChangeText={(value) => setForm((current) => ({ ...current, name: value }))}
          placeholder="Your name"
          maxLength={60}
          autoCapitalize="words"
          style={{ marginTop: spacing.md }}
        />
        <Input
          label="BIO (OPTIONAL)"
          value={form.bio}
          onChangeText={(value) => setForm((current) => ({ ...current, bio: value }))}
          placeholder="A line about what you love listening to"
          maxLength={280}
          multiline
          style={{ marginTop: spacing.sm }}
        />
        <AppText variant="caption" color={colors.textMuted} style={styles.emailNote}>
          Your email stays private and is never shown in rooms.
        </AppText>
        <Button
          title="Save profile"
          icon="check"
          onPress={saveProfile}
          loading={saving}
          style={{ marginTop: spacing.md, marginBottom: spacing.sm }}
        />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxl,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  eyebrow: {
    letterSpacing: 1.6,
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  bigAvatar: {
    borderWidth: 2,
    borderColor: colors.yellow,
  },
  identityText: {
    flex: 1,
    gap: 3,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.xs,
  },
  bioCard: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  bio: {
    lineHeight: 21,
  },
  quickActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  section: {
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  signOut: {
    marginTop: spacing.xs,
  },
  version: {
    textAlign: 'center',
    marginTop: spacing.md,
  },
  editAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  colorChoices: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  colorChoice: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorChoiceActive: {
    borderColor: colors.offWhite,
  },
  emailNote: {
    marginTop: spacing.sm,
  },
});
