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
  Animated,
  Easing,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { showMessage } from 'react-native-flash-message';
import { Feather } from '@expo/vector-icons';
import { authService } from '../../services/authService';
import { useAuthStore } from '../../stores/authStore';
import PlatinumCirclesLogo from '../../components/PlatinumCirclesLogo';

const { height: SCREEN_H } = Dimensions.get('window');

const NAVY_DEEP = '#080E1A';
const NAVY = '#0B1E3D';
const NAVY_MID = '#141E30';
const WHITE = '#FFFFFF';
const WHITE_08 = 'rgba(255,255,255,0.08)';
const WHITE_15 = 'rgba(255,255,255,0.15)';
const WHITE_30 = 'rgba(255,255,255,0.30)';
const WHITE_45 = 'rgba(255,255,255,0.45)';
const WHITE_60 = 'rgba(255,255,255,0.60)';

type ForgotStep = 'email' | 'reset';

export default function LoginScreen({ navigation }: any) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Forgot password state
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotStep, setForgotStep] = useState<ForgotStep>('email');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotCode, setForgotCode] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;
  const passwordRef = useRef<TextInput>(null);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(logoScale, { toValue: 1, duration: 900, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }),
    ]).start();
  }, []);

  function resetForgotState() {
    setForgotMode(false);
    setForgotStep('email');
    setForgotEmail('');
    setForgotCode('');
    setForgotNewPassword('');
    setForgotConfirmPassword('');
    setForgotError(null);
    setForgotLoading(false);
  }

  async function handleLogin() {
    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password;

    if (!cleanEmail || !cleanPassword) {
      showMessage({ message: 'Enter your email and password', type: 'warning' });
      return;
    }

    setLoading(true);
    try {
      await authService.signIn(cleanEmail, cleanPassword);
    } catch (err: any) {
      showMessage({ message: err?.message ?? 'Login failed', type: 'danger' });
    } finally {
      setLoading(false);
    }
  }

  // Step 1: Send reset code via email
  async function handleSendCode() {
    const cleanEmail = forgotEmail.trim().toLowerCase();
    if (!cleanEmail) {
      setForgotError('Enter your email address');
      return;
    }

    setForgotLoading(true);
    setForgotError(null);
    try {
      await authService.resetPassword(cleanEmail);
      showMessage({
        message: 'Code sent',
        description: 'Check ' + cleanEmail + ' for your 8-digit reset code.',
        type: 'success',
        duration: 4000,
      });
      setForgotStep('reset');
    } catch (err: any) {
      setForgotError(err?.message ?? 'Could not send reset code');
    } finally {
      setForgotLoading(false);
    }
  }

  // Step 2: Verify code + set new password + sign out, all in one action
  async function handleResetPassword() {
    const cleanCode = forgotCode.trim();
    if (cleanCode.length < 6) {
      setForgotError('Enter the full 8-digit code from your email');
      return;
    }
    if (forgotNewPassword.length < 8) {
      setForgotError('Password must be at least 8 characters');
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      setForgotError('Passwords do not match');
      return;
    }

    setForgotLoading(true);
    setForgotError(null);
    try {
      // Suppress the PASSWORD_RECOVERY redirect AND any SIGNED_IN processing
      useAuthStore.getState().setSuppressRecoveryRedirect(true);

      // 1. Verify OTP code (creates a recovery session)
      await authService.verifyResetCode(forgotEmail.trim().toLowerCase(), cleanCode);

      // 2. Immediately update password using the recovery session
      await authService.updatePassword(forgotNewPassword);

      // 3. Sign out to clear the recovery session
      await useAuthStore.getState().signOut();

      // 4. Pre-fill email and show success
      const savedEmail = forgotEmail.trim().toLowerCase();
      resetForgotState();
      setEmail(savedEmail);

      showMessage({
        message: 'Password updated',
        description: 'Sign in with your new password.',
        type: 'success',
        duration: 4000,
      });
    } catch (err: any) {
      useAuthStore.getState().setSuppressRecoveryRedirect(false);
      const msg = err?.message ?? 'Failed to reset password';
      if (/invalid|expired|token/i.test(msg)) {
        setForgotError('Invalid or expired code. Please request a new one.');
      } else {
        setForgotError(msg);
      }
    } finally {
      setForgotLoading(false);
    }
  }

  // ===================== FORGOT PASSWORD SCREENS =====================

  if (forgotMode) {
    return (
      <View style={s.root}>
        <LinearGradient colors={[NAVY_DEEP, NAVY_MID, NAVY]} style={s.gradient}>
          <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={s.forgotContainer} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <TouchableOpacity
                style={s.backBtn}
                onPress={() => {
                  if (forgotStep === 'email') resetForgotState();
                  else setForgotStep('email');
                  setForgotError(null);
                }}
                activeOpacity={0.7}
              >
                <Feather name="arrow-left" size={20} color={WHITE_60} />
                <Text style={s.backTxt}>
                  {forgotStep === 'email' ? 'Back to sign in' : 'Back'}
                </Text>
              </TouchableOpacity>

              <View style={s.forgotContent}>
                <PlatinumCirclesLogo size={56} />

                {/* STEP 1: Enter email */}
                {forgotStep === 'email' && (
                  <>
                    <Text style={s.forgotTitle}>Reset password</Text>
                    <Text style={s.forgotSub}>
                      Enter the email you signed up with. We will send an 8-digit reset code.
                    </Text>

                    <View style={[s.inputWrap, { width: '100%' }]}>
                      <Feather name="mail" size={16} color={WHITE_45} style={s.inputIcon} />
                      <TextInput
                        style={s.input}
                        value={forgotEmail}
                        onChangeText={(t) => { setForgotEmail(t); setForgotError(null); }}
                        placeholder="Email address"
                        placeholderTextColor={WHITE_30}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoFocus
                        returnKeyType="send"
                        onSubmitEditing={handleSendCode}
                      />
                    </View>

                    {forgotError && <Text style={s.errorTxt}>{forgotError}</Text>}

                    <TouchableOpacity
                      style={[s.primaryBtn, { width: '100%' }, forgotLoading && s.primaryBtnDisabled]}
                      onPress={handleSendCode}
                      disabled={forgotLoading}
                      activeOpacity={0.85}
                    >
                      {forgotLoading ? (
                        <ActivityIndicator color={NAVY} size={16} />
                      ) : (
                        <Text style={s.primaryBtnTxt}>Send code</Text>
                      )}
                    </TouchableOpacity>
                  </>
                )}

                {/* STEP 2: Enter code + new password together */}
                {forgotStep === 'reset' && (
                  <>
                    <Text style={s.forgotTitle}>Reset your password</Text>
                    <Text style={s.forgotSub}>
                      Enter the 8-digit code sent to {forgotEmail.trim().toLowerCase()} and choose a new password.
                    </Text>

                    <View style={[s.inputWrap, { width: '100%' }]}>
                      <Feather name="hash" size={16} color={WHITE_45} style={s.inputIcon} />
                      <TextInput
                        style={s.input}
                        value={forgotCode}
                        onChangeText={(t) => { setForgotCode(t); setForgotError(null); }}
                        placeholder="8-digit code"
                        placeholderTextColor={WHITE_30}
                        keyboardType="number-pad"
                        autoFocus
                        maxLength={8}
                      />
                    </View>

                    <View style={[s.inputWrap, { width: '100%' }]}>
                      <Feather name="lock" size={16} color={WHITE_45} style={s.inputIcon} />
                      <TextInput
                        style={s.input}
                        value={forgotNewPassword}
                        onChangeText={(t) => { setForgotNewPassword(t); setForgotError(null); }}
                        placeholder="New password"
                        placeholderTextColor={WHITE_30}
                        secureTextEntry
                      />
                    </View>

                    <View style={[s.inputWrap, { width: '100%' }]}>
                      <Feather name="lock" size={16} color={WHITE_45} style={s.inputIcon} />
                      <TextInput
                        style={s.input}
                        value={forgotConfirmPassword}
                        onChangeText={(t) => { setForgotConfirmPassword(t); setForgotError(null); }}
                        placeholder="Confirm new password"
                        placeholderTextColor={WHITE_30}
                        secureTextEntry
                        returnKeyType="done"
                        onSubmitEditing={handleResetPassword}
                      />
                    </View>

                    {forgotError && <Text style={s.errorTxt}>{forgotError}</Text>}

                    <TouchableOpacity
                      style={[
                        s.primaryBtn,
                        { width: '100%' },
                        (forgotLoading || forgotCode.length < 6 || forgotNewPassword.length < 8 || !forgotConfirmPassword) && s.primaryBtnDisabled,
                      ]}
                      onPress={handleResetPassword}
                      disabled={forgotLoading || forgotCode.length < 6 || forgotNewPassword.length < 8 || !forgotConfirmPassword}
                      activeOpacity={0.85}
                    >
                      {forgotLoading ? (
                        <ActivityIndicator color={NAVY} size={16} />
                      ) : (
                        <Text style={s.primaryBtnTxt}>Reset password</Text>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={s.resendBtn}
                      onPress={handleSendCode}
                      disabled={forgotLoading}
                      activeOpacity={0.7}
                    >
                      <Text style={s.resendTxt}>Resend code</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </LinearGradient>
      </View>
    );
  }

  // ===================== MAIN LOGIN SCREEN =====================

  return (
    <View style={s.root}>
      <LinearGradient colors={[NAVY_DEEP, NAVY_MID, NAVY]} style={s.gradient}>
        <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

            <Animated.View style={[s.logoWrap, { opacity: fadeAnim, transform: [{ scale: logoScale }] }]}>
              <PlatinumCirclesLogo size={88} />
            </Animated.View>

            <Animated.View style={[s.brandWrap, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
              <Text style={s.brandName}>PlatinumCircles</Text>
              <Text style={s.brandTag}>YOUR EXCLUSIVE COMMUNITY</Text>
            </Animated.View>

            <Animated.View style={[s.formWrap, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
              <View style={s.inputWrap}>
                <Feather name="mail" size={16} color={WHITE_45} style={s.inputIcon} />
                <TextInput
                  style={s.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email address"
                  placeholderTextColor={WHITE_30}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
              </View>

              <View style={s.inputWrap}>
                <Feather name="lock" size={16} color={WHITE_45} style={s.inputIcon} />
                <TextInput
                  ref={passwordRef}
                  style={[s.input, { paddingRight: 44 }]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password"
                  placeholderTextColor={WHITE_30}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="go"
                  onSubmitEditing={handleLogin}
                />
                <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPassword(p => !p)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Feather name={showPassword ? 'eye' : 'eye-off'} size={16} color={WHITE_45} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={s.forgotBtn} onPress={() => { setForgotMode(true); setForgotEmail(email); }} activeOpacity={0.7}>
                <Text style={s.forgotTxt}>Forgot password?</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.primaryBtn, loading && s.primaryBtnDisabled]}
                onPress={handleLogin}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color={NAVY} size={16} />
                ) : (
                  <Text style={s.primaryBtnTxt}>Sign In</Text>
                )}
              </TouchableOpacity>

              <View style={s.dividerRow}>
                <View style={s.dividerLine} />
                <Text style={s.dividerTxt}>or</Text>
                <View style={s.dividerLine} />
              </View>

              <TouchableOpacity
                style={s.outlineBtn}
                onPress={() => navigation.navigate('SignUp')}
                activeOpacity={0.8}
              >
                <Text style={s.outlineBtnTxt}>Create an account</Text>
              </TouchableOpacity>
            </Animated.View>

            <View style={s.footer}>
              <Text style={s.footerTxt}>By signing in you agree to our Terms and Privacy Policy</Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: NAVY_DEEP },
  gradient: { flex: 1 },
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
    paddingTop: SCREEN_H * 0.08,
    paddingBottom: 40,
  },
  logoWrap: { alignItems: 'center', marginBottom: 16 },
  brandWrap: { alignItems: 'center', marginBottom: 40 },
  brandName: { fontSize: 28, fontWeight: '800', color: WHITE, letterSpacing: -0.5 },
  brandTag: { fontSize: 11, color: WHITE_30, letterSpacing: 2, marginTop: 6 },
  formWrap: { width: '100%' },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: WHITE_08,
    borderWidth: 0.5,
    borderColor: WHITE_15,
    borderRadius: 14,
    marginBottom: 12,
    position: 'relative',
  },
  inputIcon: { marginLeft: 16 },
  input: {
    flex: 1,
    paddingVertical: 15,
    paddingHorizontal: 12,
    fontSize: 15,
    color: WHITE,
  },
  eyeBtn: {
    position: 'absolute',
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  forgotBtn: { alignSelf: 'flex-end', marginBottom: 20, marginTop: 2 },
  forgotTxt: { fontSize: 13, color: WHITE_45, fontWeight: '500' },
  primaryBtn: {
    backgroundColor: WHITE,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnTxt: { fontSize: 16, fontWeight: '700', color: NAVY },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 0.5, backgroundColor: WHITE_15 },
  dividerTxt: { fontSize: 12, color: WHITE_30, marginHorizontal: 14, fontWeight: '500' },
  outlineBtn: {
    borderWidth: 1,
    borderColor: WHITE_30,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineBtnTxt: { fontSize: 15, fontWeight: '600', color: WHITE },
  footer: { alignItems: 'center', marginTop: 32, paddingHorizontal: 20 },
  footerTxt: { fontSize: 11, color: WHITE_30, textAlign: 'center', lineHeight: 16 },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 32,
    paddingVertical: 4,
  },
  backTxt: { fontSize: 14, color: WHITE_60, fontWeight: '500' },
  forgotContainer: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: SCREEN_H * 0.12,
    paddingBottom: 40,
  },
  forgotContent: { alignItems: 'center', gap: 12 },
  forgotTitle: { fontSize: 24, fontWeight: '700', color: WHITE, marginTop: 16 },
  forgotSub: {
    fontSize: 14,
    color: WHITE_45,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12,
    paddingHorizontal: 10,
  },
  errorTxt: {
    color: '#EF4444',
    fontSize: 13,
    textAlign: 'center',
    width: '100%',
  },
  resendBtn: { marginTop: 16, paddingVertical: 8 },
  resendTxt: { fontSize: 14, color: WHITE_45, fontWeight: '500' },
});