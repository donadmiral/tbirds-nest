import React, { useState } from 'react';
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
} from 'react-native';
import { showMessage } from 'react-native-flash-message';
import { authService } from '../../services/authService';
import { colors as themeColors, spacing as themeSpacing, radius as themeRadius, typography as themeTypography } from '../../utils/theme';
import PlatinumCirclesLogo from '../../components/PlatinumCirclesLogo';

const colors = {
  primary: themeColors?.primary ?? '#2563EB',
  white: themeColors?.white ?? '#FFFFFF',
  text: themeColors?.text ?? '#111827',
  text2: themeColors?.text2 ?? '#374151',
  text3: themeColors?.text3 ?? '#9CA3AF',
  bg: themeColors?.bg ?? themeColors?.background ?? '#F8FAFC',
  border2: themeColors?.border2 ?? themeColors?.border ?? '#E5E7EB',
  shadow: themeColors?.shadow ?? '#000000',
};

const spacing = {
  sm: themeSpacing?.sm ?? 8,
  md: themeSpacing?.md ?? 12,
  lg: themeSpacing?.lg ?? 16,
  xl: themeSpacing?.xl ?? 20,
  xxl: themeSpacing?.xxl ?? 24,
};

const radius = {
  sm: themeRadius?.sm ?? 10,
  lg: themeRadius?.lg ?? 18,
};

const typography = {
  sm: themeTypography?.sm ?? 14,
  md: themeTypography?.md ?? 16,
  xl: themeTypography?.xl ?? 22,
  xxl: themeTypography?.xxl ?? 30,
};

export default function LoginScreen({ navigation }: any) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password;

    if (!cleanEmail || !cleanPassword) {
      showMessage({ message: 'Please enter email and password', type: 'warning' });
      return;
    }

    setLoading(true);

    try {
      const result = await authService.signIn(cleanEmail, cleanPassword);
      console.log('LOGIN_RESULT', { hasResult: !!result });
    } catch (err: any) {
      console.log('LOGIN_ERROR', {
        message: err?.message ?? 'Unknown login error',
        name: err?.name ?? null,
      });

      showMessage({ message: err?.message ?? 'Login failed', type: 'danger' });
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
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoWrap}>
          <PlatinumCirclesLogo size={80} />
          <Text style={styles.appName}>
            Platinum<Text style={styles.appNameAccent}>Circles</Text>
          </Text>
          <Text style={styles.tagline}>Your exclusive community platform</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Welcome back</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.text3}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.text3}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.btnText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => navigation.navigate('SignUp')}
            style={styles.linkWrap}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Text style={styles.link}>
              Don't have an account? <Text style={styles.linkAccent}>Sign up</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    backgroundColor: colors.bg,
    padding: spacing.xl,
    justifyContent: 'center',
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: spacing.xxl + 8,
  },
  appName: {
    fontSize: typography.xxl,
    fontWeight: '700',
    color: colors.text,
    marginTop: 12,
  },
  appNameAccent: {
    color: colors.primary,
  },
  tagline: {
    fontSize: typography.sm,
    color: colors.text3,
    marginTop: 4,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.xxl,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  title: {
    fontSize: typography.xl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xl,
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
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border2,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: typography.md,
    color: colors.text,
  },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  btnDisabled: {
    opacity: 0.7,
  },
  btnText: {
    color: colors.white,
    fontSize: typography.md,
    fontWeight: '600',
  },
  linkWrap: {
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  link: {
    fontSize: typography.sm,
    color: colors.text2,
  },
  linkAccent: {
    color: colors.primary,
    fontWeight: '600',
  },
});