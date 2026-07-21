import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as Linking from 'expo-linking';
import { Feather } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import { supabase } from '../../services/supabase';
import { authService } from '../../services/authService';
import { useAuthStore } from '../../stores/authStore';

const NAVY = '#0B1E3D';
const WHITE = '#FFFFFF';
const GRAY_100 = '#F3F4F6';
const GRAY_400 = '#9CA3AF';
const GRAY_500 = '#6B7280';
const GRAY_900 = '#111827';
const GREEN_500 = '#16A34A';
const GREEN_50 = '#F0FDF4';
const GREEN_200 = '#BBF7D0';
const RED_500 = '#DC2626';

function extractTokensFromUrl(url: string): {
  access_token: string;
  refresh_token: string;
} | null {
  try {
    const hash = url.split('#')[1];
    if (hash) {
      const params = new URLSearchParams(hash);
      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token');
      if (access_token && refresh_token) return { access_token, refresh_token };
    }
  } catch (e) {
    console.log('[extractTokens] hash error:', e);
  }
  return null;
}

function extractCodeFromUrl(url: string): string | null {
  try {
    const questionMark = url.indexOf('?');
    if (questionMark !== -1) {
      const queryString = url.substring(questionMark + 1).split('#')[0];
      const params = new URLSearchParams(queryString);
      return params.get('code');
    }
  } catch (e) {
    console.log('[extractCode] error:', e);
  }
  return null;
}

function extractTokenHashFromUrl(url: string): {
  tokenHash: string;
  type: string;
} | null {
  try {
    const questionMark = url.indexOf('?');
    if (questionMark !== -1) {
      const queryString = url.substring(questionMark + 1).split('#')[0];
      const params = new URLSearchParams(queryString);
      const token = params.get('token');
      const type = params.get('type');
      if (token && type) return { tokenHash: token, type };
    }
  } catch (e) {
    console.log('[extractTokenHash] error:', e);
  }
  return null;
}

async function establishSessionFromUrl(url: string): Promise<boolean> {
  console.log('[AuthCallback] Processing URL:', url);

  const tokens = extractTokensFromUrl(url);
  if (tokens) {
    console.log('[AuthCallback] Hash tokens found, setting session');
    const { error } = await supabase.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    });
    if (error) {
      console.log('[AuthCallback] setSession error:', error.message);
      return false;
    }
    return true;
  }

  const tokenHash = extractTokenHashFromUrl(url);
  if (tokenHash) {
    console.log('[AuthCallback] Token hash found, type:', tokenHash.type);
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash.tokenHash,
      type: tokenHash.type as any,
    });
    if (error) {
      console.log('[AuthCallback] verifyOtp error:', error.message);
      return false;
    }
    return true;
  }

  const code = extractCodeFromUrl(url);
  if (code) {
    console.log('[AuthCallback] PKCE code found, exchanging');
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.log('[AuthCallback] exchangeCode error:', error.message);
      return false;
    }
    return true;
  }

  console.log('[AuthCallback] No tokens, token_hash, or code in URL');
  return false;
}

