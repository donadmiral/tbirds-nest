import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
  FlatList, Pressable, Image,
} from 'react-native';
import * as Linking from 'expo-linking';
import { showMessage } from 'react-native-flash-message';
import { Feather } from '@expo/vector-icons';
import { authService } from '../../services/authService';
import { useAuthStore } from '../../stores/authStore';
import { institutionsService, type Institution, type DomainMatch } from '../../services/institutionsService';
import { colors, spacing, radius } from '../../utils/theme';

type Step = 'institution' | 'email' | 'password' | 'profile';

type WizardState = {
  institution: Institution | null;
  email: string;
  password: string;
  fullName: string;
  domainMatch: DomainMatch | null;
};

export default function SignUpScreen({ navigation }: any) {
  const [step, setStep] = useState<Step>('institution');
  const [state, setState] = useState<WizardState>({
    institution: null,
    email: '',
    password: '',
    fullName: '',
    domainMatch: null,
  });
  const [submitting, setSubmitting] = useState(false);

  const goBack = () => {
    if (step === 'institution') {
      navigation.goBack();
      return;
    }
    if (step === 'email') setStep('institution');
    else if (step === 'password') setStep('email');
    else if (step === 'profile') setStep('password');
  };

  const handleSubmit = async () => {
    const { institution, email, password, fullName } = state;
    if (!institution || !email || !password || !fullName) {
      showMessage({ message: 'Missing information', type: 'warning' });
      return;
    }

    setSubmitting(true);
    try {
      const redirectTo = Linking.createURL('auth/callback');
      await authService.signUp(email, password, fullName, redirectTo);

      // Store chosen institution so authStore claims it on first sign-in.
      useAuthStore.getState().setPendingInstitutionId(institution.id);

      navigation.navigate('VerifyEmail', { email });
    } catch (err: any) {
      showMessage({ message: err?.message ?? 'Signup failed', type: 'danger' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.header}>
        <TouchableOpacity onPress={goBack} style={s.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={26} color={colors.text} />
        </TouchableOpacity>
        <StepIndicator step={step} />
        <View style={{ width: 40 }} />
      </View>

      {step === 'institution' && (
        <InstitutionStep
          selected={state.institution}
          onPick={(inst) => {
            setState(prev => ({ ...prev, institution: inst }));
            setStep('email');
          }}
        />
      )}

      {step === 'email' && (
        <EmailStep
          institution={state.institution!}
          initial={state.email}
          onNext={(email, match) => {
            setState(prev => ({ ...prev, email, domainMatch: match }));
            setStep('password');
          }}
        />
      )}

      {step === 'password' && (
        <PasswordStep
          initial={state.password}
          onNext={(password) => {
            setState(prev => ({ ...prev, password }));
            setStep('profile');
          }}
        />
      )}

      {step === 'profile' && (
        <ProfileStep
          initialName={state.fullName}
          institution={state.institution!}
          domainMatch={state.domainMatch}
          submitting={submitting}
          onSubmit={(fullName) => {
            setState(prev => ({ ...prev, fullName }));
            setTimeout(() => {
              setState(current => {
                if (current.fullName === fullName) handleSubmit();
                return current;
              });
            }, 0);
          }}
        />
      )}
    </KeyboardAvoidingView>
  );
}

// =========================================================================
// Step indicator
// =========================================================================
function StepIndicator({ step }: { step: Step }) {
  const idx = step === 'institution' ? 0 : step === 'email' ? 1 : step === 'password' ? 2 : 3;
  return (
    <View style={s.stepDots}>
      {[0, 1, 2, 3].map(i => (
        <View
          key={i}
          style={[s.stepDot, i <= idx && s.stepDotActive]}
        />
      ))}
    </View>
  );
}

// =========================================================================
// Step 1: Institution picker
// =========================================================================
function InstitutionStep({
  selected,
  onPick,
}: {
  selected: Institution | null;
  onPick: (inst: Institution) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Institution[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestingNew, setRequestingNew] = useState(false);
  const [newName, setNewName] = useState('');

  const debounceRef = useRef<any>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await institutionsService.search(query, 30);
        setResults(r);
      } catch (e: any) {
        showMessage({ message: 'Search failed', type: 'danger' });
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const handleRequestNew = () => {
    const trimmed = newName.trim();
    if (trimmed.length < 3) {
      showMessage({ message: 'Name too short', type: 'warning' });
      return;
    }
    showMessage({
      message: `We will review "${trimmed}". Please pick an existing institution for now.`,
      type: 'info',
      duration: 4000,
    });
    setRequestingNew(false);
    setNewName('');
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={s.stepHeader}>
        <Text style={s.stepTitle}>Select your school</Text>
        <Text style={s.stepSub}>Search for your current or former institution.</Text>
      </View>

      <View style={s.searchWrap}>
        <Feather name="search" size={18} color="#8E8E93" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search schools..."
          placeholderTextColor="#8E8E93"
          style={s.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Feather name="x" size={18} color="#8E8E93" />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={s.loaderWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(it) => it.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 40 }}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [s.instRow, pressed && s.instRowPressed, selected?.id === item.id && s.instRowSelected]}
              onPress={() => onPick(item)}
            >
              <View style={s.instLogo}>
                {item.logo_url ? (
                  <Image source={{ uri: item.logo_url }} style={{ width: 36, height: 36, borderRadius: 8 }} />
                ) : (
                  <Feather name="award" size={20} color={colors.primary} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.instName} numberOfLines={1}>{item.name}</Text>
                <Text style={s.instMeta} numberOfLines={1}>
                  {[item.short_name, item.city, item.state].filter(Boolean).join(' · ') || item.country}
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color="#C7C7CC" />
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={s.emptyWrap}>
              <Text style={s.emptyTitle}>No schools match "{query}"</Text>
              <TouchableOpacity onPress={() => setRequestingNew(true)}>
                <Text style={s.emptyAction}>Request to add it</Text>
              </TouchableOpacity>
            </View>
          }
          ListFooterComponent={
            results.length > 0 && query.length > 0 ? (
              <TouchableOpacity style={s.notFoundRow} onPress={() => setRequestingNew(true)}>
                <Feather name="help-circle" size={18} color={colors.primary} />
                <Text style={s.notFoundTxt}>Cannot find your school? Request to add it</Text>
              </TouchableOpacity>
            ) : null
          }
        />
      )}

      {requestingNew && (
        <View style={s.requestOverlay}>
          <View style={s.requestCard}>
            <Text style={s.requestTitle}>Request a new school</Text>
            <Text style={s.requestSub}>We will review and add it within a day.</Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. University of Zimbabwe"
              placeholderTextColor="#9CA3AF"
              style={s.requestInput}
              autoFocus
            />
            <View style={s.requestActions}>
              <TouchableOpacity
                style={s.requestCancel}
                onPress={() => { setRequestingNew(false); setNewName(''); }}
              >
                <Text style={s.requestCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.requestSubmit} onPress={handleRequestNew}>
                <Text style={s.requestSubmitTxt}>Submit request</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

// =========================================================================
// Step 2: Email with live domain match
// =========================================================================
function EmailStep({
  institution,
  initial,
  onNext,
}: {
  institution: Institution;
  initial: string;
  onNext: (email: string, match: DomainMatch | null) => void;
}) {
  const [email, setEmail] = useState(initial);
  const [match, setMatch] = useState<DomainMatch | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<any>(null);

  const emailValid = /.+@.+\..+/.test(email.trim());

  useEffect(() => {
    if (!emailValid) {
      setMatch(null);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setChecking(true);
      try {
        const m = await institutionsService.matchEmailToInstitution(email.trim().toLowerCase());
        setMatch(m);
      } finally {
        setChecking(false);
      }
    }, 280);
    return () => clearTimeout(debounceRef.current);
  }, [email, emailValid]);

  const verifiedForSelected = match?.institution_id === institution.id;

  const handleNext = () => {
    if (!emailValid) {
      setError('Enter a valid email');
      return;
    }
    setError(null);
    onNext(email.trim().toLowerCase(), match);
  };

  return (
    <ScrollView
      contentContainerStyle={s.stepContent}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={s.stepTitle}>What is your email</Text>
      <Text style={s.stepSub}>
        Use your <Text style={{ fontWeight: '700' }}>{institution.short_name || institution.name}</Text> email for auto-verification, or any email you prefer.
      </Text>

      <View style={s.field}>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder={`you@${institution.website?.replace(/^https?:\/\/(www\.)?/, '') || 'example.edu'}`}
          placeholderTextColor="#9CA3AF"
          style={s.input}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          autoFocus
          returnKeyType="next"
          onSubmitEditing={handleNext}
        />
      </View>

      {checking && (
        <View style={s.statusRow}>
          <ActivityIndicator size={14} color="#8E8E93" />
          <Text style={s.statusTxt}>Checking domain...</Text>
        </View>
      )}

      {!checking && emailValid && verifiedForSelected && (
        <View style={s.statusRow}>
          <Feather name="check-circle" size={16} color="#059669" />
          <Text style={[s.statusTxt, { color: '#059669' }]}>
            Verified as {institution.short_name || institution.name}
          </Text>
        </View>
      )}

      {!checking && emailValid && match && !verifiedForSelected && (
        <View style={s.statusRow}>
          <Feather name="alert-circle" size={16} color="#D97706" />
          <Text style={[s.statusTxt, { color: '#D97706' }]}>
            This email belongs to {match.institution_name}. You can still continue.
          </Text>
        </View>
      )}

      {!checking && emailValid && !match && (
        <View style={s.statusRow}>
          <Feather name="info" size={14} color="#8E8E93" />
          <Text style={s.statusTxt}>
            No domain match. Your {institution.short_name || 'school'} membership will be unverified until an admin approves.
          </Text>
        </View>
      )}

      {error && <Text style={s.errTxt}>{error}</Text>}

      <TouchableOpacity
        style={[s.primaryBtn, !emailValid && s.primaryBtnDisabled]}
        onPress={handleNext}
        disabled={!emailValid}
      >
        <Text style={s.primaryBtnTxt}>Continue</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// =========================================================================
// Step 3: Password
// =========================================================================
function PasswordStep({
  initial,
  onNext,
}: {
  initial: string;
  onNext: (password: string) => void;
}) {
  const [password, setPassword] = useState(initial);
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleNext = () => {
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setError(null);
    onNext(password);
  };

  return (
    <ScrollView contentContainerStyle={s.stepContent} keyboardShouldPersistTaps="handled">
      <Text style={s.stepTitle}>Set a password</Text>
      <Text style={s.stepSub}>At least 8 characters. Make it something you will remember.</Text>

      <View style={s.field}>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor="#9CA3AF"
          style={s.input}
          secureTextEntry
          autoFocus
        />
      </View>

      <View style={s.field}>
        <TextInput
          value={confirm}
          onChangeText={setConfirm}
          placeholder="Confirm password"
          placeholderTextColor="#9CA3AF"
          style={s.input}
          secureTextEntry
          returnKeyType="done"
          onSubmitEditing={handleNext}
        />
      </View>

      {error && <Text style={s.errTxt}>{error}</Text>}

      <TouchableOpacity
        style={[s.primaryBtn, (password.length < 8 || !confirm) && s.primaryBtnDisabled]}
        onPress={handleNext}
        disabled={password.length < 8 || !confirm}
      >
        <Text style={s.primaryBtnTxt}>Continue</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// =========================================================================
// Step 4: Profile basics
// =========================================================================
function ProfileStep({
  initialName,
  institution,
  domainMatch,
  submitting,
  onSubmit,
}: {
  initialName: string;
  institution: Institution;
  domainMatch: DomainMatch | null;
  submitting: boolean;
  onSubmit: (fullName: string) => void;
}) {
  const [fullName, setFullName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);

  const verified = domainMatch?.institution_id === institution.id;

  const handleSubmit = () => {
    if (fullName.trim().length < 2) {
      setError('Enter your full name');
      return;
    }
    setError(null);
    onSubmit(fullName.trim());
  };

  return (
    <ScrollView contentContainerStyle={s.stepContent} keyboardShouldPersistTaps="handled">
      <Text style={s.stepTitle}>Your name</Text>
      <Text style={s.stepSub}>This is how you will appear to other {institution.short_name || 'students'}.</Text>

      <View style={s.instChip}>
        <Feather name="award" size={16} color={colors.primary} />
        <Text style={s.instChipTxt} numberOfLines={1}>{institution.name}</Text>
        {verified && <Feather name="check-circle" size={14} color="#059669" />}
      </View>

      <View style={s.field}>
        <TextInput
          value={fullName}
          onChangeText={setFullName}
          placeholder="Full name"
          placeholderTextColor="#9CA3AF"
          style={s.input}
          autoCapitalize="words"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
        />
      </View>

      {error && <Text style={s.errTxt}>{error}</Text>}

      <TouchableOpacity
        style={[s.primaryBtn, (submitting || fullName.trim().length < 2) && s.primaryBtnDisabled]}
        onPress={handleSubmit}
        disabled={submitting || fullName.trim().length < 2}
      >
        {submitting ? <ActivityIndicator color="#FFF" /> : <Text style={s.primaryBtnTxt}>Create account</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingTop: 54, paddingBottom: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  stepDots: { flexDirection: 'row', gap: 6 },
  stepDot: { width: 26, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB' },
  stepDotActive: { backgroundColor: colors.primary },

  stepHeader: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
  stepContent: { padding: 20, paddingTop: 12 },

  stepTitle: { fontSize: 26, fontWeight: '700', color: colors.text, marginBottom: 6 },
  stepSub: { fontSize: 15, color: '#6B7280', lineHeight: 21, marginBottom: 8 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 20, marginBottom: 10,
    backgroundColor: '#F2F2F7', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 11,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.text, padding: 0 },

  loaderWrap: { paddingVertical: 40, alignItems: 'center' },

  instRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: '#FFF',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
  },
  instRowPressed: { backgroundColor: '#F3F4F6' },
  instRowSelected: { backgroundColor: '#EFF6FF' },
  instLogo: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: '#EFF6FF',
    alignItems: 'center', justifyContent: 'center',
  },
  instName: { fontSize: 15, fontWeight: '600', color: colors.text },
  instMeta: { fontSize: 12, color: '#6B7280', marginTop: 2 },

  emptyWrap: { paddingTop: 40, paddingHorizontal: 20, alignItems: 'center', gap: 10 },
  emptyTitle: { fontSize: 15, color: '#6B7280' },
  emptyAction: { fontSize: 15, color: colors.primary, fontWeight: '600' },

  notFoundRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 20, paddingVertical: 20,
  },
  notFoundTxt: { fontSize: 14, color: colors.primary, fontWeight: '500' },

  field: { marginBottom: 14 },
  input: {
    backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 16, color: colors.text,
  },

  statusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, paddingHorizontal: 4,
  },
  statusTxt: { fontSize: 13, color: '#6B7280', flex: 1 },

  errTxt: { color: '#DC2626', fontSize: 14, marginTop: 6, marginBottom: 6 },

  primaryBtn: {
    backgroundColor: colors.primary, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
    marginTop: 16,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnTxt: { color: '#FFF', fontSize: 16, fontWeight: '700' },

  instChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#EFF6FF', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 8,
    marginBottom: 20,
  },
  instChipTxt: { fontSize: 13, color: colors.primary, fontWeight: '600', maxWidth: 220 },

  requestOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', padding: 20,
  },
  requestCard: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 20,
  },
  requestTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 4 },
  requestSub: { fontSize: 14, color: '#6B7280', marginBottom: 14 },
  requestInput: {
    backgroundColor: '#F3F4F6', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: colors.text, marginBottom: 14,
  },
  requestActions: { flexDirection: 'row', gap: 10 },
  requestCancel: {
    flex: 1, backgroundColor: '#F3F4F6', borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  requestCancelTxt: { color: '#374151', fontWeight: '600', fontSize: 15 },
  requestSubmit: {
    flex: 1, backgroundColor: colors.primary, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  requestSubmitTxt: { color: '#FFF', fontWeight: '700', fontSize: 15 },
});