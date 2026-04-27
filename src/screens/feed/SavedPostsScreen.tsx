/**
 * SavedPostsScreen.tsx
 * Shows user's bookmarked posts, matches Clean Premium style.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Image,
  ActivityIndicator, StatusBar, RefreshControl, Alert, Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import MediaRenderer, { PostMedia } from '../../components/MediaRenderer';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

const SCREEN_W = Dimensions.get('window').width;
const NAVY = '#0B1E3D';
const TEXT_PRIMARY = '#000000';
const TEXT_SECONDARY = '#8E8E93';
const HAIRLINE = '#E5E5EA';

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
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const [posts, setPosts] = useState<SavedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unsaving, setUnsaving] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const { data: bookmarks, error: bErr } = await supabase
        .from('post_bookmarks')
        .select('post_id, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (bErr || !bookmarks || bookmarks.length === 0) {
        setPosts([]);
        return;
      }

      const postIds = bookmarks.map((b: any) => b.post_id);
      const savedAtMap: Record<string, string> = {};
      bookmarks.forEach((b: any) => { savedAtMap[b.post_id] = b.created_at; });

      const { data: postsData } = await supabase
        .from('posts')
        .select('id, user_id, content, body, media_url, likes_count, comments_count, created_at, post_media(id, url, media_type, width, height, sort_order)')
        .in('id', postIds);

      if (!postsData || postsData.length === 0) {
        setPosts([]);
        return;
      }

      const authorIds = Array.from(new Set(postsData.map((p: any) => p.user_id)));
      const authorMap: Record<string, any> = {};
      if (authorIds.length > 0) {
        const { data: authors } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url')
          .in('id', authorIds);
        (authors || []).forEach((a: any) => { authorMap[a.id] = a; });
      }

      const hydrated: SavedPost[] = postsData.map((p: any) => ({
        id: p.id,
        user_id: p.user_id,
        content: p.content || p.body || '',
        body: p.body || '',
        media_url: p.media_url,
        likes_count: p.likes_count ?? 0,
        comments_count: p.comments_count ?? 0,
        created_at: p.created_at,
        saved_at: savedAtMap[p.id] || p.created_at,
        post_media: Array.isArray(p.post_media) ? p.post_media : [],
        author: authorMap[p.user_id] ?? null,
      }));

      // Preserve bookmark order (most recently saved first)
      hydrated.sort((a, b) => new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime());
      setPosts(hydrated);
    } catch (e) {
      console.log('[SAVED_LOAD_ERR]', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    load();

    if (!userId) return;
    const ch = supabase
      .channel(`bookmarks_${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_bookmarks', filter: `user_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load, userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const unsave = async (postId: string) => {
    if (!userId || unsaving[postId]) return;
    setUnsaving(prev => ({ ...prev, [postId]: true }));
    const snapshot = posts;
    setPosts(prev => prev.filter(p => p.id !== postId));
    const { error } = await supabase.from('post_bookmarks')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', userId);
    if (error) {
      setPosts(snapshot);
      Alert.alert('Error', 'Could not unsave.');
    }
    setUnsaving(prev => { const n = { ...prev }; delete n[postId]; return n; });
  };

  const renderPost = ({ item: post }: { item: SavedPost }) => {
    const author = post.author;
    const mediaItems: PostMedia[] = post.post_media?.length
      ? post.post_media
      : (post.media_url ? [{ id: '0', url: post.media_url, media_type: 'image' as const, sort_order: 0 }] : []);

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
              <Text style={ss.authorName} numberOfLines={1}>{author?.full_name || 'Member'}</Text>
              <Text style={ss.authorSub}>
                {author?.username ? `@${author.username} · ` : ''}
                {relTime(post.created_at)}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={ss.unsaveBtn}
            onPress={() => unsave(post.id)}
            disabled={!!unsaving[post.id]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            {unsaving[post.id]
              ? <ActivityIndicator size={14} color={NAVY} />
              : <Feather name="bookmark" size={18} color={NAVY} />}
          </TouchableOpacity>
        </View>

        <TouchableOpacity activeOpacity={0.9} onPress={() => navigation.navigate('Post', { postId: post.id })}>
          {post.content ? <Text style={ss.content} numberOfLines={4}>{post.content}</Text> : null}
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
                <Feather name="heart" size={12} color={TEXT_SECONDARY} />
                <Text style={ss.countTxt}>{post.likes_count}</Text>
              </View>
            )}
            {post.comments_count > 0 && (
              <View style={ss.countItem}>
                <Feather name="message-circle" size={12} color={TEXT_SECONDARY} />
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
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      <View style={ss.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={ss.backBtn} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="chevron-left" size={26} color={NAVY} />
        </TouchableOpacity>
        <Text style={ss.headerTitle}>Saved Posts</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={ss.loader}><ActivityIndicator color={NAVY} size="large" /></View>
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
              tintColor={NAVY}
            />
          }
          ListEmptyComponent={
            <View style={ss.empty}>
              <View style={ss.emptyIcon}>
                <Feather name="bookmark" size={32} color="#C7C7CC" />
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

const ss = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F7F9' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '600', color: TEXT_PRIMARY, flex: 1, textAlign: 'center' },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 12 },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  hdr: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFb: { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  avatarFbTxt: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  authorMeta: { flex: 1 },
  authorName: { fontSize: 14, fontWeight: '600', color: TEXT_PRIMARY },
  authorSub: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 1 },
  unsaveBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(11,30,61,0.08)', alignItems: 'center', justifyContent: 'center' },

  content: { fontSize: 14, lineHeight: 20, color: '#1A1A1A', marginBottom: 10 },
  mediaWrap: { borderRadius: 10, overflow: 'hidden', marginBottom: 10 },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F0F0F0' },
  counts: { flexDirection: 'row', gap: 14 },
  countItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  countTxt: { fontSize: 12, color: TEXT_SECONDARY },
  savedAt: { fontSize: 11, color: TEXT_SECONDARY, fontStyle: 'italic' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingTop: 80 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: TEXT_PRIMARY, marginBottom: 6 },
  emptySub: { fontSize: 13, lineHeight: 19, color: TEXT_SECONDARY, textAlign: 'center' },
});
