import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  AppState,
  Animated,
  Easing,
} from 'react-native';
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
const GREEN_500 = '#16A34A';
const GREEN_50 = '#F0FDF4';
const GREEN_200 = '#BBF7D0';
const MAROON = '#8C1D40';
const GOLD = '#FFC627';

export default function VerifyEmailScreen({ route, navigation }: any) {
  const { email } = route.params;
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const [checking, setChecking] = useState(false);
  const verifiedIsASU = false; // school era retired 2026-07-28
  const [navigating, setNavigating] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const checkScale = useRef(new Animated.Value(0)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  // Recover from persisted verification state
  useEffect(() => {
    AsyncStorage.getItem(`pc_email_verified_${email}`).then(val => {
      if (val === 'true') {
        supabase.auth.getSession().then(({ data }) => {
          if (data?.session) handleVerificationSuccess(data.session);
          else AsyncStorage.removeItem(`pc_email_verified_${email}`).catch(() => {});
        });
      }
    }).catch(() => {});
  }, []);

  // Pulse animation on the mail icon
  useEffect(() => {
    if (verified) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [verified]);

  // Check for session on foreground with retry
  useEffect(() => {
    const checkSessionWithRetry = async () => {
      if (verified || checking) return;
      setChecking(true);
      try {
        for (let attempt = 0; attempt < 5; attempt++) {
          const { data } = await supabase.auth.getSession();
          if (data?.session) {
            handleVerificationSuccess(data.session);
            return;
          }
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }
      } catch (e) {
        console.log('[VerifyEmail] session check error:', e);
      } finally {
        setChecking(false);
      }
    };

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkSessionWithRetry();
    });

    checkSessionWithRetry();
    return () => sub.remove();
  }, [verified]);

  // Deep link listener
  useEffect(() => {
    const sub = Linking.addEventListener('url', async ({ url }) => {
      if (url && url.includes('auth/callback')) {
        setChecking(true);
        await new Promise(r => setTimeout(r, 500));
        const { data } = await supabase.auth.getSession();
        if (data?.session) {
          handleVerificationSuccess(data.session);
        }
        setChecking(false);
      }
    });
    return () => sub.remove();
  }, []);

  async function handleVerificationSuccess(session: any) {
    if (verified) return;
    setVerified(true);

    const userId = session?.user?.id;
    const userEmail = session?.user?.email || '';

    // Animate checkmark, then fade in content
    Animated.spring(checkScale, {
      toValue: 1, friction: 4, tension: 100, useNativeDriver: true,
    }).start(() => {
      Animated.timing(fadeIn, {
        toValue: 1, duration: 400, useNativeDriver: true,
      }).start();
    });

    // Persist verification state
    AsyncStorage.setItem(`pc_email_verified_${email}`, 'true').catch(() => {});

    // Update auth store
    useAuthStore.getState().setSession(session);

    // Finalize institution verification for ASU users
    if (userId && asuUser) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error: verifyErr } = await supabase.from('profiles').update({
          is_verified_institution: true,
        }).eq('id', userId);
        if (verifyErr) {
          console.log(`[VerifyEmail] institution verify attempt ${attempt + 1} error:`, verifyErr.message);
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        await useAuthStore.getState().refreshProfile();
        const check = useAuthStore.getState().profile;
        if ((check as any)?.is_verified_institution === true) break;
        await new Promise(r => setTimeout(r, 500));
      }
    }

    await useAuthStore.getState().refreshProfile();
  }

  async function handleContinue() {
    if (navigating) return;
    setNavigating(true);

    // Clean up persistence flag
    AsyncStorage.removeItem(`pc_email_verified_${email}`).catch(() => {});

    // Safety check: verify session still exists
    const session = useAuthStore.getState().session;
    if (!session) {
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
      setNavigating(false);
    }
  }

  async function handleResend() {
    setLoading(true);
    try {
      const redirectTo = Linking.createURL('auth/callback');
      await authService.resendVerification(email, redirectTo);
      showMessage({
        message: 'Verification email sent',
        description: `Check ${email} and tap the link.`,
        type: 'success',
        duration: 4000,
      });
    } catch (err: any) {
      showMessage({
        message: err?.message ?? 'Failed to resend verification email',
        type: 'danger',
      });
    } finally {
      setLoading(false);
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
    <View style={s.container}>
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
        onPress={async () => {
          setChecking(true);
          const { data } = await supabase.auth.getSession();
          if (data?.session) {
            handleVerificationSuccess(data.session);
          } else {
            showMessage({
              message: 'Not verified yet',
              description: 'Open the link in your email first.',
              type: 'info',
            });
          }
          setChecking(false);
        }}
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

const s = StyleSheet.create({
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
});