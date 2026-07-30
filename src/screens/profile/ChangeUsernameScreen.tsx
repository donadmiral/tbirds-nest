/**
 * ChangeUsernameScreen - the @ is the one permanent handle; changing it
 * checks availability live against the case-insensitive unique index.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

const NAVY = '#0B1E3D';

export default function ChangeUsernameScreen() {
  const navigation = useNavigation<any>();
  const { profile } = useAuthStore();
  const [handle, setHandle] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'free' | 'taken' | 'invalid'>('idle');
  const [busy, setBusy] = useState(false);

  const check = async (v: string) => {
    const clean = v.trim().toLowerCase();
    setHandle(clean);
    if (!clean || clean === (profile?.username || '').toLowerCase()) { setState('idle'); return; }
    if (!/^[a-z0-9_]{3,30}$/.test(clean)) { setState('invalid'); return; }
    setState('checking');
    try {
      const { data } = await supabase.rpc('is_username_available', { p_username: clean });
      setState(data ? 'free' : 'taken');
    } catch { setState('idle'); }
  };

  const save = async () => {
    if (!profile?.id || busy) return;
    if (state !== 'free') { Alert.alert('Pick an available handle', '3 to 30 characters: letters, numbers, underscores.'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from('profiles').update({ username: handle }).eq('id', profile.id);
      if (error) throw error;
      try { (useAuthStore as any).setState({ profile: { ...(profile as any), username: handle } }); } catch {}
      Alert.alert('Done', 'You are now @' + handle + '. Your old handle is released.');
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Could not change', e?.message || 'Try again.');
    } finally { setBusy(false); }
  };

  const hint = state === 'checking' ? 'Checking...' : state === 'free' ? '@' + handle + ' is available' : state === 'taken' ? 'That handle is taken' : state === 'invalid' ? '3-30 chars: a-z, 0-9, _' : '';

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>{'\u2039'}</Text><Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Username</Text>
        <View style={{ width: 60 }} />
      </View>
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <Text style={s.lede}>Your handle is how people find and mention you. You are currently <Text style={{ fontWeight: '800', color: NAVY }}>@{profile?.username || '-'}</Text>. Changing it releases the old one.</Text>
        <TextInput value={handle} onChangeText={check} autoCapitalize="none" autoCorrect={false} placeholder="New username" placeholderTextColor="#9CA3AF" style={s.input} />
        {hint ? <Text style={[s.hint, state === 'free' ? { color: '#059669' } : state === 'checking' ? { color: 'rgba(11,30,61,0.5)' } : { color: '#DC2626' }]}>{hint}</Text> : null}
        <TouchableOpacity style={[s.submit, (busy || state !== 'free') && { opacity: 0.5 }]} onPress={save} disabled={busy || state !== 'free'} activeOpacity={0.85}>
          {busy ? <ActivityIndicator color="#FFFFFF" size={16} /> : <Text style={s.submitTxt}>Change username</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  backBtn: { flexDirection: 'row', alignItems: 'center', width: 60 },
  backChev: { fontSize: 26, color: NAVY, marginRight: 2, marginTop: -3 },
  backLbl: { fontSize: 15, color: NAVY, fontWeight: '600' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: NAVY },
  lede: { fontSize: 13, lineHeight: 19, color: 'rgba(11,30,61,0.6)', marginBottom: 14, marginTop: 4 },
  input: { borderWidth: 1.2, borderColor: 'rgba(11,30,61,0.14)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: NAVY, marginBottom: 8, backgroundColor: '#FFFFFF' },
  hint: { fontSize: 12, fontWeight: '600', marginBottom: 10, marginLeft: 4 },
  submit: { backgroundColor: NAVY, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  submitTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
