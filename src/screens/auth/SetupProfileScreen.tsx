import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { showMessage } from 'react-native-flash-message';
import { useAuthStore } from '../../stores/authStore';
import { authService } from '../../services/authService';
import { colors as themeColors, spacing as themeSpacing, radius as themeRadius, typography as themeTypography } from '../../utils/theme';
import PlatinumCirclesLogo from '../../components/PlatinumCirclesLogo';

const colors = {
  primary: themeColors?.primary ?? '#2563EB',
  primaryLight: themeColors?.primaryLight ?? '#DBEAFE',
  white: themeColors?.white ?? '#FFFFFF',
  text: themeColors?.text ?? '#111827',
  text2: themeColors?.text2 ?? '#374151',
  text3: themeColors?.text3 ?? '#9CA3AF',
  bg: themeColors?.bg ?? themeColors?.background ?? '#F8FAFC',
  border2: themeColors?.border2 ?? themeColors?.border ?? '#E5E7EB',
};

const spacing = {
  md: themeSpacing?.md ?? 12,
  lg: themeSpacing?.lg ?? 16,
  xl: themeSpacing?.xl ?? 20,
  xxl: themeSpacing?.xxl ?? 24,
};

const radius = {
  sm: themeRadius?.sm ?? 10,
  full: themeRadius?.full ?? 9999,
};

const typography = {
  sm: themeTypography?.sm ?? 14,
  md: themeTypography?.md ?? 16,
  base: themeTypography?.base ?? themeTypography?.md ?? 16,
  xxl: themeTypography?.xxl ?? 30,
};

const PROGRAMS = [
  'Master of Global Management',
  'MBA',
  'MS Finance',
  'MS Marketing',
  'MS Supply Chain',
  'Alumni',
  'Faculty',
];

export default function SetupProfileScreen() {
  const { session, refreshProfile } = useAuthStore();
  const uid = session?.user?.id;

  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [program, setProgram] = useState('');
  const [year, setYear] = useState('');
  const [location, setLocation] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function pickAvatar() {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!res.canceled && res.assets?.length) {
        setAvatar(res.assets[0].uri);
      }
    } catch (err: any) {
      showMessage({ message: err?.message ?? 'Could not open photo library', type: 'danger' });
    }
  }

  async function handleSave() {
    if (!uid) {
      showMessage({ message: 'Session not found. Please sign in again.', type: 'danger' });
      return;
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanBio = bio.trim();
    const cleanLocation = location.trim();
    const cleanYear = year.trim();

    if (!cleanUsername) {
      showMessage({ message: 'Username is required', type: 'warning' });
      return;
    }

    if (cleanUsername.length < 3) {
      showMessage({ message: 'Username must be at least 3 characters', type: 'warning' });
      return;
    }

    const parsedYear = cleanYear ? parseInt(cleanYear, 10) : null;
    if (cleanYear && Number.isNaN(parsedYear)) {
      showMessage({ message: 'Graduation year must be a valid number', type: 'warning' });
      return;
    }

    setLoading(true);

    try {
      let avatarUrl: string | undefined;

      if (avatar) {
        avatarUrl = await authService.uploadAvatar(uid, avatar);
      }

      await authService.updateProfile(uid, {
        username: cleanUsername,
        bio: cleanBio || null,
        degree_program: program || null,
        graduation_year: parsedYear,
        location: cleanLocation || null,
        avatar_url: avatarUrl ?? null,
      });

      await refreshProfile();
    } catch (err: any) {
      showMessage({ message: err?.message ?? 'Failed to save profile', type: 'danger' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoRow}>
          <PlatinumCirclesLogo size={36} />
          <Text style={styles.logoText}>Platinum<Text style={styles.logoAccent}>Circles</Text></Text>
        </View>

        <Text style={styles.title}>Complete your profile</Text>
        <Text style={styles.sub}>Help others in your circle find and connect with you.</Text>

        <TouchableOpacity style={styles.avatarWrap} onPress={pickAvatar} activeOpacity={0.85}>
          {avatar ? (
            <Image source={{ uri: avatar }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarEmoji}>📷</Text>
            </View>
          )}
          <Text style={styles.avatarLabel}>Add photo</Text>
        </TouchableOpacity>

        <View style={styles.field}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={(t) => setUsername(t.toLowerCase())}
            placeholder="e.g. donmusa"
            placeholderTextColor={colors.text3}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Bio</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            value={bio}
            onChangeText={setBio}
            placeholder="Tell your circle about yourself..."
            placeholderTextColor={colors.text3}
            multiline
            textAlignVertical="top"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Graduation Year</Text>
          <TextInput
            style={styles.input}
            value={year}
            onChangeText={setYear}
            placeholder="2026"
            placeholderTextColor={colors.text3}
            keyboardType="numeric"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Location</Text>
          <TextInput
            style={styles.input}
            value={location}
            onChangeText={setLocation}
            placeholder="Phoenix, AZ"
            placeholderTextColor={colors.text3}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Degree Program</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
          >
            {PROGRAMS.map((p) => {
              const active = program === p;

              return (
                <TouchableOpacity
                  key={p}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setProgram(p)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{p}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={handleSave}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.btnText}>Save and Continue</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.xl,
    paddingTop: 60,
    paddingBottom: 40,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  logoText: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  logoAccent: {
    color: colors.primary,
  },
  title: {
    fontSize: typography.xxl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  sub: {
    fontSize: typography.base,
    color: colors.text2,
    marginBottom: spacing.xl,
  },
  avatarWrap: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: {
    fontSize: 34,
  },
  avatarLabel: {
    fontSize: typography.sm,
    color: colors.primary,
    marginTop: 8,
    fontWeight: '600',
  },
  field: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: typography.sm,
    fontWeight: '600',
    color: colors.text2,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border2,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: typography.md,
    color: colors.text,
  },
  multilineInput: {
    height: 92,
  },
  chipsRow: {
    paddingTop: 6,
    paddingBottom: 2,
    paddingRight: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border2,
    marginRight: 8,
    backgroundColor: colors.white,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: typography.sm,
    color: colors.text2,
    fontWeight: '500',
  },
  chipTextActive: {
    color: colors.white,
  },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  btnDisabled: {
    opacity: 0.7,
  },
  btnText: {
    color: colors.white,
    fontSize: typography.md,
    fontWeight: '600',
  },
});