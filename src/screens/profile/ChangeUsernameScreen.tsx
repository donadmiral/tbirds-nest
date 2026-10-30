import SettingsExit from '../../components/SettingsExit';
import { settingsBack } from '../../navigation/settingsNavigation';
import { themedSheet, getTheme, useTheme } from '../../theme/useTheme';
import KeyboardSafe from '../../components/KeyboardSafe';
/**
 * ChangeUsernameScreen - the @ is the one permanent handle; changing it
 * checks availability live against the case-insensitive unique index.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StatusBar, TextInput, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from '../../components/SafeArea';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';


export default function ChangeUsernameScreen() {
  const navigation = useNavigation<any>();
  const { isDark } = useTheme();
  const { profile } = useAuthStore();
  const [handle, setHandle] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'free' | 'taken' | 'invalid' | 'error'>('idle');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const mounted = useRef(true);
  const available = useRef<string | null>(null);
  const saving = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, []);

  const check = async (v: string) => {
    if (saving.current) return;
    const run = ++request.current;
    available.current = null;
    const clean = v.trim().toLowerCase();
    setHandle(clean);
    if (!clean || clean === (profile?.username || '').toLowerCase()) { setState('idle'); return; }
    if (!/^[a-z0-9_]{3,30}$/.test(clean)) { setState('invalid'); return; }
    setState('checking');
    try {
      const { data, error } = await supabase.rpc('is_username_available', { p_username: clean });
      if (!mounted.current || run !== request.current) return;
      if (error || typeof data !== 'boolean') { setState('error'); return; }
      available.current = data ? clean : null;
      setState(data ? 'free' : 'taken');
    } catch { if (mounted.current && run === request.current) setState('error'); }
  };

  const save = async () => {
    if (!profile?.id || saving.current) return;
    if (state !== 'free' || available.current !== handle) { Alert.alert('Pick an available handle', '3 to 30 characters: letters, numbers, underscores.'); return; }
    const ownerId = profile.id;
    if (useAuthStore.getState().session?.user?.id !== ownerId) return;
    saving.current = true;
    setBusy(true);
    try {
      const { data, error } = await supabase.from('profiles').update({ username: handle }).eq('id', ownerId).select('id, username').maybeSingle();
      if (!mounted.current || useAuthStore.getState().session?.user?.id !== ownerId) return;
      if (error) throw error;
      if (data?.id !== ownerId || data?.username !== handle) throw new Error('Your username was not saved. Please try again.');
      try { (useAuthStore as any).setState({ profile: { ...(profile as any), username: handle } }); } catch {}
      Alert.alert('Done', 'You are now @' + handle + '. Your old handle is released.');
      settingsBack(navigation, 'Settings');
    } catch (e: any) {
      if (mounted.current && useAuthStore.getState().session?.user?.id === ownerId) Alert.alert('Could not change', e?.message || 'Try again.');
    } finally { saving.current = false; if (mounted.current) setBusy(false); }
  };

  const hint = state === 'checking' ? 'Checking...' : state === 'free' ? '@' + handle + ' is available' : state === 'taken' ? 'That handle is taken' : state === 'invalid' ? '3-30 chars: a-z, 0-9, _' : state === 'error' ? 'Could not check availability. Edit the username to try again.' : '';

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => settingsBack(navigation, 'Settings')} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>{'\u2039'}</Text><Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Username</Text>
        <SettingsExit navigation={navigation} />
      </View>
      <KeyboardSafe>
      <ScrollView automaticallyAdjustKeyboardInsets={true} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 140 }}>
        <Text style={s.lede}>Your handle is how people find and mention you. You are currently <Text style={{ fontWeight: '800', color: getTheme().ink.primary }}>@{profile?.username || '-'}</Text>. Changing it releases the old one.</Text>
        <TextInput value={handle} onChangeText={check} editable={!busy} autoCapitalize="none" autoCorrect={false} placeholder="New username" placeholderTextColor={getTheme().ink.muted} style={s.input} />
        {hint ? <Text style={[s.hint, state === 'free' ? { color: '#059669' } : state === 'checking' ? { color: getTheme().ink.muted } : { color: '#FF3B30' }]}>{hint}</Text> : null}
        <TouchableOpacity style={[s.submit, (busy || state !== 'free') && { opacity: 0.5 }]} onPress={save} disabled={busy || state !== 'free'} activeOpacity={0.85}>
          {busy ? <ActivityIndicator color="#FFFFFF" size={16} /> : <Text style={s.submitTxt}>Change username</Text>}
        </TouchableOpacity>
      </ScrollView>
      </KeyboardSafe>
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  backBtn: { flexDirection: 'row', alignItems: 'center', width: 60 },
  backChev: { fontSize: 26, color: t.ink.primary, marginRight: 2, marginTop: -3 },
  backLbl: { fontSize: 15, color: t.ink.primary, fontWeight: '600' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: t.ink.primary },
  lede: { fontSize: 13, lineHeight: 19, color: t.ink.muted, marginBottom: 14, marginTop: 4 },
  input: { borderWidth: 1.2, borderColor: t.surface.hairline, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: t.ink.primary, marginBottom: 8, backgroundColor: t.surface.canvas },
  hint: { fontSize: 12, fontWeight: '600', marginBottom: 10, marginLeft: 4 },
  submit: { backgroundColor: t.brand.base, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  submitTxt: { color: t.ink.inverse, fontSize: 15, fontWeight: '800' },
}));
