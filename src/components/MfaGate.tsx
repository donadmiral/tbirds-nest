/**
 * The second step of sign-in. When the account has two-factor on, Supabase
 * issues the first session at level one; this gate covers the app until a
 * code lifts it to level two. Nothing behind it is reachable before that.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { useTheme } from '../theme/useTheme';

export default function MfaGate() {
  const session = useAuthStore((s) => s.session);
  const { t } = useTheme();
  const [needed, setNeeded] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (!session) { setNeeded(false); return; }
    try {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const must = data?.nextLevel === 'aal2' && data?.currentLevel === 'aal1';
      if (must) { const { data: f } = await supabase.auth.mfa.listFactors(); const v = ((f?.totp as any[]) || []).find((x) => x.status === 'verified'); setFactorId(v?.id ?? null); }
      setNeeded(must);
    } catch { setNeeded(false); }
  }, [session]);
  useEffect(() => { check(); }, [check]);

  const verify = async () => {
    if (!factorId || code.trim().length < 6) { setErr('Enter the six-digit code.'); return; }
    setBusy(true); setErr(null);
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
      if (chErr || !ch) throw chErr || new Error('Could not verify');
      const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: code.trim() });
      if (error) throw error;
      setCode(''); setNeeded(false);
    } catch (e: any) { setErr(e?.message || 'Wrong code'); }
    finally { setBusy(false); }
  };

  if (!needed) return null;
  return (
    <View style={[st.cover, { backgroundColor: t.surface.canvas }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={st.box}>
        <Text style={[st.title, { color: t.ink.primary }]}>Enter your code</Text>
        <Text style={[st.sub, { color: t.ink.muted }]}>Open your authenticator app and enter the six-digit code for Platinum Circles.</Text>
        <TextInput value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoFocus placeholder="000000" placeholderTextColor={t.ink.faint} style={[st.input, { color: t.ink.primary, borderColor: t.surface.hairline, backgroundColor: t.surface.raised }]} onSubmitEditing={verify} />
        {err ? <Text style={{ color: t.status.danger, fontSize: 13, marginTop: 8 }}>{err}</Text> : null}
        <TouchableOpacity style={[st.btn, { backgroundColor: t.brand.base }]} onPress={verify} disabled={busy} activeOpacity={0.85}>{busy ? <ActivityIndicator color={t.ink.inverse} /> : <Text style={[st.btnTxt, { color: t.ink.inverse }]}>Continue</Text>}</TouchableOpacity>
        <TouchableOpacity onPress={() => useAuthStore.getState().signOut()} style={{ alignSelf: 'center', marginTop: 16 }}><Text style={{ color: t.ink.muted, fontSize: 13.5, fontWeight: '600' }}>Sign out</Text></TouchableOpacity>
      </KeyboardAvoidingView>
    </View>
  );
}

const st = StyleSheet.create({
  cover: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 9998, elevation: 9998, alignItems: 'center', justifyContent: 'center', padding: 24 },
  box: { width: '100%', maxWidth: 380 },
  title: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  sub: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8, marginBottom: 20 },
  input: { borderWidth: 1, borderRadius: 12, height: 52, fontSize: 24, letterSpacing: 8, textAlign: 'center' },
  btn: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  btnTxt: { fontSize: 15, fontWeight: '800' },
});