export default function AuthCallbackScreen({ navigation }: any) {
  const isPasswordRecovery = useAuthStore((s) => s.isPasswordRecovery);
  const setPasswordRecovery = useAuthStore((s) => s.setPasswordRecovery);
  const recoveryUrl = useAuthStore((s) => s.recoveryUrl);
  const setRecoveryUrl = useAuthStore((s) => s.setRecoveryUrl);
  const session = useAuthStore((s) => s.session);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [verified, setVerified] = useState(false);
  const [showManualContinue, setShowManualContinue] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function processDeepLink() {
      try {
        const { data: existingCheck } = await supabase.auth.getSession();
        if (existingCheck?.session && !cancelled) {
          console.log('[AuthCallback] Existing session found');
          if (!isPasswordRecovery) {
            setVerified(true);
            showMessage({ message: 'Email verified', type: 'success' });
          }
          return;
        }

        if (recoveryUrl) {
          console.log('[AuthCallback] Using stored recovery URL');
          const success = await establishSessionFromUrl(recoveryUrl);
          setRecoveryUrl(null);
          if (!cancelled && success) {
            if (!isPasswordRecovery) {
              setVerified(true);
              showMessage({ message: 'Email verified', type: 'success' });
            }
            return;
          }
        }

        const initialUrl = await Linking.getInitialURL();
        console.log('[AuthCallback] initialURL:', initialUrl || 'NO_INITIAL_URL');

        if (initialUrl) {
          const success = await establishSessionFromUrl(initialUrl);
          if (!cancelled && success) {
            if (!isPasswordRecovery) {
              setVerified(true);
              showMessage({ message: 'Email verified', type: 'success' });
            }
            return;
          }
        }

        const { data: existing } = await supabase.auth.getSession();
        if (existing?.session && !cancelled) {
          console.log('[AuthCallback] Session found after URL processing');
          if (!isPasswordRecovery) {
            setVerified(true);
            showMessage({ message: 'Email verified', type: 'success' });
          }
          return;
        }

        if (!cancelled) {
          setError('Could not establish session. Please request a new link.');
        }
      } catch (e: any) {
        console.log('[AuthCallback] error:', e);
        if (!cancelled) {
          setError('Something went wrong. Please try again.');
        }
      }
    }

    processDeepLink();

    const subscription = Linking.addEventListener('url', async ({ url }) => {
      console.log('[AuthCallback] Warm URL received:', url);
      const success = await establishSessionFromUrl(url);
      if (success) {
        if (!isPasswordRecovery) {
          setVerified(true);
          showMessage({ message: 'Email verified', type: 'success' });
        }
      } else {
        setError('Could not establish session. Please request a new link.');
      }
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [isPasswordRecovery, recoveryUrl]);

  useEffect(() => {
    if (!verified || isPasswordRecovery) return;
    const timer = setTimeout(() => setShowManualContinue(true), 5000);
    return () => clearTimeout(timer);
  }, [verified, isPasswordRecovery]);

  function handleManualContinue() {
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) {
        useAuthStore.getState().setSession(data.session);
        useAuthStore.getState().refreshProfile();
      } else {
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      }
    });
  }

  async function handleResetPassword() {
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await authService.updatePassword(newPassword);
      setShowSuccess(true);
      showMessage({ message: 'Password updated', type: 'success' });
      setTimeout(() => setPasswordRecovery(false), 1500);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update password');
    } finally {
      setSaving(false);
    }
  }

  function handleGoBack() {
    setPasswordRecovery(false);
    supabase.auth.signOut();
  }

  if (showSuccess) {
    return (
      <View style={s.center}>
        <Feather name="check-circle" size={56} color={GREEN_500} />
        <Text style={s.successTitle}>Password updated</Text>
        <Text style={s.successSub}>Redirecting you now...</Text>
      </View>
    );
  }

  if (isPasswordRecovery && !verified && !session) {
    return (
      <View style={s.center}>
        {!error ? (
          <>
            <ActivityIndicator size="large" color={NAVY} />
            <Text style={s.loadingTxt}>Preparing password reset...</Text>
          </>
        ) : (
          <>
            <Feather name="alert-circle" size={48} color={RED_500} />
            <Text style={[s.errTxt, { marginTop: 16, textAlign: 'center', fontSize: 15 }]}>{error}</Text>
            <TouchableOpacity style={[s.primaryBtn, { marginTop: 20, paddingHorizontal: 32 }]} onPress={handleGoBack}>
              <Text style={s.primaryBtnTxt}>Back to sign in</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  if (isPasswordRecovery) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: WHITE }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.resetContainer}>
          <Feather name="lock" size={48} color={NAVY} style={{ marginBottom: 16 }} />
          <Text style={s.resetTitle}>Set a new password</Text>
          <Text style={s.resetSub}>Enter your new password below.</Text>

          <View style={s.field}>
            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="New password"
              placeholderTextColor={GRAY_400}
              style={s.resetInput}
              secureTextEntry
              autoFocus
            />
          </View>

          <View style={s.field}>
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm new password"
              placeholderTextColor={GRAY_400}
              style={s.resetInput}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={handleResetPassword}
            />
          </View>

          {error && <Text style={s.errTxt}>{error}</Text>}

          <TouchableOpacity
            style={[s.primaryBtn, (saving || newPassword.length < 8 || !confirmPassword) && s.btnDisabled]}
            onPress={handleResetPassword}
            disabled={saving || newPassword.length < 8 || !confirmPassword}
          >
            {saving ? <ActivityIndicator color={WHITE} /> : <Text style={s.primaryBtnTxt}>Update password</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={s.cancelBtn} onPress={handleGoBack}>
            <Text style={s.cancelTxt}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  if (verified) {
    return (
      <View style={s.center}>
        <View style={s.verifiedIcon}>
          <Feather name="check" size={28} color={GREEN_500} />
        </View>
        <Text style={s.successTitle}>Email verified</Text>
        <Text style={s.successSub}>Setting up your account...</Text>
        <ActivityIndicator size="small" color={NAVY} style={{ marginTop: 20 }} />
        {showManualContinue && (
          <TouchableOpacity
            style={[s.primaryBtn, { marginTop: 24, paddingHorizontal: 32 }]}
            onPress={handleManualContinue}
          >
            <Text style={s.primaryBtnTxt}>Continue</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={s.center}>
      {!error ? (
        <>
          <ActivityIndicator size="large" color={NAVY} />
          <Text style={s.loadingTxt}>Verifying your email...</Text>
        </>
      ) : (
        <>
          <Feather name="alert-circle" size={48} color={RED_500} />
          <Text style={[s.errTxt, { marginTop: 16, textAlign: 'center', fontSize: 15 }]}>{error}</Text>
          <TouchableOpacity
            style={[s.primaryBtn, { marginTop: 20, paddingHorizontal: 32 }]}
            onPress={() => {
              supabase.auth.signOut();
              setPasswordRecovery(false);
            }}
          >
            <Text style={s.primaryBtnTxt}>Back to sign in</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: WHITE,
  },
  verifiedIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: GREEN_50,
    borderWidth: 2,
    borderColor: GREEN_200,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  loadingTxt: { marginTop: 16, fontSize: 15, color: GRAY_500 },
  successTitle: { fontSize: 22, fontWeight: '700', color: GRAY_900, marginTop: 4, marginBottom: 6 },
  successSub: { fontSize: 14, color: GRAY_500 },
  resetContainer: { flex: 1, justifyContent: 'center', padding: 28, backgroundColor: WHITE },
  resetTitle: { fontSize: 24, fontWeight: '700', color: GRAY_900, marginBottom: 6 },
  resetSub: { fontSize: 14, color: GRAY_500, marginBottom: 24 },
  field: { marginBottom: 12 },
  resetInput: {
    backgroundColor: GRAY_100,
    borderWidth: 0.5,
    borderColor: GRAY_400,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
    color: GRAY_900,
  },
  errTxt: { color: RED_500, fontSize: 14, marginBottom: 10 },
  primaryBtn: {
    backgroundColor: NAVY,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnTxt: { color: WHITE, fontSize: 16, fontWeight: '700' },
  cancelBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  cancelTxt: { color: GRAY_500, fontSize: 15 },
});