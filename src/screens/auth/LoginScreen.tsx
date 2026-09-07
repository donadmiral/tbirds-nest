import { themedSheet } from '../../theme/useTheme';
import { useSafeAreaInsets } from '../../components/SafeArea';
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
  Dimensions, Image , StatusBar } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { showMessage } from 'react-native-flash-message';
import { Feather } from '@expo/vector-icons';
import { authService } from '../../services/authService';
import { useAuthStore } from '../../stores/authStore';
import PearlMark from '../../components/brand/PearlMark';

const { height: SCREEN_H } = Dimensions.get('window');

const NAVY_DEEP = '#080E1A';
const NAVY = '#0B1E3D';
const NAVY_MID = '#141E30';
const WHITE = '#FFFFFF';
const WHITE_08 = 'rgba(255,255,255,0.08)';
const WHITE_15 = 'rgba(11,30,61,0.12)'; // card-zone hairline
const WHITE_30 = 'rgba(11,30,61,0.30)'; // card-zone neutral
const WHITE_45 = 'rgba(11,30,61,0.45)'; // card-zone neutral (the form is a light sheet now)
const WHITE_60 = 'rgba(255,255,255,0.60)';

type ForgotStep = 'email' | 'reset';

export default function LoginScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
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
            <ScrollView contentContainerStyle={[s.forgotContainer, { paddingTop: insets.top }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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
                <PearlMark size={64} />

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
                        <ActivityIndicator color={WHITE} size={16} />
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
                        <ActivityIndicator color={WHITE} size={16} />
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
    <View style={d.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[d.container, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          <Animated.View style={[d.hero, { opacity: fadeAnim, transform: [{ scale: logoScale }] }]}>
            <Image source={require('../../../assets/brand/mark-light.png')} style={d.mark} resizeMode="contain" />
            <Image source={require('../../../assets/brand/wordmark-light.png')} style={d.wordmark} resizeMode="contain" accessibilityLabel="Platinum Circles" />
          </Animated.View>

          <Animated.View style={[d.form, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            <View style={d.field}>
              <TextInput
                style={d.input}
                value={email}
                onChangeText={setEmail}
                placeholder="Username or email"
                placeholderTextColor="#8A93A5"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
            </View>
            <View style={d.field}>
              <TextInput
                ref={passwordRef}
                style={[d.input, { paddingRight: 44 }]}
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor="#8A93A5"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                returnKeyType="go"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity style={d.eye} onPress={() => setShowPassword(p => !p)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}>
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color="#8A93A5" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={d.forgot} onPress={() => { setForgotMode(true); setForgotEmail(email); }} activeOpacity={0.7}>
              <Text style={d.forgotTxt}>Forgot password</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[d.btn, loading && { opacity: 0.6 }]} onPress={handleLogin} disabled={loading} activeOpacity={0.88}>
              {loading ? <ActivityIndicator color="#F5F3EF" size="small" /> : <Text style={d.btnTxt}>Sign in</Text>}
            </TouchableOpacity>
          </Animated.View>

          <View style={d.footer}>
            <TouchableOpacity onPress={() => navigation.navigate('SignUp')} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8 }}>
              <Text style={d.link}>New here? <Text style={d.linkStrong}>Create an account</Text></Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => (navigation as any).navigate('BusinessSignIn')} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8 }}>
              <Text style={d.linkSmall}>Business sign-in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
const s = themedSheet((t) => ({
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
  brandName: { fontSize: 16, fontWeight: '400', color: '#EDE7DB', letterSpacing: 7 },
  brandTag: { fontSize: 11, color: WHITE_30, letterSpacing: 2, marginTop: 6 },
  formWrap: {
    width: '100%', backgroundColor: WHITE, borderRadius: 28, padding: 22, paddingTop: 24,
    shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12,
  },
  sheetTitle: { fontSize: 24, fontWeight: '800', color: NAVY, letterSpacing: -0.4 },
  sheetSub: { fontSize: 13, color: t.ink.muted, marginTop: 3, marginBottom: 16 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FBFBFA',
    borderWidth: 1,
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
    color: NAVY,
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
    backgroundColor: NAVY,
    borderRadius: 99,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnTxt: { fontSize: 16, fontWeight: '700', color: '#F5F0E8', letterSpacing: 0.4 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 0.5, backgroundColor: WHITE_15 },
  dividerTxt: { fontSize: 12, color: WHITE_30, marginHorizontal: 14, fontWeight: '500' },
  outlineBtn: {
    borderWidth: 1,
    borderColor: WHITE_15,
    borderRadius: 99,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineBtnTxt: { fontSize: 15, fontWeight: '600', color: NAVY },
  footer: { alignItems: 'center', marginTop: 32, paddingHorizontal: 20 },
  footerTxt: { fontSize: 11, color: 'rgba(255,255,255,0.35)', textAlign: 'center', lineHeight: 16 },
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
  forgotContent: {
    alignItems: 'center', gap: 12, backgroundColor: WHITE, borderRadius: 28, padding: 22, paddingTop: 26,
    shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12,
  },
  forgotTitle: { fontSize: 24, fontWeight: '700', color: NAVY, marginTop: 16 },
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
}));
// The approved sign-in design: white canvas, the real mark with the wordmark, raised fields, navy button.
const d = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  container: { flexGrow: 1, paddingHorizontal: 28 },
  hero: { alignItems: 'center', marginTop: 8 },
  mark: { width: 200, height: 146 },
  wordmark: { width: 236, height: 25, marginTop: 22 },
  form: { marginTop: 48, gap: 12 },
  field: { backgroundColor: '#FAFAF9', borderWidth: 1, borderColor: 'rgba(11,30,61,0.10)', borderRadius: 14, height: 54, justifyContent: 'center' },
  input: { height: 54, paddingHorizontal: 16, fontSize: 15.5, color: '#0B1E3D' },
  eye: { position: 'absolute', right: 8, top: 0, height: 54, width: 40, alignItems: 'center', justifyContent: 'center' },
  forgot: { alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: 4, marginTop: -2 },
  forgotTxt: { fontSize: 13.5, color: 'rgba(11,30,61,0.55)', fontWeight: '600' },
  btn: { backgroundColor: '#0B1E3D', borderRadius: 14, height: 54, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  btnTxt: { color: '#F5F3EF', fontSize: 16, fontWeight: '800' },
  footer: { marginTop: 'auto', alignItems: 'center', gap: 12, paddingTop: 36 },
  link: { fontSize: 13.5, color: 'rgba(11,30,61,0.55)' },
  linkStrong: { color: '#0B1E3D', fontWeight: '800' },
  linkSmall: { fontSize: 12.5, color: 'rgba(11,30,61,0.45)', fontWeight: '600' },
});
