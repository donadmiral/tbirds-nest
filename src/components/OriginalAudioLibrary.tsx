import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from './SafeArea';
import PostSoundtrack from './PostSoundtrack';
import { supabase } from '../services/supabase';
import { soundtrackRead } from '../../shared/soundtrackPicker';

type Original = { id: string; title: string; duration_sec: number; reuse_allowed: boolean; status: string };
export function OriginalAudioLibrary({ owner, onClose }: { owner: string; onClose(): void }) {
  const [rows, setRows] = useState<Original[]>([]), [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const live = useRef(true), lock = useRef(false), epoch = useRef(0);
  useEffect(() => {
    live.current = true; let accepted = owner;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? '';
      if (next === accepted) return;
      accepted = next; epoch.current += 1; lock.current = false;
      setRows([]); setBusy(false); setLoading(false);
      if (next === owner) { setError(''); setAttempt(value => value + 1); }
      else setError('Return to the account that owns this audio.');
    });
    return () => { live.current = false; epoch.current += 1; subscription.unsubscribe(); };
  }, [owner]);
  useEffect(() => {
    let active = true; const current = epoch.current; setLoading(true);
    void soundtrackRead(supabase.auth.getSession()).then(async ({ data }) => {
      if (data.session?.user.id !== owner || current !== epoch.current) throw new Error('Return to the account that owns this audio.');
      const { data: result, error: failure } = await soundtrackRead(supabase.rpc('list_my_original_audio'));
      if (failure) throw failure;
      if (active && current === epoch.current) { setRows((result || []) as Original[]); setError(''); }
    }).catch(() => { if (active && current === epoch.current) setError('Your audio library could not load. Retry.'); })
      .finally(() => { if (active && current === epoch.current) setLoading(false); });
    return () => { active = false; };
  }, [owner, attempt]);
  async function change(row: Original, revoke: boolean) {
    if (lock.current) return; lock.current = true; const current = epoch.current; setBusy(true); setError('');
    try {
      const { data } = await soundtrackRead(supabase.auth.getSession());
      if (!live.current || data.session?.user.id !== owner || current !== epoch.current) return;
      const { error: failure } = await soundtrackRead(supabase.rpc(revoke ? 'revoke_original_audio' : 'set_original_audio_reuse', revoke ? { p_sound_id: row.id } : { p_sound_id: row.id, p_allowed: !row.reuse_allowed }));
      if (failure) throw failure;
      if (live.current && current === epoch.current) setAttempt(value => value + 1);
    } catch { if (live.current && current === epoch.current) setError('This audio setting could not save. Retry.'); }
    finally { if (live.current && current === epoch.current) { lock.current = false; setBusy(false); } }
  }
  return <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0B1525' }}>
      <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close audio library" onPress={onClose} style={{ minHeight: 44, minWidth: 44, justifyContent: 'center' }}><Feather name="arrow-left" size={23} color="#F6F4F0" /></TouchableOpacity>
        <Text accessibilityRole="header" style={{ color: '#F6F4F0', fontSize: 21, fontWeight: '700', flex: 1 }}>Your audio library</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
        <Text style={{ color: '#BFC8D5', lineHeight: 21, marginBottom: 20 }}>Manage the originals you own and decide whether others may reuse them.</Text>
        {error ? <View><Text accessibilityRole="alert" style={{ color: '#FFACA4' }}>{error}</Text><TouchableOpacity accessibilityRole="button" onPress={() => setAttempt(value => value + 1)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: '#E6CFAB' }}>Retry library</Text></TouchableOpacity></View> : null}
        {loading ? <ActivityIndicator color="#E6CFAB" /> : !rows.length ? <Text style={{ color: '#BFC8D5', paddingVertical: 20 }}>Your verified original recordings will appear here.</Text> : rows.map(row => <View key={row.id} style={{ borderColor: '#334156', borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 14 }}>
          <Text style={{ color: '#F6F4F0', fontSize: 16, fontWeight: '700' }}>{row.title}</Text>
          <Text style={{ color: '#BFC8D5', marginTop: 8 }}>{Math.round(row.duration_sec)} seconds · {row.status === 'revoked' ? 'Revoked' : row.reuse_allowed ? 'Others can reuse this original' : 'Private original'}</Text>
          {row.status === 'ready' ? <>
            <View style={{ height: 52 }}><PostSoundtrack active={!busy} controls selection={{ soundId: row.id, startSec: 0, durationSec: Math.min(30, Math.floor(row.duration_sec)), volume: .7, originalVolume: 1 }} /></View>
            <TouchableOpacity disabled={busy} accessibilityRole="switch" accessibilityState={{ checked: row.reuse_allowed, disabled: busy }} accessibilityLabel="Allow other people to reuse this original" onPress={() => void change(row, false)} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }}><Feather name={row.reuse_allowed ? 'check-square' : 'square'} size={20} color="#E6CFAB" /><Text style={{ color: '#F6F4F0' }}>Allow reuse</Text></TouchableOpacity>
            <TouchableOpacity disabled={busy} accessibilityRole="button" onPress={() => Alert.alert(`Revoke ${row.title}?`, 'This stops new playback and reuse in posts, stories and books. Downloaded copies cannot be recalled. Account erasure removes the stored file.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Revoke playback', style: 'destructive', onPress: () => { void change(row, true); } }])} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: '#FFACA4' }}>Revoke playback</Text></TouchableOpacity>
          </> : null}
        </View>)}
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}
