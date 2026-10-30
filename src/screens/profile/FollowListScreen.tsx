import TierName from '../../components/TierName';
import { themedSheet, getTheme, useTheme } from '../../theme/useTheme';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from '../../components/SafeArea';
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
  useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { userId, initial, isSelf, username } = (route.params || {}) as { userId: string; initial?: 'followers' | 'following'; isSelf?: boolean; username?: string };
  const me = useAuthStore(s => s.profile?.id) as string | undefined;
  const ownerId = useAuthStore(s => s.session?.user.id) as string | undefined;
  const [tab, setTab] = useState<'followers' | 'following'>(initial === 'following' ? 'following' : 'followers');
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [iFollow, setIFollow] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const [loadError, setLoadError] = useState<string | null>(null);
  const scope = `${ownerId || ''}:${me || ''}:${userId || ''}`;
  const visibleScope = useRef(scope); visibleScope.current = scope;
  const mounted = useRef(false);
  const operations = useRef(new Map<string, object>());
  const revisions = useRef(new Map<string, number>());
  const followingState = useRef(iFollow); followingState.current = iFollow;
  const loadRequest = useRef<object | null>(null);
  const current = useCallback(() => mounted.current && visibleScope.current === scope
    && !!ownerId && useAuthStore.getState().session?.user.id === ownerId
    && useAuthStore.getState().profile?.id === me, [me, ownerId, scope]);

  useEffect(() => {
    mounted.current = true;
    operations.current.clear(); revisions.current.clear(); loadRequest.current = null;
    followingState.current = new Set(); setIFollow(new Set()); setBusy(new Set());
    return () => { mounted.current = false; loadRequest.current = null; };
  }, [scope]);

  const load = useCallback(async (which: 'followers' | 'following', pageN: number, replace: boolean) => {
    if (!userId || !current() || (!replace && loadRequest.current)) return;
    const request = {}; loadRequest.current = request;
    const readRevisions = new Map(revisions.current);
    const active = () => current() && loadRequest.current === request;
    if (replace) setLoading(true);
    setLoadError(null);
    try {
      const from = pageN * PAGE;
      const col = which === 'followers' ? 'follower_id' : 'following_id';
      const eqCol = which === 'followers' ? 'following_id' : 'follower_id';
      const { data: rows, error: rowsError } = await supabase.from('follows').select(col).eq(eqCol, userId).neq(col, userId)
        .order('created_at', { ascending: false }).range(from, from + PAGE - 1);
      if (!active()) return;
      if (rowsError) throw rowsError;
      const ids = (rows || []).map((r: any) => r[col]).filter(Boolean) as string[];
      let found: Person[] = [];
      if (ids.length > 0) {
        const { data: profs, error: profileError } = await supabase.from('profiles').select('id,full_name,username,avatar_url').in('id', ids);
        if (!active()) return;
        if (profileError) throw profileError;
        const byId = new Map((profs || []).map((p: any) => [p.id, p]));
        found = ids.map((id: string) => byId.get(id)).filter(Boolean) as Person[];
      }
      if (me && ids.length > 0) {
        const { data: fl, error: followError } = await supabase.from('follows').select('following_id').eq('follower_id', me).in('following_id', ids);
        if (!active()) return;
        if (followError) throw followError;
        const mine = new Set((fl || []).map((r: any) => r.following_id));
        setIFollow(previous => {
          const next = new Set(previous);
          for (const id of ids) {
            // A read started before a button press cannot undo that response.
            if (operations.current.has(id) || revisions.current.get(id) !== readRevisions.get(id)) continue;
            if (mine.has(id)) next.add(id); else next.delete(id);
          }
          followingState.current = next;
          return next;
        });
      }
      setPeople(previous => replace ? found : [...new Map([...previous, ...found].map(person => [person.id, person])).values()]);
      setHasMore(ids.length >= PAGE); setPage(pageN);
    } catch {
      if (active()) setLoadError('Connections could not be loaded. Please try again.');
    } finally {
      if (active()) { loadRequest.current = null; setLoading(false); }
    }
  }, [current, me, userId]);

  useEffect(() => {
    setPeople([]); setPage(0); setHasMore(false); void load(tab, 0, true);
    return () => { loadRequest.current = null; };
  }, [load, tab]);

  const toggleFollow = useCallback(async function respond(target: Person, expectedFollowing?: boolean) {
    if (!me || me === target.id || !current() || operations.current.has(target.id)) return;
    const following = followingState.current.has(target.id);
    if (expectedFollowing !== undefined && following !== expectedFollowing) return;
    const operation = {}; operations.current.set(target.id, operation);
    revisions.current.set(target.id, (revisions.current.get(target.id) || 0) + 1);
    const active = () => current() && operations.current.get(target.id) === operation;
    setBusy(previous => new Set(previous).add(target.id));
    setIFollow(previous => {
      const next = new Set(previous); if (following) next.delete(target.id); else next.add(target.id);
      followingState.current = next; return next;
    });
    try {
      if (expectedFollowing !== undefined) {
        // A disconnected response can still have committed. Reconcile before
        // an explicit retry so a confirmed follow is not submitted twice.
        const { data, error } = await supabase.from('follows').select('following_id')
          .eq('follower_id', me).eq('following_id', target.id).maybeSingle();
        if (!active()) return;
        if (error) throw error;
        if (!!data === !following) {
          setIFollow(previous => {
            const next = new Set(previous); if (following) next.delete(target.id); else next.add(target.id);
            followingState.current = next; return next;
          });
          return;
        }
      }
      const result = following
        ? await supabase.from('follows').delete().eq('follower_id', me).eq('following_id', target.id)
        : await supabase.from('follows').insert({ follower_id: me, following_id: target.id });
      if (!active()) return;
      if (result.error) throw result.error;
    } catch {
      if (!active()) return;
      setIFollow(previous => {
        const next = new Set(previous); if (following) next.add(target.id); else next.delete(target.id);
        followingState.current = next; return next;
      });
      Alert.alert(following ? 'Could not unfollow' : 'Could not follow', 'The change could not be confirmed. You can retry.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Retry', onPress: () => { if (current()) void respond(target, following); } },
      ]);
    } finally {
      if (active()) {
        // Also invalidate reads that began while this response was in flight.
        revisions.current.set(target.id, (revisions.current.get(target.id) || 0) + 1);
        operations.current.delete(target.id);
        setBusy(previous => { const next = new Set(previous); next.delete(target.id); return next; });
      }
    }
  }, [current, me]);

  const removeFollower = useCallback((target: Person) => {
    if (!current()) return;
    Alert.alert('Remove follower?', (target.full_name || 'This member') + ' will no longer follow you. They will not be notified.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        if (!current()) return;
        try {
          const { error } = await supabase.rpc('remove_follower', { p_follower_id: target.id });
          if (!current()) return;
          if (error) throw error;
          setPeople(prev => prev.filter(p => p.id !== target.id));
        } catch { if (current()) Alert.alert('Could not remove', 'Please try again.'); }
      } },
    ]);
  }, [current]);

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
              <Text style={s.name} numberOfLines={1}><TierName userId={((item) as any)?.id ?? ((item) as any)?.user_id} baseStyle={s.name} text={item.full_name || 'Member' || ''} numberOfLines={1} /></Text>
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
            <Feather name="x" size={16} color="rgba(11,30,61,0.42)" />
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
        <Feather name="search" size={18} color={getTheme().ink.secondary} />
        <TextInput style={s.searchInput} placeholder="Search" placeholderTextColor={getTheme().ink.secondary} value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} />
        {query.length > 0 ? (
          <TouchableOpacity onPress={() => setQuery('')}><Feather name="x-circle" size={16} color="rgba(11,30,61,0.24)" /></TouchableOpacity>
        ) : null}
      </View>
      {loadError && <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
        <Text accessibilityRole="alert" style={s.emptyTitle}>{loadError}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry connections" style={s.followBtn} onPress={() => { void load(tab, 0, true); }}>
          <Text style={s.followTxt}>Retry</Text>
        </TouchableOpacity>
      </View>}
      {loading ? (
        <View style={s.center}><ActivityIndicator color={NAVY} /></View>
      ) : filtered.length === 0 ? (
        <View style={s.center}>
          <Feather name="users" size={38} color="rgba(11,30,61,0.08)" />
          <Text style={s.emptyTitle}>{query ? 'No matches' : tab === 'followers' ? 'No followers yet' : 'Not following anyone yet'}</Text>
        </View>
      ) : (
        <FlatList data={filtered} keyExtractor={p => p.id} renderItem={renderRow} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          onEndReachedThreshold={0.4} onEndReached={() => { if (hasMore && !query) load(tab, page + 1, false); }}
          ListFooterComponent={hasMore && !query && !loadError ? <ActivityIndicator color={NAVY} style={{ marginVertical: 16 }} /> : null}
          keyboardShouldPersistTaps="handled" />
      )}
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 16.5, fontWeight: '700', color: t.ink.primary },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabOn: { borderBottomWidth: 2, borderBottomColor: NAVY },
  tabTxt: { fontSize: 14.5, fontWeight: '600', color: t.ink.muted },
  tabTxtOn: { color: NAVY, fontWeight: '700' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.surface.sunken, borderRadius: 12, marginHorizontal: 16, marginTop: 12, marginBottom: 4, paddingHorizontal: 12, minHeight: 48 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 48, fontSize: 16, color: t.ink.primary, paddingHorizontal: 0, paddingVertical: 10, includeFontPadding: false, textAlignVertical: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 60 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: t.ink.muted },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, gap: 10 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  avatarFb: { backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 16, fontWeight: '700', color: NAVY },
  name: { fontSize: 15.5, fontWeight: '600', color: t.ink.primary, flexShrink: 1 },
  handle: { fontSize: 13, color: t.ink.muted, marginTop: 1 },
  followBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999, backgroundColor: NAVY },
  followBtnOn: { backgroundColor: t.surface.canvas, borderWidth: 1, borderColor: '#D1D5DB' },
  followTxt: { fontSize: 13, fontWeight: '700', color: t.ink.inverse },
  followTxtOn: { color: t.ink.primary },
  moreBtn: { padding: 6 },
}));
