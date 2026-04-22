import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  StatusBar, RefreshControl, Share, Alert, TextInput, Image,
  KeyboardAvoidingView, Platform, Keyboard, ScrollView, Dimensions, Modal,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Image as ExpoImage } from 'expo-image';
import MediaRenderer, { PostMedia } from '../../components/MediaRenderer';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

const SCREEN_W = Dimensions.get('window').width;
const MEDIA_GAP = 2;

type MediaItem = { id: string; url: string; media_type: 'image' | 'video'; sort_order: number };
type Post = {
  id: string; user_id: string; content: string;
  likes_count: number; comments_count: number; reposts_count: number; bookmarks_count: number; views_count?: number;
  created_at?: string | null; media_url?: string | null; location?: string | null;
  media: MediaItem[]; score: number;
};
type ProfileLite = { id: string; full_name?: string | null; username?: string | null; avatar_url?: string | null };
type ProfileMap = Record<string, ProfileLite>;
type CommentPreview = { body: string; authorName: string };
type LocalMedia = { uri: string; type: 'image' | 'video'; ext: string; width?: number; height?: number; fileSize?: number; thumbnail?: string; };
type PostMediaRow = { id: string; url: string; media_type: 'image' | 'video'; width?: number | null; height?: number | null; sort_order: number };

function scorePost(p: Omit<Post, 'score'>): number {
  const h = (Date.now() - new Date(p.created_at || Date.now()).getTime()) / 3600000;
  return ((p.likes_count * 2) + (p.comments_count * 5) + (p.reposts_count * 3)) * Math.exp(-h / 36) + (h < 1 ? 20 : 0);
}
function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (m < 1) return 'now'; if (m < 60) return `${m}m`; if (h < 24) return `${h}h`;
  if (dy < 7) return `${dy}d`;
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function initials(name?: string | null) {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}
function fmtCount(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

function renderRichText(text: string, onHashtag: (t: string) => void, onMention: (u: string) => void) {
  return text.split(/([@#][\w.]+)/g).map((part, i) => {
    if (part.startsWith('#')) return <Text key={i} style={s.hashTag} onPress={() => onHashtag(part.slice(1))}>{part}</Text>;
    if (part.startsWith('@')) return <Text key={i} style={s.mention} onPress={() => onMention(part.slice(1))}>{part}</Text>;
    return <Text key={i}>{part}</Text>;
  });
}


// ─── Dynamic aspect-ratio image ──────────────────────────────────────────────
function DynamicImage({ uri, width }: { uri: string; width: number }) {
  // Default to 4:3. Once we know the real size, update.
  const [imgH, setImgH] = React.useState(width * 0.75);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!uri) return;
    Image.getSize(
      uri,
      (w, h) => {
        if (w > 0 && h > 0) {
          const naturalRatio = h / w;
          // Portrait: allow up to full square (1:1). Landscape: minimum 40% height.
          // Avoids tiny slivers for ultra-wide and excessively tall boxes for ultra-portrait.
          const clampedRatio = Math.min(Math.max(naturalRatio, 0.4), 1.25);
          setImgH(Math.round(width * clampedRatio));
        }
      },
      () => { /* keep default */ }
    );
  }, [uri, width]);

  return (
    <View style={{
      width, height: imgH,
      borderRadius: 14, overflow: 'hidden',
      backgroundColor: '#F0F0F0',
      marginTop: 10,
    }}>
      <ExpoImage
        source={{ uri }}
        style={{ width, height: imgH }}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={300}
        onLoad={() => { setLoaded(true); }}
        onError={(e: any) => console.log('[IMG_ERR]', uri, e.error)}
      />
      {!loaded && (
        <View style={{
          position: 'absolute', top: 0, left: 0, width, height: imgH,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: '#F0F0F0',
        }}>
          <ActivityIndicator color="#C7C7CC" size="small" />
        </View>
      )}
    </View>
  );
}

