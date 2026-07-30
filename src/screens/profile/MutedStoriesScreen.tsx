import EmptyState from '../../components/EmptyState';
/**
 * MutedStoriesScreen - manage who you have muted.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';

export default function MutedStoriesScreen({ navigation }: any) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data: me } = await supabase.auth.getUser();
      if (!me?.user) { setRows([]); return; }
      const { data: mutes, error: mErr } = await supabase
        .from('muted_stories')
        .select('muted_id, created_at')
        .eq('user_id', me.user.id)
        .order('created_at', { ascending: false });
      if (mErr) { console.log('[MutedStories] mutes', mErr.message); setRows([]); return; }
      const ids = (mutes || []).map((m: any) => m.muted_id);
      if (!ids.length) { setRows([]); return; }
      const { data: profs, error: pErr } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url')
        .in('id', ids);
      if (pErr) { console.log('[MutedStories] profiles', pErr.message); }
      const byId = new Map((profs || []).map((p: any) => [p.id, p]));
      setRows((mutes || []).map((m: any) => ({ ...m, profile: byId.get(m.muted_id) || { id: m.muted_id, full_name: 'Unknown', username: '', avatar_url: null } })));
    } catch (e) { console.log('[MutedStories]', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const unmute = useCallback(async (mutedId: string) => {
    setRows(prev => prev.filter(r => r.muted_id !== mutedId));
    try {
      const { data: me } = await supabase.auth.getUser();
      if (me?.user) {
        await supabase.from('muted_stories').delete().eq('user_id', me.user.id).eq('muted_id', mutedId);
      }
    } catch (e) { console.log('[unmute]', e); load(); }
  }, [load]);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.bar}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={26} color="#0A0A0A" />
        </TouchableOpacity>
        <Text style={s.title}>Muted stories</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator /></View>
      ) : rows.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyTitle}>Nobody is muted</Text>
          <Text style={s.emptySub}>Press and hold a story to mute someone.</Text>
        </View>
      ) : (
        <FlatList ListEmptyComponent={<EmptyState icon="eye-off" title="Nobody muted" line="Muted people stay in your feed but their stories stay hidden." />}
          data={rows}
          keyExtractor={r => r.muted_id}
          contentContainerStyle={{ paddingVertical: 8 }}
          renderItem={({ item }) => (
            <View style={s.row}>
              {item.profile?.avatar_url
                ? <Image source={{ uri: item.profile.avatar_url }} style={s.avatar} />
                : <View style={[s.avatar, s.avatarFb]}><Text style={s.avatarTxt}>{(item.profile?.full_name || '?')[0]}</Text></View>}
              <View style={{ flex: 1 }}>
                <Text style={s.name} numberOfLines={1}>{item.profile?.full_name || 'Member'}</Text>
                {!!item.profile?.username && <Text style={s.handle}>@{item.profile.username}</Text>}
              </View>
              <TouchableOpacity style={s.unmute} onPress={() => unmute(item.muted_id)} activeOpacity={0.8}>
                <Text style={s.unmuteTxt}>Unmute</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA' },
  title: { fontSize: 17, fontWeight: '700', color: '#0A0A0A' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#0A0A0A' },
  emptySub: { fontSize: 14, color: '#8E8E93' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#E5E5EA' },
  avatarFb: { alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 17, fontWeight: '700', color: '#8E8E93' },
  name: { fontSize: 15.5, fontWeight: '600', color: '#0A0A0A' },
  handle: { fontSize: 13, color: '#8E8E93', marginTop: 1 },
  unmute: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 7 },
  unmuteTxt: { fontSize: 13.5, fontWeight: '700', color: '#0B1E3D' },
});