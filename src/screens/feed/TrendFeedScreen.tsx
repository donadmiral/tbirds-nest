import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../../services/supabase';

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

export default function TrendFeedScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const rawTag = route.params?.tag || '';
  const tag = cleanTag(rawTag);

  const [posts, setPosts] = useState<TrendPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);

  const hydrateRaw = async (rawPosts: any[]): Promise<TrendPost[]> => {
    if (rawPosts.length === 0) return [];

    const uids = Array.from(new Set(rawPosts.map((p: any) => p.user_id).filter(Boolean)));
    let pm: Record<string, any> = {};

    if (uids.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url')
        .in('id', uids);
      (profiles || []).forEach((p: any) => { pm[p.id] = p; });
    }

    return rawPosts.map((p: any) => ({
      id: p.id,
      user_id: p.user_id,
      content: p.content || '',
      likes_count: p.likes_count || 0,
      comments_count: p.comments_count || 0,
      reposts_count: p.reposts_count || 0,
      created_at: p.created_at,
      author_name: pm[p.user_id]?.full_name || 'User',
      author_avatar: pm[p.user_id]?.avatar_url || null,
      author_username: pm[p.user_id]?.username || null,
    }));
  };

  const fetchViaRpc = async (offset: number): Promise<TrendPost[] | null> => {
    const { data, error: rpcErr } = await supabase.rpc('get_posts_by_hashtag', {
      p_tag: tag,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });

    if (rpcErr) return null;
    if (!data) return [];

    return (data as any[]).map((p: any) => ({
      id: p.id,
      user_id: p.user_id,
      content: p.content || '',
      likes_count: p.likes_count || 0,
      comments_count: p.comments_count || 0,
      reposts_count: p.reposts_count || 0,
      created_at: p.created_at,
      author_name: p.author_name || 'User',
      author_avatar: p.author_avatar || null,
      author_username: p.author_username || null,
    }));
  };

  const fetchViaFallback = async (offset: number): Promise<TrendPost[]> => {
    const searchTerm = `%${tag}%`;

    const { data: rawPosts, error: queryErr } = await supabase
      .from('posts')
      .select('id, user_id, content, likes_count, comments_count, reposts_count, created_at')
      .ilike('content', searchTerm)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (queryErr || !rawPosts) return [];

    const exactRegex = buildExactTagRegex(tag);
    const filtered = rawPosts.filter((p: any) => {
      const content = p.content || '';
      return exactRegex.test(content);
    });

    return hydrateRaw(filtered);
  };

  const load = useCallback(async (showLoader = true) => {
    if (!tag) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      if (showLoader) setLoading(true);
      setError(false);
      offsetRef.current = 0;
      setHasMore(true);

      const rpcResult = await fetchViaRpc(0);

      if (rpcResult === null) {
        const fallbackResult = await fetchViaFallback(0);
        setPosts(fallbackResult);
        setHasMore(fallbackResult.length >= PAGE_SIZE);
      } else {
        setPosts(rpcResult);
        setHasMore(rpcResult.length >= PAGE_SIZE);
      }

      offsetRef.current = PAGE_SIZE;
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tag]);

  const loadMore = useCallback(async () => {
    if (!tag || loadingMore || !hasMore) return;

    setLoadingMore(true);
    try {
      const offset = offsetRef.current;

      const rpcResult = await fetchViaRpc(offset);

      let newPosts: TrendPost[];
      if (rpcResult === null) {
        newPosts = await fetchViaFallback(offset);
      } else {
        newPosts = rpcResult;
      }

      if (newPosts.length < PAGE_SIZE) {
        setHasMore(false);
      }

      if (newPosts.length > 0) {
        setPosts(prev => [...prev, ...newPosts]);
        offsetRef.current = offset + newPosts.length;
      }
    } catch {
      // Silent fail on pagination
    } finally {
      setLoadingMore(false);
    }
  }, [tag, loadingMore, hasMore]);

  useEffect(() => {
    load(true);
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(false);
  }, [load]);

  if (!tag) {
    return (
      <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
        <StatusBar barStyle="dark-content" />
        <View style={st.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn} activeOpacity={0.7}>
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

      {loading && !refreshing ? (
        <View style={st.center}>
          <ActivityIndicator color={NAVY} size="large" />
        </View>
      ) : error ? (
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

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
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
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});