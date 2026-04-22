import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import * as Linking from 'expo-linking';
import { showMessage } from 'react-native-flash-message';
import { authService } from '../../services/authService';
import { colors, spacing, radius } from '../../utils/theme';

export default function VerifyEmailScreen({ route, navigation }: any) {
  const { email } = route.params;
  const [loading, setLoading] = useState(false);

  async function handleResend() {
    setLoading(true);
    try {
      const redirectTo = Linking.createURL('auth/callback');
      await authService.resendVerification(email, redirectTo);
      showMessage({
        message: 'Verification email sent',
        description: `Check ${email} and click the link to activate your account.`,
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

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>📬</Text>
      <Text style={styles.title}>Check your email</Text>
      <Text style={styles.text}>We sent a verification link to:</Text>
      <Text style={styles.email}>{email}</Text>
      <Text style={styles.hint}>
        Click the link in the email to activate your account. After verifying, come back and sign in.
      </Text>

      <TouchableOpacity
        style={[styles.primaryBtn, loading && styles.btnDisabled]}
        onPress={handleResend}
        disabled={loading}
        activeOpacity={0.85}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnTxt}>Resend email</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryBtn}
        onPress={() => navigation.navigate('Login')}
        disabled={loading}
        activeOpacity={0.85}
      >
        <Text style={styles.secondaryBtnTxt}>Back to sign in</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background ?? '#F8FAFC',
  },
  emoji: { fontSize: 56, marginBottom: 20 },
  title: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: spacing.md,
    color: colors.text,
  },
  text: {
    fontSize: 15,
    color: colors.text,
    marginBottom: 6,
  },
  email: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: spacing.lg,
    color: colors.primary,
  },
  hint: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
    paddingHorizontal: 20,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: radius.sm ?? 10,
    minWidth: 220,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnTxt: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  secondaryBtn: {
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  secondaryBtnTxt: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
});