export default function FeedScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const [posts, setPosts] = useState<Post[]>([]);
  const [profilesMap, setProfilesMap] = useState<ProfileMap>({});
  const [likedPosts, setLikedPosts] = useState<Record<string, boolean>>({});
  const [bookmarkedPosts, setBookmarkedPosts] = useState<Record<string, boolean>>({});
  const [repostedPosts, setRepostedPosts] = useState<Record<string, boolean>>({});
  const [commentPreviews, setCommentPreviews] = useState<Record<string, CommentPreview>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKeys, setBusyKeys] = useState<Record<string, boolean>>({});
  const [feedMode, setFeedMode] = useState<'forYou' | 'latest'>('forYou');
  const [search, setSearch] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [composerMedia, setComposerMedia] = useState<LocalMedia[]>([]);
  const [posting, setPosting] = useState(false);
  const [mentionResults, setMentionResults] = useState<ProfileLite[]>([]);
  const [mentionActive, setMentionActive] = useState(false);
  const [sharingPost, setSharingPost] = useState<Record<string, boolean>>({});
  const [menuPost, setMenuPost] = useState<Post | null>(null);

  const realtimeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerRef    = useRef<TextInput>(null);
  const lastTapMap     = useRef<Record<string, number>>({});
  const [heartAnim]    = useState(() => new Animated.Value(0));
  const [heartPost,    setHeartPost]    = useState<string | null>(null);
  const [activePostId, setActivePostId]   = useState<string | null>(null);
  const [screenFocused, setScreenFocused] = useState(true);

  // Pause all feed videos when navigating to another screen (e.g. PostScreen).
  // Restore normal autoplay when returning to the feed.
  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, [])
  );

  // viewabilityConfig must be stable — defined outside render or in a ref
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 55, // correct key — no 'ity' suffix
  }).current;

  const onViewableItemsChanged = useCallback(({ viewableItems }: any) => {
    // Pick the first fully-in-view item that has any media
    const first = viewableItems.find((v: any) => v.isViewable);
    setActivePostId(first?.item?.id ?? null);
  }, []);

  const isBusy = (k: string) => !!busyKeys[k];
  const setBusy = (k: string, v: boolean) =>
    setBusyKeys(p => { const n = { ...p }; if (v) n[k] = true; else delete n[k]; return n; });

  const scheduleRefresh = useCallback(() => {
    if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
    realtimeTimerRef.current = setTimeout(() => loadFeed(false), 2000);
  }, []);

  const loadFeed = useCallback(async (showLoader = false) => {
    try {
      if (showLoader) setLoading(true);
      // Try full query with post_media join
      let rawPosts: any[] | null = null;
      let queryError: any = null;

      const { data: d1, error: e1 } = await supabase
        .from('posts')
        .select('*, post_media(id, url, media_type, width, height, sort_order)')
        .order('created_at', { ascending: false })
        .limit(80);

      if (e1) {
        // post_media join failed (schema mismatch) — fall back to posts-only query
        console.log('[FEED] join failed, falling back:', e1.message);
        const { data: d2, error: e2 } = await supabase
          .from('posts')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(80);
        rawPosts = d2;
        queryError = e2;
      } else {
        rawPosts = d1;
        queryError = e1;
      }

      if (queryError) {
        console.log('[FEED] query error:', queryError.message);
        // Do NOT wipe existing posts — just stop refreshing
        return;
      }
      if (!rawPosts) return;

      const normalized = (rawPosts as any[]).map((row: any): Omit<Post, 'score'> => ({
        id: row.id, user_id: row.user_id, content: row.content ?? row.body ?? '',
        likes_count: row.likes_count ?? 0, comments_count: row.comments_count ?? 0, views_count: row.views_count ?? 0,
        reposts_count: row.reposts_count ?? 0, bookmarks_count: row.bookmarks_count ?? 0,
        created_at: row.created_at, media_url: row.media_url ?? null,
        location: row.location ?? null,
        media: Array.isArray(row.post_media)
          ? (row.post_media as PostMediaRow[]).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          : (Array.isArray(row.media) ? row.media : []),
      }));
      const scored = normalized.map(p => ({ ...p, score: scorePost(p) }));
      setPosts(scored);
      const uids = Array.from(new Set(scored.map(p => p.user_id)));
      const { data: pData } = await supabase.from('profiles').select('id, full_name, username, avatar_url').in('id', uids);
      const pm: ProfileMap = {};
      (pData || []).forEach((p: any) => { pm[p.id] = p; });
      setProfilesMap(pm);
      if (userId) {
        const ids = scored.map(p => p.id);
        const [{ data: likes }, { data: bookmarks }, { data: reposts }] = await Promise.all([
          supabase.from('post_likes').select('post_id').eq('user_id', userId).in('post_id', ids),
          supabase.from('post_bookmarks').select('post_id').eq('user_id', userId).in('post_id', ids),
          supabase.from('post_reposts').select('post_id').eq('user_id', userId).in('post_id', ids),
        ]);
        const lm: Record<string, boolean> = {}, bm: Record<string, boolean> = {}, rm: Record<string, boolean> = {};
        (likes || []).forEach((r: any) => { lm[r.post_id] = true; });
        (bookmarks || []).forEach((r: any) => { bm[r.post_id] = true; });
        (reposts || []).forEach((r: any) => { rm[r.post_id] = true; });
        setLikedPosts(lm); setBookmarkedPosts(bm); setRepostedPosts(rm);
        if (ids.length > 0) {
          const { data: cData } = await supabase.from('post_comments').select('post_id, body, user_id').in('post_id', ids).is('parent_comment_id', null).order('created_at', { ascending: true });
          const cpMap: Record<string, CommentPreview> = {};
          const aIds = Array.from(new Set((cData || []).map((c: any) => c.user_id)));
          let authors: Record<string, any> = {};
          if (aIds.length > 0) {
            const { data: aData } = await supabase.from('profiles').select('id, full_name, username').in('id', aIds);
            (aData || []).forEach((a: any) => { authors[a.id] = a; });
          }
          (cData || []).forEach((c: any) => {
            if (!cpMap[c.post_id]) {
              const a = authors[c.user_id];
              cpMap[c.post_id] = { body: c.body, authorName: a?.full_name || a?.username || 'User' };
            }
          });
          setCommentPreviews(cpMap);
        }
      }
    } catch (e) { console.log('LOAD_FEED', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [userId]);

  useEffect(() => {
    loadFeed(true);
    const ch = supabase.channel('feed_live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, () => scheduleRefresh())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_comments' }, () => scheduleRefresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current); };
  }, [loadFeed, scheduleRefresh]);

  const toggleLike = async (postId: string) => {
    if (!userId || isBusy(`like-${postId}`)) return;
    setBusy(`like-${postId}`, true);
    const was = !!likedPosts[postId];
    setLikedPosts(p => ({ ...p, [postId]: !was }));
    setPosts(p => p.map(x => x.id === postId ? { ...x, likes_count: x.likes_count + (was ? -1 : 1) } : x));
    try {
      if (was) await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', userId);
      else await supabase.from('post_likes').insert({ post_id: postId, user_id: userId });
    } catch { setLikedPosts(p => ({ ...p, [postId]: was })); }
    finally { setBusy(`like-${postId}`, false); }
  };

  // ── Double-tap like ─────────────────────────────────────────────────────
  const singleTapTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleDoubleTap = (postId: string, onSingleTap: () => void) => {
    const now = Date.now();
    const last = lastTapMap.current[postId] || 0;
    if (now - last < 300) {
      // Double tap detected — cancel pending single-tap nav
      if (singleTapTimers.current[postId]) {
        clearTimeout(singleTapTimers.current[postId]);
        delete singleTapTimers.current[postId];
      }
      if (!likedPosts[postId]) toggleLike(postId);
      setHeartPost(postId);
      heartAnim.setValue(0);
      Animated.sequence([
        Animated.timing(heartAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.delay(420),
        Animated.timing(heartAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start(() => setHeartPost(null));
    } else {
      // First tap — wait to see if double tap follows
      singleTapTimers.current[postId] = setTimeout(() => {
        delete singleTapTimers.current[postId];
        onSingleTap();
      }, 220);
    }
    lastTapMap.current[postId] = now;
  };

  const toggleBookmark = async (postId: string) => {
    if (!userId || isBusy(`bk-${postId}`)) return;
    setBusy(`bk-${postId}`, true);
    const was = !!bookmarkedPosts[postId];
    setBookmarkedPosts(p => ({ ...p, [postId]: !was }));
    try {
      if (was) await supabase.from('post_bookmarks').delete().eq('post_id', postId).eq('user_id', userId);
      else await supabase.from('post_bookmarks').insert({ post_id: postId, user_id: userId });
    } catch { setBookmarkedPosts(p => ({ ...p, [postId]: was })); }
    finally { setBusy(`bk-${postId}`, false); }
  };

  const toggleRepost = async (postId: string) => {
    if (!userId || isBusy(`rp-${postId}`)) return;
    setBusy(`rp-${postId}`, true);
    const was = !!repostedPosts[postId];
    setRepostedPosts(p => ({ ...p, [postId]: !was }));
    setPosts(p => p.map(x => x.id === postId ? { ...x, reposts_count: x.reposts_count + (was ? -1 : 1) } : x));
    try {
      if (was) await supabase.from('post_reposts').delete().eq('post_id', postId).eq('user_id', userId);
      else await supabase.from('post_reposts').insert({ post_id: postId, user_id: userId });
    } catch { setRepostedPosts(p => ({ ...p, [postId]: was })); }
    finally { setBusy(`rp-${postId}`, false); }
  };

  // sharingPost: maps postId → true while share sheet is open + 600ms after close.
  // This disables the Comment pill so iOS ghost-touch after sheet dismiss
  // cannot trigger navigation.

  const sharePost = async (post: Post) => {
    if (sharingPost[post.id]) return;
    setSharingPost(p => ({ ...p, [post.id]: true }));
    const author = profilesMap[post.user_id];
    try {
      await Share.share({ message: `${author?.full_name || 'Someone'} on TBirds Nest:\n\n${post.content}` });
    } catch {}
    setTimeout(() => setSharingPost(p => { const n = { ...p }; delete n[post.id]; return n; }), 600);
  };

  const pickMedia = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission required'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'] as ImagePicker.MediaType[],
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 0.85,
    });
    if (!result.canceled && result.assets) {
      const MAX_VIDEO_BYTES = 50 * 1024 * 1024;  // 50 MB
      const MAX_IMAGE_BYTES = 10 * 1024 * 1024;  // 10 MB

      const picked: LocalMedia[] = [];
      for (const a of result.assets) {
        const isVideo = a.type === 'video';
        const ext = isVideo ? 'mp4' : 'jpg';
        const fileSize = (a as any).fileSize ?? undefined;

        // Reject files that are too large — clear error, not silent fallback
        if (isVideo && fileSize && fileSize > MAX_VIDEO_BYTES) {
          Alert.alert('Video too large', `Maximum video size is 50 MB. Your file is ${(fileSize / 1024 / 1024).toFixed(0)} MB. Please trim or compress it first.`);
          continue;
        }
        if (!isVideo && fileSize && fileSize > MAX_IMAGE_BYTES) {
          Alert.alert('Image too large', `Maximum image size is 10 MB.`);
          continue;
        }

        // Generate thumbnail for video preview
        let thumbnail: string | undefined;
        if (isVideo) {
          try {
            const result = await VideoThumbnails.getThumbnailAsync(a.uri, { time: 0, quality: 0.7 });
            thumbnail = result.uri;
          } catch (e) {
            console.log('[THUMB_ERR]', e);
          }
        }

        picked.push({
          uri: a.uri,
          type: isVideo ? 'video' as const : 'image' as const,
          ext,
          width: a.width ?? undefined,
          height: a.height ?? undefined,
          fileSize,
          thumbnail,
        });
      }
      setComposerMedia(p => [...p, ...picked].slice(0, 10));
    }
  };

  const openCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission required'); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    if (!result.canceled && result.assets?.[0]) {
      const a = result.assets[0];
      setComposerMedia(p => [...p, { uri: a.uri, type: 'image', ext: 'jpg' }]);
    }
  };

  const handleComposerChange = (text: string) => {
    setComposerText(text);
    const match = text.match(/@([\w.]*)$/);
    if (match && match[1].length >= 1) {
      setMentionActive(true);
      supabase.from('profiles').select('id, full_name, username, avatar_url').ilike('username', `${match[1]}%`).limit(5).then(({ data }) => setMentionResults((data || []) as ProfileLite[]));
    } else { setMentionActive(false); setMentionResults([]); }
  };

  const insertMention = (user: ProfileLite) => {
    setComposerText(composerText.replace(/@[\w.]*$/, `@${user.username} `));
    setMentionActive(false); setMentionResults([]);
  };

  const createPost = async () => {
    if ((!composerText.trim() && !composerMedia.length) || posting || !userId) return;
    setPosting(true);
    try {
      let mediaUrl: string | null = null;
      // Upload ALL selected media using FormData (most reliable in Expo Go)
      const uploadedMedia: { url: string; media_type: 'image' | 'video'; width?: number; height?: number; sort_order: number }[] = [];
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
      const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token || supabaseKey;

      for (let i = 0; i < composerMedia.length; i++) {
        const m = composerMedia[i];
        try {
          const isVideo = m.type === 'video';

          // Double-check size — catches items added via camera that skipped the picker check
          const MAX_BYTES = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
          if (m.fileSize && m.fileSize > MAX_BYTES) {
            const mb = (m.fileSize / 1024 / 1024).toFixed(0);
            console.log(`[POST_UPLOAD] #${i} SKIPPED — too large: ${mb} MB`);
            Alert.alert('File too large', `${isVideo ? 'Video' : 'Image'} is ${mb} MB. Max ${isVideo ? '50' : '10'} MB.`);
            continue;
          }
          const mimeType = isVideo ? 'video/mp4' : 'image/jpeg';
          const ext      = isVideo ? 'mp4' : 'jpg';
          const fileName = `${userId}/${Date.now()}_${i}.${ext}`;

          console.log(`[POST_UPLOAD] #${i}`, { uri: m.uri, mimeType, fileName });

          const formData = new FormData();
          formData.append('file', { uri: m.uri, type: mimeType, name: `media_${i}.${ext}` } as any);

          const uploadRes = await fetch(
            `${supabaseUrl}/storage/v1/object/post-media/${fileName}`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey, 'x-upsert': 'true' },
              body: formData,
            }
          );

          const uploadJson = await uploadRes.json().catch(() => ({}));
          console.log(`[POST_UPLOAD] #${i} Status:`, uploadRes.status, JSON.stringify(uploadJson));

          if (!uploadRes.ok) throw new Error(uploadJson?.error || `Upload failed: ${uploadRes.status}`);

          const publicUrl = `${supabaseUrl}/storage/v1/object/public/post-media/${fileName}`;
          console.log(`[POST_UPLOAD] #${i} URL:`, publicUrl);

          uploadedMedia.push({ url: publicUrl, media_type: isVideo ? 'video' : 'image', width: m.width, height: m.height, sort_order: i });
          if (i === 0) mediaUrl = publicUrl;

        } catch (e: any) {
          console.log(`[POST_UPLOAD] #${i} FAILED:`, e?.message);
        }
      }

      if (composerMedia.length > 0 && uploadedMedia.length === 0) {
        console.log('[POST] All media uploads failed — posting text only');
      }
      const insertData: any = {
        user_id: userId,
        content: composerText.trim() || null,
      };
      if (mediaUrl) insertData.media_url = mediaUrl;

      const { data: newPost, error } = await supabase
        .from('posts').insert(insertData).select('id').single();
      if (error) {
        console.log('POST_INSERT_ERR', error.message);
        Alert.alert('Post failed', error.message);
        return;
      }

      // Insert all media into post_media table — failure here does NOT block the post
      if (newPost?.id && uploadedMedia.length > 0) {
        try {
          const mediaRows = uploadedMedia.map(m => ({
            post_id: newPost.id,
            url: m.url,
            media_type: m.media_type,
            sort_order: m.sort_order,
            // Only include width/height if defined — avoids schema cache errors
            ...(m.width  != null ? { width:  m.width  } : {}),
            ...(m.height != null ? { height: m.height } : {}),
          }));
          const { error: mErr } = await supabase.from('post_media').insert(mediaRows);
          if (mErr) console.log('[POST] post_media insert failed (non-fatal):', mErr.message);
          else console.log('[POST] post_media inserted:', mediaRows.length, 'rows');
        } catch (e: any) {
          console.log('[POST] post_media insert exception (non-fatal):', e?.message);
        }
      }

      // Always close composer and refresh feed — even if media insert failed
      setComposerOpen(false);
      setComposerText('');
      setComposerMedia([]);
      Keyboard.dismiss();
      // Small delay to let DB propagate, then refresh
      setTimeout(() => loadFeed(false), 300);
    } catch (e: any) {
      console.log('CREATE_POST_CATCH', e?.message);
      Alert.alert('Error', 'Could not post. Check your connection and try again.');
    } finally {
      setPosting(false);
    }
  };

  const displayPosts = useMemo(() => {
    let list = [...posts];
    const term = search.trim().toLowerCase();
    if (term) list = list.filter(p => (p.content || '').toLowerCase().includes(term));
    if (feedMode === 'forYou') list.sort((a, b) => b.score - a.score);
    return list;
  }, [posts, feedMode, search]);

  const renderMedia = (post: any) => {
    const mediaItems: PostMedia[] = post.media?.length > 0
      ? post.media
      : (post.media_url ? [{ id: '0', url: post.media_url, media_type: 'image' as const, sort_order: 0 }] : []);
    if (!mediaItems.length) return null;
    return (
      <MediaRenderer
        media={mediaItems}
        containerWidth={SCREEN_W}
        fullBleed
        maxHeight={420}
        isActive={screenFocused && post.id === activePostId}
      />
    );
  };

    const renderPost = ({ item: post }: { item: Post }) => {
    const author = profilesMap[post.user_id];
    const isLiked = !!likedPosts[post.id];
    const isBookmarked = !!bookmarkedPosts[post.id];
    const isReposted = !!repostedPosts[post.id];
    const preview = commentPreviews[post.id];
    const isSharing = !!sharingPost[post.id];
    // Block navigation for 600ms after share sheet closes to prevent ghost touch
    const openPost = () => { if (!isSharing) navigation.navigate('Post', { postId: post.id }); };

    return (
      <View style={s.postCard}>
        <View style={s.postTopRow}>
          <TouchableOpacity style={s.postMeta} onPress={() => navigation.navigate('UserProfile', { userId: post.user_id, user: author })} activeOpacity={0.8}>
            {author?.avatar_url ? <Image source={{ uri: author.avatar_url }} style={s.avatar} /> : <View style={s.avatarFb}><Text style={s.avatarFbTxt}>{initials(author?.full_name || author?.username)}</Text></View>}
            <View style={s.postMetaTxt}>
              <Text style={s.postAuthor} numberOfLines={1}>{author?.full_name || 'Member'}</Text>
              <Text style={s.postSub}>{author?.username ? `@${author.username}` : ''}{author?.username && post.created_at ? ' · ' : ''}{relTime(post.created_at)}</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.menuBtn}
            onPress={() => setMenuPost(post)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={s.menuBtnTxt}>···</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity activeOpacity={0.95} onPress={openPost}>
          <Text style={s.content}>{renderRichText(post.content, () => {}, () => {})}</Text>
        </TouchableOpacity>

        {(() => {
          const media = renderMedia(post);
          if (!media) return null;
          const isVidPost = post.media?.some((m: any) => m.media_type === 'video') || false;
          return (
            <View style={{ position: 'relative' }}>
              <TouchableOpacity
                activeOpacity={0.97}
                onPress={() => handleDoubleTap(post.id, openPost)}
              >
                {media}
              </TouchableOpacity>
              {/* Heart burst overlay */}
              {heartPost === post.id && (
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                    alignItems: 'center', justifyContent: 'center',
                    opacity: heartAnim,
                    transform: [{ scale: heartAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.3] }) }],
                  }}
                >
                  <Text style={{ fontSize: 80 }}>❤️</Text>
                </Animated.View>
              )}
              {/* Video view count badge */}
              {isVidPost && (post.views_count ?? 0) > 0 && (
                <View style={{ position:'absolute', bottom:10, left:10, flexDirection:'row', alignItems:'center', gap:4, backgroundColor:'rgba(0,0,0,0.55)', borderRadius:12, paddingHorizontal:8, paddingVertical:4 }}>
                  <Feather name="eye" size={11} color="#FFF" />
                  <Text style={{ color:'#FFF', fontSize:11, fontWeight:'600' }}>{fmtCount(post.views_count ?? 0)}</Text>
                </View>
              )}
            </View>
          );
        })()}

        {(post.likes_count > 0 || post.comments_count > 0) && (
          <View style={s.metricsRow}>
            {post.likes_count > 0 && <Text style={s.metric}>{fmtCount(post.likes_count)} {post.likes_count === 1 ? 'like' : 'likes'}</Text>}
            {post.likes_count > 0 && post.comments_count > 0 && <Text style={s.metricDot}>·</Text>}
            {post.comments_count > 0 && <Text style={s.metric}>{fmtCount(post.comments_count)} {post.comments_count === 1 ? 'comment' : 'comments'}</Text>}
          </View>
        )}

        <View style={s.divider} />

        <View style={s.actions}>
          <TouchableOpacity style={[s.pill, isLiked && s.pillLiked]} onPress={() => toggleLike(post.id)} activeOpacity={0.75} disabled={isBusy(`like-${post.id}`)}>
            <Feather name="heart" size={14} color={isLiked ? '#E53935' : '#6B7280'} />
            <Text style={[s.pillTxt, isLiked && s.pillTxtLiked]}>{post.likes_count > 0 ? fmtCount(post.likes_count) : 'Like'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.pill}
            onPress={() => navigation.navigate('Post', { postId: post.id, focusComment: true })}
            activeOpacity={0.75}
            disabled={!!sharingPost[post.id]}
          >
            <Feather name="message-circle" size={14} color="#6B7280" />
            <Text style={s.pillTxt}>{post.comments_count > 0 ? fmtCount(post.comments_count) : 'Comment'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.pill, isReposted && s.pillReposted]} onPress={() => toggleRepost(post.id)} activeOpacity={0.75} disabled={isBusy(`rp-${post.id}`)}>
            <Feather name="repeat" size={14} color={isReposted ? '#059669' : '#6B7280'} />
            <Text style={[s.pillTxt, isReposted && s.pillTxtReposted]}>{post.reposts_count > 0 ? fmtCount(post.reposts_count) : 'Repost'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.pill, s.pillIcon, isBookmarked && s.pillSaved]} onPress={() => toggleBookmark(post.id)} activeOpacity={0.75} disabled={isBusy(`bk-${post.id}`)}>
            <Feather name="bookmark" size={14} color={isBookmarked ? '#2563EB' : '#6B7280'} />
          </TouchableOpacity>

          <TouchableOpacity style={[s.pill, s.pillIcon]} onPress={() => sharePost(post)} activeOpacity={0.75}>
            <Feather name="share-2" size={14} color="#6B7280" />
          </TouchableOpacity>
        </View>

        {preview && (
          <TouchableOpacity style={s.cpWrap} onPress={openPost} activeOpacity={0.8}>
            <Text style={s.cpTxt} numberOfLines={2}>
              <Text style={s.cpAuthor}>{preview.authorName} </Text>{preview.body}
            </Text>
            {post.comments_count > 1 && <Text style={s.viewAll}>View all {post.comments_count} comments</Text>}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.container}>
          <View style={s.header}>
            <View style={s.headerRow}>
              <Text style={s.logo}>TBirds</Text>
              <TouchableOpacity style={s.iconBtn} onPress={() => navigation.navigate('Notifications')}>
                <Feather name="bell" size={20} color="#000" />
              </TouchableOpacity>
            </View>
            <TextInput value={search} onChangeText={setSearch} placeholder="Search posts..." placeholderTextColor="#9CA3AF" style={s.searchInput} returnKeyType="search" clearButtonMode="while-editing" />
            <View style={s.tabRow}>
              {(['forYou', 'latest'] as const).map(m => (
                <TouchableOpacity key={m} style={[s.tab, feedMode === m && s.tabActive]} onPress={() => setFeedMode(m)}>
                  <Text style={[s.tabTxt, feedMode === m && s.tabTxtActive]}>{m === 'forYou' ? 'For You' : 'Latest'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {loading ? (
            <View style={s.loader}><ActivityIndicator color="#000" size="large" /></View>
          ) : (
            <FlatList
              data={displayPosts}
              keyExtractor={p => p.id}
              renderItem={renderPost}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="none"
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={viewabilityConfig}
              contentContainerStyle={[s.list, !displayPosts.length && s.listEmpty, { paddingBottom: Math.max(insets.bottom + 80, 100) }]}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadFeed(false); }} tintColor="#000" />}
              ListEmptyComponent={
                <View style={s.emptyWrap}>
                  <Text style={s.emptyTitle}>{search ? 'No posts found' : 'Welcome to TBirds'}</Text>
                  <Text style={s.emptySub}>{search ? 'Try a different search.' : 'Be the first to share something.'}</Text>
                  {!search && <TouchableOpacity style={s.emptyBtn} onPress={() => setComposerOpen(true)}><Text style={s.emptyBtnTxt}>Create a post</Text></TouchableOpacity>}
                </View>
              }
            />
          )}

          {composerOpen && (
            <KeyboardAvoidingView style={[s.composerContainer, { bottom: insets.bottom + 16 }]} behavior={Platform.OS === 'ios' ? 'position' : undefined}>
              {mentionActive && mentionResults.length > 0 && (
                <View style={s.mentionDropdown}>
                  {mentionResults.map(u => (
                    <TouchableOpacity key={u.id} style={s.mentionRow} onPress={() => insertMention(u)}>
                      {u.avatar_url ? <Image source={{ uri: u.avatar_url }} style={s.mAvatar} /> : <View style={s.mAvatarFb}><Text style={s.mAvatarTxt}>{initials(u.full_name || u.username)}</Text></View>}
                      <View><Text style={s.mName}>{u.full_name}</Text><Text style={s.mUser}>@{u.username}</Text></View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <View style={s.composerCard}>
                <View style={s.cAuthorRow}>
                  {profile?.avatar_url ? <Image source={{ uri: profile.avatar_url }} style={s.cAvatar} /> : <View style={s.cAvatarFb}><Text style={s.cAvatarTxt}>{initials(profile?.full_name || profile?.username)}</Text></View>}
                  <Text style={s.cName}>{profile?.full_name || 'You'}</Text>
                </View>
                <TextInput ref={composerRef} style={s.cInput} value={composerText} onChangeText={handleComposerChange} placeholder="What's on your mind?" placeholderTextColor="#9CA3AF" multiline autoFocus maxLength={2000} />
                {composerText.length > 1800 && <Text style={s.charCount}>{2000 - composerText.length} left</Text>}
                {composerMedia.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.cMediaScroll} keyboardShouldPersistTaps="handled">
                    {composerMedia.map((m, i) => (
                      <View key={i} style={s.cThumb}>
                        <Image
                          source={{ uri: m.type === 'video' ? (m.thumbnail || m.uri) : m.uri }}
                          style={s.cThumbImg}
                          resizeMode="cover"
                        />
                        {m.type === 'video' && (
                          <View style={s.cVideoOverlay}>
                            <Text style={s.cVideoPlayIcon}>▶</Text>
                          </View>
                        )}
                        <TouchableOpacity style={s.cRemove} onPress={() => setComposerMedia(p => p.filter((_, j) => j !== i))}><Text style={s.cRemoveTxt}>×</Text></TouchableOpacity>
                      </View>
                    ))}
                    {composerMedia.length < 10 && <TouchableOpacity style={s.cAddMore} onPress={pickMedia}><Text style={s.cAddMoreTxt}>+</Text></TouchableOpacity>}
                  </ScrollView>
                )}
                <View style={s.cToolbar}>
                  <View style={s.cToolbarLeft}>
                    <TouchableOpacity style={s.toolBtn} onPress={pickMedia}><Feather name="image" size={20} color="#6B7280" /></TouchableOpacity>
                    <TouchableOpacity style={s.toolBtn} onPress={openCamera}><Feather name="camera" size={20} color="#6B7280" /></TouchableOpacity>
                    {composerMedia.length > 0 && <Text style={s.mediaCount}>{composerMedia.length}/10</Text>}
                  </View>
                  <View style={s.cToolbarRight}>
                    <TouchableOpacity onPress={() => { setComposerOpen(false); setComposerText(''); setComposerMedia([]); setMentionActive(false); Keyboard.dismiss(); }} style={s.cancelBtn}><Text style={s.cancelTxt}>Cancel</Text></TouchableOpacity>
                    <TouchableOpacity onPress={createPost} disabled={(!composerText.trim() && !composerMedia.length) || posting} style={[s.postBtn, ((!composerText.trim() && !composerMedia.length) || posting) && s.postBtnOff]}>
                      {posting ? <ActivityIndicator color="#fff" size={14} /> : <Text style={s.postBtnTxt}>Post</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </KeyboardAvoidingView>
          )}

          {!composerOpen && (
            <TouchableOpacity activeOpacity={0.9} onPress={() => setComposerOpen(true)} style={[s.fab, { bottom: Math.max(insets.bottom + 18, 24) }]}>
              <Text style={s.fabTxt}>+</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* ── Post options sheet ── */}
      <Modal
        visible={!!menuPost}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuPost(null)}
      >
        <TouchableOpacity style={s.menuOverlay} activeOpacity={1} onPress={() => setMenuPost(null)}>
          <TouchableOpacity activeOpacity={1} style={s.menuSheet}>
            <View style={s.menuHandle} />

            {/* Post snippet */}
            {menuPost && (
              <Text style={s.menuPreview} numberOfLines={2}>{menuPost.content}</Text>
            )}
            <View style={s.menuDivider} />

            {/* ── Own post options ── */}
            {menuPost?.user_id === userId && (
              <>
                <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
                  setMenuPost(null);
                  Alert.alert('Delete post?', 'This will permanently remove your post and all its comments.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: async () => {
                      await supabase.from('posts').delete().eq('id', menuPost!.id);
                      loadFeed(false);
                    }},
                  ]);
                }}>
                  <Feather name="trash-2" size={18} color="#FF3B30" />
                  <Text style={[s.menuOptionTxt, { color: '#FF3B30' }]}>Delete post</Text>
                </TouchableOpacity>
              </>
            )}

            {/* ── Share — close modal FIRST then wait for dismiss animation ── */}
            <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
              const captured = menuPost;
              const author = captured ? profilesMap[captured.user_id] : null;
              setMenuPost(null);
              // Wait 400ms for Modal slide-down animation to finish before
              // opening the native share sheet. Two native sheets cannot
              // stack simultaneously on iOS — this prevents the blank screen.
              setTimeout(async () => {
                if (!captured) return;
                await Share.share({
                  message: `${author?.full_name || 'Someone'} on TBirds Nest:\n\n${captured.content}`,
                });
              }, 400);
            }}>
              <Feather name="share-2" size={18} color="#000" />
              <Text style={s.menuOptionTxt}>Share post</Text>
            </TouchableOpacity>

            {/* ── Save / Remove bookmark ── */}
            <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
              if (!menuPost) return;
              toggleBookmark(menuPost.id);
              setMenuPost(null);
            }}>
              <Feather name="bookmark" size={18} color="#000" />
              <Text style={s.menuOptionTxt}>
                {menuPost && bookmarkedPosts[menuPost.id] ? 'Remove bookmark' : 'Save post'}
              </Text>
            </TouchableOpacity>

            {/* ── Copy text ── */}
            <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={async () => {
              if (!menuPost) return;
              await Clipboard.setStringAsync(menuPost.content || '');
              setMenuPost(null);
              Alert.alert('Copied', 'Post text copied to clipboard.');
            }}>
              <Feather name="copy" size={18} color="#000" />
              <Text style={s.menuOptionTxt}>Copy text</Text>
            </TouchableOpacity>

            {/* ── Not interested (mute post from feed) ── */}
            <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
              const id = menuPost?.id;
              setMenuPost(null);
              if (id) setPosts(prev => prev.filter(p => p.id !== id));
            }}>
              <Feather name="eye-off" size={18} color="#6B7280" />
              <Text style={s.menuOptionTxt}>Not interested</Text>
            </TouchableOpacity>

            {/* ── Mute user (hide all posts from them) ── */}
            {menuPost?.user_id !== userId && (
              <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
                const authorId = menuPost?.user_id;
                const authorName = menuPost ? profilesMap[menuPost.user_id]?.full_name || 'this person' : 'this person';
                setMenuPost(null);
                Alert.alert(
                  `Mute ${authorName}?`,
                  'Their posts will be hidden from your feed during this session.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Mute', style: 'destructive', onPress: () => {
                      if (authorId) setPosts(prev => prev.filter(p => p.user_id !== authorId));
                    }},
                  ]
                );
              }}>
                <Feather name="volume-x" size={18} color="#6B7280" />
                <Text style={s.menuOptionTxt}>
                  Mute {menuPost ? profilesMap[menuPost.user_id]?.full_name || 'user' : 'user'}
                </Text>
              </TouchableOpacity>
            )}

            {/* ── Report ── */}
            {menuPost?.user_id !== userId && (
              <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
                const captured = menuPost;
                setMenuPost(null);
                setTimeout(() => {
                  Alert.alert(
                    'Report post',
                    'What is the issue with this post?',
                    [
                      { text: 'Spam',             onPress: () => Alert.alert('Reported', 'This post has been flagged as spam. We will review it within 24 hours.') },
                      { text: 'Misinformation',   onPress: () => Alert.alert('Reported', 'Thank you. Our trust and safety team will fact-check this content.') },
                      { text: 'Harassment',        onPress: () => Alert.alert('Reported', 'We take harassment seriously. This has been escalated for immediate review.') },
                      { text: 'Inappropriate',     onPress: () => Alert.alert('Reported', 'This content has been reported. We will review it and take appropriate action.') },
                      { text: 'Cancel', style: 'cancel' },
                    ]
                  );
                }, 400);
              }}>
                <Feather name="flag" size={18} color="#FF9500" />
                <Text style={[s.menuOptionTxt, { color: '#FF9500' }]}>Report post</Text>
              </TouchableOpacity>
            )}

            {/* ── Cancel ── */}
            <TouchableOpacity style={[s.menuOption, s.menuCancel]} activeOpacity={0.75} onPress={() => setMenuPost(null)}>
              <Text style={s.menuCancelTxt}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { paddingHorizontal: 16, paddingBottom: 4, backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4, marginBottom: 12 },
  logo: { fontSize: 26, fontWeight: '800', color: '#000000', letterSpacing: -0.5 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F8F8F8', borderWidth: StyleSheet.hairlineWidth, borderColor: '#E8E8E8', alignItems: 'center', justifyContent: 'center' },
  searchInput: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#111', marginBottom: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: '#EBEBEB' },
  tabRow: { flexDirection: 'row', marginBottom: 10, backgroundColor: '#F5F5F5', borderRadius: 12, padding: 3 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  tabTxt: { fontSize: 13, fontWeight: '500', color: '#8E8E93' },
  tabTxtActive: { color: '#000000', fontWeight: '600' },
  list: { paddingHorizontal: 0, paddingTop: 6 },
  listEmpty: { flexGrow: 1 },
  postCard: { backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  postTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  postMeta: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatar: { width: 42, height: 42, borderRadius: 21, marginRight: 10 },
  avatarFb: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarFbTxt: { fontSize: 15, fontWeight: '700', color: '#1D4ED8' },
  postMetaTxt: { flex: 1 },
  postAuthor: { fontSize: 14, fontWeight: '700', color: '#000000' },
  postSub: { marginTop: 1, fontSize: 12, color: '#8E8E93' },
  menuBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  menuBtnTxt: { fontSize: 16, color: '#C7C7CC', letterSpacing: 1 },
  content: { fontSize: 15, lineHeight: 22, color: '#1A1A1A', paddingHorizontal: 16, paddingBottom: 12 },
  hashTag: { color: '#007AFF', fontWeight: '500' },
  mention: { color: '#5856D6', fontWeight: '500' },
  mediaSingle: { width: '100%', height: 280, backgroundColor: '#F5F5F5' },
  mediaRow: { flexDirection: 'row', gap: MEDIA_GAP },
  mediaPair: { flex: 1, height: 200, overflow: 'hidden' },
  triLeft: { flex: 2, height: 220, overflow: 'hidden', marginRight: MEDIA_GAP },
  triSmall: { flex: 1, overflow: 'hidden' },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: MEDIA_GAP },
  gridItem: { width: (SCREEN_W - MEDIA_GAP) / 2, height: 160, overflow: 'hidden' },
  ovOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.52)' },
  ovTxt: { fontSize: 24, fontWeight: '700', color: '#fff' },
  metricsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 4 },
  metric: { fontSize: 13, color: '#8E8E93' },
  metricDot: { fontSize: 12, color: '#C7C7CC' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#F0F0F0', marginHorizontal: 16, marginTop: 6 },
  actions: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#E8E8E8', backgroundColor: '#FAFAFA' },
  pillLiked: { backgroundColor: '#FFF0F0', borderColor: '#FFCDD2' },
  pillReposted: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  pillSaved: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' },
  pillIcon: { paddingHorizontal: 10 },
  pillTxt: { fontSize: 13, fontWeight: '500', color: '#6B7280' },
  pillTxtLiked: { color: '#E53935', fontWeight: '600' },
  pillTxtReposted: { color: '#059669', fontWeight: '600' },
  cpWrap: { paddingHorizontal: 16, paddingBottom: 14, paddingTop: 2 },
  cpAuthor: { fontWeight: '700', color: '#000000', fontSize: 13 },
  cpTxt: { fontSize: 13, lineHeight: 18, color: '#3C3C43' },
  viewAll: { fontSize: 12, color: '#8E8E93', marginTop: 3 },
  composerContainer: { position: 'absolute', left: 12, right: 12, zIndex: 100 },
  mentionDropdown: { backgroundColor: '#FFF', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: '#E8E8E8', marginBottom: 6, overflow: 'hidden' },
  mentionRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F5F5F5' },
  mAvatar: { width: 34, height: 34, borderRadius: 17 },
  mAvatarFb: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  mAvatarTxt: { fontSize: 12, fontWeight: '700', color: '#1D4ED8' },
  mName: { fontSize: 14, fontWeight: '600', color: '#000000' },
  mUser: { fontSize: 12, color: '#8E8E93' },
  composerCard: { backgroundColor: '#FFF', borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: '#E8E8E8', padding: 16, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 6 }, elevation: 10 },
  cAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  cAvatar: { width: 36, height: 36, borderRadius: 18 },
  cAvatarFb: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  cAvatarTxt: { fontSize: 13, fontWeight: '700', color: '#1D4ED8' },
  cName: { fontSize: 14, fontWeight: '700', color: '#000000' },
  cInput: { minHeight: 80, maxHeight: 160, fontSize: 15, color: '#000000', textAlignVertical: 'top', lineHeight: 22, marginBottom: 8 },
  charCount: { fontSize: 12, color: '#FF3B30', textAlign: 'right', marginBottom: 4 },
  cMediaScroll: { marginBottom: 10 },
  cThumb: { width: 80, height: 80, borderRadius: 10, marginRight: 8, overflow: 'hidden' },
  cThumbImg: { width: '100%', height: '100%' },
  cVideoOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  cVideoPlayIcon: { fontSize: 22, color: '#FFF' },
  cRemove: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  cRemoveTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
  cAddMore: { width: 80, height: 80, borderRadius: 10, backgroundColor: '#F5F5F5', borderWidth: 1.5, borderColor: '#E8E8E8', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  cAddMoreTxt: { fontSize: 28, color: '#C7C7CC', fontWeight: '300' },
  cToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  cToolbarLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cToolbarRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toolBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F5F5F5', borderWidth: StyleSheet.hairlineWidth, borderColor: '#E8E8E8', alignItems: 'center', justifyContent: 'center' },
  mediaCount: { fontSize: 12, color: '#8E8E93', fontWeight: '600' },
  cancelBtn: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  cancelTxt: { color: '#3C3C43', fontSize: 14, fontWeight: '500' },
  postBtn: { backgroundColor: '#000000', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 9, minWidth: 64, alignItems: 'center' },
  postBtnOff: { opacity: 0.3 },
  postBtnTxt: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  fab: { position: 'absolute', right: 18, width: 54, height: 54, borderRadius: 27, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  fabTxt: { color: '#FFF', fontSize: 26, fontWeight: '300', lineHeight: 30 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 60 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#000000', textAlign: 'center' },
  emptySub: { marginTop: 8, fontSize: 14, lineHeight: 20, color: '#8E8E93', textAlign: 'center' },
  emptyBtn: { marginTop: 20, backgroundColor: '#000000', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  emptyBtnTxt: { color: '#FFF', fontSize: 15, fontWeight: '600' },

  // Post options menu sheet
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    paddingBottom: 32,
    paddingHorizontal: 16,
  },
  menuHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#E0E0E0',
    alignSelf: 'center', marginBottom: 14,
  },
  menuPreview: {
    fontSize: 14, color: '#8E8E93', lineHeight: 20,
    marginBottom: 12, paddingHorizontal: 4,
  },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#F0F0F0', marginBottom: 8 },
  menuOption: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 16, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F5F5F5',
  },
  menuOptionTxt: { fontSize: 16, color: '#000000', fontWeight: '400' },
  menuCancel: {
    justifyContent: 'center', marginTop: 8,
    borderBottomWidth: 0,
  },
  menuCancelTxt: { fontSize: 16, color: '#8E8E93', fontWeight: '500', textAlign: 'center', width: '100%' },
});