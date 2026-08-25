import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import VerifiedBadge from '../../components/VerifiedBadge';

const NAVY = '#0B1E3D';
const PAGE = 40;

type Person = { id: string; full_name: string | null; username: string | null; avatar_url: string | null };

function initials(name?: string | null) {
  return (name || 'M').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

export default function FollowListScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { userId, initial, isSelf, username } = (route.params || {}) as { userId: string; initial?: 'followers' | 'following'; isSelf?: boolean; username?: string };
  const me = useAuthStore(s => s.profile?.id) as string | undefined;
  const [tab, setTab] = useState<'followers' | 'following'>(initial === 'following' ? 'following' : 'followers');
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [iFollow, setIFollow] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(async (which: 'followers' | 'following', pageN: number, replace: boolean) => {
    if (!userId) return;
    if (replace) setLoading(true);
    try {
      const from = pageN * PAGE;
      const col = which === 'followers' ? 'follower_id' : 'following_id';
      const eqCol = which === 'followers' ? 'following_id' : 'follower_id';
      const { data: rows } = await supabase.from('follows').select(col).eq(eqCol, userId).neq(col, userId)
        .order('created_at', { ascending: false }).range(from, from + PAGE - 1);
      const ids = (rows || []).map((r: any) => r[col]).filter(Boolean);
      let found: Person[] = [];
      if (ids.length > 0) {
        const { data: profs } = await supabase.from('profiles').select('id,full_name,username,avatar_url').in('id', ids);
        const byId = new Map((profs || []).map((p: any) => [p.id, p]));
        found = ids.map((id: string) => byId.get(id)).filter(Boolean) as Person[];
      }
      let mine = new Set(iFollow);
      if (me && ids.length > 0) {
        const { data: fl } = await supabase.from('follows').select('following_id').eq('follower_id', me).in('following_id', ids);
        (fl || []).forEach((r: any) => mine.add(r.following_id));
        setIFollow(new Set(mine));
      }
      setPeople(prev => replace ? found : [...prev, ...found]);
      setHasMore(ids.length >= PAGE);
      setPage(pageN);
    } catch (e) { console.log('[FollowList]', e); }
    finally { setLoading(false); }
  }, [userId, me, iFollow]);

  useEffect(() => { setPeople([]); setPage(0); load(tab, 0, true); }, [tab, userId]);

  const toggleFollow = useCallback(async (target: Person) => {
    if (!me || busy.has(target.id)) return;
    const following = iFollow.has(target.id);
    setBusy(prev => new Set(prev).add(target.id));
    setIFollow(prev => { const n = new Set(prev); following ? n.delete(target.id) : n.add(target.id); return n; });
    try {
      if (following) await supabase.from('follows').delete().eq('follower_id', me).eq('following_id', target.id);
      else await supabase.from('follows').insert({ follower_id: me, following_id: target.id });
    } catch (e) {
      setIFollow(prev => { const n = new Set(prev); following ? n.add(target.id) : n.delete(target.id); return n; });
    } finally { setBusy(prev => { const n = new Set(prev); n.delete(target.id); return n; }); }
  }, [me, iFollow, busy]);

  const removeFollower = useCallback((target: Person) => {
    Alert.alert('Remove follower?', (target.full_name || 'This member') + ' will no longer follow you. They will not be notified.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try {
          const { error } = await supabase.rpc('remove_follower', { p_follower_id: target.id });
          if (error) throw error;
          setPeople(prev => prev.filter(p => p.id !== target.id));
        } catch (e: any) { Alert.alert('Could not remove', e?.message || 'Please try again.'); }
      } },
    ]);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter(p => (p.full_name || '').toLowerCase().includes(q) || (p.username || '').toLowerCase().includes(q));
  }, [people, query]);

  const renderRow = ({ item }: { item: Person }) => {
    const self = me === item.id;
    const following = iFollow.has(item.id);
    return (
      <View style={s.row}>
        <TouchableOpacity style={s.rowMain} activeOpacity={0.85} onPress={() => navigation.push('UserProfile', { userId: item.id })}>
          {item.avatar_url ? (
            <ExpoImage source={{ uri: item.avatar_url }} style={s.avatar} contentFit="cover" cachePolicy="memory-disk" transition={120} />
          ) : (
            <View style={[s.avatar, s.avatarFb]}><Text style={s.avatarTxt}>{initials(item.full_name)}</Text></View>
          )}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={s.name} numberOfLines={1}>{item.full_name || 'Member'}</Text>
              <VerifiedBadge userId={item.id} size={13} />
            </View>
            {item.username ? <Text style={s.handle} numberOfLines={1}>@{item.username}</Text> : null}
          </View>
        </TouchableOpacity>
        {!self && me ? (
          <TouchableOpacity style={[s.followBtn, following && s.followBtnOn]} onPress={() => toggleFollow(item)} activeOpacity={0.85} disabled={busy.has(item.id)}>
            <Text style={[s.followTxt, following && s.followTxtOn]}>{following ? 'Following' : 'Follow'}</Text>
          </TouchableOpacity>
        ) : null}
        {isSelf && tab === 'followers' && !self ? (
          <TouchableOpacity style={s.moreBtn} onPress={() => removeFollower(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={16} color="#8E8E93" />
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={26} color={NAVY} />
        </TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>{username ? '@' + username : 'Connections'}</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={s.tabs}>
        {(['followers', 'following'] as const).map(k => (
          <TouchableOpacity key={k} style={[s.tab, tab === k && s.tabOn]} onPress={() => setTab(k)} activeOpacity={0.85}>
            <Text style={[s.tabTxt, tab === k && s.tabTxtOn]}>{k === 'followers' ? 'Followers' : 'Following'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={s.searchWrap}>
        <Feather name="search" size={15} color="#8E8E93" />
        <TextInput style={s.searchInput} placeholder="Search" placeholderTextColor="#8E8E93" value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} />
        {query.length > 0 ? (
          <TouchableOpacity onPress={() => setQuery('')}><Feather name="x-circle" size={16} color="#C7C7CC" /></TouchableOpacity>
        ) : null}
      </View>
      {loading ? (
        <View style={s.center}><ActivityIndicator color={NAVY} /></View>
      ) : filtered.length === 0 ? (
        <View style={s.center}>
          <Feather name="users" size={38} color="#E5E5EA" />
          <Text style={s.emptyTitle}>{query ? 'No matches' : tab === 'followers' ? 'No followers yet' : 'Not following anyone yet'}</Text>
        </View>
      ) : (
        <FlatList data={filtered} keyExtractor={p => p.id} renderItem={renderRow} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          onEndReachedThreshold={0.4} onEndReached={() => { if (hasMore && !query) load(tab, page + 1, false); }}
          ListFooterComponent={hasMore && !query ? <ActivityIndicator color={NAVY} style={{ marginVertical: 16 }} /> : null}
          keyboardShouldPersistTaps="handled" />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 16.5, fontWeight: '700', color: '#0F1419' },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EFF3F4' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabOn: { borderBottomWidth: 2, borderBottomColor: NAVY },
  tabTxt: { fontSize: 14.5, fontWeight: '600', color: '#8E8E93' },
  tabTxtOn: { color: NAVY, fontWeight: '700' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F2F2F7', borderRadius: 12, marginHorizontal: 16, marginTop: 12, marginBottom: 4, paddingHorizontal: 12, paddingVertical: 9 },
  searchInput: { flex: 1, fontSize: 15, color: '#0F1419', padding: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 60 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: '#8E8E93' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, gap: 10 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  avatarFb: { backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 16, fontWeight: '700', color: NAVY },
  name: { fontSize: 15.5, fontWeight: '600', color: '#0F1419', flexShrink: 1 },
  handle: { fontSize: 13, color: '#8E8E93', marginTop: 1 },
  followBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999, backgroundColor: NAVY },
  followBtnOn: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#D1D5DB' },
  followTxt: { fontSize: 13, fontWeight: '700', color: '#FFF' },
  followTxtOn: { color: '#0F1419' },
  moreBtn: { padding: 6 },
});
