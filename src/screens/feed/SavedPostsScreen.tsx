/**
 * SavedPostsScreen.tsx
 * Shows user's bookmarked posts, matches Clean Premium style.
 */
import { ListRowSkeleton } from '../../components/skeletons';
import VerifiedBadge from '../../components/VerifiedBadge';
import TierName from '../../components/TierName';
import { themedSheet, useTheme } from '../../theme/useTheme';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Image,
  ActivityIndicator, StatusBar, RefreshControl, Alert, Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import MediaRenderer, { PostMedia } from '../../components/MediaRenderer';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { hydratePostMedia, withoutPrivateMedia } from '../../services/contentMedia';
import { normalizeProfilePost } from '../../utils/profilePost';
import { profileRead } from '../../utils/profileRead';
import { useProfileMediaRefresh } from '../../hooks/useProfileMediaRefresh';

const SCREEN_W = Dimensions.get('window').width;

type SavedPost = {
  id: string;
  user_id: string;
  content: string;
  body: string;
  media_url: string | null;
  likes_count: number;
  comments_count: number;
  created_at: string;
  saved_at: string;
  post_media: PostMedia[];
  media: PostMedia[];
  mediaPending?: boolean;
  mediaUnavailable?: boolean;
  author: { id?: string; full_name?: string | null; username?: string | null; avatar_url?: string | null } | null;
};

