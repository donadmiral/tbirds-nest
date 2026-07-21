import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Image,
  Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import { supabase } from '../../services/supabase';
import { authService } from '../../services/authService';
import { useAuthStore } from '../../stores/authStore';
import { isAsuEmail } from '../../utils/isAsuEmail';

const { height: SCREEN_H } = Dimensions.get('window');

const NAVY = '#0B1E3D';
const WHITE = '#FFFFFF';
const GRAY_100 = '#F3F4F6';
const GRAY_200 = '#E5E7EB';
const GRAY_300 = '#D1D5DB';
const GRAY_400 = '#9CA3AF';
const GRAY_500 = '#6B7280';
const GRAY_700 = '#374151';
const GRAY_900 = '#111827';
const GREEN_500 = '#16A34A';
const GREEN_50 = '#F0FDF4';
const RED_500 = '#DC2626';
const MAROON = '#8C1D40';
const GOLD = '#FFC627';

export default function SetupProfileScreen() {
  const { session, refreshProfile } = useAuthStore();
  const userEmail = session?.user?.email ?? '';
  const userFullName = session?.user?.user_metadata?.full_name ?? '';
  const isASU = isAsuEmail(userEmail);

  const [step, setStep] = useState<1 | 2>(1);

  // Step 1
  const [displayName, setDisplayName] = useState(userFullName);
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const usernameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 2
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  // ASU-specific
  const [degree, setDegree] = useState('');
  const [gradYear, setGradYear] = useState('');
  const [gradSemester, setGradSemester] = useState('');
  const [fraternity, setFraternity] = useState('');

  // Public-specific
  const [headline, setHeadline] = useState('');
  const [workplace, setWorkplace] = useState('');
  const [school, setSchool] = useState('');

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (userFullName) {
      const parts = userFullName.trim().split(' ');
      setFirstName(parts[0] || '');
      setLastName(parts.slice(1).join(' ') || '');
    }
  }, [userFullName]);

  useEffect(() => {
    if (userFullName && !username) {
      const clean = userFullName.trim().split(' ')[0].replace(/[^a-zA-Z0-9_]/g, '');
      if (clean) setUsername(clean.toLowerCase());
    }
  }, [userFullName]);

  useEffect(() => {
    if (!username || username.length < 2) {
      setUsernameStatus('idle');
      return;
    }
    setUsernameStatus('checking');
    if (usernameTimer.current) clearTimeout(usernameTimer.current);
    usernameTimer.current = setTimeout(async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('id')
          .eq('username', username.toLowerCase())
          .maybeSingle();
        setUsernameStatus(data ? 'taken' : 'available');
      } catch {
        setUsernameStatus('idle');
      }
    }, 500);
    return () => { if (usernameTimer.current) clearTimeout(usernameTimer.current); };
  }, [username]);

  async function handlePickAvatar() {
    try {
      const url = await authService.pickAndUploadAvatar(session?.user?.id ?? '');
      if (url) setAvatarUri(url);
    } catch (err: any) {
      showMessage({ message: err?.message ?? 'Failed to upload photo', type: 'danger' });
    }
  }

  function handleContinueToStep2() {
    if (!username || username.length < 2) {
      showMessage({ message: 'Pick a username (at least 2 characters)', type: 'warning' });
      return;
    }
    if (usernameStatus === 'taken') {
      showMessage({ message: 'That username is taken', type: 'warning' });
      return;
    }
    if (usernameStatus === 'checking') {
      showMessage({ message: 'Checking username, please wait', type: 'info' });
      return;
    }
    setStep(2);
  }

  async function handleComplete() {
    if (!firstName.trim()) {
      showMessage({ message: 'Enter your first name', type: 'warning' });
      return;
    }
    if (!lastName.trim()) {
      showMessage({ message: 'Enter your last name', type: 'warning' });
      return;
    }

    const userId = session?.user?.id;
    if (!userId) return;

    setSaving(true);
    try {
      const updates: Record<string, any> = {
        username: username.toLowerCase().trim(),
        full_name: `${firstName.trim()} ${lastName.trim()}`,
        bio: bio.trim() || null,
      };

      if (avatarUri) updates.avatar_url = avatarUri;

      if (isASU) {
        updates.degree_program = degree.trim() || null;
        updates.graduation_year = gradYear ? parseInt(gradYear) : null;
        updates.graduation_semester = gradSemester.trim() || null;
        if (fraternity.trim()) updates.cohort = fraternity.trim();
      } else {
        updates.headline = headline.trim() || null;
        updates.workplace = workplace.trim() || null;
        updates.school = school.trim() || null;
      }

      await authService.updateProfile(userId, updates);
      await refreshProfile();

      showMessage({
        message: 'Profile created',
        description: isASU ? 'Welcome to the ASU network!' : 'Welcome to PlatinumCircles!',
        type: 'success',
        duration: 3000,
      });
    } catch (err: any) {
      showMessage({ message: err?.message ?? 'Failed to save profile', type: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  // ============ STEP 1 ============
  if (step === 1) {
    return (
      <View style={s.root}>
        <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={s.stepContainer} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

            {/* Account type badge */}
            <View style={[s.typeBadge, isASU ? s.typeBadgeASU : s.typeBadgePublic]}>
              <Feather name={isASU ? 'shield' : 'globe'} size={12} color={isASU ? MAROON : NAVY} />
              <Text style={[s.typeBadgeTxt, isASU ? s.typeBadgeTxtASU : s.typeBadgeTxtPublic]}>
                {isASU ? 'ASU Exclusive Account' : 'Public Account'}
              </Text>
            </View>

            {/* Verified badge */}
            <View style={s.verifiedBadge}>
              <Feather name="check" size={12} color={GREEN_500} />
              <Text style={s.verifiedTxt}>Email Verified</Text>
            </View>

            <Text style={s.stepTitle}>Welcome to PlatinumCircles</Text>
            <Text style={s.stepSub}>Let's set up your identity</Text>

            {/* Email (read-only) */}
            <View style={[s.inputWrap, s.inputReadOnly]}>
              <Feather name="mail" size={16} color={GRAY_400} style={s.inputIcon} />
              <Text style={s.inputReadOnlyTxt} numberOfLines={1}>{userEmail}</Text>
              {isASU && (
                <View style={s.asuInlineBadge}>
                  <Text style={s.asuInlineTxt}>ASU</Text>
                </View>
              )}
            </View>

            <View style={s.divider} />

            {/* Name */}
            <View style={s.inputWrap}>
              <Feather name="user" size={16} color={GRAY_400} style={s.inputIcon} />
              <TextInput
                style={s.input}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Full name"
                placeholderTextColor={GRAY_400}
                autoCapitalize="words"
              />
            </View>

            {/* Username */}
            <Text style={s.fieldLabel}>Pick a username</Text>
            <View style={s.inputWrap}>
              <Text style={s.atSymbol}>@</Text>
              <TextInput
                style={s.input}
                value={username}
                onChangeText={(t) => setUsername(t.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                placeholder="username"
                placeholderTextColor={GRAY_400}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {usernameStatus === 'checking' && <ActivityIndicator size={14} color={GRAY_400} style={s.usernameIndicator} />}
              {usernameStatus === 'available' && <Feather name="check-circle" size={16} color={GREEN_500} style={s.usernameIndicator} />}
              {usernameStatus === 'taken' && <Feather name="x-circle" size={16} color={RED_500} style={s.usernameIndicator} />}
            </View>
            {usernameStatus === 'available' && <Text style={s.usernameAvailable}>Available</Text>}
            {usernameStatus === 'taken' && <Text style={s.usernameTaken}>That username is taken</Text>}

            <TouchableOpacity
              style={[s.primaryBtn, isASU && s.primaryBtnASU, { marginTop: 20 }]}
              onPress={handleContinueToStep2}
              activeOpacity={0.85}
            >
              <Text style={[s.primaryBtnTxt, isASU && s.primaryBtnTxtASU]}>Continue</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  // ============ STEP 2 ============
  return (
    <View style={s.root}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.stepContainer} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Header */}
          <View style={[s.typeBadge, isASU ? s.typeBadgeASU : s.typeBadgePublic, { marginBottom: 12 }]}>
            <Feather name={isASU ? 'shield' : 'globe'} size={12} color={isASU ? MAROON : NAVY} />
            <Text style={[s.typeBadgeTxt, isASU ? s.typeBadgeTxtASU : s.typeBadgeTxtPublic]}>
              {isASU ? 'ASU Profile' : 'Public Profile'}
            </Text>
          </View>

          <Text style={s.stepTitle}>Complete your profile</Text>
          <Text style={s.stepSub}>Step 2 of 2</Text>

          {/* Avatar */}
          <TouchableOpacity style={s.avatarWrap} onPress={handlePickAvatar} activeOpacity={0.8}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={s.avatarImg} />
            ) : (
              <View style={[s.avatarPlaceholder, isASU && s.avatarPlaceholderASU]}>
                <Feather name="camera" size={22} color={isASU ? MAROON : GRAY_400} />
              </View>
            )}
            <View style={[s.avatarBadge, isASU && s.avatarBadgeASU]}>
              <Feather name="plus" size={10} color={WHITE} />
            </View>
          </TouchableOpacity>
          <Text style={s.avatarHint}>Add a photo</Text>

          {/* Name fields */}
          <View style={s.inputWrap}>
            <TextInput style={s.inputNoIcon} value={firstName} onChangeText={setFirstName} placeholder="First name" placeholderTextColor={GRAY_400} autoCapitalize="words" />
          </View>
          <View style={s.inputWrap}>
            <TextInput style={s.inputNoIcon} value={lastName} onChangeText={setLastName} placeholder="Last name" placeholderTextColor={GRAY_400} autoCapitalize="words" />
          </View>

          {/* ASU-specific fields */}
          {isASU && (
            <>
              <Text style={s.sectionLabel}>ASU Details</Text>

              <View style={s.inputWrap}>
                <Feather name="book" size={16} color={GRAY_400} style={s.inputIcon} />
                <TextInput
                  style={s.input}
                  value={degree}
                  onChangeText={setDegree}
                  placeholder="Degree / Program (optional)"
                  placeholderTextColor={GRAY_400}
                  autoCapitalize="words"
                />
              </View>

              <View style={s.rowFields}>
                <View style={[s.inputWrap, { flex: 1 }]}>
                  <TextInput style={s.inputNoIcon} value={gradYear} onChangeText={setGradYear} placeholder="Grad year" placeholderTextColor={GRAY_400} keyboardType="number-pad" maxLength={4} />
                </View>
                <View style={[s.inputWrap, { flex: 1 }]}>
                  <TextInput style={s.inputNoIcon} value={gradSemester} onChangeText={setGradSemester} placeholder="Semester" placeholderTextColor={GRAY_400} autoCapitalize="words" />
                </View>
              </View>

              <View style={s.inputWrap}>
                <Feather name="users" size={16} color={GRAY_400} style={s.inputIcon} />
                <TextInput style={s.input} value={fraternity} onChangeText={setFraternity} placeholder="Fraternity / Sorority (optional)" placeholderTextColor={GRAY_400} autoCapitalize="words" />
              </View>
            </>
          )}

          {/* Public-specific fields */}
          {!isASU && (
            <>
              <Text style={s.sectionLabel}>About You</Text>

              <View style={s.inputWrap}>
                <Feather name="briefcase" size={16} color={GRAY_400} style={s.inputIcon} />
                <TextInput style={s.input} value={headline} onChangeText={setHeadline} placeholder="Headline (e.g. Product Manager at Google)" placeholderTextColor={GRAY_400} autoCapitalize="sentences" />
              </View>

              <View style={s.inputWrap}>
                <Feather name="home" size={16} color={GRAY_400} style={s.inputIcon} />
                <TextInput style={s.input} value={workplace} onChangeText={setWorkplace} placeholder="Company / Organization" placeholderTextColor={GRAY_400} autoCapitalize="words" />
              </View>

              <View style={s.inputWrap}>
                <Feather name="award" size={16} color={GRAY_400} style={s.inputIcon} />
                <TextInput style={s.input} value={school} onChangeText={setSchool} placeholder="School / University (optional)" placeholderTextColor={GRAY_400} autoCapitalize="words" />
              </View>
            </>
          )}

          {/* Bio */}
          <View style={[s.inputWrap, { minHeight: 80, alignItems: 'flex-start' }]}>
            <TextInput
              style={[s.inputNoIcon, { textAlignVertical: 'top', paddingTop: 12, minHeight: 76 }]}
              value={bio} onChangeText={setBio}
              placeholder={isASU ? 'Tell the ASU community about yourself...' : 'Write a short bio...'}
              placeholderTextColor={GRAY_400}
              multiline maxLength={300}
            />
          </View>
          <Text style={s.charCount}>{bio.length}/300</Text>

          {/* Finish */}
          <TouchableOpacity
            style={[s.primaryBtn, isASU && s.primaryBtnASU, saving && s.primaryBtnDisabled]}
            onPress={handleComplete} disabled={saving} activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color={isASU ? MAROON : WHITE} size={16} />
            ) : (
              <Text style={[s.primaryBtnTxt, isASU && s.primaryBtnTxtASU]}>
                {isASU ? 'Join ASU Network' : 'Join PlatinumCircles'}
              </Text>
            )}
          </TouchableOpacity>

          {/* Back */}
          <TouchableOpacity style={s.backStepBtn} onPress={() => setStep(1)} activeOpacity={0.7}>
            <Feather name="arrow-left" size={14} color={GRAY_500} />
            <Text style={s.backStepTxt}>Back to details</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: WHITE },
  flex: { flex: 1 },
  stepContainer: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: SCREEN_H * 0.07,
    paddingBottom: 40,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
    marginBottom: 8,
  },
  typeBadgeASU: { backgroundColor: '#FFF5F0', borderWidth: 1, borderColor: '#FECDD3' },
  typeBadgePublic: { backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE' },
  typeBadgeTxt: { fontSize: 12, fontWeight: '700' },
  typeBadgeTxtASU: { color: MAROON },
  typeBadgeTxtPublic: { color: NAVY },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'center',
    backgroundColor: GREEN_50, paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 20, gap: 4, marginBottom: 14,
  },
  verifiedTxt: { fontSize: 12, fontWeight: '600', color: GREEN_500 },
  stepTitle: { fontSize: 22, fontWeight: '700', color: GRAY_900, textAlign: 'center', marginBottom: 4 },
  stepSub: { fontSize: 13, color: GRAY_500, textAlign: 'center', marginBottom: 20 },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: GRAY_900, marginTop: 16, marginBottom: 10 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: GRAY_100, borderWidth: 0.5, borderColor: GRAY_200,
    borderRadius: 12, marginBottom: 10, position: 'relative',
  },
  inputReadOnly: { opacity: 0.6 },
  inputReadOnlyTxt: { flex: 1, paddingVertical: 14, paddingHorizontal: 10, fontSize: 15, color: GRAY_700 },
  inputIcon: { marginLeft: 14 },
  input: { flex: 1, paddingVertical: 14, paddingHorizontal: 10, fontSize: 15, color: GRAY_900 },
  inputNoIcon: { flex: 1, paddingVertical: 14, paddingHorizontal: 14, fontSize: 15, color: GRAY_900 },
  atSymbol: { marginLeft: 14, fontSize: 15, fontWeight: '600', color: GRAY_500 },
  usernameIndicator: { marginRight: 14 },
  usernameAvailable: { fontSize: 12, color: GREEN_500, marginTop: -6, marginBottom: 6, marginLeft: 4 },
  usernameTaken: { fontSize: 12, color: RED_500, marginTop: -6, marginBottom: 6, marginLeft: 4 },
  fieldLabel: { fontSize: 13, color: GRAY_500, marginBottom: 6, marginTop: 4 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: GRAY_200, marginVertical: 10 },
  asuInlineBadge: { backgroundColor: MAROON, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginRight: 10 },
  asuInlineTxt: { fontSize: 11, fontWeight: '800', color: GOLD, letterSpacing: 0.5 },
  primaryBtn: { backgroundColor: NAVY, borderRadius: 12, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
  primaryBtnASU: { backgroundColor: GOLD },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnTxt: { fontSize: 16, fontWeight: '700', color: WHITE },
  primaryBtnTxtASU: { color: MAROON },
  avatarWrap: { width: 80, height: 80, alignSelf: 'center', marginBottom: 4, position: 'relative' },
  avatarPlaceholder: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: GRAY_100,
    borderWidth: 2, borderColor: GRAY_300, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarPlaceholderASU: { borderColor: MAROON, backgroundColor: '#FFF5F0' },
  avatarImg: { width: 80, height: 80, borderRadius: 40 },
  avatarBadge: {
    position: 'absolute', bottom: 0, right: 0, width: 24, height: 24,
    borderRadius: 12, backgroundColor: NAVY,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: WHITE,
  },
  avatarBadgeASU: { backgroundColor: MAROON },
  avatarHint: { fontSize: 12, color: GRAY_400, textAlign: 'center', marginBottom: 16 },
  rowFields: { flexDirection: 'row', gap: 8 },
  charCount: { fontSize: 11, color: GRAY_400, textAlign: 'right', marginTop: -6, marginBottom: 10 },
  backStepBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginTop: 14, paddingVertical: 10,
  },
  backStepTxt: { fontSize: 14, color: GRAY_500 },
});