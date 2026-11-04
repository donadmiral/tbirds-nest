import { settingsBack } from '../../navigation/settingsNavigation';
import VerifiedBadge from '../../components/VerifiedBadge';
import TierName from '../../components/TierName';
import { themedSheet, useTheme } from '../../theme/useTheme';
import EmptyState from '../../components/EmptyState';
/**
 * MutedStoriesScreen - manage who you have muted.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from '../../components/SafeArea';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { createScreenReadGuard, isReadAccessDenied, requireReadRows } from '../../../shared/readContinuity';
import { orderTimeout } from '../../../shared/orderRequest';

export default function MutedStoriesScreen({ navigation }: any) {
  useTheme();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const userId = useAuthStore(state => state.session?.user.id ?? null);
  const [reads] = useState(() => createScreenReadGuard(userId));
  reads.setScope(userId);

  const load = useCallback(async () => {
    if (!userId) { setRows([]); setLoading(false); return; }
    const current = reads.begin(userId);
    if (!current()) return;
    setLoading(true); setLoadError(null);
    try {
      const { data: mutes, error: mErr } = await orderTimeout(supabase
        .from('muted_stories')
        .select('muted_id, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }), 15000, 'Muted stories could not be loaded.');
      if (mErr) throw mErr;
      if (!current()) return;
      const ids = requireReadRows<any>(mutes).map((m: any) => m.muted_id);
      if (!ids.length) { setRows([]); return; }
      const { data: profs, error: pErr } = await orderTimeout(supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url')
        .in('id', ids), 15000, 'Muted stories could not be loaded.');
      if (pErr) throw pErr;
      const byId = new Map(requireReadRows<any>(profs).map((p: any) => [p.id, p]));
      if (current()) setRows(requireReadRows<any>(mutes).map((m: any) => ({ ...m, profile: byId.get(m.muted_id) || { id: m.muted_id, full_name: 'Unknown', username: '', avatar_url: null } })));
    } catch (error) {
      if (current()) { if (isReadAccessDenied(error)) setRows([]); setLoadError('Muted stories could not be refreshed. Tap to retry.'); }
    } finally { if (current()) setLoading(false); }
  }, [userId, reads]);

  useEffect(() => { setRows([]); setLoading(!!userId); setLoadError(null); void load(); return () => reads.invalidate(); }, [load, userId, reads]);

  const unmute = useCallback(async (mutedId: string) => {
    if (!userId) return;
    reads.begin(userId);
    const current = reads.capture(userId);
    if (!current()) return;
    setLoading(false);
    setRows(prev => prev.filter(r => r.muted_id !== mutedId));
    try {
      const { error } = await orderTimeout(supabase.from('muted_stories').delete().eq('user_id', userId).eq('muted_id', mutedId), 15000, 'The story could not be unmuted.');
      if (error) throw error;
      if (current()) { reads.begin(userId); setRows(prev => prev.filter(r => r.muted_id !== mutedId)); setLoading(false); }
    } catch { if (current()) { setLoadError('The story could not be unmuted. Refreshing your list.'); void load(); } }
  }, [load, reads, userId]);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.bar}>
        <TouchableOpacity onPress={() => settingsBack(navigation, 'Settings')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={26} color="#0B1E3D" />
        </TouchableOpacity>
        <Text style={s.title}>Muted stories</Text>
        <View style={{ width: 26 }} />
      </View>

      {loadError ? <TouchableOpacity accessibilityRole="button" onPress={() => { void load(); }}><Text accessibilityRole="alert" style={{ padding: 16 }}>{loadError}</Text></TouchableOpacity> : null}
      {loading && rows.length === 0 ? (
        <View style={s.center}><ActivityIndicator /></View>
      ) : rows.length === 0 && !loadError ? (
        <View style={s.center}>
          <Text style={s.emptyTitle}>Nobody is muted</Text>
          <Text style={s.emptySub}>Press and hold a story to mute someone.</Text>
        </View>
      ) : (
        <FlatList ListFooterComponent={<View style={{ height: 120 }} />}
 ListEmptyComponent={loadError ? null : <EmptyState icon="eye-off" title="Nobody muted" line="Muted people stay in your feed but their stories stay hidden." />}
          data={rows}
          refreshing={loading}
          onRefresh={() => { void load(); }}
          keyExtractor={r => r.muted_id}
          contentContainerStyle={{ paddingVertical: 8 }}
          renderItem={({ item }) => (
            <View style={s.row}>
              {item.profile?.avatar_url
                ? <Image source={{ uri: item.profile.avatar_url }} style={s.avatar} />
                : <View style={[s.avatar, s.avatarFb]}><Text style={s.avatarTxt}>{(item.profile?.full_name || '?')[0]}</Text></View>}
              <View style={{ flex: 1 }}>
                <Text style={s.name} numberOfLines={1}><TierName userId={((item.profile) as any)?.id ?? ((item.profile) as any)?.user_id} baseStyle={s.name} text={item.profile?.full_name || 'Member' || ''} numberOfLines={1} /> <VerifiedBadge userId={((item.profile) as any)?.id ?? ((item.profile) as any)?.user_id} size={12} /></Text>
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

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline },
  title: { fontSize: 17, fontWeight: '700', color: t.ink.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: t.ink.primary },
  emptySub: { fontSize: 14, color: t.ink.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: t.surface.hairline },
  avatarFb: { alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 17, fontWeight: '700', color: t.ink.primary },
  name: { fontSize: 15.5, fontWeight: '600', color: t.ink.primary },
  handle: { fontSize: 13, color: t.ink.muted, marginTop: 1 },
  unmute: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 7 },
  unmuteTxt: { fontSize: 13.5, fontWeight: '700', color: t.ink.primary },
}));