function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (m < 1) return 'now'; if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`; if (dy < 7) return `${dy}d`;
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function initials(name?: string | null) {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

export default function SavedPostsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { t, isDark } = useTheme();
  const focused = useIsFocused();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const [posts, setPosts] = useState<SavedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleUserId, setVisibleUserId] = useState(userId);
  const [refreshing, setRefreshing] = useState(false);
  const [unsaving, setUnsaving] = useState<Record<string, boolean>>({});

  const [error, setError] = useState('');
  const request = useRef(0), mounted = useRef(true);
  const identity = useRef({ userId });
  if (identity.current.userId !== userId) identity.current = { userId };
  const removed = useRef(new Set<string>()), pending = useRef(new Set<string>());
  useProfileMediaRefresh(posts, setPosts, userId || '', focused, setError);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, []);

  const load = useCallback(async () => {
    const owner = identity.current, version = ++request.current;
    const current = () => mounted.current && owner === identity.current && version === request.current;
    if (!userId) { setPosts([]); setLoading(false); setRefreshing(false); return; }
    setError('');
    try {
      const { data: bookmarks, error: bookmarkError } = await profileRead(supabase
        .from('post_bookmarks').select('post_id, created_at').eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(100));
      if (bookmarkError) throw bookmarkError;
      if (!current()) return;
      if (!bookmarks?.length) { setPosts([]); return; }
      const savedAt = new Map(bookmarks.map((row: any) => [row.post_id, row.created_at]));
      const { data, error: postError } = await profileRead(supabase.from('posts')
        .select('id, user_id, content, body, media_url, post_type, likes_count, comments_count, created_at, post_media(id, url, media_type, width, height, sort_order)')
        .in('id', [...savedAt.keys()]).is('archived_at', null));
      if (postError) throw postError;
      if (!current()) return;
      const rows = (data || []).map((row: any) => ({ ...row, saved_at: savedAt.get(row.id) || row.created_at,
        _mediaExpected: !!(row.post_media?.length || row.media_url), author: null }));
      rows.sort((a: any, b: any) => new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime());
      // Authorized text stays readable while private image/video URLs are signed.
      setPosts(withoutPrivateMedia(rows).filter(row => !removed.current.has(row.id))
        .map(row => normalizeProfilePost({ ...row, _mediaPending: true })));
      setLoading(false);
      const authorIds = [...new Set(rows.map(row => row.user_id))];
      const [media, authors] = await Promise.allSettled([
        profileRead(hydratePostMedia(rows), 25000),
        authorIds.length ? profileRead(supabase.from('profiles').select('id, full_name, username, avatar_url').in('id', authorIds)) : Promise.resolve({ data: [], error: null }),
      ]);
      if (!current()) return;
      const authorMap = new Map(authors.status === 'fulfilled' && !authors.value.error
        ? (authors.value.data || []).map((row: any) => [row.id, row]) : []);
      const safe = media.status === 'fulfilled' ? media.value : withoutPrivateMedia(rows);
      setPosts(safe.filter(row => !removed.current.has(row.id)).map(row => normalizeProfilePost({ ...row, author: authorMap.get(row.user_id) || null, _mediaPending: false })));
      if (media.status === 'rejected') setError('Photos and videos could not load. Tap Retry to restore access.');
      else if (authors.status === 'rejected' || authors.value.error) setError('Some author details could not load. Tap Retry.');
    } catch {
      if (current()) setError('Saved posts could not load. Please try again.');
    } finally {
      if (current()) { setLoading(false); setRefreshing(false); }
    }
  }, [userId]);

  useEffect(() => {
    request.current++; removed.current.clear(); pending.current.clear();
    setVisibleUserId(userId); setPosts([]); setLoading(!!userId); setRefreshing(false); setUnsaving({}); setError('');
    if (!userId) return;
    const channel = supabase.channel(`bookmarks_${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_bookmarks', filter: `user_id=eq.${userId}` }, () => void load()).subscribe();
    return () => { request.current++; supabase.removeChannel(channel); };
  }, [load, userId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const unsave = async (postId: string) => {
    if (!userId || pending.current.has(postId)) return;
    const owner = identity.current, row = posts.find(post => post.id === postId);
    const current = () => mounted.current && owner === identity.current;
    pending.current.add(postId); removed.current.add(postId);
    setUnsaving(prev => ({ ...prev, [postId]: true }));
    setPosts(prev => prev.filter(post => post.id !== postId));
    try {
      const { error: removeError } = await profileRead(supabase.from('post_bookmarks').delete().eq('post_id', postId).eq('user_id', userId));
      if (removeError) throw removeError;
    } catch {
      if (current()) {
        removed.current.delete(postId);
        // Restore only this failed row, so another successful unsave stays removed.
        if (row) setPosts(prev => prev.some(post => post.id === postId) ? prev : [...prev, row].sort((a, b) => new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime()));
        Alert.alert('Could not unsave', 'Your saved post is still here. Please try again.');
      }
    } finally {
      if (current()) {
        pending.current.delete(postId);
        setUnsaving(prev => { const next = { ...prev }; delete next[postId]; return next; });
      }
    }
  };

  const renderPost = ({ item: post }: { item: SavedPost }) => {
    const author = post.author;
    const mediaItems = post.media || [];

    return (
      <View style={ss.card}>
        <View style={ss.hdr}>
          <TouchableOpacity
            style={ss.authorRow}
            onPress={() => navigation.navigate('UserProfile', { userId: post.user_id, user: author })}
            activeOpacity={0.7}
          >
            {author?.avatar_url
              ? <Image source={{ uri: author.avatar_url }} style={ss.avatar} />
              : <View style={[ss.avatar, ss.avatarFb]}><Text style={ss.avatarFbTxt}>{initials(author?.full_name || author?.username)}</Text></View>}
            <View style={ss.authorMeta}>
              <Text style={ss.authorName} numberOfLines={1}><TierName userId={((author) as any)?.id ?? ((author) as any)?.user_id} baseStyle={ss.authorName} text={author?.full_name || 'Member' || ''} numberOfLines={1} /> <VerifiedBadge userId={((author) as any)?.id ?? ((author) as any)?.user_id} size={12} /></Text>
              <Text style={ss.authorSub}>
                {author?.username ? `@${author.username} · ` : ''}
                {relTime(post.created_at)}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={ss.unsaveBtn}
            accessibilityRole="button"
            accessibilityLabel="Remove from saved posts"
            onPress={() => unsave(post.id)}
            disabled={!!unsaving[post.id]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            {unsaving[post.id]
              ? <ActivityIndicator size={14} color={t.ink.primary} />
              : <Feather name="bookmark" size={18} color={t.ink.primary} />}
          </TouchableOpacity>
        </View>

        <TouchableOpacity activeOpacity={0.9} onPress={() => navigation.navigate('Post', { postId: post.id })}>
          {post.content ? <Text style={ss.content} numberOfLines={4}>{post.content}</Text> : null}
          {post.mediaPending ? <View accessibilityRole="progressbar" accessibilityLabel="Loading saved media" style={ss.mediaState}><ActivityIndicator color={t.ink.muted}/><Text style={ss.authorSub}>Loading media…</Text></View> : post.mediaUnavailable ? <TouchableOpacity onPress={() => void load()} accessibilityRole="button" style={ss.mediaState}><Text style={ss.authorSub}>A photo or video could not load. Tap to retry.</Text></TouchableOpacity> : null}
          {mediaItems.length > 0 && (
            <View style={ss.mediaWrap}>
              <MediaRenderer
                media={mediaItems}
                containerWidth={SCREEN_W - 48}
                fullBleed={false}
                maxHeight={280}
              />
            </View>
          )}
        </TouchableOpacity>

        <View style={ss.footer}>
          <View style={ss.counts}>
            {post.likes_count > 0 && (
              <View style={ss.countItem}>
                <Feather name="heart" size={12} color={t.ink.secondary} />
                <Text style={ss.countTxt}>{post.likes_count}</Text>
              </View>
            )}
            {post.comments_count > 0 && (
              <View style={ss.countItem}>
                <Feather name="message-circle" size={12} color={t.ink.secondary} />
                <Text style={ss.countTxt}>{post.comments_count}</Text>
              </View>
            )}
          </View>
          <Text style={ss.savedAt}>Saved {relTime(post.saved_at)}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={ss.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={t.surface.canvas} />

      <View style={ss.header}>
        <TouchableOpacity onPress={() => { if (navigation.canGoBack()) navigation.goBack(); else navigation.navigate('Main', { screen: 'Profile', params: { screen: 'ProfileMain' } }); }} style={ss.backBtn} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="chevron-left" size={26} color={t.ink.primary} />
        </TouchableOpacity>
        <Text style={ss.headerTitle}>Saved Posts</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading || visibleUserId !== userId ? (
        <ListRowSkeleton />
      ) : (
        <FlatList
          data={posts}
          keyExtractor={p => p.id}
          renderItem={renderPost}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            ss.list,
            posts.length === 0 && { flexGrow: 1 },
            { paddingBottom: Math.max(insets.bottom + 20, 40) },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={t.ink.primary}
            />
          }
          ListHeaderComponent={error ? <TouchableOpacity accessibilityRole="button" onPress={() => void load()} style={ss.error}><Text accessibilityRole="alert" style={ss.content}>{error}</Text><Text style={ss.authorName}>Retry</Text></TouchableOpacity> : null}
          ListEmptyComponent={error ? null :
            <View style={ss.empty}>
              <View style={ss.emptyIcon}>
                <Feather name="bookmark" size={32} color={t.ink.muted} />
              </View>
              <Text style={ss.emptyTitle}>No saved posts</Text>
              <Text style={ss.emptySub}>Tap the bookmark icon on any post to save it for later.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const ss = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.sunken },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: t.surface.canvas,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '600', color: t.ink.primary, flex: 1, textAlign: 'center' },

  error: { padding: 16, marginBottom: 12, borderRadius: 12, backgroundColor: t.surface.raised },
  mediaState: { minHeight: 100, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: t.surface.sunken, borderRadius: 10, marginBottom: 10 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 12 },

  card: {
    backgroundColor: t.surface.canvas,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  hdr: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFb: { backgroundColor: t.brand.base, alignItems: 'center', justifyContent: 'center' },
  avatarFbTxt: { fontSize: 14, fontWeight: '700', color: t.ink.inverse },
  authorMeta: { flex: 1 },
  authorName: { fontSize: 14, fontWeight: '600', color: t.ink.primary },
  authorSub: { fontSize: 12, color: t.ink.secondary, marginTop: 1 },
  unsaveBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.surface.hairline, alignItems: 'center', justifyContent: 'center' },

  content: { fontSize: 14, lineHeight: 20, color: t.ink.primary, marginBottom: 10 },
  mediaWrap: { borderRadius: 10, overflow: 'hidden', marginBottom: 10 },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.surface.hairline },
  counts: { flexDirection: 'row', gap: 14 },
  countItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  countTxt: { fontSize: 12, color: t.ink.secondary },
  savedAt: { fontSize: 11, color: t.ink.secondary, fontStyle: 'italic' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingTop: 80 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: t.surface.sunken, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: t.ink.primary, marginBottom: 6 },
  emptySub: { fontSize: 13, lineHeight: 19, color: t.ink.secondary, textAlign: 'center' },
}));
