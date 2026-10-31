import { themedSheet } from '../../theme/useTheme';
import { useSafeAreaInsets } from '../../components/SafeArea';
import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { View, Text, TouchableOpacity, ActivityIndicator, AppState, Animated, Easing } from 'react-native';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import { authService } from '../../services/authService';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import PearlMark from '../../components/brand/PearlMark';

const NAVY = '#0B1E3D';
const NAVY_DEEP = '#080E1A';
const WHITE = '#FFFFFF';
const GRAY_100 = '#F3F4F6';
const GRAY_400 = '#9CA3AF';
const GRAY_500 = '#6B7280';
const GRAY_900 = '#111827';
const GREEN_50 = '#F0FDF4';
const GREEN_200 = '#BBF7D0';
const MAROON = '#8C1D40';
const GOLD = '#FFC627';

export default function VerifyEmailScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const { email } = route.params;
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const [checking, setChecking] = useState(false);
  const verifiedIsASU = false; // school era retired 2026-07-28
  const [navigating, setNavigating] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const checkScale = useRef(new Animated.Value(0)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  const verificationRef = useRef<{
    check: (notify?: boolean) => Promise<void>;
    current: () => boolean;
    verifiedUserId: () => string | null;
  } | null>(null);
  const verificationGeneration = useRef(0);

  // Work belongs to this mounted email screen, never the next signed-in account.
  useEffect(() => {
    const generation = ++verificationGeneration.current;
    const expectedEmail = String(email || '').trim().toLowerCase();
    const matchesEmail = (value: Session | null) => !!expectedEmail
      && value?.user.email?.trim().toLowerCase() === expectedEmail;
    const initial = useAuthStore.getState().session;
    let invalidated = !!initial && !matchesEmail(initial);
    let expectedUserId = matchesEmail(initial) ? initial?.user.id ?? null : null;
    let seenSession = !!initial;
    let completedUserId: string | null = null;
    let checkingSession = false;
    let exchanging = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let endRetry: (() => void) | undefined;
    const current = () => verificationGeneration.current === generation && !invalidated;
    const compatible = (candidate: Session) => current() && matchesEmail(candidate)
      && (!expectedUserId || candidate.user.id === expectedUserId)
      && (!useAuthStore.getState().session || useAuthStore.getState().session?.user.id === candidate.user.id);
    const unsubscribe = useAuthStore.subscribe((state, previous) => {
      if (state.session?.user.id === previous.session?.user.id) return;
      if (!state.session) {
        if (seenSession) invalidated = true;
      } else if (!matchesEmail(state.session) || (expectedUserId && state.session.user.id !== expectedUserId)) {
        invalidated = true;
      } else {
        expectedUserId = state.session.user.id;
        seenSession = true;
      }
    });
    setVerified(false); setChecking(false); setNavigating(false);

    async function accept(candidate: Session | null): Promise<boolean> {
      if (!candidate || !compatible(candidate)) return false;
      if (completedUserId) return completedUserId === candidate.user.id;
      // A saved UI flag and cached session cannot confirm email verification.
      const { data, error } = await supabase.auth.getUser(candidate.access_token);
      if (error) throw error;
      if (!compatible(candidate) || !data.user?.email_confirmed_at
        || data.user.id !== candidate.user.id
        || data.user.email?.trim().toLowerCase() !== expectedEmail) return false;
      if (completedUserId) return completedUserId === candidate.user.id;
      expectedUserId = candidate.user.id;
      completedUserId = candidate.user.id;
      setVerified(true);
      Animated.spring(checkScale, { toValue: 1, friction: 4, tension: 100, useNativeDriver: true }).start(() => {
        if (current()) Animated.timing(fadeIn, { toValue: 1, duration: 400, useNativeDriver: true }).start();
      });
      AsyncStorage.setItem(`pc_email_verified_${email}`, 'true').catch(() => {});
      useAuthStore.getState().setSession({ ...candidate, user: data.user });
      await useAuthStore.getState().refreshProfile();
      return true;
    }

    async function check(notify = false) {
      if (!current() || completedUserId || checkingSession) return;
      checkingSession = true; setChecking(true);
      try {
        for (let attempt = 0; attempt < (notify ? 1 : 5) && current(); attempt++) {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (!current() || await accept(data.session)) return;
          if (notify || attempt === 4) break;
          await new Promise<void>(resolve => { endRetry = resolve; retryTimer = setTimeout(resolve, 500 * (attempt + 1)); });
          retryTimer = undefined; endRetry = undefined;
        }
        if (notify && current()) showMessage({ message: 'Not verified yet', description: 'Open the link in your email first.', type: 'info' });
      } catch {
        if (notify && current()) showMessage({ message: 'Verification could not be checked', description: 'Please try again when your connection is available.', type: 'danger' });
        console.log('[VerifyEmail] session check failed');
      } finally {
        checkingSession = false;
        if (current() && !exchanging) setChecking(false);
      }
    }

    async function exchangeFromUrl(url: string) {
      if (!current() || completedUserId || exchanging || !url.includes('auth/callback')) return;
      exchanging = true; setChecking(true);
      try {
        const hash = new URLSearchParams(url.split('#')[1] || '');
        const accessToken = hash.get('access_token');
        const refreshToken = hash.get('refresh_token');
        if (accessToken && refreshToken) {
          const checked = await supabase.auth.getUser(accessToken);
          if (!current() || checked.error || !checked.data.user?.email_confirmed_at
            || checked.data.user.email?.trim().toLowerCase() !== expectedEmail
            || (expectedUserId && checked.data.user.id !== expectedUserId)) return;
          const { data, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          if (error) throw error;
          if (!current() || await accept(data.session)) return;
        } else {
          const query = new URLSearchParams(url.split('?')[1]?.split('#')[0] || '');
          const token = query.get('token'); const type = query.get('type');
          if (token && (type === 'signup' || type === 'email' || type === 'email_change')) {
            const { data, error } = await supabase.auth.verifyOtp({ token_hash: token, type });
            if (error) throw error;
            if (!current() || await accept(data.session)) return;
          }
        }
        await check();
      } catch {
        if (current()) showMessage({ message: 'Verification could not be completed', description: 'Open the latest verification email or check your status again.', type: 'danger' });
        console.log('[VerifyEmail] exchange failed');
      } finally {
        exchanging = false;
        if (current() && !checkingSession) setChecking(false);
      }
    }

    verificationRef.current = { check, current, verifiedUserId: () => completedUserId };
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') void check(); });
    const links = Linking.addEventListener('url', ({ url }) => { void exchangeFromUrl(url); });
    void Linking.getInitialURL().then(url => { if (url && current()) return exchangeFromUrl(url); }).catch(() => {});
    void check();
    return () => {
      verificationGeneration.current = generation + 1; verificationRef.current = null;
      unsubscribe(); foreground.remove(); links.remove();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      endRetry?.();
    };
  }, [email, checkScale, fadeIn]);

  useEffect(() => {
    if (verified) return;
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.08, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    pulse.start();
    return () => pulse.stop();
  }, [verified, pulseAnim]);

  async function handleContinue() {
    const verification = verificationRef.current;
    if (navigating || !verification?.current()) return;
    setNavigating(true);

    // Clean up persistence flag
    AsyncStorage.removeItem(`pc_email_verified_${email}`).catch(() => {});

    // Safety check: verify session still exists
    const session = useAuthStore.getState().session;
    if (!session || session.user.id !== verification.verifiedUserId()) {
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      return;
    }

    // Route based on profile state
    const profile = useAuthStore.getState().profile;
    if (!profile?.username) {
      // New user: go to profile setup
      navigation.reset({ index: 0, routes: [{ name: 'SetupProfile' }] });
    } else {
      // Existing user with complete profile.
      // refreshProfile updates authStore state, which triggers AppNavigator
      // to re-render and show the main tab navigator automatically.
      await useAuthStore.getState().refreshProfile();
      // Fallback: if AppNavigator doesn't switch, unfreeze the button
      if (verification.current()) setNavigating(false);
    }
  }

  async function handleResend() {
    const verification = verificationRef.current;
    if (loading || !verification?.current()) return;
    setLoading(true);
    try {
      const redirectTo = Linking.createURL('auth/callback');
      await authService.resendVerification(email, redirectTo);
      if (!verification.current()) return;
      showMessage({
        message: 'Verification email sent',
        description: `Check ${email} and tap the link.`,
        type: 'success',
        duration: 4000,
      });
    } catch {
      if (!verification.current()) return;
      showMessage({
        message: 'Failed to resend verification email',
        type: 'danger',
      });
    } finally {
      if (verification.current()) setLoading(false);
    }
  }

  // ── OPTION B: CELEBRATION SUCCESS SCREEN ────────────────────
  if (verified) {
    return (
      <View style={s.successBg}>
        <Animated.View style={{ transform: [{ scale: checkScale }], marginBottom: 24 }}>
          <View style={[s.successCheckWrap, verifiedIsASU && s.successCheckWrapASU]}>
            <Feather name="check" size={36} color={verifiedIsASU ? GOLD : WHITE} />
          </View>
        </Animated.View>

        <Animated.View style={{ opacity: fadeIn, alignItems: 'center' }}>
          <PearlMark size={72} />

          <Text style={s.successTitle}>Welcome to PlatinumCircles</Text>
          <Text style={s.successSub}>
            {verifiedIsASU ? 'Your ASU network awaits.' : 'Your global network awaits.'}
          </Text>

          {verifiedIsASU && (
            <View style={s.asuBadge}>
              <Feather name="shield" size={12} color={GOLD} />
              <Text style={s.asuBadgeTxt}>ASU Verified</Text>
            </View>
          )}

          <TouchableOpacity
            style={[s.successBtn, verifiedIsASU && s.successBtnASU]}
            onPress={handleContinue}
            activeOpacity={0.85}
            disabled={navigating}
          >
            {navigating ? (
              <ActivityIndicator color={verifiedIsASU ? MAROON : NAVY} size={16} />
            ) : (
              <Text style={[s.successBtnTxt, verifiedIsASU && s.successBtnTxtASU]}>
                Set Up Your Profile
              </Text>
            )}
          </TouchableOpacity>

          <Text style={s.successHint}>This takes about 30 seconds</Text>
        </Animated.View>
      </View>
    );
  }

  // ── WAITING STATE ───────────────────────────────────────────
  return (
    <View style={[s.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Animated.View style={[s.iconWrap, { transform: [{ scale: pulseAnim }] }]}>
        <Feather name="mail" size={28} color={NAVY} />
      </Animated.View>

      <Text style={s.title}>Check your email</Text>
      <Text style={s.desc}>We sent a verification link to</Text>
      <Text style={s.email}>{email}</Text>

      <View style={s.stepsCard}>
        <StepRow number={1} text="Open the email from PlatinumCircles" />
        <StepRow number={2} text="Tap the verification link" />
        <StepRow number={3} text="You'll be brought back here automatically" />
      </View>

      {checking && (
        <View style={s.checkingRow}>
          <ActivityIndicator color={NAVY} size="small" />
          <Text style={s.checkingTxt}>Checking verification status...</Text>
        </View>
      )}

      <TouchableOpacity
        style={[s.resendBtn, loading && s.btnDisabled]}
        onPress={handleResend}
        disabled={loading}
        activeOpacity={0.85}
      >
        {loading ? (
          <ActivityIndicator color={GRAY_500} size={14} />
        ) : (
          <Text style={s.resendTxt}>Resend email</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={s.checkBtn}
        onPress={() => { void verificationRef.current?.check(true); }}
        disabled={checking}
        activeOpacity={0.7}
      >
        <Text style={s.checkBtnTxt}>I already verified</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={s.backBtn}
        onPress={() => navigation.navigate('Login')}
        disabled={loading}
        activeOpacity={0.7}
      >
        <Text style={s.backTxt}>Back to sign in</Text>
      </TouchableOpacity>
    </View>
  );
}

function StepRow({ number, text }: { number: number; text: string }) {
  return (
    <View style={s.stepRow}>
      <View style={s.stepNum}>
        <Text style={s.stepNumTxt}>{number}</Text>
      </View>
      <Text style={s.stepTxt}>{text}</Text>
    </View>
  );
}

const s = themedSheet((t) => ({
  container: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    padding: 32, backgroundColor: WHITE,
  },
  iconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: GREEN_50, borderWidth: 2, borderColor: GREEN_200,
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  title: { fontSize: 24, fontWeight: '700', color: GRAY_900, marginBottom: 8 },
  desc: { fontSize: 14, color: GRAY_500, marginBottom: 4 },
  email: { fontSize: 15, fontWeight: '700', color: NAVY, marginBottom: 24 },
  stepsCard: {
    width: '100%', backgroundColor: GRAY_100, borderRadius: 16,
    padding: 16, marginBottom: 24, gap: 12,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNum: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: NAVY,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumTxt: { fontSize: 13, fontWeight: '700', color: WHITE },
  stepTxt: { fontSize: 14, color: GRAY_900, flex: 1, lineHeight: 19 },
  checkingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  checkingTxt: { fontSize: 13, color: NAVY, fontWeight: '500' },
  resendBtn: {
    backgroundColor: NAVY, borderRadius: 99,
    paddingVertical: 13, paddingHorizontal: 28, minWidth: 180, alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  resendTxt: { fontSize: 14, fontWeight: '600', color: '#F5F0E8' },
  checkBtn: { marginTop: 12, paddingVertical: 10, paddingHorizontal: 20 },
  checkBtnTxt: { fontSize: 14, fontWeight: '600', color: NAVY },
  backBtn: { marginTop: 8, paddingVertical: 10, paddingHorizontal: 20 },
  backTxt: { fontSize: 14, fontWeight: '500', color: GRAY_400 },

  // ── Option B: Celebration success ───────
  successBg: {
    flex: 1, backgroundColor: NAVY_DEEP,
    alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  successCheckWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  successCheckWrapASU: {
    backgroundColor: 'rgba(140,29,64,0.3)',
    borderColor: GOLD,
  },
  successTitle: {
    fontSize: 26, fontWeight: '800', color: WHITE,
    marginTop: 20, marginBottom: 8, letterSpacing: -0.3,
  },
  successSub: {
    fontSize: 15, color: 'rgba(255,255,255,0.6)',
    marginBottom: 20, textAlign: 'center',
  },
  asuBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(140,29,64,0.4)',
    borderWidth: 1, borderColor: GOLD,
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6,
    marginBottom: 28,
  },
  asuBadgeTxt: { fontSize: 12, fontWeight: '700', color: GOLD },
  successBtn: {
    backgroundColor: WHITE, borderRadius: 14,
    paddingVertical: 16, paddingHorizontal: 48,
    minWidth: 240, alignItems: 'center', marginTop: 8,
  },
  successBtnASU: { backgroundColor: GOLD },
  successBtnTxt: { fontSize: 16, fontWeight: '700', color: NAVY },
  successBtnTxtASU: { color: MAROON },
  successHint: { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 12 },
}));
