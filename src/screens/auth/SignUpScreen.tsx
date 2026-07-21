import React, { useRef, useState } from 'react';
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
  Dimensions,
} from 'react-native';
import * as Linking from 'expo-linking';
import { Feather } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import { authService } from '../../services/authService';
import { isAsuEmail } from '../../utils/isAsuEmail';
import PlatinumCirclesLogo from '../../components/PlatinumCirclesLogo';

const { height: SCREEN_H } = Dimensions.get('window');

const NAVY = '#0B1E3D';
const WHITE = '#FFFFFF';
const GRAY_100 = '#F3F4F6';
const GRAY_200 = '#E5E7EB';
const GRAY_400 = '#9CA3AF';
const GRAY_500 = '#6B7280';
const GRAY_900 = '#111827';
const INDIGO_50 = '#EEF2FF';
const INDIGO_100 = '#E0E7FF';
const INDIGO_700 = '#4338CA';
const MAROON = '#8C1D40';
const GOLD = '#FFC627';

export default function SignUpScreen({ navigation }: any) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const isASU = isAsuEmail(email);

  async function handleSignUp() {
    const cleanName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password;

    if (!cleanName) {
      showMessage({ message: 'Enter your full name', type: 'warning' });
      return;
    }
    if (cleanName.length < 2) {
      showMessage({ message: 'Name must be at least 2 characters', type: 'warning' });
      return;
    }
    if (!cleanEmail || !/.+@.+\..+/.test(cleanEmail)) {
      showMessage({ message: 'Enter a valid email address', type: 'warning' });
      return;
    }
    if (cleanPassword.length < 8) {
      showMessage({ message: 'Password must be at least 8 characters', type: 'warning' });
      return;
    }
    if (cleanPassword !== confirmPassword) {
      showMessage({ message: 'Passwords do not match', type: 'warning' });
      return;
    }

    setLoading(true);
    try {
      const redirectTo = Linking.createURL('auth/callback');
      await authService.signUp(cleanEmail, cleanPassword, cleanName, redirectTo);
      navigation.navigate('VerifyEmail', { email: cleanEmail });
    } catch (err: any) {
      showMessage({ message: err?.message ?? 'Signup failed', type: 'danger' });
    } finally {
      setLoading(false);
    }
  }

  const formValid =
    fullName.trim().length >= 2 &&
    /.+@.+\..+/.test(email.trim()) &&
    password.length >= 8 &&
    confirmPassword.length > 0;

  return (
    <View style={s.root}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={s.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo */}
          <View style={s.logoWrap}>
            <PlatinumCirclesLogo size={64} />
          </View>

          {/* Title */}
          <Text style={s.title}>PlatinumCircles</Text>
          <Text style={s.subtitle}>Create your account</Text>

          {/* Form fields */}
          <View style={s.inputWrap}>
            <Feather name="user" size={16} color={GRAY_400} style={s.inputIcon} />
            <TextInput
              style={s.input}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Full name"
              placeholderTextColor={GRAY_400}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => emailRef.current?.focus()}
            />
          </View>

          <View style={[s.inputWrap, isASU && s.inputWrapASU]}>
            <Feather name="mail" size={16} color={isASU ? MAROON : GRAY_400} style={s.inputIcon} />
            <TextInput
              ref={emailRef}
              style={s.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Email address"
              placeholderTextColor={GRAY_400}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            {isASU && (
              <View style={s.asuDetectedBadge}>
                <Text style={s.asuDetectedTxt}>ASU</Text>
              </View>
            )}
          </View>

          {/* ASU detected card */}
          {isASU ? (
            <View style={s.asuCard}>
              <View style={s.asuIconWrap}>
                <Feather name="shield" size={16} color={MAROON} />
              </View>
              <View style={s.asuTextWrap}>
                <Text style={s.asuTitle}>ASU exclusive account</Text>
                <Text style={s.asuSub}>
                  You'll get access to the private ASU network. Only ASU students, faculty, and staff can see your content.
                </Text>
              </View>
            </View>
          ) : email.length > 3 ? (
            <View style={s.publicCard}>
              <View style={s.publicIconWrap}>
                <Feather name="globe" size={16} color={NAVY} />
              </View>
              <View style={s.asuTextWrap}>
                <Text style={s.publicTitle}>Public account</Text>
                <Text style={s.asuSub}>
                  You'll join the global PlatinumCircles network. Use an @asu.edu email instead for the exclusive ASU network.
                </Text>
              </View>
            </View>
          ) : null}

          <View style={s.inputWrap}>
            <Feather name="lock" size={16} color={GRAY_400} style={s.inputIcon} />
            <TextInput
              ref={passwordRef}
              style={[s.input, { paddingRight: 44 }]}
              value={password}
              onChangeText={setPassword}
              placeholder="Password (8+ characters)"
              placeholderTextColor={GRAY_400}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => confirmRef.current?.focus()}
            />
            <TouchableOpacity
              style={s.eyeBtn}
              onPress={() => setShowPassword((p) => !p)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Feather name={showPassword ? 'eye' : 'eye-off'} size={16} color={GRAY_400} />
            </TouchableOpacity>
          </View>

          <View style={s.inputWrap}>
            <Feather name="lock" size={16} color={GRAY_400} style={s.inputIcon} />
            <TextInput
              ref={confirmRef}
              style={[s.input, { paddingRight: 44 }]}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm password"
              placeholderTextColor={GRAY_400}
              secureTextEntry={!showConfirm}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={handleSignUp}
            />
            <TouchableOpacity
              style={s.eyeBtn}
              onPress={() => setShowConfirm((p) => !p)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Feather name={showConfirm ? 'eye' : 'eye-off'} size={16} color={GRAY_400} />
            </TouchableOpacity>
          </View>

          {/* Sign Up button */}
          <TouchableOpacity
            style={[
              s.primaryBtn,
              isASU && s.primaryBtnASU,
              (!formValid || loading) && s.primaryBtnDisabled,
            ]}
            onPress={handleSignUp}
            disabled={!formValid || loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={isASU ? MAROON : WHITE} size={16} />
            ) : (
              <Text style={[s.primaryBtnTxt, isASU && s.primaryBtnTxtASU]}>
                {isASU ? 'Join ASU Network' : 'Sign Up'}
              </Text>
            )}
          </TouchableOpacity>

          {/* Divider */}
          <View style={s.dividerRow}>
            <View style={s.dividerLine} />
            <Text style={s.dividerTxt}>or</Text>
            <View style={s.dividerLine} />
          </View>

          {/* Footer */}
          <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={s.footerTxt}>
              Have an account? <Text style={s.footerLink}>Log in</Text>
            </Text>
          </TouchableOpacity>

          <Text style={s.termsTxt}>
            By signing up you agree to our Terms and Privacy Policy
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: WHITE },
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: SCREEN_H * 0.08,
    paddingBottom: 40,
  },
  logoWrap: { alignItems: 'center', marginBottom: 12 },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: GRAY_900,
    textAlign: 'center',
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: GRAY_500,
    textAlign: 'center',
    marginBottom: 24,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GRAY_100,
    borderWidth: 0.5,
    borderColor: GRAY_200,
    borderRadius: 12,
    marginBottom: 10,
    position: 'relative',
  },
  inputWrapASU: {
    borderColor: MAROON,
    borderWidth: 1.5,
    backgroundColor: '#FFF8F0',
  },
  inputIcon: { marginLeft: 14 },
  input: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    fontSize: 15,
    color: GRAY_900,
  },
  eyeBtn: {
    position: 'absolute',
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  asuDetectedBadge: {
    backgroundColor: MAROON,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 10,
  },
  asuDetectedTxt: {
    fontSize: 11,
    fontWeight: '800',
    color: GOLD,
    letterSpacing: 0.5,
  },
  asuCard: {
    backgroundColor: '#FFF5F0',
    borderWidth: 1,
    borderColor: '#FECDD3',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  asuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  asuTextWrap: { flex: 1 },
  asuTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: MAROON,
    marginBottom: 2,
  },
  publicCard: {
    backgroundColor: INDIGO_50,
    borderWidth: 0.5,
    borderColor: INDIGO_100,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  publicIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: INDIGO_100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publicTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: NAVY,
    marginBottom: 2,
  },
  asuSub: {
    fontSize: 11,
    color: GRAY_500,
    lineHeight: 15,
  },
  primaryBtn: {
    backgroundColor: NAVY,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  primaryBtnASU: {
    backgroundColor: GOLD,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnTxt: { fontSize: 16, fontWeight: '700', color: WHITE },
  primaryBtnTxtASU: { color: MAROON },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: GRAY_200,
  },
  dividerTxt: {
    paddingHorizontal: 12,
    fontSize: 12,
    color: GRAY_400,
  },
  footerTxt: {
    textAlign: 'center',
    fontSize: 14,
    color: GRAY_500,
  },
  footerLink: {
    fontWeight: '700',
    color: NAVY,
  },
  termsTxt: {
    textAlign: 'center',
    fontSize: 11,
    color: GRAY_400,
    marginTop: 20,
    lineHeight: 16,
  },
});