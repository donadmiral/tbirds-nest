import TrendingList from '../../components/TrendingList';
import * as FileSystem from 'expo-file-system/legacy';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  StatusBar, RefreshControl, Share, Alert, TextInput, Image,
  KeyboardAvoidingView, Platform, Keyboard, ScrollView, Dimensions, Modal,
  Animated,
  PanResponder,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { Feather } from '@expo/vector-icons';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import StoryBar from '../../components/stories/StoryStrip';
import { handleTabBarScroll } from '../../components/AdaptiveTabBar';
import TrendingTopicsStrip from '../../components/TrendingTopicsStrip';
import BuiltInZimbabweStrip from '../../components/BuiltInZimbabweStrip';
import PostCarousel, { CarouselMedia } from '../../components/PostCarousel';
import ImageView from 'react-native-image-viewing';
import { Video as AVVideo, ResizeMode as AVResizeMode } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FeedSkeleton } from '../../components/Skeleton';

const SCREEN_W = Dimensions.get('window').width;
const NAVY = '#0B1E3D';

type MediaItem = { id: string; url: string; media_type: 'image' | 'video'; sort_order: number; width?: number | null; height?: number | null };
type Post = {
  id: string; user_id: string; content: string;
  likes_count: number; comments_count: number; reposts_count: number; bookmarks_count: number; views_count?: number;
  created_at?: string | null; media_url?: string | null; location?: string | null;
  channel?: string | null;
  quoted_post_id?: string | null;
  thread_parent_id?: string | null;
  media: MediaItem[]; score: number;
};
type ProfileLite = { id: string; full_name?: string | null; username?: string | null; avatar_url?: string | null };
type ProfileMap = Record<string, ProfileLite>;
type CommentPreview = { body: string; authorName: string; likes?: number };
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

function isVideoUrl(url: string): boolean {
  const clean = url.split('?')[0].split('#')[0].toLowerCase();
  return clean.endsWith('.mp4') || clean.endsWith('.mov') || clean.endsWith('.webm') || clean.endsWith('.quicktime');
}

function detectMediaType(asset: any): 'image' | 'video' {
  if (asset.type === 'video') return 'video';
  if (asset.type === 'image') return 'image';
  if (asset.mimeType && typeof asset.mimeType === 'string') {
    if (asset.mimeType.startsWith('video/')) return 'video';
    if (asset.mimeType.startsWith('image/')) return 'image';
  }
  if (asset.uri && typeof asset.uri === 'string') {
    if (isVideoUrl(asset.uri)) return 'video';
  }
  if (asset.duration && asset.duration > 0) return 'video';
  return 'image';
}

function safeExtFromUri(uri: string, fallback: string): string {
  try {
    const clean = uri.split('?')[0].split('#')[0];
    const ext = (clean.split('.').pop() || '').toLowerCase();
    if (ext && ext.length <= 5 && /^[a-z0-9]+$/.test(ext)) return ext;
  } catch {}
  return fallback;
}

