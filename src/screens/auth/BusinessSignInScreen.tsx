/**
 * BusinessSignInScreen - the completely separate door. A company
 * representative enters the business @, their own access code, on a
 * registered company device. The session that opens IS the business.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, TextInput, Alert, ActivityIndicator, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as Application from 'expo-application';
import { supabase } from '../../services/supabase';

const NAVY = '#0B1E3D';

async function getDeviceId(): Promise<string> {
  try {
    if (Platform.OS === 'ios') {
      const id = await Application.getIosIdForVendorAsync();
      if (id) return 'ios-' + id;
    } else {
      const id = Application.getAndroidId();
      if (id) return 'android-' + id;
    }
  } catch {}
  return 'app-' + (Application.getInstallationTimeAsync ? 'inst' : 'x');
}

export default function BusinessSignInScreen() {
  const navigation = useNavigation<any>();
  const [handle, setHandle] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    if (busy) return;
    if (!handle.trim() || !code.trim()) { Alert.alert('Both fields', 'The business @ and your access code are required.'); return; }
    setBusy(true);
    try {
      const device_id = await getDeviceId();
      const { data, error } = await supabase.functions.invoke('business-signin', {
        body: { handle: handle.trim(), code: code.trim(), device_id, device_label: Platform.OS + ' device' },
      });
      if (error) {
        let msg = 'Sign-in failed.';
        try { const body = await (error as any).context?.json?.(); if (body?.error) msg = body.error; } catch {}
        throw new Error((data as any)?.error || msg);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      const { token_hash, email } = data as any;
      const { error: vErr } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash });
      if (vErr) throw vErr;
      // Session is now the business - the app boots into its world.
    } catch (e: any) {
      Alert.alert('Business sign-in', e?.message || 'Could not sign in.');
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
            <Text style={s.backChev}>{'\u2039'}</Text><Text style={s.backLbl}>Back</Text>
          </TouchableOpacity>
        </View>
        <View style={{ paddingHorizontal: 22, paddingTop: 8 }}>
          <Text style={s.title}>Business sign-in</Text>
          <Text style={s.lede}>For company representatives. Enter your business handle and your personal access code. This works only on devices your company has registered - the first device a business uses is trusted automatically.</Text>
          <TextInput value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false} placeholder="@business" placeholderTextColor="rgba(255,255,255,0.35)" style={s.input} />
          <TextInput value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} placeholder="Access code" placeholderTextColor="rgba(255,255,255,0.35)" style={s.input} />
          <TouchableOpacity style={[s.submit, busy && { opacity: 0.5 }]} onPress={signIn} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color={NAVY} size={16} /> : <Text style={s.submitTxt}>Enter as the business</Text>}
          </TouchableOpacity>
          <Text style={s.foot}>Every sign-in is recorded with the member and device. Access is revocable by the company at any moment.</Text>
          <TouchableOpacity onPress={() => (navigation as any).navigate('BusinessApply')} activeOpacity={0.7} style={{ marginTop: 18, alignItems: 'center' }}>
            <Text style={{ color: '#E8E2D6', fontSize: 13.5, fontWeight: '700' }}>New business? Apply for an account</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: NAVY },
  header: { paddingHorizontal: 14, paddingVertical: 10 },
  backBtn: { flexDirection: 'row', alignItems: 'center', width: 60 },
  backChev: { fontSize: 26, color: '#FFFFFF', marginRight: 2, marginTop: -3 },
  backLbl: { fontSize: 15, color: '#FFFFFF', fontWeight: '600' },
  title: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', marginBottom: 8 },
  lede: { fontSize: 13, lineHeight: 19, color: 'rgba(255,255,255,0.6)', marginBottom: 18 },
  input: { borderWidth: 1.2, borderColor: 'rgba(255,255,255,0.22)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#FFFFFF', marginBottom: 10, backgroundColor: 'rgba(255,255,255,0.06)' },
  submit: { backgroundColor: '#E8E2D6', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  submitTxt: { color: NAVY, fontSize: 15, fontWeight: '800' },
  foot: { fontSize: 11.5, lineHeight: 17, color: 'rgba(255,255,255,0.4)', marginTop: 14 },
});
