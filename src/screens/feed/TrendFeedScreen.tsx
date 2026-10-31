import { ListRowSkeleton } from '../../components/skeletons';
import { themedSheet } from '../../theme/useTheme';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  StatusBar,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { navigationCache, navigationScope } from '../../lib/navigationCache';
import { useAuthStore } from '../../stores/authStore';
import { reconcileFeedVisibility } from '../../services/feedSnapshot';
import { profileRead } from '../../utils/profileRead';

const NAVY = '#0B1E3D';
const PAGE_SIZE = 20;

type TrendPost = {
  id: string;
  user_id: string;
  content: string;
  likes_count: number;
  comments_count: number;
  reposts_count: number;
  created_at: string;
  author_name: string;
  author_avatar: string | null;
  author_username: string | null;
};

function initials(name?: string | null) {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const dy = Math.floor(h / 24);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`;
  if (dy < 7) return `${dy}d`;
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function cleanTag(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let cleaned = raw.trim().toLowerCase();
  if (!cleaned.startsWith('#')) cleaned = `#${cleaned}`;
  cleaned = cleaned.replace(/[^#A-Za-z0-9_]/g, '');
  if (cleaned === '#') return '';
  return cleaned;
}

function buildExactTagRegex(tag: string): RegExp {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped + '(?![A-Za-z0-9_])', 'i');
}

type TrendMemory = { rows: TrendPost[]; offset: number; hasMore: boolean; top: number };
const trendRow = (p: any): TrendPost => ({
  id: p.id, user_id: p.user_id, content: p.content || '', likes_count: p.likes_count || 0,
  comments_count: p.comments_count || 0, reposts_count: p.reposts_count || 0, created_at: p.created_at,
  author_name: p.author_name || 'User', author_avatar: p.author_avatar || null, author_username: p.author_username || null,
});
async function readTrendPage(tag: string, offset: number, signal: AbortSignal, token: string) {
  const pin = (query: any) => query.setHeader('Authorization', `Bearer ${token}`).abortSignal(signal);
  const result = await pin(supabase.rpc('get_posts_by_hashtag', { p_tag: tag, p_limit: PAGE_SIZE, p_offset: offset }));
  if (!result.error) return { rows: (result.data ?? []).map(trendRow) as TrendPost[], scanned: (result.data ?? []).length };
  // Only an absent RPC uses the compatibility query. Offline/auth failures
  // must remain visible instead of being mistaken for an empty topic.
  if (!['PGRST202', '42883'].includes(result.error.code)) throw new Error('Topic posts could not be refreshed.');
  const raw = await pin(supabase.from('posts').select('id, user_id, content, likes_count, comments_count, reposts_count, created_at')
    .ilike('content', `%${tag}%`).order('created_at', { ascending: false }).range(offset, offset + PAGE_SIZE - 1));
  if (raw.error) throw new Error('Topic posts could not be refreshed.');
  const exact = buildExactTagRegex(tag), rows = (raw.data ?? []).filter((row: any) => exact.test(row.content || ''));
  const ids = [...new Set(rows.map((row: any) => row.user_id).filter(Boolean))];
  const profiles = ids.length ? await pin(supabase.from('profiles').select('id, full_name, username, avatar_url').in('id', ids)) : { data: [], error: null };
  if (profiles.error) throw new Error('Topic authors could not be refreshed.');
  const people = new Map<string, any>((profiles.data ?? []).map((row: any) => [row.id, row]));
  return { rows: rows.map((row: any) => trendRow({ ...row, author_name: people.get(row.user_id)?.full_name,
    author_username: people.get(row.user_id)?.username, author_avatar: people.get(row.user_id)?.avatar_url })) as TrendPost[], scanned: (raw.data ?? []).length };
}

export default function TrendFeedScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const rawTag = route.params?.tag || '';
  const tag = cleanTag(rawTag);

  const scope = navigationScope();
  const cacheKey = `topic:${tag}`;
  const [initial] = useState(() => navigationCache.read<TrendMemory>(scope, cacheKey));
  const [posts, setPosts] = useState<TrendPost[]>(initial?.rows ?? []);
  const postsRef = useRef(posts); postsRef.current = posts;
  const [loading, setLoading] = useState(initial === null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(initial?.hasMore ?? true);
  const hasMoreRef = useRef(hasMore); hasMoreRef.current = hasMore;
  const offsetRef = useRef(initial?.offset ?? 0);
  const scrollTop = useRef(initial?.top ?? 0);
  const [restoredTop, setRestoredTop] = useState(initial?.top ?? 0);
  const listRef = useRef<FlatList<TrendPost>>(null);
  const requestRef = useRef(0), pendingMore = useRef(false);
  const refreshPending = useRef(false);
  const currentRoute = useRef({ scope, tag }); currentRoute.current = { scope, tag };
  const visibleTag = useRef(tag);

  const load = useCallback(async (showLoader = true) => {
    if (!tag || !scope) { setLoading(false); setRefreshing(false); return; }
    const request = ++requestRef.current;
    const current = () => requestRef.current === request && currentRoute.current.tag === tag && navigationScope() === scope;
    pendingMore.current = false; refreshPending.current = true; setLoadingMore(false);
    setLoading(showLoader && postsRef.current.length === 0); setError(false);
    const session = useAuthStore.getState().session;
    if (!session) { refreshPending.current = false; setLoading(false); return; }
    const retained = postsRef.current;
    try {
      const result = await navigationCache.load(scope, `${cacheKey}:first-page`, signal => readTrendPage(tag, 0, signal, session.access_token));
      if (!current()) return;
      const allowed = retained.length ? await profileRead(reconcileFeedVisibility(session.user.id, retained.map(row => row.id), current), 12000) : null;
      if (!current()) return;
      const fresh = new Map(result.rows.map(row => [row.id, row]));
      const keepPosition = retained.length > 0;
      const rows = keepPosition ? retained.filter(row => allowed?.has(row.id)).map(row => fresh.get(row.id) ?? row) : result.rows;
      postsRef.current = rows; setPosts(rows);
      if (!keepPosition) { offsetRef.current = result.scanned; setHasMore(result.scanned >= PAGE_SIZE); }
      navigationCache.save(scope, cacheKey, { rows, offset: offsetRef.current, hasMore: keepPosition ? hasMoreRef.current : result.scanned >= PAGE_SIZE, top: scrollTop.current });
    } catch { if (current()) setError(true); }
    finally { if (current()) { refreshPending.current = false; setLoading(false); setRefreshing(false); } }
  }, [scope, tag, cacheKey]);

  const loadMore = useCallback(async () => {
    if (!tag || !scope || pendingMore.current || refreshPending.current || loading || !hasMoreRef.current) return;
    const request = requestRef.current, offset = offsetRef.current;
    const current = () => request === requestRef.current && currentRoute.current.tag === tag && navigationScope() === scope;
    const session = useAuthStore.getState().session;
    if (!session) return;
    pendingMore.current = true; setLoadingMore(true); setError(false);
    try {
      const page = await navigationCache.load(scope, `${cacheKey}:page:${offset}`, signal => readTrendPage(tag, offset, signal, session.access_token));
      if (!current()) return;
      const rows = [...new Map([...postsRef.current, ...page.rows].map(row => [row.id, row])).values()];
      postsRef.current = rows; setPosts(rows); offsetRef.current = offset + page.scanned;
      setHasMore(page.scanned >= PAGE_SIZE);
      navigationCache.save(scope, cacheKey, { rows, offset: offsetRef.current, hasMore: page.scanned >= PAGE_SIZE, top: scrollTop.current });
    } catch { if (current()) setError(true); }
    finally { if (current()) { pendingMore.current = false; setLoadingMore(false); } }
  }, [scope, tag, cacheKey, loading]);

  useLayoutEffect(() => {
    if (visibleTag.current === tag) return;
    visibleTag.current = tag;
    const cached = navigationCache.read<TrendMemory>(scope, cacheKey);
    postsRef.current = cached?.rows ?? []; setPosts(postsRef.current);
    offsetRef.current = cached?.offset ?? 0; scrollTop.current = cached?.top ?? 0;
    setRestoredTop(cached?.top ?? 0);
    setHasMore(cached?.hasMore ?? true); setLoading(cached === null); setError(false);
  }, [scope, tag, cacheKey]);
  useEffect(() => {
    void load(true);
    const requests = requestRef;
    return () => { requests.current++; };
  }, [load]);
  useLayoutEffect(() => () => {
    const cached = navigationCache.read<TrendMemory>(scope, cacheKey);
    if (cached) navigationCache.save(scope, cacheKey, { ...cached, top: scrollTop.current });
  }, [scope, cacheKey]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(false);
  }, [load]);

  if (!tag) {
    return (
      <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
        <StatusBar barStyle="dark-content" />
        <View style={st.header}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={st.backBtn} activeOpacity={0.7}>
            <Feather name="chevron-left" size={24} color={NAVY} />
          </TouchableOpacity>
          <View style={st.headerCenter}>
            <Text style={st.headerTag}>Topic</Text>
          </View>
          <View style={{ width: 36 }} />
        </View>
        <View style={st.center}>
          <Feather name="hash" size={32} color="#C7C7CC" />
          <Text style={st.emptyTitle}>No topic specified</Text>
        </View>
      </SafeAreaView>
    );
  }

  const renderItem = ({ item }: { item: TrendPost }) => (
    <TouchableOpacity
      style={st.card}
      activeOpacity={0.8}
      onPress={() => navigation.navigate('Post', { postId: item.id })}
    >
      <View style={st.cardHeader}>
        {item.author_avatar ? (
          <Image source={{ uri: item.author_avatar }} style={st.avatar} />
        ) : (
          <View style={[st.avatar, st.avatarFb]}>
            <Text style={st.avatarFbTxt}>{initials(item.author_name)}</Text>
          </View>
        )}
        <View style={st.authorInfo}>
          <Text style={st.authorName} numberOfLines={1}>{item.author_name}</Text>
          <Text style={st.authorSub}>
            {item.author_username ? `@${item.author_username} · ` : ''}{relTime(item.created_at)}
          </Text>
        </View>
      </View>

      <Text style={st.content} numberOfLines={4}>{item.content}</Text>

      <View style={st.statsRow}>
        <View style={st.stat}>
          <Feather name="heart" size={12} color="#8E8E93" />
          <Text style={st.statTxt}>{item.likes_count}</Text>
        </View>
        <View style={st.stat}>
          <Feather name="message-circle" size={12} color="#8E8E93" />
          <Text style={st.statTxt}>{item.comments_count}</Text>
        </View>
        <View style={st.stat}>
          <Feather name="repeat" size={12} color="#8E8E93" />
          <Text style={st.statTxt}>{item.reposts_count}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={st.footer}>
        <ActivityIndicator color={NAVY} size="small" />
      </View>
    );
  };

  return (
    <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />

      <View style={st.header}>
        <TouchableOpacity
          accessibilityRole="button" accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
          style={st.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="chevron-left" size={24} color={NAVY} />
        </TouchableOpacity>
        <View style={st.headerCenter}>
          <Text style={st.headerTag}>{tag}</Text>
          {!loading && !error && (
            <Text style={st.headerSub}>
              {posts.length}{hasMore ? '+' : ''} {posts.length === 1 ? 'post' : 'posts'}
            </Text>
          )}
        </View>
        <View style={{ width: 36 }} />
      </View>

      {error && posts.length > 0 ? <TouchableOpacity accessibilityRole="button" onPress={() => void load(false)} style={{ padding: 16 }}><Text accessibilityRole="alert">Topic posts could not be refreshed. Tap to retry.</Text></TouchableOpacity> : null}
      {loading && !refreshing && posts.length === 0 ? (
        <ListRowSkeleton />
      ) : error && posts.length === 0 ? (
        <ScrollView
          contentContainerStyle={st.center}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={NAVY} />
          }
        >
          <Feather name="alert-circle" size={32} color="#C7C7CC" />
          <Text style={st.emptyTitle}>Something went wrong</Text>
          <Text style={st.emptySub}>Could not load posts for this topic.</Text>
          <TouchableOpacity style={st.retryBtn} onPress={() => load(true)} activeOpacity={0.8}>
            <Text style={st.retryBtnTxt}>Try again</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : posts.length === 0 ? (
        <ScrollView
          contentContainerStyle={st.center}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={NAVY} />
          }
        >
          <Feather name="hash" size={32} color="#C7C7CC" />
          <Text style={st.emptyTitle}>No posts found</Text>
          <Text style={st.emptySub}>No one has posted with {tag} yet.</Text>
        </ScrollView>
      ) : (
        <FlatList
          key={tag}
          ref={listRef}
          contentOffset={{ x: 0, y: restoredTop }}
          onScroll={event => { scrollTop.current = event.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          data={posts}
          keyExtractor={(p) => p.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[st.list, { paddingBottom: Math.max(insets.bottom + 20, 34) }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={NAVY} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={renderFooter}
        />
      )}
    </SafeAreaView>
  );
}

const st = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    alignItems: 'center',
  },
  headerTag: {
    fontSize: 17,
    fontWeight: '700',
    color: '#000000',
  },
  headerSub: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 1,
  },

  list: {
    paddingVertical: 4,
  },

  card: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  avatarFb: {
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFbTxt: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  authorInfo: {
    flex: 1,
    minWidth: 0,
  },
  authorName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
  },
  authorSub: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 1,
  },

  content: {
    fontSize: 14,
    lineHeight: 20,
    color: '#1A1A1A',
    marginBottom: 10,
  },

  statsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statTxt: {
    fontSize: 12,
    color: '#8E8E93',
  },

  footer: {
    paddingVertical: 16,
    alignItems: 'center',
  },

  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000000',
    marginTop: 8,
  },
  emptySub: {
    fontSize: 13,
    color: '#8E8E93',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 12,
    backgroundColor: NAVY,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryBtnTxt: {
    color: t.ink.inverse,
    fontSize: 14,
    fontWeight: '600',
  },
}));