function renderRichText(text: string, onHashtag: (t: string) => void, onMention: (u: string) => void) {
  return text.split(/([@#][\w.]+)/g).map((part, i) => {
    if (part.startsWith('#')) return <Text key={i} style={s.hashTag} onPress={() => onHashtag(part.slice(1))}>{part}</Text>;
    if (part.startsWith('@')) return <Text key={i} style={s.mention} onPress={() => onMention(part.slice(1))}>{part}</Text>;
    return <Text key={i}>{part}</Text>;
  });
}

export default function FeedScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;
  const isVerifiedSchoolUser = !!(profile as any)?.is_verified_school_user;

  const [posts, setPosts] = useState<Post[]>([]);
  const [profilesMap, setProfilesMap] = useState<ProfileMap>({});
  const [likedPosts, setLikedPosts] = useState<Record<string, boolean>>({});
  const [likerNames, setLikerNames] = useState<Record<string, string[]>>({});
  const [bookmarkedPosts, setBookmarkedPosts] = useState<Record<string, boolean>>({});
  const [repostedPosts, setRepostedPosts] = useState<Record<string, boolean>>({});
  const [commentPreviews, setCommentPreviews] = useState<Record<string, CommentPreview>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const hasMoreRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const [busyKeys, setBusyKeys] = useState<Record<string, boolean>>({});
  const [feedMode, setFeedMode] = useState<'forYou' | 'latest' | 'innovation' | 'trending'>('forYou');
  const mediaTouchRef = useRef(false);
  const hiddenIdsRef = useRef<Set<string>>(new Set());
  const feedModeRef = useRef(feedMode);
  feedModeRef.current = feedMode;
  const tabSwipe = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => !mediaTouchRef.current && Math.abs(g.dx) > 40 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
    onPanResponderRelease: (_e, g) => {
      const order = ['forYou', 'latest', 'innovation', 'trending'] as const;
      const i = order.indexOf(feedModeRef.current);
      if (g.dx < -40 && i < order.length - 1) { setFeedMode(order[i + 1]); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }
      else if (g.dx > 40 && i > 0) { setFeedMode(order[i - 1]); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }
    },
  })).current;
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [composerMedia, setComposerMedia] = useState<LocalMedia[]>([]);
  const [posting, setPosting] = useState(false);
  const [exclusivePost, setExclusivePost] = useState(false);
  const [innovationPost, setInnovationPost] = useState(false);
  const [mentionResults, setMentionResults] = useState<ProfileLite[]>([]);
  const [mentionActive, setMentionActive] = useState(false);
  const [sharingPost, setSharingPost] = useState<Record<string, boolean>>({});
  const [menuPost, setMenuPost] = useState<Post | null>(null);
  const [viewer, setViewer] = useState<{ images: { uri: string }[]; index: number } | null>(null);
  const [fsVideo, setFsVideo] = useState<{ url: string } | null>(null);
  useEffect(() => {
    AsyncStorage.getItem('pc_draft').then(v => {
      if (!v) return;
      try {
        const d = JSON.parse(v);
        if (d?.text) setComposerText(d.text);
        if (d?.exclusive) setExclusivePost(true);
        if (d?.innovation) setInnovationPost(true);
      } catch {}
    }).catch(() => {});
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      if (composerText.trim().length > 0) {
        AsyncStorage.setItem('pc_draft', JSON.stringify({ text: composerText, exclusive: exclusivePost, innovation: innovationPost })).catch(() => {});
      } else {
        AsyncStorage.removeItem('pc_draft').catch(() => {});
      }
    }, 400);
    return () => clearTimeout(t);
  }, [composerText, exclusivePost, innovationPost]);
  const [likersPost, setLikersPost] = useState<Post | null>(null);
  const [likersList, setLikersList] = useState<any[]>([]);
  const [wtfSuggestions, setWtfSuggestions] = useState<any[]>([]);
  const [sendPost, setSendPost] = useState<Post | null>(null);
  const [sendConvs, setSendConvs] = useState<any[]>([]);
  const [sendBusy, setSendBusy] = useState(false);
  const [quotingPost, setQuotingPost] = useState<Post | null>(null);
  const [threadingPost, setThreadingPost] = useState<Post | null>(null);
  const [quotedMap, setQuotedMap] = useState<Record<string, { content: string; user_id: string }>>({});
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [momentRefreshKey, setMomentRefreshKey] = useState(0);

  const realtimeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const likedPostsRef = useRef<Record<string, boolean>>({});
  const bookmarkedPostsRef = useRef<Record<string, boolean>>({});
  const repostedPostsRef = useRef<Record<string, boolean>>({});
  const commentPreviewsRef = useRef<Record<string, CommentPreview>>({});
  const sharingPostRef = useRef<Record<string, boolean>>({});
  const postsRef = useRef<Post[]>([]);
  const busyKeysRef = useRef<Record<string, boolean>>({});
  const composerRef    = useRef<TextInput>(null);
  const lastTapMap     = useRef<Record<string, number>>({});
  const singleTapTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [heartAnim]    = useState(() => new Animated.Value(0));
  const [heartPost,    setHeartPost]    = useState<string | null>(null);
  const [activePostId, setActivePostId]   = useState<string | null>(null);
  const [screenFocused, setScreenFocused] = useState(true);

  const loadFeedRef = useRef<(showLoader: boolean) => Promise<void>>(undefined);

  useEffect(() => {
    setScreenFocused(true);
    return () => {
      setScreenFocused(false);
      Keyboard.dismiss();
    };
  }, []);

  useEffect(() => {
    if (!userId) { setUnreadNotifs(0); return; }
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const loadUnread = async () => {
      const { count } = await supabase
        .from('notifications').select('id', { count: 'exact', head: true })
        .eq('recipient_id', userId).is('read_at', null);
      setUnreadNotifs(count || 0);
    };
    const debouncedLoad = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(loadUnread, 300);
    };
    loadUnread();
    const ch = supabase.channel(`feed_notif_badge_${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` }, debouncedLoad)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` }, debouncedLoad)
      .subscribe();
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(ch);
    };
  }, [userId]);

  useEffect(() => { postsRef.current = posts; }, [posts]);
  useEffect(() => { likedPostsRef.current = likedPosts; }, [likedPosts]);
  useEffect(() => { bookmarkedPostsRef.current = bookmarkedPosts; }, [bookmarkedPosts]);
  useEffect(() => { repostedPostsRef.current = repostedPosts; }, [repostedPosts]);
  useEffect(() => { commentPreviewsRef.current = commentPreviews; }, [commentPreviews]);
  useEffect(() => { sharingPostRef.current = sharingPost; }, [sharingPost]);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 55 }).current;

  const onViewableItemsChanged = useCallback(({ viewableItems }: any) => {
    const first = viewableItems.find((v: any) => v.isViewable);
    setActivePostId(first?.item?.id ?? null);
  }, []);

  const isBusy = (k: string) => !!busyKeysRef.current[k];
  const setBusy = (k: string, v: boolean) => {
    busyKeysRef.current[k] = v;
    setBusyKeys(p => { const n = { ...p }; if (v) n[k] = true; else delete n[k]; return n; });
  };

  const scheduleRefresh = useCallback(() => {
    if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
    realtimeTimerRef.current = setTimeout(() => {
      loadFeedRef.current?.(false);
    }, 2000);
  }, []);

  const loadFeed = useCallback(async (showLoader = false) => {
    try {
      if (showLoader) setLoading(true);
      let rawPosts: any[] | null = null;
      let queryError: any = null;

      const { data: d1, error: e1 } = await supabase
        .from('posts')
        .select('*, post_media(id, url, media_type, width, height, sort_order)')
        .order('created_at', { ascending: false })
        .limit(80);

      if (e1) {
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
        return;
      }
      if (!rawPosts) return;
      if (userId) {
        const { data: hid } = await supabase.from('hidden_posts').select('post_id').eq('user_id', userId);
        hiddenIdsRef.current = new Set((hid ?? []).map((h: any) => h.post_id));
      }
      rawPosts = (rawPosts as any[]).filter((row: any) => !hiddenIdsRef.current.has(row.id));

      const normalized = (rawPosts as any[]).map((row: any): Omit<Post, 'score'> => ({
        id: row.id, user_id: row.user_id, content: row.content ?? row.body ?? '',
        likes_count: row.likes_count ?? 0, comments_count: row.comments_count ?? 0, views_count: row.views_count ?? 0,
        reposts_count: row.reposts_count ?? 0, bookmarks_count: row.bookmarks_count ?? 0,
        created_at: row.created_at, media_url: row.media_url ?? null,
        location: row.location ?? null,
        channel: row.channel ?? null,
        quoted_post_id: row.quoted_post_id ?? null,
        thread_parent_id: row.thread_parent_id ?? null,
        media: Array.isArray(row.post_media)
          ? (row.post_media as PostMediaRow[]).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          : (Array.isArray(row.media) ? row.media : []),
      }));
      const scored = normalized.map(p => ({ ...p, score: scorePost(p) }));
      setPosts(scored);
      hasMoreRef.current = scored.length >= 80;
      const likerIds = scored.filter(p => p.likes_count > 0).map(p => p.id);
      if (likerIds.length > 0) supabase.rpc('get_recent_likers', { post_ids: likerIds }).then(({ data }) => { const m: Record<string, string[]> = {}; (data ?? []).forEach((r: any) => { m[r.post_id] = r.liker_names ?? []; }); setLikerNames(m); });
      const qIds = Array.from(new Set(scored.map(p => p.quoted_post_id).filter(Boolean))) as string[];
      let qRows: any[] = [];
      if (qIds.length > 0) {
        const { data: qData } = await supabase.from('posts').select('id, content, body, user_id, media_url, post_media(url, media_type, sort_order)').in('id', qIds);
        qRows = qData ?? [];
        const qm: Record<string, { content: string; user_id: string }> = {};
        qRows.forEach((qr: any) => { qm[qr.id] = { content: qr.content ?? qr.body ?? '', user_id: qr.user_id, media: (() => { const pm = Array.isArray(qr.post_media) ? [...qr.post_media].sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) : []; return pm[0] ? { url: pm[0].url, media_type: pm[0].media_type } : (qr.media_url ? { url: qr.media_url, media_type: 'image' } : null); })() }; });
        setQuotedMap(qm);
      }
      const uids = Array.from(new Set([...scored.map(p => p.user_id), ...qRows.map((qr: any) => qr.user_id)]));
      const { data: pData } = await supabase.from('profiles').select('id, full_name, username, avatar_url').in('id', uids);
      const pm: ProfileMap = {};
      (pData || []).forEach((p: any) => { pm[p.id] = p; });
      setProfilesMap(pm);
      if (userId) {
        supabase.from('profiles')
          .select('id, full_name, username, avatar_url, headline, connections_count')
          .neq('id', userId)
          .is('deactivated_at', null)
          .order('connections_count', { ascending: false, nullsFirst: false })
          .limit(15)
          .then(({ data: sug }) => { if (sug) setWtfSuggestions(sug); });
      }
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
          const { data: cData } = await supabase
            .from('post_comments')
            .select('post_id, body, user_id, parent_comment_id, created_at, likes_count')
            .in('post_id', ids)
            .order('created_at', { ascending: false });

          const countMap: Record<string, number> = {};
          (cData || []).forEach((c: any) => {
            countMap[c.post_id] = (countMap[c.post_id] || 0) + 1;
          });

          setPosts(prev => prev.map(post => ({
            ...post,
            comments_count: countMap[post.id] ?? post.comments_count ?? 0,
          })));

          const cpMap: Record<string, CommentPreview> = {};
          const topLevelComments = (cData || []).filter((c: any) => !c.parent_comment_id);
          const aIds = Array.from(new Set(topLevelComments.map((c: any) => c.user_id).filter(Boolean)));
          let authors: Record<string, any> = {};

          if (aIds.length > 0) {
            const { data: aData } = await supabase.from('profiles').select('id, full_name, username').in('id', aIds);
            (aData || []).forEach((a: any) => { authors[a.id] = a; });
          }

          topLevelComments.forEach((c: any) => {
            const cur = cpMap[c.post_id];
            if (!cur || (c.likes_count ?? 0) > (cur.likes ?? 0)) {
              const a = authors[c.user_id];
              cpMap[c.post_id] = { body: c.body, authorName: a?.full_name || a?.username || 'User', likes: c.likes_count ?? 0 };
            }
          });

          setCommentPreviews(cpMap);
        }
      }
    } catch (e) { console.log('LOAD_FEED', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [userId]);

  useEffect(() => {
    loadFeedRef.current = loadFeed;
  }, [loadFeed]);

  useEffect(() => {
    if (!userId) return;
    supabase.from('orbits').select('following_id').eq('follower_id', userId).limit(1000)
      .then(({ data }) => { if (data) setFollowingIds(new Set(data.map((r: any) => r.following_id))); });
  }, [userId]);

  useEffect(() => {
    loadFeed(true);

    const sortPosts = (items: Post[]) => {
      if (feedMode === 'latest' || feedMode === 'innovation') {
        return [...items].sort((a, b) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        );
      }
      return [...items].sort((a, b) => b.score - a.score);
    };

    const ch = supabase.channel('feed_live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, () => scheduleRefresh())
      .subscribe();

    const likeCh = supabase.channel('feed_likes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_likes' }, (payload) => {
        const row = payload.new as any;
        if (!row?.post_id) return;
        const wasAlreadyLikedHere = !!likedPostsRef.current[row.post_id];
        if (row.user_id === userId) {
          setLikedPosts(prev => ({ ...prev, [row.post_id]: true }));
        }
        setPosts(prev => sortPosts(prev.map(p => {
          if (p.id !== row.post_id) return p;
          const shouldIncrement = row.user_id !== userId || !wasAlreadyLikedHere;
          const next = { ...p, likes_count: shouldIncrement ? p.likes_count + 1 : p.likes_count };
          return { ...next, score: scorePost(next) };
        })));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'post_likes' }, (payload) => {
        const row = payload.old as any;
        if (!row?.post_id) return;
        const wasLikedHere = !!likedPostsRef.current[row.post_id];
        if (row.user_id === userId) {
          setLikedPosts(prev => ({ ...prev, [row.post_id]: false }));
        }
        setPosts(prev => sortPosts(prev.map(p => {
          if (p.id !== row.post_id) return p;
          const shouldDecrement = row.user_id !== userId || wasLikedHere;
          const next = { ...p, likes_count: shouldDecrement ? Math.max(0, p.likes_count - 1) : p.likes_count };
          return { ...next, score: scorePost(next) };
        })));
      })
      .subscribe();

    const commentCh = supabase.channel('feed_comments')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_comments' }, async (payload) => {
        const row = payload.new as any;
        if (!row?.post_id) return;
        setPosts(prev => sortPosts(prev.map(p => {
          if (p.id !== row.post_id) return p;
          const next = { ...p, comments_count: p.comments_count + 1 };
          return { ...next, score: scorePost(next) };
        })));
        if (!row.parent_comment_id) {
          let authorName = 'User';
          if (row.user_id) {
            const { data: author } = await supabase
              .from('profiles').select('full_name, username').eq('id', row.user_id).maybeSingle();
            authorName = author?.full_name || author?.username || 'User';
          }
          setCommentPreviews(prev => ({
            ...prev,
            [row.post_id]: { body: row.body || row.text || '', authorName },
          }));
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'post_comments' }, async (payload) => {
        const row = payload.old as any;
        if (!row?.post_id) return;
        setPosts(prev => sortPosts(prev.map(p => {
          if (p.id !== row.post_id) return p;
          const next = { ...p, comments_count: Math.max(0, p.comments_count - 1) };
          return { ...next, score: scorePost(next) };
        })));
        try {
          const { data: latestComment } = await supabase
            .from('post_comments')
            .select('body, user_id')
            .eq('post_id', row.post_id)
            .is('parent_comment_id', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (latestComment) {
            let aName = 'User';
            if (latestComment.user_id) {
              const { data: a } = await supabase.from('profiles').select('full_name, username').eq('id', latestComment.user_id).maybeSingle();
              aName = a?.full_name || a?.username || 'User';
            }
            setCommentPreviews(prev => ({ ...prev, [row.post_id]: { body: latestComment.body, authorName: aName } }));
          } else {
            setCommentPreviews(prev => { const n = { ...prev }; delete n[row.post_id]; return n; });
          }
        } catch {}
      })
      .subscribe();

    const postUpdateCh = supabase.channel('feed_post_updates')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, (payload) => {
        const row = payload.new as any;
        if (!row?.id) return;
        setPosts(prev => sortPosts(prev.map(p => {
          if (p.id !== row.id) return p;
          const next = {
            ...p,
            likes_count: row.likes_count ?? p.likes_count,
            comments_count: row.comments_count ?? p.comments_count,
            reposts_count: row.reposts_count ?? p.reposts_count,
            bookmarks_count: row.bookmarks_count ?? p.bookmarks_count,
            views_count: row.views_count ?? p.views_count,
          };
          return { ...next, score: scorePost(next) };
        })));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
      supabase.removeChannel(likeCh);
      supabase.removeChannel(commentCh);
      supabase.removeChannel(postUpdateCh);
      if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
    };
  }, [loadFeed, scheduleRefresh, userId, feedMode]);

  const toggleLike = useCallback(async (postId: string) => {
    if (!userId || isBusy(`like-${postId}`)) return;
    setBusy(`like-${postId}`, true);
    const was = !!likedPostsRef.current[postId];
    const optimisticDelta = was ? -1 : 1;
    setLikedPosts(prev => ({ ...prev, [postId]: !was }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPosts(prev => prev.map(post => {
      if (post.id !== postId) return post;
      const next = { ...post, likes_count: Math.max(0, post.likes_count + optimisticDelta) };
      return { ...next, score: scorePost(next) };
    }));
    try {
      const { data, error } = await supabase.rpc('toggle_post_like', { p_post_id: postId });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      const liked = !!result?.liked;
      const likesCount = Number(result?.likes_count ?? 0);
      setLikedPosts(prev => ({ ...prev, [postId]: liked }));
      setPosts(prev => prev.map(post => {
        if (post.id !== postId) return post;
        const next = { ...post, likes_count: Math.max(0, likesCount) };
        return { ...next, score: scorePost(next) };
      }));
    } catch (e: any) {
      console.log('[LIKE_TOGGLE_ERR]', e?.code, e?.message, e?.details, e?.hint);
      setLikedPosts(prev => ({ ...prev, [postId]: was }));
      setPosts(prev => prev.map(post => {
        if (post.id !== postId) return post;
        const next = { ...post, likes_count: Math.max(0, post.likes_count - optimisticDelta) };
        return { ...next, score: scorePost(next) };
      }));
      Alert.alert('Could not update like', 'Please try again.');
    } finally {
      setBusy(`like-${postId}`, false);
    }
  }, [userId]);

  const handleDoubleTap = useCallback((postId: string, onSingleTap: () => void) => {
    const now = Date.now();
    const last = lastTapMap.current[postId] || 0;
    if (now - last < 300) {
      if (singleTapTimers.current[postId]) {
        clearTimeout(singleTapTimers.current[postId]);
        delete singleTapTimers.current[postId];
      }
      if (!likedPostsRef.current[postId]) toggleLike(postId);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setHeartPost(postId);
      heartAnim.setValue(0);
      Animated.sequence([
        Animated.timing(heartAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.delay(420),
        Animated.timing(heartAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start(() => setHeartPost(null));
    } else {
      singleTapTimers.current[postId] = setTimeout(() => {
        delete singleTapTimers.current[postId];
        onSingleTap();
      }, 220);
    }
    lastTapMap.current[postId] = now;
  }, [toggleLike]);

  const toggleBookmark = useCallback(async (postId: string) => {
    if (!userId || isBusy(`bk-${postId}`)) return;
    setBusy(`bk-${postId}`, true);
    const was = !!bookmarkedPostsRef.current[postId];
    setBookmarkedPosts(p => ({ ...p, [postId]: !was }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (was) {
        const { error } = await supabase.from('post_bookmarks').delete().eq('post_id', postId).eq('user_id', userId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('post_bookmarks').insert({ post_id: postId, user_id: userId });
        if (error) throw error;
      }
    } catch {
      setBookmarkedPosts(p => ({ ...p, [postId]: was }));
    } finally {
      setBusy(`bk-${postId}`, false);
    }
  }, [userId]);

  const toggleRepost = useCallback(async (postId: string) => {
    if (!userId || isBusy(`rp-${postId}`)) return;
    setBusy(`rp-${postId}`, true);
    const was = !!repostedPostsRef.current[postId];
    setRepostedPosts(p => ({ ...p, [postId]: !was }));
    setPosts(p => p.map(x => x.id === postId ? { ...x, reposts_count: Math.max(0, x.reposts_count + (was ? -1 : 1)) } : x));
    try {
      if (was) {
        const { error } = await supabase.from('post_reposts').delete().eq('post_id', postId).eq('user_id', userId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('post_reposts').insert({ post_id: postId, user_id: userId });
        if (error) throw error;
      }
    } catch {
      setRepostedPosts(p => ({ ...p, [postId]: was }));
      setPosts(p => p.map(x => x.id === postId ? { ...x, reposts_count: Math.max(0, x.reposts_count + (was ? 1 : -1)) } : x));
    } finally {
      setBusy(`rp-${postId}`, false);
    }
  }, [userId]);

  const hidePost = useCallback(async (postId: string) => {
    hiddenIdsRef.current.add(postId);
    setPosts(prev => prev.filter(p => p.id !== postId));
    if (!userId) return;
    const { error } = await supabase.from('hidden_posts').insert({ user_id: userId, post_id: postId });
    if (error && error.code !== '23505') console.log('[HIDE_ERR]', error.message);
  }, [userId]);

  const reportPost = useCallback(async (postId: string, reason: string) => {
    if (!userId) return;
    const { error } = await supabase.from('post_reports').insert({ reporter_id: userId, post_id: postId, reason });
    if (error) { Alert.alert('Could not report', error.message); return; }
    hidePost(postId);
    Alert.alert('Reported', 'Thanks. This post has been hidden from your feed.');
  }, [userId, hidePost]);

  const openLikers = useCallback(async (post: Post) => {
    setLikersPost(post);
    setLikersList([]);
    const { data: lk } = await supabase.from('post_likes').select('user_id, created_at').eq('post_id', post.id).order('created_at', { ascending: false }).limit(100);
    const uids = Array.from(new Set((lk ?? []).map((r: any) => r.user_id)));
    if (uids.length === 0) return;
    const { data: profs } = await supabase.from('profiles').select('id, full_name, username, avatar_url').in('id', uids);
    const pm: Record<string, any> = {};
    (profs ?? []).forEach((p: any) => { pm[p.id] = p; });
    setLikersList(uids.map(u => pm[u]).filter(Boolean));
  }, []);

  const toggleFollow = useCallback(async (targetId: string) => {
    if (!userId || targetId === userId) return;
    const was = followingIds.has(targetId);
    setFollowingIds(prev => { const n = new Set(prev); if (was) n.delete(targetId); else n.add(targetId); return n; });
    try {
      if (was) {
        const { error } = await supabase.from('orbits').delete().eq('follower_id', userId).eq('following_id', targetId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('orbits').insert({ follower_id: userId, following_id: targetId });
        if (error && error.code !== '23505') throw error;
      }
    } catch (e: any) {
      setFollowingIds(prev => { const n = new Set(prev); if (was) n.add(targetId); else n.delete(targetId); return n; });
      Alert.alert('Could not update follow', e?.message || 'Try again.');
    }
  }, [userId, followingIds]);

  const openSendSheet = useCallback(async (post: Post) => {
    if (!userId) return;
    setSendPost(post);
    setSendConvs([]);
    const { data: convs } = await supabase.from('conversations')
      .select('id, user_1, user_2, last_message_time')
      .eq('type', 'direct')
      .or(`user_1.eq.${userId},user_2.eq.${userId}`)
      .order('last_message_time', { ascending: false })
      .limit(12);
    const rows = convs ?? [];
    const otherIds = Array.from(new Set(rows.map((c: any) => (c.user_1 === userId ? c.user_2 : c.user_1)).filter(Boolean)));
    const pm: Record<string, any> = {};
    if (otherIds.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name, username, avatar_url').in('id', otherIds);
      (profs ?? []).forEach((p: any) => { pm[p.id] = p; });
    }
    setSendConvs(rows.map((c: any) => { const oid = c.user_1 === userId ? c.user_2 : c.user_1; return { ...c, other: pm[oid] ?? null, otherId: oid }; }));
  }, [userId]);

  const sendPostTo = useCallback(async (conv: any) => {
    if (!userId || !sendPost || sendBusy) return;
    setSendBusy(true);
    try {
      const { error } = await supabase.from('messages').insert({
        conversation_id: conv.id, sender_id: userId, receiver_id: conv.otherId ?? null,
        text: null, shared_post_id: sendPost.id,
      });
      if (error) throw error;
      await supabase.from('conversations').update({ last_message: 'Shared a post', last_message_time: new Date().toISOString(), last_message_sender_id: userId }).eq('id', conv.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSendPost(null);
    } catch (e: any) {
      Alert.alert('Could not send', e?.message || 'Try again.');
    } finally {
      setSendBusy(false);
    }
  }, [userId, sendPost, sendBusy]);

  const sharePost = useCallback(async (post: Post) => {
    if (sharingPostRef.current[post.id]) return;
    setSharingPost(p => ({ ...p, [post.id]: true }));
    const author = profilesMap[post.user_id];
    try {
      await Share.share({ message: `${author?.full_name || 'Someone'} on Platinum Circles:\n\n${post.content}\n\nOpen in the app: platinum-circles://post/${post.id}` });
    } catch {}
    setTimeout(() => setSharingPost(p => { const n = { ...p }; delete n[post.id]; return n; }), 600);
  }, [profilesMap]);

  const pickMedia = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission required'); return; }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'] as ImagePicker.MediaType[],
        allowsMultipleSelection: true,
        selectionLimit: 10,
        quality: 1,
        allowsEditing: false,
        exif: false,
      });
      if (result.canceled || !result.assets?.length) return;

      const picked: LocalMedia[] = [];
      for (const a of result.assets) {
        try {
          const mediaType = detectMediaType(a);
          const isVideo = mediaType === 'video';
          const rawExt = safeExtFromUri(a.uri, isVideo ? 'mp4' : 'jpg');
          const ext = isVideo ? (['mov', 'mp4', 'webm'].includes(rawExt) ? rawExt : 'mp4') : rawExt;
          const fileSize = (a as any).fileSize ?? undefined;

          let thumbnail: string | undefined;
          if (isVideo) {
            try {
              const thumbResult = await VideoThumbnails.getThumbnailAsync(a.uri, { time: 0, quality: 0.7 });
              thumbnail = thumbResult.uri;
            } catch (thumbErr: any) {
              console.log('[THUMB_ERR]', thumbErr?.message || thumbErr);
            }
          }

          picked.push({ uri: a.uri, type: mediaType, ext, width: a.width ?? undefined, height: a.height ?? undefined, fileSize, thumbnail });
        } catch (assetErr: any) {
          console.log('[PICK_ASSET_ERR]', assetErr?.message || assetErr);
        }
      }

      if (picked.length > 0) {
        setComposerMedia(p => [...p, ...picked].slice(0, 10));
      }
    } catch (outerErr: any) {
      const msg = outerErr?.message || String(outerErr);
      if (msg.includes('3164') || msg.includes('PHPhotos')) {
        Alert.alert('Video not available', 'This video may be stored in iCloud and not downloaded to your device. Open Photos, wait for the video to fully download, then try again.');
      } else {
        Alert.alert('Could not pick media', msg || 'Please try again.');
      }
    }
  };

  const openCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission required'); return; }
    try {
      const result = await ImagePicker.launchCameraAsync({
        quality: 1,
        mediaTypes: ['images', 'videos'] as ImagePicker.MediaType[],
        allowsEditing: false,
      });
      if (!result.canceled && result.assets?.[0]) {
        const a = result.assets[0];
        const mediaType = detectMediaType(a);
        const isVideo = mediaType === 'video';
        const rawExt = safeExtFromUri(a.uri, isVideo ? 'mp4' : 'jpg');
        const ext = isVideo ? (['mov', 'mp4', 'webm'].includes(rawExt) ? rawExt : 'mp4') : rawExt;

        let thumbnail: string | undefined;
        if (isVideo) {
          try {
            const thumbResult = await VideoThumbnails.getThumbnailAsync(a.uri, { time: 0, quality: 0.7 });
            thumbnail = thumbResult.uri;
          } catch (e) {
            console.log('[CAMERA_THUMB_ERR]', e);
          }
        }

        setComposerMedia(p => [...p, { uri: a.uri, type: mediaType, ext, width: a.width ?? undefined, height: a.height ?? undefined, thumbnail }]);
      }
    } catch (e: any) {
      console.log('[CAMERA_ERR]', e?.message || e);
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
      const uploadedMedia: { url: string; media_type: 'image' | 'video'; width?: number; height?: number; sort_order: number }[] = [];
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
      const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token || supabaseKey;

      let uploadFailed = false;

      for (let i = 0; i < composerMedia.length; i++) {
        const m = composerMedia[i];
        try {
          const isVideo = m.type === 'video';
          const rawExt = safeExtFromUri(m.uri, isVideo ? 'mp4' : 'jpg');
          let mimeType: string;
          let ext: string;
          if (isVideo) {
            if (rawExt === 'mov') { mimeType = 'video/quicktime'; ext = 'mov'; }
            else if (rawExt === 'webm') { mimeType = 'video/webm'; ext = 'webm'; }
            else { mimeType = 'video/mp4'; ext = 'mp4'; }
          } else {
            if (rawExt === 'png') { mimeType = 'image/png'; ext = 'png'; }
            else if (rawExt === 'webp') { mimeType = 'image/webp'; ext = 'webp'; }
            else if (rawExt === 'heic') { mimeType = 'image/heic'; ext = 'heic'; }
            else { mimeType = 'image/jpeg'; ext = 'jpg'; }
          }

          const fileName = `${userId}/${Date.now()}_${i}.${ext}`;
          const formData = new FormData();
          formData.append('file', { uri: m.uri, type: mimeType, name: `media_${i}.${ext}` } as any);

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 120000);

          const uploadRes = await fetch(
            `${supabaseUrl}/storage/v1/object/post-media/${fileName}`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey, 'x-upsert': 'true' },
              body: formData,
              signal: controller.signal,
            }
          );

          clearTimeout(timeoutId);

          if (!uploadRes.ok) {
            const errText = await uploadRes.text().catch(() => '');
            throw new Error(`Upload failed: ${uploadRes.status} ${errText}`);
          }

          const publicUrl = `${supabaseUrl}/storage/v1/object/public/post-media/${fileName}`;
          uploadedMedia.push({ url: publicUrl, media_type: isVideo ? 'video' : 'image', width: m.width, height: m.height, sort_order: i });
          if (i === 0) mediaUrl = publicUrl;

        } catch (e: any) {
          uploadFailed = true;
          Alert.alert('Upload failed', `Media #${i + 1} failed: ${e?.message || 'Unknown error'}. Post was not created.`);
          break;
        }
      }

      if (uploadFailed) {
        setPosting(false);
        return;
      }

      const hasText = !!(composerText.trim());
      const hasMedia = uploadedMedia.length > 0;

      if (!hasText && !hasMedia) {
        Alert.alert('Nothing to post', 'Add some text or media before posting.');
        setPosting(false);
        return;
      }

      const insertData: any = {
        user_id: userId,
        content: composerText.trim() || null,
        is_exclusive: exclusivePost,
        channel: innovationPost ? 'innovation' : null,
        ...(quotingPost ? { quoted_post_id: quotingPost.id } : {}),
        ...(threadingPost ? { thread_parent_id: threadingPost.id } : {}),
      };
      if (mediaUrl) insertData.media_url = mediaUrl;

      const { data: newPost, error } = await supabase
        .from('posts').insert(insertData).select('id').single();
      if (error) {
        Alert.alert('Post failed', error.message);
        return;
      }

      if (newPost?.id && uploadedMedia.length > 0) {
        try {
          const mediaRows = uploadedMedia.map(m => ({
            post_id: newPost.id,
            url: m.url,
            media_type: m.media_type,
            sort_order: m.sort_order,
            ...(m.width  != null ? { width:  m.width  } : {}),
            ...(m.height != null ? { height: m.height } : {}),
          }));
          const { error: mErr } = await supabase.from('post_media').insert(mediaRows);
          if (mErr) {
            Alert.alert('Warning', 'Post created but media metadata failed to save. Media may not display correctly.');
          }
        } catch (e: any) {
          console.log('[POST] post_media insert exception:', e?.message);
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setComposerOpen(false);
      setComposerText('');
      setComposerMedia([]);
      setExclusivePost(false);
      setInnovationPost(false);
      setQuotingPost(null);
      setThreadingPost(null);
      Keyboard.dismiss();
      setTimeout(() => loadFeed(false), 300);
    } catch (e: any) {
      Alert.alert('Error', 'Could not post. Check your connection and try again.');
    } finally {
      setPosting(false);
    }
  };

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current || posts.length === 0) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const oldest = posts.reduce((m, p) => (p.created_at && (!m || p.created_at < m) ? p.created_at : m), null as string | null);
      if (!oldest) { hasMoreRef.current = false; return; }
      const { data: d1, error: e1 } = await supabase
        .from('posts')
        .select('*, post_media(id, url, media_type, width, height, sort_order)')
        .lt('created_at', oldest)
        .order('created_at', { ascending: false })
        .limit(30);
      if (e1 || !d1) return;
      if (d1.length < 30) hasMoreRef.current = false;
      const existing = new Set(posts.map(p => p.id));
      const freshRows = (d1 as any[]).filter((row: any) => !existing.has(row.id) && !hiddenIdsRef.current.has(row.id));
      if (freshRows.length === 0) return;
      const normalized = freshRows.map((row: any): Omit<Post, 'score'> => ({
        id: row.id, user_id: row.user_id, content: row.content ?? row.body ?? '',
        likes_count: row.likes_count ?? 0, comments_count: row.comments_count ?? 0, views_count: row.views_count ?? 0,
        reposts_count: row.reposts_count ?? 0, bookmarks_count: row.bookmarks_count ?? 0,
        created_at: row.created_at, media_url: row.media_url ?? null,
        location: row.location ?? null,
        channel: row.channel ?? null,
        quoted_post_id: row.quoted_post_id ?? null,
        thread_parent_id: row.thread_parent_id ?? null,
        media: Array.isArray(row.post_media)
          ? (row.post_media as PostMediaRow[]).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          : [],
      }));
      const scored = normalized.map(p => ({ ...p, score: scorePost(p) }));
      setPosts(prev => [...prev, ...scored.filter(p => !prev.some(x => x.id === p.id))]);
      const ids = scored.map(p => p.id);
      const likerIds2 = scored.filter(p => p.likes_count > 0).map(p => p.id);
      if (likerIds2.length > 0) supabase.rpc('get_recent_likers', { post_ids: likerIds2 }).then(({ data }) => { if (data) setLikerNames(prev => { const m = { ...prev }; (data ?? []).forEach((r: any) => { m[r.post_id] = r.liker_names ?? []; }); return m; }); });
      const qIds2 = Array.from(new Set(scored.map(p => p.quoted_post_id).filter(Boolean))) as string[];
      let qRows2: any[] = [];
      if (qIds2.length > 0) {
        const { data: qData } = await supabase.from('posts').select('id, content, body, user_id, media_url, post_media(url, media_type, sort_order)').in('id', qIds2);
        qRows2 = qData ?? [];
        setQuotedMap(prev => { const qm = { ...prev }; qRows2.forEach((qr: any) => { qm[qr.id] = { content: qr.content ?? qr.body ?? '', user_id: qr.user_id, media: (() => { const pm = Array.isArray(qr.post_media) ? [...qr.post_media].sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) : []; return pm[0] ? { url: pm[0].url, media_type: pm[0].media_type } : (qr.media_url ? { url: qr.media_url, media_type: 'image' } : null); })() }; }); return qm; });
      }
      const uids2 = Array.from(new Set([...scored.map(p => p.user_id), ...qRows2.map((qr: any) => qr.user_id)]));
      const missingU = uids2.filter(u => !profilesMap[u]);
      if (missingU.length > 0) {
        const { data: pData } = await supabase.from('profiles').select('id, full_name, username, avatar_url').in('id', missingU);
        if (pData) setProfilesMap(prev => { const pm = { ...prev }; pData.forEach((p: any) => { pm[p.id] = p; }); return pm; });
      }
      if (userId && ids.length > 0) {
        const [{ data: likes }, { data: bookmarks }, { data: reposts }] = await Promise.all([
          supabase.from('post_likes').select('post_id').eq('user_id', userId).in('post_id', ids),
          supabase.from('post_bookmarks').select('post_id').eq('user_id', userId).in('post_id', ids),
          supabase.from('post_reposts').select('post_id').eq('user_id', userId).in('post_id', ids),
        ]);
        setLikedPosts(prev => { const m = { ...prev }; (likes ?? []).forEach((r: any) => { m[r.post_id] = true; }); return m; });
        setBookmarkedPosts(prev => { const m = { ...prev }; (bookmarks ?? []).forEach((r: any) => { m[r.post_id] = true; }); return m; });
        setRepostedPosts(prev => { const m = { ...prev }; (reposts ?? []).forEach((r: any) => { m[r.post_id] = true; }); return m; });
      }
      const { data: cData } = await supabase.from('post_comments')
        .select('post_id, body, user_id, parent_comment_id, created_at, likes_count')
        .in('post_id', ids)
        .order('created_at', { ascending: false });
      if (cData && cData.length > 0) {
        const countMap: Record<string, number> = {};
        cData.forEach((c: any) => { countMap[c.post_id] = (countMap[c.post_id] || 0) + 1; });
        setPosts(prev => prev.map(post => countMap[post.id] != null ? { ...post, comments_count: countMap[post.id] } : post));
        const topC = cData.filter((c: any) => !c.parent_comment_id);
        const aIds2 = Array.from(new Set(topC.map((c: any) => c.user_id).filter(Boolean)));
        const authors2: Record<string, any> = {};
        if (aIds2.length > 0) {
          const { data: aData } = await supabase.from('profiles').select('id, full_name, username').in('id', aIds2);
          (aData ?? []).forEach((a: any) => { authors2[a.id] = a; });
        }
        setCommentPreviews(prev => { const cp = { ...prev }; topC.forEach((c: any) => { const cur = cp[c.post_id]; if (!cur || (c.likes_count ?? 0) > (cur.likes ?? 0)) { const a = authors2[c.user_id]; cp[c.post_id] = { body: c.body, authorName: a?.full_name || a?.username || 'User', likes: c.likes_count ?? 0 }; } }); return cp; });
      }
    } catch (e) { console.log('[LOAD_MORE_ERR]', e); }
    finally { loadingMoreRef.current = false; setLoadingMore(false); }
  }, [posts, userId, profilesMap]);

  const displayPosts = useMemo(() => {
    let list = [...posts];
    if (feedMode === 'innovation') list = list.filter(p => p.channel === 'innovation');
    const term = search.trim().toLowerCase();
    if (term) list = list.filter(p => (p.content || '').toLowerCase().includes(term));
    if (feedMode === 'forYou') {
      const boost = (p: Post) => p.score + (followingIds.has(p.user_id) ? 500 : 0);
      list.sort((a, b) => boost(b) - boost(a));
    } else {
      list.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    }
    const wtfVisible = wtfSuggestions.filter((p: any) => !followingIds.has(p.id));
    if (!search && wtfVisible.length >= 3 && list.length > 8) {
      list = [...list.slice(0, 8), { id: '__wtf', __suggestions: true } as any, ...list.slice(8)];
    }
    return list;
  }, [posts, feedMode, search, followingIds, wtfSuggestions]);

  const renderMedia = useCallback((post: any, isActive: boolean, onMediaPress?: () => void) => {
    const mediaItems: CarouselMedia[] = Array.isArray(post.media) && post.media.length > 0
      ? post.media
      : (post.media_url ? [{
          id: '0',
          url: post.media_url,
          media_type: isVideoUrl(post.media_url) ? 'video' as const : 'image' as const,
          sort_order: 0,
        }] : []);
    if (mediaItems.length === 0) return null;

    return (
      <PostCarousel
        media={mediaItems}
        containerWidth={SCREEN_W}
        isActive={isActive}
        onMediaPress={onMediaPress}
      />

    );
  }, []);

  const openHashtag = useCallback((tag: string) => {
    navigation.navigate('TrendFeed', { tag });
  }, [navigation]);

  const openMention = useCallback(async (uname: string) => {
    const { data } = await supabase.from('profiles').select('id, full_name, username, avatar_url').eq('username', uname).maybeSingle();
    if (data?.id) navigation.navigate('UserProfile', { userId: data.id, user: data });
  }, [navigation]);

  const renderPost = useCallback(({ item: post }: { item: Post }) => {
    if ((post as any).__suggestions) {
      const vis = wtfSuggestions.filter((p: any) => !followingIds.has(p.id)).slice(0, 8);
      if (vis.length === 0) return <View />;
      return (
        <View style={{ paddingTop: 12, paddingBottom: 14, borderBottomWidth: 6, borderBottomColor: '#F2F3F5', backgroundColor: '#FFFFFF' }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#0A0A0A', paddingHorizontal: 16, marginBottom: 10, letterSpacing: -0.1 }}>Who to follow</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }} onTouchStart={() => { mediaTouchRef.current = true; }} onTouchEnd={() => { mediaTouchRef.current = false; }} onTouchCancel={() => { mediaTouchRef.current = false; }}>
            {vis.map((p: any) => (
              <View key={p.id} style={{ width: 148, borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E7EB', borderRadius: 14, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 10, backgroundColor: '#FFFFFF' }}>
                <TouchableOpacity activeOpacity={0.8} style={{ alignItems: 'center' }} onPress={() => navigation.navigate('UserProfile', { userId: p.id, user: p })}>
                  {p.avatar_url ? <ExpoImage source={{ uri: p.avatar_url }} style={{ width: 56, height: 56, borderRadius: 28 }} contentFit="cover" /> : <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 18, fontWeight: '700', color: '#1D4ED8' }}>{initials(p.full_name || p.username)}</Text></View>}
                  <Text style={{ fontSize: 13.5, fontWeight: '700', color: '#0A0A0A', marginTop: 8 }} numberOfLines={1}>{p.full_name || p.username || 'Member'}</Text>
                  <Text style={{ fontSize: 11.5, color: '#8E8E93', marginTop: 2 }} numberOfLines={1}>{p.headline || (p.username ? '@' + p.username : '')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => toggleFollow(p.id)} activeOpacity={0.8} style={{ marginTop: 10, paddingHorizontal: 22, paddingVertical: 7, borderRadius: 16, backgroundColor: NAVY }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#FFFFFF' }}>Follow</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>
      );
    }
    const author = profilesMap[post.user_id];
    const isLiked = !!likedPostsRef.current[post.id];
    const isBookmarked = !!bookmarkedPostsRef.current[post.id];
    const isReposted = !!repostedPostsRef.current[post.id];
    const preview = commentPreviewsRef.current[post.id];
    const isSharing = !!sharingPostRef.current[post.id];
    const openPost = () => { if (!isSharing) navigation.navigate('Post', { postId: post.id }); };

    return (
      <View style={s.postCard}>
        <View style={s.postTopRow}>
          <TouchableOpacity style={s.postMeta} onPress={() => navigation.navigate('UserProfile', { userId: post.user_id, user: author })} activeOpacity={0.8}>
            {author?.avatar_url ? <ExpoImage source={{ uri: author.avatar_url }} style={s.avatar} contentFit="cover" cachePolicy="memory-disk" transition={150} /> : <View style={s.avatarFb}><Text style={s.avatarFbTxt}>{initials(author?.full_name || author?.username)}</Text></View>}
            <View style={s.postMetaTxt}>
              <Text style={s.postAuthor} numberOfLines={1}>{author?.full_name || 'Member'}</Text>
              <Text style={s.postSub}>{author?.username ? `@${author.username}` : ''}{author?.username && post.created_at ? ' · ' : ''}{relTime(post.created_at)}{post.channel === 'innovation' && <Text style={{ color: '#D97706', fontWeight: '700' }}> · Innovation</Text>}</Text>
            </View>
          </TouchableOpacity>
          {userId && post.user_id !== userId && !followingIds.has(post.user_id) && (
            <TouchableOpacity onPress={() => toggleFollow(post.user_id)} activeOpacity={0.8} style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: NAVY, marginRight: 6 }}>
              <Text style={{ fontSize: 12.5, fontWeight: '600', color: NAVY }}>Follow</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.menuBtn} onPress={() => setMenuPost(post)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="more-horizontal" size={18} color="#8E8E93" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity activeOpacity={0.95} onPress={() => handleDoubleTap(post.id, openPost)}>
          <Text style={s.content}>{renderRichText(post.content, openHashtag, openMention)}</Text>
        </TouchableOpacity>
        {(() => {
          const qid = post.quoted_post_id;
          if (!qid) return null;
          const q = quotedMap[qid];
          const qAuthor = q ? profilesMap[q.user_id] : undefined;
          return (
            <TouchableOpacity style={{ marginHorizontal: 16, marginTop: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: '#D1D5DB', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }} activeOpacity={0.85} onPress={() => navigation.navigate('Post', { postId: qid })}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#0A0A0A' }} numberOfLines={1}>{qAuthor?.full_name || qAuthor?.username || 'Post'}</Text>
                <Text style={{ fontSize: 13, color: '#374151', marginTop: 2 }} numberOfLines={2}>{q?.content || 'Tap to view'}</Text>
              </View>
              {(q as any)?.media?.url ? (
                (q as any).media.media_type === 'video' ? (
                  <View style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 13, color: '#FFFFFF', marginLeft: 2 }}>{'\u25B6'}</Text>
                  </View>
                ) : (
                  <ExpoImage source={{ uri: (q as any).media.url }} style={{ width: 64, height: 64, borderRadius: 8 }} contentFit="cover" />
                )
              ) : null}
            </TouchableOpacity>
          );
        })()}

        {(() => {
          const openViewer = (idx?: number) => {
            const items: any[] = (post.media && post.media.length > 0) ? post.media : (post.media_url ? [{ url: post.media_url, media_type: 'image' }] : []);
            const tappedItem = items[idx ?? 0];
            if (tappedItem && tappedItem.media_type === 'video') { setFsVideo({ url: tappedItem.url }); return; }
            const imgs = items.filter((m: any) => m.media_type === 'image').map((m: any) => ({ uri: m.url }));
            if (imgs.length === 0) { openPost(); return; }
            const tapped = items[idx ?? 0];
            const vIdx = tapped ? imgs.findIndex(i => i.uri === tapped.url) : 0;
            setViewer({ images: imgs, index: vIdx >= 0 ? vIdx : 0 });
          };
          const media = renderMedia(post, screenFocused && post.id === activePostId, (idx?: number) => handleDoubleTap(post.id, () => openViewer(idx)));
          if (!media) return null;
          const isVidPost = post.media?.some((m: any) => m.media_type === 'video') || false;
          return (
            <View style={{ position: 'relative' }}>
              <View
                onTouchStart={() => { mediaTouchRef.current = true; }}
                onTouchEnd={() => { mediaTouchRef.current = false; }}
                onTouchCancel={() => { mediaTouchRef.current = false; }}
              >
                {media}
              </View>

              {heartPost === post.id && (
                <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', opacity: heartAnim, transform: [{ scale: heartAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.3] }) }] }}>
                  <Text style={{ fontSize: 80 }}>❤️</Text>
                </Animated.View>
              )}
              {isVidPost && (post.views_count ?? 0) > 0 && (
                <View style={{ position:'absolute', bottom:10, left:10, flexDirection:'row', alignItems:'center', gap:4, backgroundColor:'rgba(0,0,0,0.55)', borderRadius:12, paddingHorizontal:8, paddingVertical:4 }}>
                  <Feather name="eye" size={11} color="#FFF" />
                  <Text style={{ color:'#FFF', fontSize:11, fontWeight:'600' }}>{fmtCount(post.views_count ?? 0)}</Text>
                </View>
              )}
            </View>
          );
        })()}

        {post.thread_parent_id && (
          <TouchableOpacity style={{ paddingHorizontal: 16, paddingTop: 8 }} onPress={openPost} activeOpacity={0.8}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: NAVY }}>Show this thread</Text>
          </TouchableOpacity>
        )}
        {(post.likes_count > 0 || post.comments_count > 0) && (
          <View style={s.metricsRow}>
            {post.likes_count > 0 && <Text style={s.metric}>{fmtCount(post.likes_count)} {post.likes_count === 1 ? 'like' : 'likes'}</Text>}
            {post.likes_count > 0 && post.comments_count > 0 && <Text style={s.metricDot}>·</Text>}
            {post.comments_count > 0 && <Text style={s.metric}>{fmtCount(post.comments_count)} {post.comments_count === 1 ? 'comment' : 'comments'}</Text>}
          </View>
        )}

        <View style={s.actions}>
          <TouchableOpacity style={[s.pill, isLiked && s.pillLiked]} onPress={() => toggleLike(post.id)} activeOpacity={0.75} disabled={isBusy(`like-${post.id}`)}>
            <Feather name="heart" size={14} color={isLiked ? '#E53935' : '#6B7280'} />
            <Text style={[s.pillTxt, isLiked && s.pillTxtLiked]}>{post.likes_count > 0 ? fmtCount(post.likes_count) : 'Like'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.pill} onPress={() => navigation.navigate('Post', { postId: post.id, focusComment: true })} activeOpacity={0.75} disabled={isSharing}>
            <Feather name="message-circle" size={14} color="#6B7280" />
            <Text style={s.pillTxt}>{post.comments_count > 0 ? fmtCount(post.comments_count) : 'Comment'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.pill, isReposted && s.pillReposted]} onPress={() => { if (isReposted) { toggleRepost(post.id); } else { Alert.alert('Repost this?', '', [{ text: 'Repost', onPress: () => toggleRepost(post.id) }, { text: 'Quote', onPress: () => { setQuotingPost(post); setComposerOpen(true); } }, { text: 'Cancel', style: 'cancel' }]); } }} activeOpacity={0.75} disabled={isBusy(`rp-${post.id}`)}>
            <Feather name="repeat" size={14} color={isReposted ? '#059669' : '#6B7280'} />
            <Text style={[s.pillTxt, isReposted && s.pillTxtReposted]}>{post.reposts_count > 0 ? fmtCount(post.reposts_count) : 'Repost'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.pill, s.pillIcon, isBookmarked && s.pillSaved]} onPress={() => toggleBookmark(post.id)} activeOpacity={0.75} disabled={isBusy(`bk-${post.id}`)}>
            <Feather name="bookmark" size={14} color={isBookmarked ? '#2563EB' : '#6B7280'} />
          </TouchableOpacity>

          <TouchableOpacity style={[s.pill, s.pillIcon]} onPress={() => { Alert.alert('Share post', '', [{ text: 'Send to...', onPress: () => openSendSheet(post) }, { text: 'Share via...', onPress: () => sharePost(post) }, { text: 'Cancel', style: 'cancel' }]); }} activeOpacity={0.75}>
            <Feather name="share-2" size={14} color="#6B7280" />
          </TouchableOpacity>
        </View>

        {post.likes_count > 0 && (
          <TouchableOpacity style={{ paddingHorizontal: 16, paddingTop: 4 }} onPress={() => openLikers(post)} activeOpacity={0.8}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#0A0A0A' }}>
              {(() => {
                const n = post.likes_count;
                const names = likerNames[post.id] ?? [];
                if (isLiked) return n === 1 ? 'Liked by you' : `Liked by you and ${n - 1} ${n === 2 ? 'other' : 'others'}`;
                if (names.length > 0) return n === 1 ? `Liked by ${names[0]}` : `Liked by ${names[0]} and ${n - 1} ${n === 2 ? 'other' : 'others'}`;
                return `${n} ${n === 1 ? 'like' : 'likes'}`;
              })()}
            </Text>
          </TouchableOpacity>
        )}

        {preview && (
          <TouchableOpacity style={s.cpWrap} onPress={openPost} activeOpacity={0.8}>
            <Text style={s.cpTxt} numberOfLines={2}>
              <Text style={s.cpAuthor}>{preview.authorName} </Text>{preview.body}{(preview.likes ?? 0) > 0 ? <Text style={{ color: '#8E8E93' }}>{'  ·  ' + fmtCount(preview.likes!) + ((preview.likes === 1) ? ' like' : ' likes')}</Text> : null}
            </Text>
            {post.comments_count > 1 && <Text style={s.viewAll}>View all {post.comments_count} comments</Text>}
          </TouchableOpacity>
        )}
      </View>
    );
  }, [
    profilesMap,
    likerNames,
    quotedMap,
    followingIds,
    wtfSuggestions,
    toggleFollow,
    heartPost,
    handleDoubleTap,
    renderMedia,
    toggleLike,
    toggleBookmark,
    toggleRepost,
    sharePost,
  ]);

  const flatListExtra = heartPost;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.container}>
          <View style={s.header}>
            <View style={s.headerRow}>
              <Text style={s.logo}>Platinum<Text style={{ color: '#8E9BAE' }}>Circles</Text></Text>
              <TouchableOpacity style={s.iconBtn} onPress={() => navigation.navigate('Notifications')}>
                <View>
                  <Feather name="bell" size={20} color="#000" />
                  {unreadNotifs > 0 && (
                    <View style={s.bellBadge}>
                      <Text style={s.bellBadgeTxt}>{unreadNotifs > 99 ? '99+' : unreadNotifs}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            </View>

            <View style={s.tabRow}>
              {(['forYou', 'latest', 'innovation', 'trending'] as const).map(m => {
                const on = feedMode === m;
                const label = m === 'forYou' ? 'For You' : m === 'latest' ? 'Latest' : m === 'innovation' ? 'Innovation' : 'Trending';
                const accent = m === 'innovation' ? '#D97706' : '#0B1E3D';
                return (
                  <TouchableOpacity key={m} style={{ alignItems: 'center', paddingVertical: 8, paddingHorizontal: 6, marginRight: 22 }} onPress={() => setFeedMode(m)} activeOpacity={0.7}>
                    <Text style={{ fontSize: 15, fontWeight: on ? '800' : '500', color: on ? '#0A0A0A' : '#A3A3A3', letterSpacing: -0.2 }}>{label}</Text>
                    <View style={{ height: 3, width: 20, borderRadius: 2, marginTop: 5, backgroundColor: on ? accent : 'transparent' }} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {feedMode === 'trending' ? (
            <TrendingList onOpenTag={(tag) => { setFeedMode('latest'); setSearch('#' + tag); }} />
          ) : loading ? (
            <FeedSkeleton />
          ) : (
            <View style={s.flex} {...tabSwipe.panHandlers}>
            <FlatList
              data={displayPosts}
              onScroll={handleTabBarScroll}
              scrollEventThrottle={16}
              keyExtractor={p => p.id}
              renderItem={renderPost}
              onEndReached={loadMore}
              onEndReachedThreshold={0.6}
              ListFooterComponent={loadingMore ? <View style={{ paddingVertical: 24 }}><ActivityIndicator color={NAVY} /></View> : null}

              extraData={flatListExtra}
              initialNumToRender={5}
              maxToRenderPerBatch={5}
              windowSize={5}
              removeClippedSubviews={Platform.OS === 'android'}
              showsVerticalScrollIndicator={false}
              decelerationRate={0.994}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="none"
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={viewabilityConfig}
              onScrollBeginDrag={() => {
                Object.keys(singleTapTimers.current).forEach(k => {
                  clearTimeout(singleTapTimers.current[k]);
                  delete singleTapTimers.current[k];
                });
              }}
              ListHeaderComponent={<><StoryBar /><TrendingTopicsStrip />{feedMode === 'innovation' && <BuiltInZimbabweStrip />}</>}
              contentContainerStyle={[s.list, !displayPosts.length && s.listEmpty, { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }]}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadFeed(false); setMomentRefreshKey(k => k + 1); }} tintColor={NAVY} />}
              ListEmptyComponent={
                <View style={s.emptyWrap}>
                  <Text style={s.emptyTitle}>{search ? 'No posts found' : 'Welcome to PlatinumCircles'}</Text>
                  <Text style={s.emptySub}>{search ? 'Try a different search.' : 'Be the first to share something.'}</Text>
                  {!search && <TouchableOpacity style={s.emptyBtn} onPress={() => setComposerOpen(true)}><Text style={s.emptyBtnTxt}>Create a post</Text></TouchableOpacity>}
                </View>
              }
            />
            </View>
          )}

          {composerOpen && (
            <KeyboardAvoidingView style={[s.composerContainer, { bottom: insets.bottom + 16 }]} behavior={Platform.OS === 'ios' ? 'position' : undefined}>
              {threadingPost && (
                <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderColor: '#E5E7EB', borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 6, gap: 6 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#374151' }}>Adding to your thread</Text>
                  <TouchableOpacity onPress={() => setThreadingPost(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Feather name="x" size={13} color="#6B7280" />
                  </TouchableOpacity>
                </View>
              )}
              {quotingPost && (
                <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderColor: '#E5E7EB', borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 6, gap: 6 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#374151' }}>Quoting {profilesMap[quotingPost.user_id]?.full_name || profilesMap[quotingPost.user_id]?.username || 'post'}</Text>
                  <TouchableOpacity onPress={() => setQuotingPost(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Feather name="x" size={13} color="#6B7280" />
                  </TouchableOpacity>
                </View>
              )}
              {mentionActive && mentionResults.length > 0 && (
                <View style={s.mentionDropdown}>
                  {mentionResults.map(u => (
                    <TouchableOpacity key={u.id} style={s.mentionRow} onPress={() => insertMention(u)}>
                      {u.avatar_url ? <Image source={{ uri: u.avatar_url }} style={s.mAvatar} fadeDuration={200} /> : <View style={s.mAvatarFb}><Text style={s.mAvatarTxt}>{initials(u.full_name || u.username)}</Text></View>}
                      <View><Text style={s.mName}>{u.full_name}</Text><Text style={s.mUser}>@{u.username}</Text></View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <View style={s.composerCard}>
                <View style={s.cAuthorRow}>
                  {profile?.avatar_url ? <Image source={{ uri: profile.avatar_url }} style={s.cAvatar} fadeDuration={200} /> : <View style={s.cAvatarFb}><Text style={s.cAvatarTxt}>{initials(profile?.full_name || profile?.username)}</Text></View>}
                  <Text style={s.cName}>{profile?.full_name || 'You'}</Text>
                </View>
                <TextInput ref={composerRef} style={s.cInput} value={composerText} onChangeText={handleComposerChange} placeholder="What's on your mind?" placeholderTextColor="#9CA3AF" multiline autoFocus maxLength={2000} />
                {composerText.length > 1800 && <Text style={s.charCount}>{2000 - composerText.length} left</Text>}
                {exclusivePost && (
                  <View style={s.exclusiveBanner}>
                    <Feather name="shield" size={13} color="#2563EB" />
                    <Text style={s.exclusiveBannerTxt}>Only verified members can see this post</Text>
                  </View>
                )}
                {innovationPost && (
                  <View style={[s.exclusiveBanner, { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }]}>
                    <Feather name="zap" size={13} color="#D97706" />
                    <Text style={[s.exclusiveBannerTxt, { color: '#B45309' }]}>Posting to Innovation — showcasing what Zimbabwe is building</Text>
                  </View>
                )}
                {composerMedia.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.cMediaScroll} keyboardShouldPersistTaps="handled">
                    {composerMedia.map((m, i) => (
                      <View key={i} style={s.cThumb}>
                        <Image source={{ uri: m.type === 'video' ? (m.thumbnail || m.uri) : m.uri }} style={s.cThumbImg} resizeMode="cover" />
                        {m.type === 'video' && (
                          <View style={s.cVideoOverlay}><Text style={s.cVideoPlayIcon}>▶</Text></View>
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
                    <TouchableOpacity style={[s.toolBtn, innovationPost && s.toolBtnActive]} onPress={() => setInnovationPost(p => !p)}><Feather name="zap" size={20} color={innovationPost ? '#D97706' : '#6B7280'} /></TouchableOpacity>
                    {isVerifiedSchoolUser && (
                      <TouchableOpacity style={[s.toolBtn, exclusivePost && s.toolBtnActive]} onPress={() => setExclusivePost(p => !p)}>
                        <Feather name="shield" size={20} color={exclusivePost ? '#2563EB' : '#6B7280'} />
                      </TouchableOpacity>
                    )}
                    {composerMedia.length > 0 && <Text style={s.mediaCount}>{composerMedia.length}/10</Text>}
                  </View>
                  <View style={s.cToolbarRight}>
                    <TouchableOpacity onPress={() => { setComposerOpen(false); setComposerMedia([]); setQuotingPost(null); setThreadingPost(null); setMentionActive(false); Keyboard.dismiss(); }} style={s.cancelBtn}><Text style={s.cancelTxt}>Cancel</Text></TouchableOpacity>
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

      <Modal visible={!!likersPost} transparent animationType="slide" onRequestClose={() => setLikersPost(null)}>
        <TouchableOpacity style={s.menuOverlay} activeOpacity={1} onPress={() => setLikersPost(null)}>
          <TouchableOpacity activeOpacity={1} style={s.menuSheet}>
            <View style={s.menuHandle} />
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#0A0A0A', paddingHorizontal: 16, paddingBottom: 8 }}>Likes</Text>
            {likersList.length === 0 && <Text style={{ fontSize: 13, color: '#8E8E93', paddingHorizontal: 16, paddingBottom: 16 }}>Loading...</Text>}
            <ScrollView style={{ maxHeight: 380 }}>
              {likersList.map((p: any) => (
                <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 9, gap: 12 }}>
                  <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }} activeOpacity={0.8} onPress={() => { setLikersPost(null); navigation.navigate('UserProfile', { userId: p.id, user: p }); }}>
                    {p.avatar_url ? <ExpoImage source={{ uri: p.avatar_url }} style={{ width: 40, height: 40, borderRadius: 20 }} contentFit="cover" /> : <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontWeight: '700', color: '#1D4ED8' }}>{initials(p.full_name || p.username)}</Text></View>}
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: '#0A0A0A' }} numberOfLines={1}>{p.full_name || p.username || 'Member'}</Text>
                      {p.username ? <Text style={{ fontSize: 12, color: '#8E8E93' }} numberOfLines={1}>@{p.username}</Text> : null}
                    </View>
                  </TouchableOpacity>
                  {userId && p.id !== userId && (
                    <TouchableOpacity onPress={() => toggleFollow(p.id)} activeOpacity={0.8} style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: 16, backgroundColor: followingIds.has(p.id) ? '#F5F5F5' : NAVY }}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: followingIds.has(p.id) ? '#3C3C43' : '#FFFFFF' }}>{followingIds.has(p.id) ? 'Following' : 'Follow'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!sendPost} transparent animationType="slide" onRequestClose={() => setSendPost(null)}>
        <TouchableOpacity style={s.menuOverlay} activeOpacity={1} onPress={() => setSendPost(null)}>
          <TouchableOpacity activeOpacity={1} style={s.menuSheet}>
            <View style={s.menuHandle} />
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#0A0A0A', paddingHorizontal: 16, paddingBottom: 8 }}>Send to</Text>
            {sendConvs.length === 0 && <Text style={{ fontSize: 13, color: '#8E8E93', paddingHorizontal: 16, paddingBottom: 16 }}>No conversations yet. Start one from Messages first.</Text>}
            <ScrollView style={{ maxHeight: 320 }}>
              {sendConvs.map((c: any) => (
                <TouchableOpacity key={c.id} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12 }} activeOpacity={0.8} onPress={() => sendPostTo(c)} disabled={sendBusy}>
                  {c.other?.avatar_url ? <ExpoImage source={{ uri: c.other.avatar_url }} style={{ width: 40, height: 40, borderRadius: 20 }} contentFit="cover" /> : <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontWeight: '700', color: '#6B7280' }}>{initials(c.other?.full_name || c.other?.username)}</Text></View>}
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#0A0A0A' }} numberOfLines={1}>{c.other?.full_name || c.other?.username || 'Member'}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <ImageView
        images={viewer?.images ?? []}
        imageIndex={viewer?.index ?? 0}
        visible={!!viewer}
        onRequestClose={() => setViewer(null)}
        swipeToCloseEnabled
        doubleTapToZoomEnabled
      />

      <Modal visible={!!fsVideo} animationType="fade" onRequestClose={() => setFsVideo(null)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {fsVideo && (
            <AVVideo
              source={{ uri: fsVideo.url }}
              style={{ flex: 1 }}
              resizeMode={AVResizeMode.CONTAIN}
              shouldPlay
              isLooping
              useNativeControls
            />
          )}
          <TouchableOpacity onPress={() => setFsVideo(null)} style={{ position: 'absolute', top: 54, left: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 10 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={20} color="#FFF" />
          </TouchableOpacity>
        </View>
      </Modal>


      <Modal visible={!!menuPost} transparent animationType="slide" onRequestClose={() => setMenuPost(null)}>
        <TouchableOpacity style={s.menuOverlay} activeOpacity={1} onPress={() => setMenuPost(null)}>
          <TouchableOpacity activeOpacity={1} style={s.menuSheet}>
            <View style={s.menuHandle} />
            {menuPost && <Text style={s.menuPreview} numberOfLines={2}>{menuPost.content}</Text>}
            <View style={s.menuDivider} />

            {menuPost?.user_id === userId && (
              <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
                setMenuPost(null);
                Alert.alert('Delete post?', 'This will permanently remove your post and all its comments.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: async () => {
                    try {
                      const { error } = await supabase.from('posts').delete().eq('id', menuPost!.id);
                      if (error) throw error;
                      loadFeed(false);
                    } catch (e: any) {
                      Alert.alert('Delete failed', e?.message || 'Could not delete post. Please try again.');
                    }
                  }},
                ]);
              }}>
                <Feather name="trash-2" size={18} color="#FF3B30" />
                <Text style={[s.menuOptionTxt, { color: '#FF3B30' }]}>Delete post</Text>
              </TouchableOpacity>
            )}

            {menuPost?.user_id === userId && (
              <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
                const captured = menuPost;
                setMenuPost(null);
                setQuotingPost(null);
                setThreadingPost(captured);
                setComposerOpen(true);
              }}>
                <Feather name="corner-down-right" size={18} color="#000" />
                <Text style={s.menuOptionTxt}>Add to thread</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
              const captured = menuPost;
              const author = captured ? profilesMap[captured.user_id] : null;
              setMenuPost(null);
              setTimeout(async () => {
                if (!captured) return;
                const media = (captured as any).media_url || (captured as any).image_url || null;
                const label = author?.username ? '@' + author.username : (author?.full_name || 'Post');
                const sticker = {
                  id: 'shared_' + captured.id,
                  kind: 'link',
                  text: label,
                  url: 'platinum-circles://post/' + captured.id,
                  nx: 0.5, ny: 0.82, scale: 1, rotation: 0,
                };
                try {
                  if (media) {
                    const name = 'shared_' + captured.id + (media.includes('.mp4') ? '.mp4' : '.jpg');
                    const target = (FileSystem.cacheDirectory || FileSystem.documentDirectory) + name;
                    const res = await FileSystem.downloadAsync(media, target);
                    navigation.navigate('StoryComposer', {
                      mode: media.includes('.mp4') ? 'video' : 'image',
                      assets: [{ localUri: res.uri || target, mediaType: media.includes('.mp4') ? 'video' : 'image' }],
                      seedStickers: [sticker],
                      seedCaption: (captured.content || '').slice(0, 180),
                    });
                  } else {
                    navigation.navigate('StoryComposer', {
                      mode: 'text',
                      assets: [],
                      seedStickers: [sticker],
                      seedText: (captured.content || '').slice(0, 240),
                    });
                  }
                } catch (e) {
                  console.log('[ShareToStory]', e);
                  Alert.alert('Could not open story', 'Please try again.');
                }
              }, 350);
            }}>
              <Feather name="plus-square" size={18} color="#000" />
              <Text style={s.menuOptionTxt}>Add to your story</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
              const captured = menuPost;
              const author = captured ? profilesMap[captured.user_id] : null;
              setMenuPost(null);
              setTimeout(async () => {
                if (!captured) return;
                await Share.share({ message: `${author?.full_name || 'Someone'} on Platinum Circles:\n\n${captured.content}\n\nOpen in the app: platinum-circles://post/${captured.id}` });
              }, 400);
            }}>
              <Feather name="share-2" size={18} color="#000" />
              <Text style={s.menuOptionTxt}>Share post</Text>
            </TouchableOpacity>

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

            <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={async () => {
              if (!menuPost) return;
              await Clipboard.setStringAsync(menuPost.content || '');
              setMenuPost(null);
              Alert.alert('Copied', 'Post text copied to clipboard.');
            }}>
              <Feather name="copy" size={18} color="#000" />
              <Text style={s.menuOptionTxt}>Copy text</Text>
            </TouchableOpacity>

            {menuPost?.user_id !== userId && (
              <>
                <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
                  const id = menuPost?.id;
                  setMenuPost(null);
                  if (id) hidePost(id);
                }}>
                  <Feather name="eye-off" size={18} color="#000" />
                  <Text style={s.menuOptionTxt}>Not interested</Text>
                </TouchableOpacity>

                <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
                  const captured = menuPost;
                  setMenuPost(null);
                  if (!captured) return;
                  setTimeout(() => {
                    Alert.alert('Report post', 'Why are you reporting this?', [
                      { text: 'Spam', onPress: () => reportPost(captured.id, 'spam') },
                      { text: 'Harassment', onPress: () => reportPost(captured.id, 'harassment') },
                      { text: 'False information', onPress: () => reportPost(captured.id, 'false_information') },
                      { text: 'Inappropriate content', onPress: () => reportPost(captured.id, 'inappropriate') },
                      { text: 'Cancel', style: 'cancel' },
                    ]);
                  }, 350);
                }}>
                  <Feather name="flag" size={18} color="#FF3B30" />
                  <Text style={[s.menuOptionTxt, { color: '#FF3B30' }]}>Report post</Text>
                </TouchableOpacity>
              </>
            )}


            <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
              const id = menuPost?.id;
              setMenuPost(null);
              if (id) setPosts(prev => prev.filter(p => p.id !== id));
            }}>
              <Feather name="eye-off" size={18} color="#6B7280" />
              <Text style={s.menuOptionTxt}>Not interested</Text>
            </TouchableOpacity>

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

            {menuPost?.user_id !== userId && (
              <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
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
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, marginBottom: 12 },
  logo: { fontSize: 24, fontFamily: 'SpaceGrotesk_700Bold', color: '#0A0A0A', letterSpacing: -0.5 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F8F8F8', borderWidth: StyleSheet.hairlineWidth, borderColor: '#E8E8E8', alignItems: 'center', justifyContent: 'center' },
  searchInput: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#111', marginBottom: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: '#EBEBEB' },
  tabRow: { flexDirection: 'row', marginBottom: 10, backgroundColor: '#F5F5F5', borderRadius: 12, padding: 3 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  tabTxt: { fontSize: 13, fontWeight: '500', color: '#8E8E93' },
  tabTxtActive: { color: '#000000', fontWeight: '600' },
  list: { paddingHorizontal: 0, paddingTop: 8 },
  listEmpty: { flexGrow: 1 },
  postCard: { backgroundColor: '#FFFFFF', borderBottomWidth: 6, borderBottomColor: '#F2F3F5' },
  postTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  postMeta: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: 10 },
  avatarFb: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarFbTxt: { fontSize: 15, fontWeight: '700', color: '#1D4ED8' },
  postMetaTxt: { flex: 1 },
  postAuthor: { fontSize: 15, fontWeight: '700', color: '#0A0A0A', letterSpacing: -0.1 },
  postSub: { marginTop: 1, fontSize: 13, color: '#8E8E93' },
  menuBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  menuBtnTxt: { fontSize: 16, color: '#C7C7CC', letterSpacing: 1 },
  content: { fontSize: 15, lineHeight: 21, color: '#0A0A0A', paddingHorizontal: 16, paddingBottom: 12 },
  hashTag: { color: '#0B1E3D', fontWeight: '600' },
  mention: { color: '#0B1E3D', fontWeight: '600' },
  metricsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 2, gap: 4 },
  metric: { fontSize: 13, color: '#8E8E93' },
  metricDot: { fontSize: 12, color: '#C7C7CC' },
  actions: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6, gap: 18 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 0, paddingVertical: 8, borderRadius: 18, borderWidth: 0, borderColor: 'transparent', backgroundColor: 'transparent' },
  pillLiked: { backgroundColor: '#FFF0F0', paddingHorizontal: 12 },
  pillReposted: { backgroundColor: '#F0FDF4', paddingHorizontal: 12 },
  pillSaved: { backgroundColor: '#EFF6FF', paddingHorizontal: 12 },
  pillIcon: { paddingHorizontal: 10 },
  pillTxt: { fontSize: 13, fontWeight: '500', color: '#6B7280' },
  pillTxtLiked: { color: '#E53935', fontWeight: '600' },
  pillTxtReposted: { color: '#059669', fontWeight: '600' },
  cpWrap: { paddingHorizontal: 16, paddingBottom: 14, paddingTop: 4 },
  cpAuthor: { fontWeight: '700', color: '#000000', fontSize: 13 },
  cpTxt: { fontSize: 13, lineHeight: 18, color: '#3C3C43' },
  viewAll: { fontSize: 12, color: '#8E8E93', marginTop: 3 },
  composerContainer: { position: 'absolute', left: 12, right: 12, zIndex: 100, maxHeight: '80%' },
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
  exclusiveBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EFF6FF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8 },
  exclusiveBannerTxt: { fontSize: 12, color: '#2563EB', fontWeight: '500', flex: 1 },
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
  toolBtnActive: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' },
  mediaCount: { fontSize: 12, color: '#8E8E93', fontWeight: '600' },
  cancelBtn: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  cancelTxt: { color: '#3C3C43', fontSize: 14, fontWeight: '500' },
  postBtn: { backgroundColor: NAVY, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 9, minWidth: 64, alignItems: 'center' },
  postBtnOff: { opacity: 0.3 },
  postBtnTxt: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  fab: { position: 'absolute', right: 18, width: 54, height: 54, borderRadius: 27, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  fabTxt: { color: '#FFF', fontSize: 26, fontWeight: '300', lineHeight: 30 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 60 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#000000', textAlign: 'center' },
  emptySub: { marginTop: 8, fontSize: 14, lineHeight: 20, color: '#8E8E93', textAlign: 'center' },
  emptyBtn: { marginTop: 20, backgroundColor: NAVY, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  emptyBtnTxt: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  menuSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 10, paddingBottom: 32, paddingHorizontal: 16 },
  menuHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#E0E0E0', alignSelf: 'center', marginBottom: 14 },
  menuPreview: { fontSize: 14, color: '#8E8E93', lineHeight: 20, marginBottom: 12, paddingHorizontal: 4 },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#F0F0F0', marginBottom: 8 },
  menuOption: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F5F5F5' },
  menuOptionTxt: { fontSize: 16, color: '#000000', fontWeight: '400' },
  menuCancel: { justifyContent: 'center', marginTop: 8, borderBottomWidth: 0 },
  menuCancelTxt: { fontSize: 16, color: '#8E8E93', fontWeight: '500', textAlign: 'center', width: '100%' },
  bellBadge: { position: 'absolute', top: -6, right: -8, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 1.5, borderColor: '#FFFFFF' },
  bellBadgeTxt: { fontSize: 10, fontWeight: '700', color: '#FFFFFF' },
});