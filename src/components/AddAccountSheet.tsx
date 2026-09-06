/**
 * Add account: signs a second account in on top of the current one. The
 * account you came from is never signed out, so its token stays valid and it
 * stays in the switcher. On success the app restarts on the new account.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from './SafeArea';
import { Feather } from '@expo/vector-icons';
import { authService } from '../services/authService';
import { supabase } from '../services/supabase';
import { useAccountsStore } from '../stores/accountsStore';
import { useTheme } from '../theme/useTheme';

export default function AddAccountSheet() {
  const insets = useSafeAreaInsets();
  const { t } = useTheme();
  const open = useAccountsStore((s) => s.addOpen);
  const close = useAccountsStore((s) => s.closeAdd);
  const remember = useAccountsStore((s) => s.remember);
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!id.trim() || !pw) { setErr('Enter the account and its password.'); return; }
    setBusy(true); setErr(null);
    try {
      await authService.signIn(id.trim(), pw);
      const { data } = await supabase.auth.getSession();
      if (data.session) await remember(data.session as any);
      setId(''); setPw(''); close();
      const { DevSettings } = require('react-native');
      try { const Updates = require('expo-updates'); if (Updates?.reloadAsync && !__DEV__) { await Updates.reloadAsync(); return; } } catch {}
      try { DevSettings.reload(); } catch {}
    } catch (e: any) {
      setErr(e?.message || 'Could not sign in.');
    } finally { setBusy(false); }
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={st.wrap}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={close} />
          <View style={[st.sheet, { backgroundColor: t.surface.canvas, paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={[st.handle, { backgroundColor: t.ink.faint }]} />
            <Text style={[st.title, { color: t.ink.primary }]}>Add account</Text>
            <Text style={[st.sub, { color: t.ink.muted }]}>The account you're using stays signed in.</Text>
            <TextInput value={id} onChangeText={setId} placeholder="Email or username" placeholderTextColor={t.ink.faint} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={[st.input, { color: t.ink.primary, borderColor: t.surface.hairline, backgroundColor: t.surface.raised }]} />
            <TextInput value={pw} onChangeText={setPw} placeholder="Password" placeholderTextColor={t.ink.faint} secureTextEntry style={[st.input, { color: t.ink.primary, borderColor: t.surface.hairline, backgroundColor: t.surface.raised }]} onSubmitEditing={submit} returnKeyType="go" />
            {err ? <Text style={[st.err, { color: t.status.danger }]}>{err}</Text> : null}
            <TouchableOpacity style={[st.btn, { backgroundColor: t.brand.base }]} onPress={submit} disabled={busy} activeOpacity={0.85}>
              {busy ? <ActivityIndicator color={t.ink.inverse} /> : <Text style={[st.btnTxt, { color: t.ink.inverse }]}>Sign in</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={close} style={{ alignSelf: 'center', marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Feather name="x" size={14} color={t.ink.muted} /><Text style={{ color: t.ink.muted, fontSize: 13, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 12 },
  title: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  sub: { fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 14 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, height: 48, fontSize: 15, marginTop: 10 },
  err: { fontSize: 13, marginTop: 10 },
  btn: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  btnTxt: { fontSize: 15, fontWeight: '800' },
});