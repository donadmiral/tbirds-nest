import { loadConversationTargets } from '../../../shared/conversationTargets';
import { createFeedTabCache } from '../../../shared/feedTabCache';
import { uniqueCollaborators, collaborationName } from '../../../shared/collaborationPeople';
function stripMd(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\n{2,}/g, ' ')
    .replace(/\n/g, ' ')
    .trim();
}
import { Image as ExpoImagePrefetch } from 'expo-image';
import { prefetch } from '../../lib/screenTransition';
import PollCard from '../../components/PollCard';
import CollaboratorsSheet from '../../components/CollaboratorsSheet';
import PeoplePickerSheet from '../../components/PeoplePickerSheet';
import { showMessage } from 'react-native-flash-message';
import { themedSheet, getTheme, useTheme } from '../../theme/useTheme';
import { useNavigation } from '@react-navigation/native';
import { takePendingCapture } from '../../utils/captureBridge';
import VideoThumb from '../../components/VideoThumb';
import ArticleBody from '../../components/ArticleBody';
import SharedPostCard from '../../components/feed/SharedPostCard';
import { TapTopFlatList } from '../../components/TapTopList';
import NewPostsPill from '../../components/NewPostsPill';
import TierName from '../../components/TierName';
import AnnouncementBanner from '../../components/AnnouncementBanner';
import TrendingStoriesRail from '../../components/TrendingStoriesRail';
import MarketplaceShelf from '../../components/market/MarketplaceShelf';
import { isMarketplacePost, MARKETPLACE_SHELF_AFTER, readMarketplaceRecommendations, type MarketplaceRecommendation } from '../../../shared/marketplaceRecommendations';
import * as ExpoLinking from 'expo-linking';
import * as FileSystem from 'expo-file-system/legacy';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { storiesService } from '../../services/storiesService';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Linking,
  StatusBar, RefreshControl, Share, Alert, TextInput, Image,
  KeyboardAvoidingView, Platform, Keyboard, ScrollView, useWindowDimensions, Modal,
  Animated,
  AppState,
  PanResponder,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from '../../components/SafeArea';

import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { Feather, Ionicons } from '@expo/vector-icons';
import PostMediaEditSheet, { type PostMediaEdit } from '../../components/PostMediaEditSheet';
import PostDraftPreview from '../../components/PostDraftPreview';
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as Crypto from 'expo-crypto';

import type { SoundtrackSelection } from '../../../shared/soundtrack';
import { ORIGINAL_AUDIO_ENABLED } from '../../../shared/musicAvailability';
import SoundtrackPicker from '../../components/SoundtrackPicker';
import { normalizePostPlayback } from '../../../shared/postVoiceEffects';
import { postLookRecipe } from '../../../shared/postMediaEditing';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { ensureUploadSafe } from '../../utils/uploadSafe';
import * as Clipboard from 'expo-clipboard';
import DiscoverTile from '../../components/feed/DiscoverTile';
import DiscoverViewer from '../../components/feed/DiscoverViewer';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../services/supabase';
import { sharePostToConversation } from '../../services/postSharing';
import { useAuthStore } from '../../stores/authStore';
import StoryBar from '../../components/stories/StoryStrip';
import { handleTabBarScroll } from '../../components/AdaptiveTabBar';
import TrendingTopicsStrip from '../../components/TrendingTopicsStrip';
import PostCarousel, { CarouselMedia } from '../../components/PostCarousel';
import ProductCarousel, { PostProduct } from '../../components/ProductCarousel';
import ProductPickerSheet from '../../components/ProductPickerSheet';
import ActorSwitcher from '../../components/ActorSwitcher';
import { useActorStore, authorId as currentAuthorId } from '../../stores/actorStore';
import PostMediaViewer from '../../components/PostMediaViewer';
import FullscreenVideo from '../../components/FullscreenVideo';
import VideoFeedModal from '../../components/VideoFeedModal';
import CommentsSheet from '../../components/feed/CommentsSheet';
import { seekWhenClaimed } from '../../lib/videoEngine';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CATEGORIES } from '../../constants/categories';
import { FeedSkeleton } from '../../components/Skeleton';
import { light } from '../../constants/tokens';
import { hydratePostMedia } from '../../services/contentMedia';
import { renewFeedMedia } from '../../../shared/feedMedia';
import { feedSnapshots, savePublicFeedSnapshot, reconcileFeedVisibility } from '../../services/feedSnapshot';
import { mergeFeedRefresh, feedPrefetchUrls } from '../../../shared/feedSnapshot';
import { useSettingsStore } from '../../stores/settingsStore';
import PostInsightsSheet from '../../components/PostInsightsSheet';
import VerifiedBadge from '../../components/VerifiedBadge';

type MediaItem = { id: string; url: string; media_type: 'image' | 'video'; sort_order: number; width?: number | null; height?: number | null };
type Post = {
  link?: string | null;
  /** feed row key: the post id, or post id plus reposter when the row is a repost */
  _rk?: string;
  id: string; user_id: string; content: string;
  likes_count: number; comments_count: number; reposts_count: number; bookmarks_count: number; views_count?: number; shares_count?: number;
  created_at?: string | null; media_url?: string | null; location?: string | null;
  channel?: string | null;
  article_title?: string | null;
  quoted_post_id?: string | null;
  quotes_count?: number;
  thread_parent_id?: string | null;
  media: MediaItem[]; score: number; is_trending?: boolean; products?: PostProduct[]; _promo?: { id: string; label: string };
};
type ProfileLite = { id: string; full_name?: string | null; username?: string | null; avatar_url?: string | null; is_verified?: boolean | null; verified_tier?: string | null };
type ProfileMap = Record<string, ProfileLite>;
type CommentPreview = { body: string; authorName: string; likes?: number };
type LocalMedia = { uri: string; type: 'image' | 'video'; ext: string; width?: number; height?: number; fileSize?: number; thumbnail?: string; edit?: PostMediaEdit | null; };
type PostMediaRow = { id: string; url: string; media_type: 'image' | 'video'; width?: number | null; height?: number | null; sort_order: number; edit?: PostMediaEdit | null };

function scorePost(p: Omit<Post, 'score'>): number {
  const h = (Date.now() - new Date(p.created_at || Date.now()).getTime()) / 3600000;
  return ((p.likes_count * 2) + (p.comments_count * 5) + (p.reposts_count * 3)) * Math.exp(-h / 36) + (h < 1 ? 20 : 0);
}
const PAGE_SIZE = 20;

function feedModeToServer(m: string): string {
  return m === 'forYou' ? 'for_you' : m === 'innovation' ? 'innovation' : m === 'trending' ? 'trending' : 'latest';
}

/** Map one get_feed row into the Post shape the render code already expects. */
function mapFeedRow(r: any): Post {
  const base: Omit<Post, 'score'> = {
    id: r.post_id, _rk: r.reposted_by_id ? r.post_id + ':' + r.reposted_by_id : r.post_id, user_id: r.author_id, content: r.content ?? r.body ?? '',
    likes_count: r.likes_count ?? 0, comments_count: r.comments_count ?? 0, views_count: r.views_count ?? 0,
    is_trending: !!r.is_trending,
    products: Array.isArray(r.products) ? r.products : [],
    link: r.link ?? null,
    reposts_count: r.reposts_count ?? 0, bookmarks_count: r.bookmarks_count ?? 0, shares_count: r.shares_count ?? 0,
    created_at: r.created_at, media_url: r.media_url ?? null,
    location: null,
    channel: r.channel ?? null,
    article_title: r.article_title ?? null,
    quoted_post_id: r.quoted_post_id ?? null,
    thread_parent_id: r.thread_parent_id ?? null,
    media: Array.isArray(r.media)
      ? r.media.filter((item: any) => typeof item?.url === 'string' && item.url.length > 0).sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      : [],
  };
  return { ...base, score: scorePost(base) };
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

// Single source of truth for "does this post have a video". Used by the
// quote-with-video eligibility check; not touching the other pre-existing
// inline copies of this same test elsewhere in this file since that's a
// separate, larger cleanup Don didn't ask for here.
function isVideoPost(post: { media?: any[] | null }): boolean {
  return !!post.media?.some((m: any) => m.media_type === 'video');
}

function renderRichText(text: string, onHashtag: (t: string) => void, onMention: (u: string) => void) {
  return text.split(/([@#][\w.]+)/g).map((part, i) => {
    if (part.startsWith('#')) return <Text key={i} style={s.hashTag} onPress={() => onHashtag(part.slice(1))}>{part}</Text>;
    if (part.startsWith('@')) return <Text key={i} style={s.mention} onPress={() => onMention(part.slice(1))}>{part}</Text>;
    return <Text key={i}>{part}</Text>;
  });
}

type FeedTextDraft = { ownerId: string | null; text: string; exclusive: boolean; innovation: boolean };

/** Restore only into an untouched draft, and never save a pre-hydration value. */
function useFeedTextDraft(ownerId: string | null) {
  const [draft, setDraft] = useState<FeedTextDraft>({ ownerId, text: '', exclusive: false, innovation: false });
  const [hydrated, setHydrated] = useState<{ ownerId: string; generation: number; revision: number; read: boolean } | null>(null);
  const generation = useRef(0), revision = useRef(0), mounted = useRef(false);
  const visibleOwner = useRef(ownerId); visibleOwner.current = ownerId;
  const current = useCallback((request: number) => mounted.current && generation.current === request
    && !!ownerId && visibleOwner.current === ownerId && useAuthStore.getState().session?.user.id === ownerId
    && useAuthStore.getState().profile?.id === ownerId, [ownerId]);

  useEffect(() => {
    const request = ++generation.current, startRevision = revision.current;
    mounted.current = true;
    let read = false;
    if (ownerId && current(request)) {
      void AsyncStorage.getItem('pc_draft:' + ownerId).then(raw => {
        if (!current(request)) return;
        read = true;
        if (revision.current !== startRevision) return;
        let saved: unknown = null;
        try { saved = raw ? JSON.parse(raw) : null; } catch { /* Ignore invalid local metadata. */ }
        const value = saved && typeof saved === 'object' ? saved as Record<string, unknown> : {};
        setDraft({ ownerId, text: typeof value.text === 'string' ? value.text : '', exclusive: value.exclusive === true, innovation: value.innovation === true });
      }).catch(() => {}).finally(() => {
        if (current(request)) setHydrated({ ownerId, generation: request, revision: startRevision, read });
      });
    }
    return () => { mounted.current = false; generation.current = request + 1; };
  }, [ownerId, current]);

  useEffect(() => {
    if (!ownerId || hydrated?.ownerId !== ownerId || draft.ownerId !== ownerId
      || !current(hydrated.generation) || (!hydrated.read && revision.current === hydrated.revision)) return;
    const timer = setTimeout(() => {
      if (!current(hydrated.generation)) return;
      const key = 'pc_draft:' + ownerId;
      if (draft.text.trim()) {
        void AsyncStorage.setItem(key, JSON.stringify({ text: draft.text, exclusive: draft.exclusive, innovation: draft.innovation })).catch(() => {});
      } else { void AsyncStorage.removeItem(key).catch(() => {}); }
    }, 400);
    return () => clearTimeout(timer);
  }, [draft, hydrated, ownerId, current]);

  const update = useCallback((change: Partial<Pick<FeedTextDraft, 'text' | 'exclusive' | 'innovation'>>) => {
    if (!current(generation.current)) return;
    revision.current++;
    setDraft(previous => ({ ...(previous.ownerId === ownerId ? previous : { ownerId, text: '', exclusive: false, innovation: false }), ...change }));
  }, [current, ownerId]);
  const setComposerText = useCallback((text: string) => update({ text }), [update]);
  const setExclusivePost = useCallback((exclusive: boolean) => update({ exclusive }), [update]);
  const setInnovationPost = useCallback((innovation: boolean) => update({ innovation }), [update]);
  const value = draft.ownerId === ownerId ? draft : { text: '', exclusive: false, innovation: false };
  return { composerText: value.text, exclusivePost: value.exclusive, innovationPost: value.innovation,
    setComposerText, setExclusivePost, setInnovationPost };
}

export default function FeedScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { t } = useTheme();
  const { width: SCREEN_W } = useWindowDimensions();
  const TILE_W = Math.floor((SCREEN_W - 12 * 2 - 10) / 2);
  const NAVY = t.ink.primary;
  const { profile, session } = useAuthStore();
  const userId = profile?.id ?? null;
  const { composerText, setComposerText, exclusivePost, setExclusivePost, innovationPost, setInnovationPost }
    = useFeedTextDraft(session?.user.id === userId ? userId : null);
  const isVerifiedSchoolUser = !!(profile as any)?.is_verified_school_user;

  const [posts, setPosts] = useState<Post[]>([]);
  const [feedOwner, setFeedOwner] = useState(userId);
  const dataSaver = useSettingsStore(state => state.uploadQuality === 'data-saver');
  const [profilesMap, setProfilesMap] = useState<ProfileMap>({});
  const [postRings, setPostRings] = useState<Record<string, boolean>>({});
  useFocusEffect(useCallback(() => {
    let alive = true;
    storiesService.getCatchupFeed('all', 100).then(users => {
      if (!alive) return;
      const map: Record<string, boolean> = {};
      (users || []).forEach((u: any) => { if (u?.user_id) map[u.user_id] = !!u.has_unseen; });
      setPostRings(map);
    }).catch(() => {});
    return () => { alive = false; };
  }, []));
  const [likedPosts, setLikedPosts] = useState<Record<string, boolean>>({});
  const [expandedPosts, setExpandedPosts] = useState<Record<string, boolean>>({});
  const [likerNames, setLikerNames] = useState<Record<string, string[]>>({});
  const [bookmarkedPosts, setBookmarkedPosts] = useState<Record<string, boolean>>({});
  const [repostedPosts, setRepostedPosts] = useState<Record<string, boolean>>({});
  const [sharePostTarget, setSharePostTarget] = useState<Post | null>(null);
  // Muted words: posts containing any of them stay out of every feed here.
  const [mutedWords, setMutedWords] = useState<string[]>(() => {
    const words = (profile as any)?.muted_words;
    return Array.isArray(words) ? words.filter((word): word is string => typeof word === 'string').map(word => word.toLowerCase()) : [];
  });
  useEffect(() => {
    let alive = true;
    const current = useAuthStore.getState().profile;
    const words = current?.id === userId ? (current as any)?.muted_words : [];
    setMutedWords(Array.isArray(words) ? words.filter((word): word is string => typeof word === 'string').map(word => word.toLowerCase()) : []);
    if (userId) supabase.from('profiles').select('muted_words').eq('id', userId).maybeSingle().then(({ data, error }) => {
      if (!error && data && alive && useAuthStore.getState().profile?.id === userId) setMutedWords((((data as any)?.muted_words as string[]) || []).filter(word => typeof word === 'string').map(word => word.toLowerCase()));
    }, () => {});
    return () => { alive = false; };
  }, [userId]);
  const isMuted = useCallback((pp: Post) => {
    if (!mutedWords.length) return false;
    const text = ((pp.content || '') + ' ' + ((pp as any).article_title || '')).toLowerCase();
    return mutedWords.some((w) => w && text.includes(w));
  }, [mutedWords]);
  // Last known counts per post. The feed query returns zeros for some of
  // them; this overlay makes sure a fresh load never draws a zero over a
  // number the phone already knows.
  const countCacheRef = useRef<Record<string, { likes_count?: number; reposts_count?: number; bookmarks_count?: number; shares_count?: number }>>({});
  const overlayCounts = (list: Post[]) => list.map(pp => { const cc = countCacheRef.current[pp.id]; return cc ? { ...pp, ...cc } : pp; });
  const feedListRef = useRef<any>(null);
  const [commentPreviews, setCommentPreviews] = useState<Record<string, CommentPreview>>({});
  const [loading, setLoading] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const hasMoreRef = useRef(true);
  const cursorRef = useRef<{ key: number; id: string } | null>(null);
  const modeFirstRun = useRef(true);
  const loadingMoreRef = useRef(false);
  const [busyKeys, setBusyKeys] = useState<Record<string, boolean>>({});
  const [feedMode, setFeedMode] = useState<'forYou' | 'latest' | 'discover' | 'trending'>('forYou');
  const [discoverCat, setDiscoverCat] = useState('all');
  const [discoverOpen, setDiscoverOpen] = useState<string | null>(null);
  const discoverPageRef = useRef({ asOf: new Date().toISOString(), offset: 0 });
  useEffect(() => { setDiscoverOpen(null); }, [userId, feedMode, discoverCat]);
  const [pendingPostCount, setPendingPostCount] = useState(0);
  const feedRequestRef = useRef(0);
  const feedRefreshRequestRef = useRef<number | null>(null);
  const resolvedFeedRequestRef = useRef(0);
  const feedScopeRef = useRef('');
  feedScopeRef.current = `${userId ?? ''}:${feedMode}:${discoverCat}`;
  const [visibleFeedScope, setVisibleFeedScope] = useState(feedScopeRef.current);
  const feedTabs = useRef(createFeedTabCache<{
    rows: Post[]; profiles: ProfileMap; likes: Record<string, boolean>; marks: Record<string, boolean>;
    reposts: Record<string, boolean>; cursor: { key: number; id: string } | null; hasMore: boolean;
    offset: number; discoverPage: { asOf: string; offset: number }; needsCursorRefresh: boolean;
  }>()).current;
  const pendingPostsRef = useRef<Post[]>([]);
  const scrollOffsetRef = useRef(0);
  const restoredSnapshotRef = useRef(false);
  const prefetchedImagesRef = useRef(new Set<string>());
  const discoverInnoIdsRef = useRef<Set<string>>(new Set());
  const discoverMetaRef = useRef<Map<string, string | null>>(new Map());
  const discoverCatRef = useRef(discoverCat);
  const mediaTouchRef = useRef(false);
  // Discover pill row: remember its scroll offset across feed reloads so tapping a far pill never snaps the row back to the start.
  const discoverPillsRef = useRef<ScrollView>(null);
  const discoverPillsXRef = useRef(0);
  const restoreDiscoverPills = useCallback(() => { const x = discoverPillsXRef.current; if (x > 0) { try { discoverPillsRef.current?.scrollTo({ x, animated: false }); } catch {} } }, []);
  const hiddenIdsRef = useRef<Set<string>>(new Set());
  const seenPendingRef = useRef<Set<string>>(new Set());
  const seenSentRef = useRef<Set<string>>(new Set());
  const videoDwellRef = useRef<{ postId: string; start: number } | null>(null);
  const viewSessionRef = useRef(
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );
  const feedModeRef = useRef(feedMode);
  feedModeRef.current = feedMode;
  const tabSwipe = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => !mediaTouchRef.current && Math.abs(g.dx) > 40 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
    onPanResponderRelease: (_e, g) => {
      const order = ['forYou', 'latest', 'discover', 'trending'] as const;
      const i = order.indexOf(feedModeRef.current);
      if (g.dx < -40 && i < order.length - 1) { setFeedMode(order[i + 1]); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }
      else if (g.dx > 40 && i > 0) { setFeedMode(order[i - 1]); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }
    },
  })).current;
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMedia, setComposerMedia] = useState<LocalMedia[]>([]);
  const composerMediaRef = useRef(composerMedia); composerMediaRef.current = composerMedia;
  const [editMediaIdx, setEditMediaIdx] = useState<number | null>(null);
  const [selectedComposerMedia,setSelectedComposerMedia]=useState(0);
  const [composerReview,setComposerReview]=useState(false);
  const [postProgress,setPostProgress]=useState({completed:0,total:0,label:''});
  const [posting, setPosting] = useState(false);
  const [postConfirmed, setPostConfirmed] = useState(false);
  const [composerSoundtrack, setComposerSoundtrack] = useState<SoundtrackSelection | null>(null);
  const [musicOpen, setMusicOpen] = useState(false);
  const [publicationLocked, setPublicationLocked] = useState(false);
  const publicationBusy = useRef(false);
  const publicationAttempt = useRef<{ owner: string; postId: string; started: boolean; run: () => Promise<void> } | null>(null);
  const canEditPostDraft = () => {
    if (!publicationBusy.current && !publicationAttempt.current) return true;
    Keyboard.dismiss(); setComposerOpen(true);
    return false;
  };
  const [postCategory, setPostCategory] = useState<string | null>(null);
  const [innoField, setInnoField] = useState<string | null>(null);
  const [innoStage, setInnoStage] = useState<string | null>(null);
  const [postAudience, setPostAudience] = useState<'everyone' | 'followers' | 'mentioned' | 'verified'>('everyone');
  // Who can comment, Instagram's rule set, enforced by the server on every comment.
  const [commentPolicy, setCommentPolicy] = useState<'everyone' | 'following' | 'followers' | 'mentioned' | 'off'>('everyone');
  // Sensitive media, the poster's own mark: readers see it by their own setting.
  const [composerSensitive, setComposerSensitive] = useState(false);
  // Collab: one invited co-author; the post shows on both profiles once they accept.
  const [collabPicks, setCollabPicks] = useState<{ id: string; username: string | null; full_name: string | null }[]>([]);
  const [collabSheet, setCollabSheet] = useState<any[] | null>(null);
  // Polls on posts: options and a duration, saved to the same tables the web uses.
  const [pollOpts, setPollOpts] = useState<string[] | null>(null);
  const [pollDays, setPollDays] = useState(1);
  const [pollPosts, setPollPosts] = useState<Record<string, boolean>>({});
  const metadataFence = useCallback(() => {
    const scope = feedScopeRef.current, request = feedRequestRef.current;
    const owner = useAuthStore.getState().profile?.id;
    return () => !!owner && useAuthStore.getState().profile?.id === owner
      && scope === feedScopeRef.current && request === feedRequestRef.current;
  }, []);
  const hydratePolls = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const isCurrent = metadataFence();
    supabase.from('post_polls').select('post_id').in('post_id', ids).then(({ data }) => { if (!isCurrent()) return; const m: Record<string, boolean> = {}; (data || []).forEach((r: any) => { m[r.post_id] = true; }); setPollPosts(prev => ({ ...prev, ...m })); }, () => {});
  }, []);
  const [collabs, setCollabs] = useState<Record<string, { id: string; username: string | null; full_name: string | null }[]>>({});
  const [collabPicker, setCollabPicker] = useState<'composer' | { postId: string } | null>(null);
  const askCollaborator = useCallback(() => { setCollabPicker('composer'); }, []);
  const inviteCollaborators = useCallback(async (postId: string, picks: { id: string }[]) => {
    if (!userId) return;
    for (const p of picks) { await supabase.from('post_collaborators').insert({ post_id: postId, user_id: p.id, invited_by: userId }).then(() => {}, () => {}); }
  }, [userId]);
  const hydrateCollabs = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const isCurrent = metadataFence();
    supabase.from('post_collaborators').select('post_id, user_id, status, profile:profiles!post_collaborators_user_id_fkey(username, full_name, avatar_url, is_verified, verified_tier)').in('post_id', ids).eq('status', 'accepted').then(({ data }) => {
      if (!isCurrent()) return;
      const m: Record<string, { id: string; username: string | null; full_name: string | null }[]> = Object.fromEntries(ids.map(id => [id, []]));
      (data || []).forEach((r: any) => { const pr = Array.isArray(r.profile) ? r.profile[0] : r.profile; if (!pr) return; (m[r.post_id] = m[r.post_id] || []).push({ id: r.user_id, username: pr.username ?? null, full_name: pr.full_name ?? null, avatar_url: pr.avatar_url ?? null, is_verified: !!pr.is_verified, verified_tier: pr.verified_tier ?? null } as any); });
      setCollabs(prev => ({ ...prev, ...m }));
    }, () => {});
  }, []);
  const COMMENT_META: Record<string, { label: string; icon: string }> = {
    everyone: { label: 'Anyone', icon: 'message-circle' }, following: { label: 'People I follow', icon: 'user-check' },
    followers: { label: 'My followers', icon: 'users' }, mentioned: { label: 'Mentioned only', icon: 'at-sign' }, off: { label: 'Comments off', icon: 'slash' },
  };
  const pickCommentPolicy = useCallback(() => {
    Alert.alert('Who can comment?', 'Enforced by the server on every comment.', [
      { text: 'Everyone', onPress: () => setCommentPolicy('everyone') },
      { text: 'People I follow', onPress: () => setCommentPolicy('following') },
      { text: 'My followers', onPress: () => setCommentPolicy('followers') },
      { text: 'Mentioned only', onPress: () => setCommentPolicy('mentioned') },
      { text: 'Turn off comments', onPress: () => setCommentPolicy('off') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, []);
  const [articleTitle, setArticleTitle] = useState('');
  const [composerProducts, setComposerProducts] = useState<PostProduct[]>([]);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [mentionResults, setMentionResults] = useState<ProfileLite[]>([]);
  const [mentionActive, setMentionActive] = useState(false);
  const [sharingPost, setSharingPost] = useState<Record<string, boolean>>({});
  const [menuPost, setMenuPost] = useState<Post | null>(null);
  const [insightsPostId, setInsightsPostId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ media: CarouselMedia[]; index: number; postId: string } | null>(null);
  const [fsVideo, setFsVideo] = useState<{ id?: string; url: string } | null>(null);
  // Comments open in a sheet over the feed: the post stays put and its video keeps playing above the sheet.
  const [commentsFor, setCommentsFor] = useState<Post | null>(null);
  const commentsForRef = useRef<Post | null>(null); commentsForRef.current = commentsFor;
  const mediaYRef = useRef<Record<string, number>>({});
  const mediaNodeRef = useRef<Record<string, any>>({});
  // While the sheet holds the media in its stage the card stays idle; the sheet hands the player back just before it leaves.
  const [commentsHold, setCommentsHold] = useState(false);
  const [likersPost, setLikersPost] = useState<Post | null>(null);
  const [likersList, setLikersList] = useState<any[]>([]);
  const [likersKind, setLikersKind] = useState<'likes' | 'reposts' | 'bookmarks'>('likes');
  const [likersLoaded, setLikersLoaded] = useState(false);
  const [wtfSuggestions, setWtfSuggestions] = useState<any[]>([]);
  const sendingPost = useRef(false);
  const [sendPost, setSendPost] = useState<Post | null>(null);
  // Who viewed a video post: owner-only list behind the eye badge.
  const [viewersPost, setViewersPost] = useState<Post | null>(null);
  const [viewersRows, setViewersRows] = useState<any[]>([]);
  const [viewersLoading, setViewersLoading] = useState(false);
  const openPostViewers = useCallback(async (post: Post) => {
    setViewersPost(post); setViewersRows([]); setViewersLoading(true);
    try { const { data } = await supabase.rpc('get_post_viewers', { p_post: post.id }); setViewersRows((data ?? []) as any[]); }
    catch { setViewersRows([]); }
    finally { setViewersLoading(false); }
  }, []);
  const [sendConvs, setSendConvs] = useState<any[]>([]);
  const [sendGroups, setSendGroups] = useState<any[]>([]);
  const [sendCommunities, setSendCommunities] = useState<any[]>([]);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const sendGeneration = useRef(0);
  useEffect(() => { sendGeneration.current++; setSendPost(null); setSendConvs([]); setSendGroups([]); setSendCommunities([]); return () => { sendGeneration.current++; }; }, [userId]);
  const [quotingPost, setQuotingPost] = useState<Post | null>(null);
  const [threadingPost, setThreadingPost] = useState<Post | null>(null);
  const [quotedMap, setQuotedMap] = useState<Record<string, { content: string; user_id: string; media?: { url: string; media_type: string; thumbnail_url?: string | null } | null }>>({});
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
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const pageRequestRef = useRef(0);

  const loadFeedRef = useRef<(showLoader: boolean, background?: boolean) => Promise<void>>(undefined);

  useFocusEffect(useCallback(() => {
    setScreenFocused(true);
    return () => {
      setScreenFocused(false);
      Keyboard.dismiss();
    };
  }, []));

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
    if (commentsForRef.current) return; // the sheet's post stays the active one until the sheet closes
    const first = viewableItems.find((v: any) => v.isViewable);
    setActivePostId(first?.item?.id ?? null);
    // Queue anything that scrolled into view. Flushed in batches below so a
    // fast scroll does not fire one insert per post.
    viewableItems.forEach((v: any) => {
      const id = v?.item?.id;
      // Seeing your own post is not a view, on your account or any business you act as.
      const me = useAuthStore.getState().profile?.id ?? null;
      const acting = currentAuthorId(me);
      const own = !!v?.item?.user_id && (v.item.user_id === me || v.item.user_id === acting);
      if (id && !own && !String(id).startsWith('__') && !seenSentRef.current.has(id)) seenPendingRef.current.add(id);
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    const flushSeen = async () => {
      if (useAuthStore.getState().profile?.id !== userId) return;
      const batch = Array.from(seenPendingRef.current);
      if (batch.length === 0) return;
      seenPendingRef.current.clear();
      batch.forEach(id => seenSentRef.current.add(id));
      const { error } = await supabase
        .from('post_seen')
        .upsert(batch.map(id => ({ user_id: userId, post_id: id })), { onConflict: 'user_id,post_id' });
      if (error && useAuthStore.getState().profile?.id === userId) {
        console.log('[FEED] post_seen upsert failed:', error.message);
        // let them retry on the next flush rather than losing them silently
        batch.forEach(id => seenSentRef.current.delete(id));
      }
    };
    const timer = setInterval(flushSeen, 6000);
    return () => { clearInterval(timer); flushSeen(); };
  }, [userId]);

  /**
   * Video views measured as dwell time in the viewport rather than player
   * position. record_video_view counts a view once the session crosses three
   * seconds and keeps the longest watch, so re-watching does not inflate.
   * An author watching their own video is not a view.
   */
  const closeVideoDwell = useCallback(() => {
    const open = videoDwellRef.current;
    videoDwellRef.current = null;
    if (!open || !userId || useAuthStore.getState().profile?.id !== userId) return;
    // Dwell keeps running if the reader stops scrolling, so cap the report.
    // A clip is watched, not camped on: sixty seconds is the ceiling.
    const seconds = Math.min(Math.round((Date.now() - open.start) / 1000), 60);
    if (seconds < 1) return;
    supabase
      .rpc('record_video_view', {
        p_post_id: open.postId,
        p_viewer_id: userId,
        p_session: viewSessionRef.current,
        p_duration: seconds,
      })
      .then(({ error }) => { if (error) console.log('[VIDEO_VIEW]', error.message); });
  }, [userId]);

  useEffect(() => {
    if (videoDwellRef.current && (feedMode === 'discover' || !screenFocused || !appActive || videoDwellRef.current.postId !== activePostId)) {
      closeVideoDwell();
    }
    if (feedMode === 'discover' || !screenFocused || !appActive || !activePostId || !userId) return;
    const active = posts.find(x => x.id === activePostId);
    if (!active) return;
    const isVideo = !!active.media?.some((m: any) => m.media_type === 'video');
    if (isVideo && videoDwellRef.current?.postId !== activePostId) {
      videoDwellRef.current = { postId: activePostId, start: Date.now() };
    }
  }, [activePostId, posts, userId, screenFocused, appActive, feedMode, closeVideoDwell]);

  useEffect(() => closeVideoDwell, [closeVideoDwell]);

  const isBusy = (k: string) => !!busyKeysRef.current[k];
  const setBusy = (k: string, v: boolean) => {
    busyKeysRef.current[k] = v;
    setBusyKeys(p => { const n = { ...p }; if (v) n[k] = true; else delete n[k]; return n; });
  };

  const scheduleRefresh = useCallback(() => {
    if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
    realtimeTimerRef.current = setTimeout(() => {
      loadFeedRef.current?.(false, true);
    }, 2000);
  }, []);

  const loadFeed = useCallback(async (showLoader = false, background = false) => {
    if (!userId) return;
    const request = ++feedRequestRef.current;
    feedRefreshRequestRef.current = request;
    const scope = feedScopeRef.current;
    const mode = feedModeRef.current;
    const category = discoverCatRef.current;
    const isCurrent = () => request === feedRequestRef.current && scope === feedScopeRef.current
      && useAuthStore.getState().profile?.id === userId;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    const deadline = setTimeout(() => {
      if (!isCurrent()) return;
      // A timed-out refresh must not later overwrite a newly requested page.
      if (feedRefreshRequestRef.current === request) { ++feedRequestRef.current; feedRefreshRequestRef.current = null; }
      setLoading(false); setRefreshing(false);
      setFeedError(postsRef.current.length ? 'Your feed is taking longer to refresh. You can keep reading.' : 'Your feed is taking longer to load. Please try again.');
    }, 12_000);
    try {
      if (showLoader && !postsRef.current.length) setLoading(true);
      let feedRows: any[] | null = null; let feedErr: any = null;
      const discoverAsOf = background ? discoverPageRef.current.asOf : new Date().toISOString();
      if (mode === 'discover') {
        const page = await supabase.rpc('get_discover_page', {
          p_category: category === 'all' || category === 'videos' ? null : category,
          p_video: category === 'videos', p_limit: PAGE_SIZE, p_offset: 0, p_as_of: discoverAsOf,
        });
        feedRows = page.data as any[] | null; feedErr = page.error;
      } else {
        const fr = await supabase.rpc('get_feed', {
          p_mode: feedModeToServer(mode),
          p_cursor_key: null,
          p_cursor_id: null,
          p_limit: PAGE_SIZE,
        });
        feedRows = (fr.data ?? null) as any[] | null; feedErr = fr.error;
      }
      if (!isCurrent()) return;
      if (feedErr) { setFeedError('Your feed could not load. Please try again.'); return; }
      setFeedError(null);

      resolvedFeedRequestRef.current = request;
      const rows = (feedRows ?? []) as any[];
      const scored = overlayCounts(rows.map(mapFeedRow)).filter(pp => !hiddenIdsRef.current.has(pp.id) && !isMuted(pp));
      hydrateShares(scored.map(pp => pp.id));
      hydrateCollabs(scored.map(pp => pp.id));
      hydratePolls(scored.map(pp => pp.id));
      const preservePosition = (background || (restoredSnapshotRef.current && scrollOffsetRef.current > 20)) && postsRef.current.length > 0;
      let retained = postsRef.current;
      if (preservePosition && retained.length) {
        const visible = await reconcileFeedVisibility(userId, retained.map(post => post.id), isCurrent);
        if (!isCurrent()) return;
        if (visible) retained = retained.filter(post => visible.has(post.id));
      }
      const merged = mergeFeedRefresh(retained, scored, preservePosition);
      merged.rows = (await renewFeedMedia(merged.rows, hydratePostMedia)).map(post => ({ ...post, media: (post.media ?? []).filter(item => typeof item.url === 'string' && item.url.length > 0) }));
      if (!isCurrent()) return;
      pendingPostsRef.current = merged.pending;
      setPendingPostCount(merged.pending.length);
      postsRef.current = merged.rows;
      setPosts(merged.rows);
      setVisibleFeedScope(scope);
      if (!preservePosition || restoredSnapshotRef.current) {
        cursorRef.current = rows.length
          ? { key: rows[rows.length - 1].sort_key, id: rows[rows.length - 1].post_id }
          : null;
        hasMoreRef.current = rows.length >= PAGE_SIZE;
        if (mode === 'discover') discoverPageRef.current = { asOf: discoverAsOf, offset: rows.length };
      }
      restoredSnapshotRef.current = false;
      feedRefreshRequestRef.current = null;
      // Content is usable now. Profiles/comments below are optional enrichment.
      setLoading(false);
      setRefreshing(false);
      void savePublicFeedSnapshot(userId, mode, rows, isCurrent);

      const pmFromFeed: ProfileMap = {};
      const lm0: Record<string, boolean> = {}, bm0: Record<string, boolean> = {}, rm0: Record<string, boolean> = {};
      rows.forEach((r: any) => {
        pmFromFeed[r.author_id] = { id: r.author_id, full_name: r.author_name, username: r.author_username, avatar_url: r.author_avatar, is_verified: r.author_verified, verified_tier: r.author_verified_tier ?? null };
        lm0[r.post_id] = !!r.viewer_liked;
        bm0[r.post_id] = !!r.viewer_bookmarked;
        rm0[r.post_id] = !!r.viewer_reposted;
      });
      setProfilesMap(prev => preservePosition ? { ...prev, ...pmFromFeed } : pmFromFeed);
      setLikedPosts(prev => preservePosition ? { ...prev, ...lm0 } : lm0);
      setBookmarkedPosts(prev => preservePosition ? { ...prev, ...bm0 } : bm0);
      setRepostedPosts(prev => preservePosition ? { ...prev, ...rm0 } : rm0);
      const likerIds = scored.filter(p => p.likes_count > 0).map(p => p.id);
      if (likerIds.length > 0) supabase.rpc('get_recent_likers', { post_ids: likerIds }).then(({ data }) => { if (!isCurrent()) return; const m: Record<string, string[]> = {}; (data ?? []).forEach((r: any) => { m[r.post_id] = r.liker_names ?? []; }); setLikerNames(prev => preservePosition ? { ...prev, ...m } : m); });
      const qIds = Array.from(new Set(scored.map(p => p.quoted_post_id).filter(Boolean))) as string[];
      let qRows: any[] = [];
      if (qIds.length > 0) {
        const { data: qData } = await supabase.from('posts').select('id, content, body, user_id, media_url, post_media(url, media_type, sort_order, edit)').in('id', qIds);
        if (!isCurrent()) return;
        qRows = qData ?? [];
        const qm: Record<string, { content: string; user_id: string; media?: { url: string; media_type: string } | null }> = {};
        qRows.forEach((qr: any) => { qm[qr.id] = { content: qr.content ?? qr.body ?? '', user_id: qr.user_id, media: (() => { const pm = Array.isArray(qr.post_media) ? [...qr.post_media].sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) : []; return pm[0] ? { url: pm[0].url, media_type: pm[0].media_type, thumbnail_url: (pm[0] as any)?.edit?.coverUrl ?? null } : (qr.media_url ? { url: qr.media_url, media_type: 'image' } : null); })() }; });
        setQuotedMap(prev => preservePosition ? { ...prev, ...qm } : qm);
      }
      const uids = Array.from(new Set([...scored.map(p => p.user_id), ...qRows.map((qr: any) => qr.user_id)]));
      const { data: pData } = await supabase.from('profiles').select('id, full_name, username, avatar_url, profile_visibility, is_verified, verified_tier').in('id', uids);
      if (!isCurrent()) return;
      const pm: ProfileMap = { ...pmFromFeed };
      (pData || []).forEach((p: any) => { pm[p.id] = p; });
      setProfilesMap(prev => ({ ...prev, ...pm }));
      if (userId) {
        supabase.from('profiles')
          .select('id, full_name, username, avatar_url, headline, connections_count')
          .neq('id', userId)
          .is('deactivated_at', null)
          .order('connections_count', { ascending: false, nullsFirst: false })
          .limit(15)
          .then(({ data: sug }) => { if (isCurrent() && sug) setWtfSuggestions(sug); });
      }
      if (userId) {
        const ids = scored.map(p => p.id);
        if (ids.length > 0) {
          const { data: cData } = await supabase
            .from('post_comments')
            .select('post_id, body, user_id, parent_comment_id, created_at, likes_count')
            .in('post_id', ids)
            .order('created_at', { ascending: false });

          if (!isCurrent()) return;
          // These rows are previews, and the API may return only a prefix.
          // Keep the authoritative comments_count returned by get_feed.
          const cpMap: Record<string, CommentPreview> = {};
          const topLevelComments = (cData || []).filter((c: any) => !c.parent_comment_id);
          const aIds = Array.from(new Set(topLevelComments.map((c: any) => c.user_id).filter(Boolean)));
          let authors: Record<string, any> = {};

          if (aIds.length > 0) {
            const { data: aData } = await supabase.from('profiles').select('id, full_name, username').in('id', aIds);
            if (!isCurrent()) return;
            (aData || []).forEach((a: any) => { authors[a.id] = a; });
          }

          topLevelComments.forEach((c: any) => {
            const cur = cpMap[c.post_id];
            if (!cur || (c.likes_count ?? 0) > (cur.likes ?? 0)) {
              const a = authors[c.user_id];
              cpMap[c.post_id] = { body: c.body, authorName: a?.full_name || a?.username || 'User', likes: c.likes_count ?? 0 };
            }
          });

          setCommentPreviews(prev => preservePosition ? { ...prev, ...cpMap } : cpMap);
        }
      }
    } catch (e: any) {
      if (!isCurrent()) return;
      setFeedError('Your feed could not load. Please try again.');
    }
    finally {
      clearTimeout(deadline);
      if (feedRefreshRequestRef.current === request) feedRefreshRequestRef.current = null;
      if (isCurrent()) { setLoading(false); setRefreshing(false); }
    }
  }, [userId]);

  useEffect(() => {
    loadFeedRef.current = loadFeed;
  }, [loadFeed]);

  useEffect(() => {
    feedModeRef.current = feedMode;
    discoverCatRef.current = discoverCat;
    if (modeFirstRun.current) { modeFirstRun.current = false; return; }
    if (visibleFeedScope.startsWith(`${userId ?? ''}:`) && !loading && !feedError) {
      feedTabs.save(visibleFeedScope, { rows: posts, profiles: profilesMap, likes: likedPosts, marks: bookmarkedPosts,
        reposts: repostedPosts, cursor: cursorRef.current, hasMore: hasMoreRef.current,
        offset: scrollOffsetRef.current, discoverPage: discoverPageRef.current, needsCursorRefresh: restoredSnapshotRef.current });
    }
    const restored = feedTabs.read(feedScopeRef.current);
    const rows = restored?.rows.filter(post => !hiddenIdsRef.current.has(post.id)) ?? [];
    postsRef.current = rows; setPosts(rows);
    setProfilesMap(restored?.profiles ?? {}); setLikedPosts(restored?.likes ?? {});
    setBookmarkedPosts(restored?.marks ?? {}); setRepostedPosts(restored?.reposts ?? {});
    cursorRef.current = restored?.cursor ?? null;
    hasMoreRef.current = restored?.hasMore ?? true;
    discoverPageRef.current = restored?.discoverPage ?? { asOf: new Date().toISOString(), offset: 0 };
    scrollOffsetRef.current = restored?.offset ?? 0;
    // A disk snapshot can reach this cache before its first network response.
    // Preserve its need for a cursor while retaining established tab cursors.
    restoredSnapshotRef.current = restored?.needsCursorRefresh ?? false;
    setVisibleFeedScope(feedScopeRef.current); setLoading(!restored); setFeedError(null);
    pendingPostsRef.current = [];
    setPendingPostCount(0);
    const scrollScope = feedScopeRef.current;
    requestAnimationFrame(() => {
      if (scrollScope === feedScopeRef.current) feedListRef.current?.scrollToOffset({ offset: restored?.offset ?? 0, animated: false });
    });
    loadFeedRef.current?.(!restored, !!restored);
  }, [feedMode, discoverCat]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const isCurrent = () => alive && useAuthStore.getState().profile?.id === userId;
    supabase.from('follows').select('following_id').eq('follower_id', userId).limit(1000)
      .then(({ data }) => { if (isCurrent() && data) setFollowingIds(new Set(data.map((r: any) => r.following_id))); });
    supabase.from('follow_requests').select('target_id').eq('requester_id', userId).eq('status', 'pending').limit(1000)
      .then(({ data }) => { if (isCurrent() && data) setRequestedIds(new Set(data.map((r: any) => r.target_id))); });
    useActorStore.getState().loadActors();
    return () => { alive = false; };
  }, [userId]);

  useEffect(() => {
    let alive = true;
    ++feedRequestRef.current;
    feedTabs.clear();
    postsRef.current = [];
    setFeedOwner(userId);
    setPosts([]); setProfilesMap({}); setLikedPosts({}); setBookmarkedPosts({}); setRepostedPosts({});
    setCommentPreviews({}); setQuotedMap({}); setLikerNames({}); setFeedError(null);
    setFollowingIds(new Set()); setRequestedIds(new Set()); setWtfSuggestions([]); setPollPosts({}); setCollabs({});
    restoredSnapshotRef.current = false; scrollOffsetRef.current = 0;
    countCacheRef.current = {}; hiddenIdsRef.current.clear();
    seenPendingRef.current.clear(); seenSentRef.current.clear();
    pendingPostsRef.current = []; setPendingPostCount(0);
    prefetchedImagesRef.current.clear();
    cursorRef.current = null; hasMoreRef.current = true;
    feedSnapshots.setAccount(userId);
    if (!userId) { setLoading(false); return () => { alive = false; }; }
    setLoading(true);
    const scope = feedScopeRef.current;
    const initialRequest = feedRequestRef.current + 1;
    void feedSnapshots.read(userId, feedModeRef.current).then(snapshot => {
      if (!alive || !snapshot || scope !== feedScopeRef.current || feedRequestRef.current !== initialRequest
        || resolvedFeedRequestRef.current === initialRequest || useAuthStore.getState().profile?.id !== userId || postsRef.current.length) return;
      const restored = snapshot.rows.map(mapFeedRow).filter(post => !isMuted(post));
      const pm: ProfileMap = {}; const likes: Record<string, boolean> = {}, marks: Record<string, boolean> = {}, reposts: Record<string, boolean> = {};
      snapshot.rows.forEach(row => {
        pm[row.author_id] = { id: row.author_id, full_name: row.author_name, username: row.author_username,
          avatar_url: row.author_avatar, is_verified: row.author_verified, verified_tier: row.author_verified_tier };
        likes[row.post_id] = !!row.viewer_liked; marks[row.post_id] = !!row.viewer_bookmarked; reposts[row.post_id] = !!row.viewer_reposted;
      });
      restoredSnapshotRef.current = true;
      setVisibleFeedScope(scope);
      postsRef.current = restored; setPosts(restored); setProfilesMap(pm);
      setLikedPosts(likes); setBookmarkedPosts(marks); setRepostedPosts(reposts); setLoading(false);
    });
    void loadFeed(true);
    return () => { alive = false; ++feedRequestRef.current; };
  }, [userId, loadFeed]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      setAppActive(state === 'active');
      if (state === 'active') loadFeedRef.current?.(false, true);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!screenFocused || !appActive) return;
    const timer = setInterval(() => { void loadFeedRef.current?.(false, true); }, 240_000);
    return () => clearInterval(timer);
  }, [screenFocused, appActive]);

  useEffect(() => {
    let feedLive = true;
    const hasFeedPost = (postId: string) => feedLive
      && useAuthStore.getState().profile?.id === userId
      && postsRef.current.some(post => post.id === postId);
    // Order is decided by get_feed on the server. Never re-sort under the
    // reader's thumb because a like arrived over realtime.
    const sortPosts = (items: Post[]) => items;

    const ch = supabase.channel('feed_live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, () => { if (feedLive && useAuthStore.getState().profile?.id === userId) scheduleRefresh(); })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, payload => {
        const id = (payload.old as any)?.id;
        if (!id || !hasFeedPost(id)) return;
        if (userId) void feedSnapshots.clear(userId);
        setPosts(prev => prev.filter(post => post.id !== id));
      })
      .subscribe();

    const likeCh = supabase.channel('feed_likes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_likes' }, (payload) => {
        const row = payload.new as any;
        if (!row?.post_id || !hasFeedPost(row.post_id)) return;
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
        if (!row?.post_id || !hasFeedPost(row.post_id)) return;
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

    // Reposts and bookmarks: every phone bumps the number the moment anyone
    // acts, the same way likes already do. The actor's own phone changed its
    // number optimistically, so its own rows are skipped here.
    const rbCh = supabase.channel('feed_reposts_bookmarks')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_reposts' }, (payload) => {
        const row = payload.new as any; if (!row?.post_id || !hasFeedPost(row.post_id) || row.user_id === userId) return;
        setPosts(prev => prev.map(p => p.id === row.post_id ? { ...p, reposts_count: (p.reposts_count || 0) + 1 } : p));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'post_reposts' }, (payload) => {
        const row = payload.old as any; if (!row?.post_id || !hasFeedPost(row.post_id) || row.user_id === userId) return;
        setPosts(prev => prev.map(p => p.id === row.post_id ? { ...p, reposts_count: Math.max(0, (p.reposts_count || 0) - 1) } : p));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_bookmarks' }, (payload) => {
        const row = payload.new as any; if (!row?.post_id || !hasFeedPost(row.post_id)) return;
        setPosts(prev => prev.map(p => p.id === row.post_id ? { ...p, bookmarks_count: (p.bookmarks_count || 0) + 1 } : p));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'post_bookmarks' }, (payload) => {
        const row = payload.old as any; if (!row?.post_id || !hasFeedPost(row.post_id)) return;
        setPosts(prev => prev.map(p => p.id === row.post_id ? { ...p, bookmarks_count: Math.max(0, (p.bookmarks_count || 0) - 1) } : p));
      })
      .subscribe();

    // Post-row updates carry the counts the triggers just changed.
    const countCh = supabase.channel('feed_post_counts')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, (payload) => {
        const r = payload.new as any; if (!r?.id || !hasFeedPost(r.id)) return;
        const pick = (a: any, b: any, cur: number) => { const v = a ?? b; return typeof v === 'number' ? Math.max(v, 0) : cur; };
        const prevC = countCacheRef.current[r.id] || {};
        countCacheRef.current[r.id] = {
          likes_count: pick(r.likes_count, r.like_count, prevC.likes_count ?? 0),
          reposts_count: pick(r.reposts_count, r.repost_count, prevC.reposts_count ?? 0),
          bookmarks_count: pick(r.bookmarks_count, r.bookmark_count, prevC.bookmarks_count ?? 0),
          shares_count: pick(r.shares_count, r.share_count, prevC.shares_count ?? 0),
        };
        setPosts(prev => overlayCounts(prev));
      })
      .subscribe();

    const commentCh = supabase.channel('feed_comments')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_comments' }, async (payload) => {
        const row = payload.new as any;
        if (!row?.post_id || !hasFeedPost(row.post_id)) return;
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
          if (!hasFeedPost(row.post_id)) return;
          setCommentPreviews(prev => ({
            ...prev,
            [row.post_id]: { body: row.body || row.text || '', authorName },
          }));
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'post_comments' }, async (payload) => {
        const row = payload.old as any;
        if (!row?.post_id || !hasFeedPost(row.post_id)) return;
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
          if (!hasFeedPost(row.post_id)) return;
          if (latestComment) {
            let aName = 'User';
            if (latestComment.user_id) {
              const { data: a } = await supabase.from('profiles').select('full_name, username').eq('id', latestComment.user_id).maybeSingle();
              aName = a?.full_name || a?.username || 'User';
            }
            if (!hasFeedPost(row.post_id)) return;
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
        if (!row?.id || !hasFeedPost(row.id)) return;
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
      feedLive = false;
      supabase.removeChannel(ch);
      supabase.removeChannel(likeCh);
      supabase.removeChannel(rbCh);
      supabase.removeChannel(countCh);
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

  const AUD_META: Record<string, { label: string; icon: any }> = {
    everyone:  { label: 'Everyone',       icon: 'globe' },
    followers: { label: 'Followers',      icon: 'users' },
    mentioned: { label: 'Mentioned only', icon: 'at-sign' },
    verified:  { label: 'Verified only',  icon: 'check-circle' },
  };
  const pickAudience = useCallback(() => {
    Alert.alert('Who can see this post?', 'This is enforced by the server, not just hidden.', [
      { text: 'Everyone',       onPress: () => setPostAudience('everyone') },
      { text: 'Followers',      onPress: () => setPostAudience('followers') },
      { text: 'Mentioned only', onPress: () => setPostAudience('mentioned') },
      { text: 'Verified only',  onPress: () => setPostAudience('verified') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, []);

  const [promos, setPromos] = useState<Post[]>([]);
  const [marketplace, setMarketplace] = useState<{ owner: string; items: MarketplaceRecommendation[] } | null>(null);
  const [marketplaceRefresh, setMarketplaceRefresh] = useState(0);
  const marketplaceRequest = useRef<AbortController | null>(null);
  const refreshMarketplace = useCallback((sellerId?: string) => {
    marketplaceRequest.current?.abort();
    if (sellerId) setMarketplace(current => current ? { ...current, items: current.items.filter(item => item.seller_id !== sellerId) } : current);
    setMarketplaceRefresh(value => value + 1);
  }, []);
  const marketplaceItems = useMemo(() => marketplace?.owner === userId ? marketplace.items : [], [marketplace, userId]);
  useEffect(() => {
    if (!userId || feedMode !== 'forYou') { setMarketplace(null); return; }
    if (!screenFocused || !appActive) return;
    let active = true;
    const request = new AbortController();
    marketplaceRequest.current = request;
    const timer = setTimeout(() => request.abort(), 10000);
    void readMarketplaceRecommendations(supabase, request.signal)
      .then(items => { if (active && !request.signal.aborted && useAuthStore.getState().profile?.id === userId) setMarketplace({ owner: userId, items }); })
      .catch(() => { /* Optional recommendations never hold up regular posts. */ })
      .finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); request.abort(); if (marketplaceRequest.current === request) marketplaceRequest.current = null; };
  }, [userId, feedMode, marketplaceRefresh, screenFocused, appActive]);
  const promoSeenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    setPromos([]); promoSeenRef.current.clear();
    if (!userId) return;
    (async () => {
      try {
        const { data } = await supabase.rpc('get_active_promos', { p_limit: 3 });
        const seenIds = new Set<string>(); const rows = ((data ?? []) as any[]).filter(r => { if (seenIds.has(r.post_id)) return false; seenIds.add(r.post_id); return true; });
        if (rows.length === 0) return;
        const pm: Record<string, any> = {};
        rows.forEach(r => { pm[r.author_id] = { id: r.author_id, full_name: r.author_name, username: r.author_username, avatar_url: r.author_avatar, is_verified: r.author_verified, verified_tier: r.author_verified_tier ?? null }; });
        setProfilesMap(prev => ({ ...pm, ...prev }));
        const secured = await hydratePostMedia(rows);
        if (!alive || useAuthStore.getState().profile?.id !== userId) return;
        setPromos(secured.map(r => ({ ...mapFeedRow(r), _promo: { id: r.promo_id, label: r.promo_label || 'Sponsored' } } as any)));
      } catch {}
    })();
    return () => { alive = false; };
  }, [userId]);
  useEffect(() => {
    if (!activePostId) return;
    const p: any = promos.find(x => x.id === activePostId);
    if (!p || !p._promo || promoSeenRef.current.has(p._promo.id)) return;
    promoSeenRef.current.add(p._promo.id);
    supabase.rpc('record_ad_event', { p_promo_id: p._promo.id, p_kind: 'impression' }).then(() => {}, () => {});
  }, [activePostId, promos]);

  const [composerPreview, setComposerPreview] = useState<any>(null);
  const lpDebounceRef = useRef<any>(null);
  const lpPreviewIntentRef = useRef({ owner: userId, url: null as string | null, dismissed: false });
  useEffect(() => {
    let active = true;
    if (lpDebounceRef.current) clearTimeout(lpDebounceRef.current);
    const url = composerText.match(/https?:\/\/[^\s<>"]+/)?.[0] ?? null;
    if (lpPreviewIntentRef.current.owner !== userId || lpPreviewIntentRef.current.url !== url) {
      lpPreviewIntentRef.current = { owner: userId, url, dismissed: false };
    }
    if (!url || lpPreviewIntentRef.current.dismissed) { setComposerPreview(null); return; }
    setComposerPreview((previous: any) => previous?.url === url ? previous : null);
    lpDebounceRef.current = setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('link-preview', { body: { url } });
        if (active && !lpPreviewIntentRef.current.dismissed && useAuthStore.getState().profile?.id === userId && !error && data && !data.error && data.url === url) setComposerPreview(data);
      } catch {}
    }, 800);
    return () => { active = false; if (lpDebounceRef.current) clearTimeout(lpDebounceRef.current); };
  }, [composerText, userId]);

  const hidePost = useCallback(async (postId: string) => {
    hiddenIdsRef.current.add(postId);
    if (userId) void feedSnapshots.clear(userId);
    setPosts(prev => prev.filter(p => p.id !== postId));
    if (!userId) return;
    const { error } = await supabase.from('hidden_posts').insert({ user_id: userId, post_id: postId });
    if (error && error.code !== '23505') console.log('[HIDE_ERR]', error.message);
  }, [userId]);

  const blockAuthor = useCallback(() => {
    const captured = menuPost;
    setMenuPost(null);
    if (!captured || captured.user_id === userId) return;
    const name = profilesMap[captured.user_id]?.full_name || 'this user';
    setTimeout(() => {
      Alert.alert(
        `Block ${name}?`,
        'They will no longer see your posts or message you, and their posts and comments will be hidden from you.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Block', style: 'destructive', onPress: async () => {
            const { error } = await supabase.from('blocked_users').upsert({ blocker_id: userId, blocked_id: captured.user_id });
            if (error) { Alert.alert('Could not block', error.message); return; }
            if (useAuthStore.getState().profile?.id !== userId) return;
            if (userId) void feedSnapshots.clear(userId);
            setPosts(prev => prev.filter(p => p.user_id !== captured.user_id));
            refreshMarketplace(captured.user_id);
          } },
        ]
      );
    }, 350);
  }, [menuPost, userId, profilesMap, refreshMarketplace]);

  const reportPost = useCallback(async (postId: string, reason: string) => {
    if (!userId) return;
    const { error } = await supabase.from('post_reports').insert({ reporter_id: userId, post_id: postId, reason });
    if (error) { Alert.alert('Could not report', error.message); return; }
    hidePost(postId);
    Alert.alert('Reported', 'Thanks. This post has been hidden from your feed.');
  }, [userId, hidePost]);

  // One sheet for likes, reposts and bookmarks: who did it, newest first.
  const openLikers = useCallback(async (post: Post, kind: 'likes' | 'reposts' | 'bookmarks' = 'likes') => {
    setLikersKind(kind);
    setLikersLoaded(false);
    setLikersPost(post);
    setLikersList([]);
    const table = kind === 'reposts' ? 'post_reposts' : kind === 'bookmarks' ? 'post_bookmarks' : 'post_likes';
    const { data: lk } = await supabase.from(table).select('user_id, created_at').eq('post_id', post.id).order('created_at', { ascending: false }).limit(100);
    setLikersLoaded(true);
    const uids = Array.from(new Set((lk ?? []).map((r: any) => r.user_id)));
    if (uids.length === 0) return;
    const { data: profs } = await supabase.from('profiles').select('id, full_name, username, avatar_url').in('id', uids);
    const pm: Record<string, any> = {};
    (profs ?? []).forEach((p: any) => { pm[p.id] = p; });
    setLikersList(uids.map(u => pm[u]).filter(Boolean));
  }, []);

  const toggleFollow = useCallback(async (targetId: string) => {
    if (!userId || targetId === userId) return;
    const wasFollowing = followingIds.has(targetId);
    const wasRequested = requestedIds.has(targetId);

    const isPrivate = (profilesMap as any)[targetId]?.profile_visibility === 'private';
    // Optimistic: paint the state the server will actually return.
    if (wasFollowing || wasRequested) {
      setFollowingIds(prev => { const n = new Set(prev); n.delete(targetId); return n; });
      setRequestedIds(prev => { const n = new Set(prev); n.delete(targetId); return n; });
    } else if (isPrivate) {
      setRequestedIds(prev => { const n = new Set(prev); n.add(targetId); return n; });
    } else {
      setFollowingIds(prev => { const n = new Set(prev); n.add(targetId); return n; });
    }

    try {
      const { data, error } = await supabase.rpc('handle_follow_action', { p_target_id: targetId });
      if (error) throw error;
      const action = (data as any)?.action;
      if (action === 'followed' || action === 'unfollowed' || action === 'requested' || action === 'request_cancelled') {
        setFollowingIds(prev => { const n = new Set(prev); if (action === 'followed') n.add(targetId); else n.delete(targetId); return n; });
        setRequestedIds(prev => { const n = new Set(prev); if (action === 'requested') n.add(targetId); else n.delete(targetId); return n; });
      }
    } catch (e: any) {
      setFollowingIds(prev => { const n = new Set(prev); if (wasFollowing) n.add(targetId); else n.delete(targetId); return n; });
      setRequestedIds(prev => { const n = new Set(prev); if (wasRequested) n.add(targetId); else n.delete(targetId); return n; });
      Alert.alert('Could not update follow', e?.message || 'Try again.');
    }
  }, [userId, followingIds, requestedIds, profilesMap]);

  const openSendSheet = useCallback(async (post: Post) => {
    if (!userId) return;
    const generation = ++sendGeneration.current;
    const current = () => generation === sendGeneration.current && useAuthStore.getState().session?.user.id === userId;
    setSendPost(post); setSendConvs([]); setSendGroups([]); setSendCommunities([]);
    setSendLoading(true); setSendError(null);
    try {
      const targets = await loadConversationTargets(supabase, userId);
      if (!current()) return;
      setSendConvs(targets.people.map(target => ({ ...target, other: { full_name: target.name, username: target.username, avatar_url: target.avatar } })));
      setSendGroups(targets.groups.map(target => ({ ...target, group_name: target.name, group_emoji: target.emoji })));
      setSendCommunities(targets.communities);
      setSendError(targets.warning);
    } catch (e) { if (current()) setSendError(e instanceof Error ? e.message : 'Conversations could not be loaded. Please retry.'); }
    finally { if (current()) setSendLoading(false); }
  }, [userId]);


  const sendPostTo = useCallback(async (conv: any) => {
    if (!userId || !sendPost || sendingPost.current) return;
    sendingPost.current = true;
    const generation = sendGeneration.current;
    setSendBusy(true);
    try {
      let conversationId = conv.id;
      if (conv.community) {
        const result = await supabase.rpc('ensure_community_conversation', { p_community: conv.id });
        if (result.error || !result.data) throw new Error('The community conversation could not be opened. Please retry.');
        conversationId = result.data;
      }
      const result = await sharePostToConversation(userId, sendPost.id, conversationId, conv.otherId ?? null);
      if (generation !== sendGeneration.current || useAuthStore.getState().session?.user.id !== userId) return;
      if (result.status === 'pending') {
        Alert.alert('Share saved', 'This post is waiting for delivery. It will retry when your connection returns.');
      } else if (result.status !== 'confirmed') {
        Alert.alert('Could not share', 'Open Messages to review or retry this share.');
        return;
      } else {
        recordShare(sendPost);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setSendPost(null);
      setSendGroups([]);
      setSendCommunities([]);
    } catch (e: any) {
      if (generation === sendGeneration.current && useAuthStore.getState().session?.user.id === userId) Alert.alert('Could not send', e?.message || 'Try again.');
    } finally {
      sendingPost.current = false;
      setSendBusy(false);
    }
  }, [userId, sendPost]);

  const sendPostToCommunity = useCallback((community: any) =>
    sendPostTo({ id: community.id, otherId: null, community: true }), [sendPostTo]);

  const addPostToStory = useCallback((post: Post) => {
    const author = profilesMap[post.user_id];
    const media: any[] = (post as any).media || [];
    const first = media.length > 0 ? media[0] : (post.media_url ? { url: post.media_url, media_type: 'image' } : null);
    const sticker: any = {
      id: 'post-' + post.id,
      text: '', style: 'classic', color: '#FFFFFF',
      nx: 0.5, ny: 0.5, scale: 1, rotation: 0,
      kind: 'post',
      postId: post.id,
      postAuthorName: author?.full_name || author?.username || 'Platinum Circles',
      postAuthorAvatar: author?.avatar_url || null,
      postText: post.content?.trim() || (post as any).body?.trim() || '',
      postMediaUrl: first?.url || null,
      postMediaType: first?.media_type || null,
      postMediaCount: Math.max(media.length, first ? 1 : 0),
      postMediaWidth: first?.width || null,
      postMediaHeight: first?.height || null,
      postMediaPlayback: normalizePostPlayback(first?.edit),
      postUsername: author?.username || null,
      postVerified: !!(author as any)?.is_verified,
      postVerifiedTier: (author as any)?.verified_tier ?? null,
      postAuthorId: post.user_id,
      postArticleTitle: (post as any).article_title ?? null,
      postCreatedAt: (post as any).created_at || null,
      postLikes: post.likes_count ?? 0,
      postComments: post.comments_count ?? 0,
      postReposts: post.reposts_count ?? 0,
    };
    (navigation as any).navigate('StoryComposer', { mode: 'text', seedStickers: [sticker] });
  }, [profilesMap, navigation]);

  const hydrateShares = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const isCurrent = metadataFence();
    // The post row carries the counts the triggers maintain, readable by
    // everyone. That is the number every phone shows, whatever it can or
    // cannot read of the underlying like, repost and bookmark rows.
    supabase.from('posts').select('id, likes_count, reposts_count, bookmarks_count, shares_count').in('id', ids).then(({ data }) => {
      if (!isCurrent() || !data || !data.length) return;
      const m: Record<string, any> = {};
      data.forEach((r: any) => { m[r.id] = r; });
      const pick = (a: any, b: any, cur: number) => { const v = a ?? b; return typeof v === 'number' ? Math.max(v, 0) : cur; };
      Object.keys(m).forEach(id => {
        const r = m[id];
        countCacheRef.current[id] = {
          likes_count: pick(r.likes_count, r.like_count, countCacheRef.current[id]?.likes_count ?? 0),
          reposts_count: pick(r.reposts_count, r.repost_count, countCacheRef.current[id]?.reposts_count ?? 0),
          bookmarks_count: pick(r.bookmarks_count, r.bookmark_count, countCacheRef.current[id]?.bookmarks_count ?? 0),
          shares_count: pick(r.shares_count, r.share_count, countCacheRef.current[id]?.shares_count ?? 0),
        };
      });
      setPosts(prev => overlayCounts(prev));
    }, () => {});
    // Quotes are posts that point at these ids. Counted here so the repost
    // number means reposts and quotes together, as on X.
    // Counts from the rows themselves, so a phone that did not do the acting
    // still shows the real numbers even before the post row's counter catches up.
    supabase.from('post_reposts').select('post_id').in('post_id', ids).then(({ data }) => {
      if (!isCurrent()) return;
      const m: Record<string, number> = {}; (data || []).forEach((r: any) => { m[r.post_id] = (m[r.post_id] || 0) + 1; });
      setPosts(prev => prev.map(pp => ids.includes(pp.id) && (m[pp.id] || 0) > (pp.reposts_count || 0) ? { ...pp, reposts_count: m[pp.id] } : pp));
    }, () => {});
    supabase.from('post_bookmarks').select('post_id').in('post_id', ids).then(({ data }) => {
      if (!isCurrent()) return;
      const m: Record<string, number> = {}; (data || []).forEach((r: any) => { m[r.post_id] = (m[r.post_id] || 0) + 1; });
      setPosts(prev => prev.map(pp => ids.includes(pp.id) && (m[pp.id] || 0) > (pp.bookmarks_count || 0) ? { ...pp, bookmarks_count: m[pp.id] } : pp));
    }, () => {});
    supabase.from('posts').select('quoted_post_id').in('quoted_post_id', ids).then(({ data }) => {
      if (!isCurrent()) return;
      const q: Record<string, number> = {};
      (data || []).forEach((r: any) => { if (r.quoted_post_id) q[r.quoted_post_id] = (q[r.quoted_post_id] || 0) + 1; });
      setPosts(prev => prev.map(pp => ids.includes(pp.id) ? { ...pp, quotes_count: q[pp.id] || 0 } : pp));
    }, () => {});
  }, []);

  const recordShare = useCallback((p: Post) => {
    supabase.rpc('increment_share_count', { p_post_id: p.id }).then(() => {}, () => {});
    setPosts(prev => prev.map(x => x.id === p.id ? { ...x, shares_count: (x.shares_count ?? 0) + 1 } : x));
  }, []);

  const postLink = (p: Post) => 'https://platinumcircles.app/post/' + p.id;
  const sharePost = useCallback(async (post: Post) => {
    if (sharingPostRef.current[post.id]) return;
    setSharingPost(p => ({ ...p, [post.id]: true }));
    const author = profilesMap[post.user_id];
    try {
      const res = await Share.share({ message: `${author?.full_name || 'Someone'} on Platinum Circles:\n\n${post.content}\n\nSee it: ${postLink(post)}` }); if ((res as any)?.action === Share.sharedAction) recordShare(post);
    } catch {}
    setTimeout(() => setSharingPost(p => { const n = { ...p }; delete n[post.id]; return n; }), 600);
  }, [profilesMap]);

  const pickMedia = async (only?: 'images' | 'videos') => {
    if (!canEditPostDraft()) return;
    const onlyKind = only === 'images' || only === 'videos' ? only : null;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!canEditPostDraft()) return;
    if (!perm.granted) { Alert.alert('Permission required'); return; }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: (onlyKind ? [onlyKind] : ['images', 'videos']) as ImagePicker.MediaType[],
        allowsMultipleSelection: true,
        selectionLimit: 10,
        preferredAssetRepresentationMode: "compatible" as ImagePicker.UIImagePickerPreferredAssetRepresentationMode,
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

          picked.push({ uri: a.uri, type: mediaType, ext, width: a.width ?? undefined, height: a.height ?? undefined, fileSize, thumbnail, edit:{aspectRatio:4/5} });
        } catch (assetErr: any) {
          console.log('[PICK_ASSET_ERR]', assetErr?.message || assetErr);
        }
      }

      if (picked.length > 0 && canEditPostDraft()) {
        setComposerMedia(p => [...p, ...picked].slice(0, 10));
        setSelectedComposerMedia(Math.min(composerMedia.length,9));setComposerReview(false);
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

  const funCamNav = useNavigation<any>();
  const resumeCameraDraft = useRef(false);
  useFocusEffect(useCallback(() => {
    const cm = takePendingCapture('feed');
    if (resumeCameraDraft.current) { resumeCameraDraft.current = false; if (canEditPostDraft()) setComposerOpen(true); }
    if (!cm) return;
    if (!canEditPostDraft()) return;
    (async () => {
      const isVideo = cm.type === 'video';
      const rawExt = safeExtFromUri(cm.uri, isVideo ? 'mp4' : 'jpg');
      const ext = isVideo ? (['mov', 'mp4', 'webm'].includes(rawExt) ? rawExt : 'mp4') : rawExt;
      let thumbnail: string | undefined;
      if (isVideo) {
        try {
          const thumbResult = await VideoThumbnails.getThumbnailAsync(cm.uri, { time: 0, quality: 0.7 });
          thumbnail = thumbResult.uri;
        } catch (e) {
          console.log('[FUNCAM_THUMB_ERR]', e);
        }
      }
      if (!canEditPostDraft()) return;
      setSelectedComposerMedia(Math.min(composerMediaRef.current.length,9));setComposerReview(false);
      setComposerMedia(p => [...p, { uri: cm.uri, type: isVideo ? 'video' : 'image', ext, width: cm.width ?? undefined, height: cm.height ?? undefined, thumbnail, edit:{aspectRatio:4/5,filterId:cm.filterId??null,filterAmt:100} }].slice(0,10) as LocalMedia[]);
      setComposerOpen(true);
    })();
  }, []));

  const openCamera = () => {
    if (!canEditPostDraft() || composerMediaRef.current.length >= 10) return;
    resumeCameraDraft.current = true;
    Keyboard.dismiss();setComposerOpen(false);setComposerReview(false);
    setTimeout(()=>{ if (canEditPostDraft()) funCamNav.navigate('StoryFunCamera', { returnTo: 'feed', feedParams: {} }); },300);
  };

  const reactToVideo = async (post: Post) => {
    if (!canEditPostDraft()) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!canEditPostDraft()) return;
    if (!perm.granted) { Alert.alert('Permission required'); return; }
    try {
      const result = await ImagePicker.launchCameraAsync({
        quality: 1,
        mediaTypes: ['videos'] as ImagePicker.MediaType[],
        allowsEditing: false,
        videoMaxDuration: 60,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const a = result.assets[0];
      const rawExt = safeExtFromUri(a.uri, 'mp4');
      const ext = ['mov', 'mp4', 'webm'].includes(rawExt) ? rawExt : 'mp4';

      let thumbnail: string | undefined;
      try {
        const thumbResult = await VideoThumbnails.getThumbnailAsync(a.uri, { time: 0, quality: 0.7 });
        thumbnail = thumbResult.uri;
      } catch (e) {
        console.log('[REACT_THUMB_ERR]', e);
      }

      if (!canEditPostDraft()) return;
      setQuotingPost(post);
      setComposerMedia([{ uri: a.uri, type: 'video', ext, width: a.width ?? undefined, height: a.height ?? undefined, thumbnail }]);
      setComposerOpen(true);
    } catch (e: any) {
      console.log('[REACT_CAMERA_ERR]', e?.message || e);
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
    if (publicationBusy.current || (!publicationAttempt.current && !composerText.trim() && !composerMedia.length) || !userId) return;
    publicationBusy.current = true;
    setPostConfirmed(false);
    if (!publicationAttempt.current) setPostProgress({completed:0,total:composerMedia.length,label:'Preparing your post'});
    setPosting(true); setPublicationLocked(true); setMusicOpen(false);
    try {
      if (!publicationAttempt.current) {
        const owner = userId, author = currentAuthorId(owner), postId = Crypto.randomUUID();
        const media = composerMedia.map(m => ({ ...m, id: Crypto.randomUUID() }));
        const completed = new Set<string>();
        const uploaded: any[] = [];
        const tags = media.flatMap(m => (m.edit?.tags ?? []).map(t => ({ id: Crypto.randomUUID(), post_id: postId, media_id: m.id, user_id: t.user_id, nx: t.nx, ny: t.ny })));
        const pollLabels = (pollOpts ?? []).map(x => x.trim()).filter(Boolean);
        if (pollOpts && pollLabels.length < 2) throw new Error('Add at least two poll options before posting.');
        const pollRows = pollLabels.map((label, i) => ({ id: Crypto.randomUUID(), post_id: postId, label, sort_order: i }));
        const pollEnd = new Date(Date.now() + pollDays * 86400000).toISOString();
        const check = async () => {
          const { data, error } = await supabase.auth.getSession();
          if (error || data.session?.user.id !== owner || useAuthStore.getState().profile?.id !== owner || currentAuthorId(owner) !== author) throw new Error('Return to the account and posting profile that started this post to finish it.');
          return data.session.access_token;
        };
        const step = async (name: string, run: () => Promise<void>) => {
          await check();
          if (completed.has(name)) return;
          await run(); await check(); completed.add(name);
        };
        // Stable IDs allow a confirmed write with a lost response to be reconciled,
        // without creating another post, media row, invitation or tag on retry.
        const saveRows = async (table: string, rows: any[], conflict = 'id') => {
          if (!rows.length) return;
          const { error } = await supabase.from(table).upsert(rows, { onConflict: conflict, ignoreDuplicates: true });
          if (error) throw error;
        };
        const upload = async (uri: string, mime: string, name: string) => {
          const token = await check();
          const form = new FormData(); form.append('file', { uri, type: mime, name: name.split('/').pop() } as any);
          const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 120000);
          try {
            const result = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/post-media/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string, 'x-upsert': 'true' }, body: form, signal: controller.signal });
            if (!result.ok) throw new Error(`Media upload failed (${result.status}). Please retry.`);
            await check();
            return `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/post-media/${name}`;
          } finally { clearTimeout(timeout); }
        };
        const currentLink = composerText.match(/https?:\/\/[^\s<>"]+/)?.[0] ?? null;
        const post: any = {
          id: postId, user_id: author, content: composerText.trim() || null, is_exclusive: exclusivePost,
          channel: innovationPost ? 'innovation' : null, audience: postAudience, comment_policy: commentPolicy,
          ...(innovationPost && innoField ? { innovation_field: innoField } : {}),
          ...(innovationPost && innoStage ? { innovation_stage: innoStage } : {}),
          ...(postCategory ? { category: postCategory } : {}),
          ...(innovationPost && articleTitle.trim() ? { article_title: articleTitle.trim(), read_minutes: Math.max(1, Math.round(composerText.trim().split(/\s+/).length / 200)) } : {}),
          ...(quotingPost ? { quoted_post_id: quotingPost.id } : {}),
          ...(threadingPost ? { thread_parent_id: threadingPost.id } : {}),
          ...(composerPreview?.url && composerPreview.url === currentLink ? { link_url: composerPreview.url } : {}),
        };
        publicationAttempt.current = {
          owner, postId, started: false,
          run: async () => {
            for (let i = 0; i < media.length; i++) await step(`upload-${i}`, async () => {
              const m = media[i], video = m.type === 'video';
              setPostProgress({completed:i,total:media.length,label:`Uploading ${video?'video':'photo'} ${i+1} of ${media.length}`});
              const safe = await ensureUploadSafe(m.uri, video ? 'video' : 'image', safeExtFromUri(m.uri, video ? 'mp4' : 'jpg'));
              const url = await upload(safe.uri, safe.mime, `${owner}/${postId}_${i}.${safe.ext}`);
              const { tags: _tags, coverLocalUri, soundtrack: previousSoundtrack, ...recipe } = m.edit ?? {};
              const chosenSoundtrack = i === 0 && composerSoundtrack ? composerSoundtrack : previousSoundtrack;
              const edit: any = { ...recipe, ...(ORIGINAL_AUDIO_ENABLED && chosenSoundtrack ? { soundtrack: chosenSoundtrack } : {}) };
              if (video) {
                const at = Math.max(0, Number(m.edit?.coverAt ?? m.edit?.trimStart ?? 0));
                const thumb = coverLocalUri ? {uri:coverLocalUri} : await VideoThumbnails.getThumbnailAsync(m.uri, { time: Math.round(at * 1000), quality: 0.9 });
                const safeCover=await ensureUploadSafe(thumb.uri,'image',safeExtFromUri(thumb.uri,'jpg'));
                edit.coverAt = at;
                edit.coverUrl = await upload(safeCover.uri, safeCover.mime, `${owner}/${postId}_${i}_cover.${safeCover.ext}`);
              }
              uploaded[i] = { id: m.id, post_id: postId, url, media_type: m.type, sort_order: i, width: m.width ?? null, height: m.height ?? null, edit: Object.keys(edit).length ? edit : null, is_sensitive: composerSensitive };
            });
            setPostProgress({completed:media.length,total:media.length,label:"Publishing your post"});
            publicationAttempt.current!.started = true;
            await step('post', () => saveRows('posts', [{ ...post, ...(uploaded[0] ? { media_url: uploaded[0].url } : {}) }]));
            await step('media', () => saveRows('post_media', uploaded));
            await step('tags', () => saveRows('post_media_tags', tags));
            await step('collaborators', () => saveRows('post_collaborators', uniqueCollaborators(collabPicks, owner).map(p => ({ post_id: postId, user_id: p.id, invited_by: owner })), 'post_id,user_id'));
            if (pollRows.length) {
              await step('poll', () => saveRows('post_polls', [{ post_id: postId, ends_at: pollEnd }], 'post_id'));
              await step('poll-options', () => saveRows('post_poll_options', pollRows));
            }
            if (composerProducts.length) await step('products', async () => {
              const { error } = await supabase.rpc('set_post_products', { p_post_id: postId, p_products: composerProducts.map((p, i) => ({ ...p, sort_order: i })) }); if (error) throw error;
            });
            await check();
          },
        };
      }
      await publicationAttempt.current.run();
      publicationAttempt.current = null; setPublicationLocked(false);
      setPostConfirmed(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => feedListRef.current?.scrollToOffset({ offset: 0, animated: true }), 150);
      setComposerOpen(false); setComposerText(''); setComposerMedia([]); setComposerSoundtrack(null);setComposerReview(false);setSelectedComposerMedia(0);
      setExclusivePost(false); setComposerProducts([]); setInnovationPost(false);
      setPostAudience('everyone'); setCommentPolicy('everyone'); setComposerSensitive(false);
      setCollabPicks([]); setPollOpts(null); setPollDays(1); setQuotingPost(null); setThreadingPost(null);
      Keyboard.dismiss(); setTimeout(() => loadFeed(false), 300);
    } catch (e: any) {
      if (!publicationAttempt.current) setPublicationLocked(false);
      Alert.alert('Post not finished', `${e?.message || 'Check your connection and try again.'}${publicationAttempt.current ? '\nYour original post is saved for retry. Tap Finish post to complete it without creating another post.' : ''}`);
    } finally { publicationBusy.current = false; setPosting(false); }
  };

  const loadMore = useCallback(async () => {
    if (!userId) return;
    const request = feedRequestRef.current;
    let pageRequest = pageRequestRef.current;
    const scope = feedScopeRef.current;
    const mode = feedModeRef.current;
    const isCurrent = () => request === feedRequestRef.current && pageRequest === pageRequestRef.current && scope === feedScopeRef.current
      && useAuthStore.getState().profile?.id === userId;
    if (feedRefreshRequestRef.current === request || loadingMoreRef.current || !hasMoreRef.current || (posts.length === 0 && mode !== 'discover')) return;
    loadingMoreRef.current = true;
    pageRequest = ++pageRequestRef.current;
    setLoadingMore(true);
    const deadline = setTimeout(() => {
      if (!isCurrent()) return;
      ++pageRequestRef.current;
      loadingMoreRef.current = false; setLoadingMore(false);
      setFeedError('Could not load more posts. Please try again.');
    }, 12_000);
    try {
      const cur = cursorRef.current;
      if (mode !== 'discover' && !cur) { hasMoreRef.current = false; return; }
      const category = discoverCatRef.current;
      const { data: moreRows, error: moreErr } = mode === 'discover'
        ? await supabase.rpc('get_discover_page', {
            p_category: category === 'all' || category === 'videos' ? null : category,
            p_video: category === 'videos', p_limit: PAGE_SIZE,
            p_offset: discoverPageRef.current.offset, p_as_of: discoverPageRef.current.asOf,
          })
        : await supabase.rpc('get_feed', { p_mode: feedModeToServer(mode), p_cursor_key: cur!.key, p_cursor_id: cur!.id, p_limit: PAGE_SIZE });
      if (!isCurrent()) return;
      if (moreErr) { setFeedError('Could not load more posts. Please try again.'); return; }
      setFeedError(null);
      const rows = (moreRows ?? []) as any[];
      if (rows.length === 0) { hasMoreRef.current = false; return; }
      const hydrated = await hydratePostMedia(rows);
      if (!isCurrent()) return;
      const scored = overlayCounts(hydrated.map(mapFeedRow)).filter(pp => !hiddenIdsRef.current.has(pp.id) && !isMuted(pp));
      hasMoreRef.current = rows.length >= PAGE_SIZE;
      cursorRef.current = { key: rows[rows.length - 1].sort_key, id: rows[rows.length - 1].post_id };
      if (mode === 'discover') discoverPageRef.current.offset += rows.length;
      hydrateShares(scored.map(pp => pp.id));
      hydrateCollabs(scored.map(pp => pp.id));
      hydratePolls(scored.map(pp => pp.id));
      setPosts(prev => { const have = new Set(prev.map(x => x.id)); const add: any[] = []; for (const p of scored) { if (!have.has(p.id)) { have.add(p.id); add.push(p); } } return [...prev, ...add]; });
      setProfilesMap(prev => { const pm = { ...prev }; rows.forEach((r: any) => { pm[r.author_id] = { id: r.author_id, full_name: r.author_name, username: r.author_username, avatar_url: r.author_avatar, is_verified: r.author_verified, verified_tier: r.author_verified_tier ?? null }; }); return pm; });
      setLikedPosts(prev => { const m = { ...prev }; rows.forEach((r: any) => { if (r.viewer_liked) m[r.post_id] = true; }); return m; });
      setBookmarkedPosts(prev => { const m = { ...prev }; rows.forEach((r: any) => { if (r.viewer_bookmarked) m[r.post_id] = true; }); return m; });
      setRepostedPosts(prev => { const m = { ...prev }; rows.forEach((r: any) => { if (r.viewer_reposted) m[r.post_id] = true; }); return m; });
      const ids = scored.map(p => p.id);
      const likerIds2 = scored.filter(p => p.likes_count > 0).map(p => p.id);
      if (likerIds2.length > 0) supabase.rpc('get_recent_likers', { post_ids: likerIds2 }).then(({ data }) => { if (isCurrent() && data) setLikerNames(prev => { const m = { ...prev }; (data ?? []).forEach((r: any) => { m[r.post_id] = r.liker_names ?? []; }); return m; }); });
      const qIds2 = Array.from(new Set(scored.map(p => p.quoted_post_id).filter(Boolean))) as string[];
      let qRows2: any[] = [];
      if (qIds2.length > 0) {
        const { data: qData } = await supabase.from('posts').select('id, content, body, user_id, media_url, post_media(url, media_type, sort_order, edit)').in('id', qIds2);
        if (!isCurrent()) return;
        qRows2 = qData ?? [];
        setQuotedMap(prev => { const qm = { ...prev }; qRows2.forEach((qr: any) => { qm[qr.id] = { content: qr.content ?? qr.body ?? '', user_id: qr.user_id, media: (() => { const pm = Array.isArray(qr.post_media) ? [...qr.post_media].sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) : []; return pm[0] ? { url: pm[0].url, media_type: pm[0].media_type, thumbnail_url: (pm[0] as any)?.edit?.coverUrl ?? null } : (qr.media_url ? { url: qr.media_url, media_type: 'image' } : null); })() }; }); return qm; });
      }
      const uids2 = Array.from(new Set([...scored.map(p => p.user_id), ...qRows2.map((qr: any) => qr.user_id)]));
      const missingU = uids2.filter(u => !profilesMap[u]);
      if (missingU.length > 0) {
        const { data: pData } = await supabase.from('profiles').select('id, full_name, username, avatar_url, profile_visibility, is_verified, verified_tier').in('id', missingU);
        if (!isCurrent()) return;
        if (pData) setProfilesMap(prev => { const pm = { ...prev }; pData.forEach((p: any) => { pm[p.id] = p; }); return pm; });
      }
      // viewer flags now arrive with the get_feed rows above
      const { data: cData } = await supabase.from('post_comments')
        .select('post_id, body, user_id, parent_comment_id, created_at, likes_count')
        .in('post_id', ids)
        .order('created_at', { ascending: false });
      if (!isCurrent()) return;
      if (cData && cData.length > 0) {
        // Preview rows can be capped independently of the total comment count.
        const topC = cData.filter((c: any) => !c.parent_comment_id);
        const aIds2 = Array.from(new Set(topC.map((c: any) => c.user_id).filter(Boolean)));
        const authors2: Record<string, any> = {};
        if (aIds2.length > 0) {
          const { data: aData } = await supabase.from('profiles').select('id, full_name, username').in('id', aIds2);
          if (!isCurrent()) return;
          (aData ?? []).forEach((a: any) => { authors2[a.id] = a; });
        }
        setCommentPreviews(prev => { const cp = { ...prev }; topC.forEach((c: any) => { const cur = cp[c.post_id]; if (!cur || (c.likes_count ?? 0) > (cur.likes ?? 0)) { const a = authors2[c.user_id]; cp[c.post_id] = { body: c.body, authorName: a?.full_name || a?.username || 'User', likes: c.likes_count ?? 0 }; } }); return cp; });
      }
    } catch (e) { if (isCurrent()) setFeedError('Could not load more posts. Please try again.'); }
    finally { clearTimeout(deadline); if (isCurrent()) { loadingMoreRef.current = false; setLoadingMore(false); } }
  }, [posts, userId, profilesMap]);

  useEffect(() => {
    if (feedMode === 'discover' && !loading && !loadingMore && !feedError && posts.length === 0 && hasMoreRef.current) void loadMore();
  }, [feedMode, loading, loadingMore, feedError, posts.length, loadMore]);

  const displayPosts = useMemo(() => {
    if (feedOwner !== userId) return [];
    let list = posts.filter(post => !isMuted(post) && !hiddenIdsRef.current.has(post.id)
      && (feedMode === 'discover' || !isMarketplacePost(post)));
    const term = search.trim().toLowerCase();
    if (term) list = list.filter(p => (p.content || '').toLowerCase().includes(term));
    // No client-side re-sort. get_feed already returns rows in sort_key order,
    // which carries gravity decay, follow weighting, affinity, the seen penalty,
    // author diversity and trending velocity. Re-sorting here by the old
    // scorePost formula threw all of that away on the one tab where it matters,
    // and the churn it caused in list identity stopped onViewableItemsChanged
    // from firing, which is why videos never autoplayed on For You.
    if (feedMode === 'latest') {
      list.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    }
    const wtfVisible = wtfSuggestions.filter((p: any) => !followingIds.has(p.id));
    if (!search && feedMode !== 'discover' && wtfVisible.length >= 3 && list.length > 8) {
      list = [...list.slice(0, 8), { id: '__wtf', __suggestions: true } as any, ...list.slice(8)];
    }
if (!search && feedMode !== 'discover' && promos.length > 0) {
      const promoIds = new Set(promos.map(p => p.id)); list = list.filter(p => !promoIds.has(p.id));
      const eligible = promos.filter(post => !isMarketplacePost(post));
      if (eligible.length > 0) {
        const out: any[] = [];
        let pi = 0;
        list.forEach((p, i) => {
          out.push(p);
          if ((i + 1) % 6 === 0 && pi < eligible.length) out.push(eligible[pi++]);
        });
        if (pi < eligible.length && out.length > 0 && out.length < 6) out.push(eligible[pi++]);
        list = out;
      }
    }
    if (!search && feedMode === 'forYou' && marketplaceItems.length && list.length >= MARKETPLACE_SHELF_AFTER) {
      list = [...list.slice(0, MARKETPLACE_SHELF_AFTER), { id: '__marketplace', media: [], products: [] } as unknown as Post, ...list.slice(MARKETPLACE_SHELF_AFTER)];
    }
    return list;
  }, [posts, feedMode, discoverCat, search, followingIds, wtfSuggestions, promos, isMuted, feedOwner, userId, marketplaceItems]);

  useEffect(() => {
    if (!screenFocused || AppState.currentState !== 'active' || dataSaver) return;
    const activeIndex = Math.max(0, displayPosts.findIndex(post => post.id === activePostId));
    const urls = feedPrefetchUrls(displayPosts, activeIndex + 1, dataSaver)
      .filter(url => !prefetchedImagesRef.current.has(url));
    if (!urls.length) return;
    if (prefetchedImagesRef.current.size > 80) prefetchedImagesRef.current.clear();
    urls.forEach(url => prefetchedImagesRef.current.add(url));
    void ExpoImagePrefetch.prefetch(urls).catch(() => {
      urls.forEach(url => prefetchedImagesRef.current.delete(url));
    });
  }, [displayPosts, activePostId, dataSaver, screenFocused, appActive]);

  const videoPosts = useMemo(() => displayPosts
    .filter((p: any) => Array.isArray(p.media) && p.media.some((m: any) => m.media_type === 'video'))
    .map((p: any) => ({
      id: p.id,
      authorId: p.user_id,
      url: (p.media.find((m: any) => m.media_type === 'video') as any).url,
      edit: (p.media.find((m: any) => m.media_type === 'video') as any).edit ?? null,
      authorName: profilesMap[p.user_id]?.full_name || profilesMap[p.user_id]?.username || 'Member',
      authorAvatar: profilesMap[p.user_id]?.avatar_url || null,
      caption: p.content || '',
      likes: p.likes_count || 0,
      comments: p.comments_count || 0,
    })), [displayPosts, profilesMap]);

  const renderMedia = useCallback((post: any, isActive: boolean, onMediaPress?: (idx?: number, at?: number) => void) => {
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
  }, [SCREEN_W]);

  const openHashtag = useCallback((tag: string) => {
    navigation.navigate('TrendFeed', { tag });
  }, [navigation]);

  const openMention = useCallback(async (uname: string) => {
    const { data } = await supabase.from('profiles').select('id, full_name, username, avatar_url').eq('username', uname).maybeSingle();
    if (data?.id) { prefetch('profile:' + data.id, async () => (await supabase.rpc('get_profile', { p_profile_id: data.id })).data); navigation.navigate('UserProfile', { userId: data.id, user: data }); }
  }, [navigation]);

  const openComments = useCallback((post: Post) => {
    // The card stays where it is; the sheet lifts its media into the stage and settles it back on close.
    commentsForRef.current = post;
    setActivePostId(post.id);
    setCommentsHold(true);
    setCommentsFor(post);
  }, []);
  const renderPost = useCallback(({ item: post }: { item: Post }) => {
    if (post.id === '__marketplace') return <MarketplaceShelf items={marketplaceItems}
      onOpen={listingId => navigation.navigate('Market', { screen: 'ListingDetail', params: { listingId } })}
      onExplore={() => navigation.navigate('Market')}
      onGesture={active => { mediaTouchRef.current = active; }} />;
    // Discover is a grid of tiles, the web Discover's twin, not a feed.
    if (feedModeRef.current === 'discover' && !(post as any).__suggestions && !(post as any)._promo && !String(post.id).startsWith('__')) {
      return (
        <DiscoverTile post={post as any} author={profilesMap[post.user_id]} width={TILE_W} onPress={() => setDiscoverOpen(post.id)} />
      );
    }
    if ((post as any).__suggestions) {
      const vis = wtfSuggestions.filter((p: any) => !followingIds.has(p.id)).slice(0, 8);
      if (vis.length === 0) return <View />;
      return (
        <View style={{ paddingTop: 12, paddingBottom: 14, borderBottomWidth: 6, borderBottomColor: t.surface.sunken, backgroundColor: getTheme().surface.canvas }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: getTheme().ink.primary, paddingHorizontal: 16, marginBottom: 10, letterSpacing: -0.1 }}>Who to follow</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }} onTouchStart={() => { mediaTouchRef.current = true; }} onTouchEnd={() => { mediaTouchRef.current = false; }} onTouchCancel={() => { mediaTouchRef.current = false; }}>
            {vis.map((p: any) => (
              <View key={p.id} style={{ width: 148, borderWidth: StyleSheet.hairlineWidth, borderColor: getTheme().surface.hairline, borderRadius: 14, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 10, backgroundColor: getTheme().surface.canvas }}>
                <TouchableOpacity activeOpacity={0.8} style={{ alignItems: 'center' }} onPress={() => { prefetch('profile:' + p.id, async () => (await supabase.rpc('get_profile', { p_profile_id: p.id })).data); navigation.navigate('UserProfile', { userId: p.id, user: p }); }}>
                  {p.avatar_url ? <ExpoImage source={{ uri: p.avatar_url }} style={{ width: 56, height: 56, borderRadius: 28 }} contentFit="cover" /> : <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: getTheme().status.linkBg, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 18, fontWeight: '700', color: getTheme().status.link }}>{initials(p.full_name || p.username)}</Text></View>}
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                    <TierName userId={p.id} baseStyle={{ fontSize: 13.5, fontWeight: '700', color: getTheme().ink.primary, flexShrink: 1 }} text={p.full_name || p.username || 'Member'} />
                    <VerifiedBadge userId={p.id} size={12} />
                  </View>
                  <Text style={{ fontSize: 11.5, color: getTheme().ink.muted, marginTop: 2 }} numberOfLines={1}>{p.headline || (p.username ? '@' + p.username : '')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => toggleFollow(p.id)} activeOpacity={0.8} style={{ marginTop: 10, paddingHorizontal: 22, paddingVertical: 7, borderRadius: 16, backgroundColor: NAVY }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: getTheme().ink.inverse }}>Follow</Text>
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
    const openPost = () => { if (isSharing) return; try { ((post as any).media || []).slice(0, 4).forEach((m: any) => { if (m?.url && m.media_type !== 'video') ExpoImagePrefetch.prefetch(m.url).catch(() => {}); }); } catch {} navigation.navigate('Post', { postId: post.id, media: Array.isArray((post as any).media) && (post as any).media.length > 0 ? (post as any).media : undefined }); };

    return (
      <View style={s.postCard}>
        <View style={s.postTopRow}>
          <TouchableOpacity style={s.postMeta} onPress={() => { prefetch('profile:' + post.user_id, async () => (await supabase.rpc('get_profile', { p_profile_id: post.user_id })).data); navigation.navigate('UserProfile', { userId: post.user_id, user: author }); }} activeOpacity={0.8}>
            {(() => {
              const ring = postRings[post.user_id];
              const ringStyle = ring === undefined ? null
                : ring ? { borderWidth: 2.5, borderColor: '#B08D3F', borderRadius: 999, padding: 2 }
                : { borderWidth: 2, borderColor: 'rgba(11,30,61,0.18)', borderRadius: 999, padding: 2 };
              const av = author?.avatar_url
                ? <ExpoImage source={{ uri: author.avatar_url }} style={s.avatar} contentFit="cover" cachePolicy="memory-disk" transition={150} />
                : <View style={s.avatarFb}><Text style={s.avatarFbTxt}>{initials(author?.full_name || author?.username)}</Text></View>;
              if (ring === undefined) return av;
              return (
                <TouchableOpacity activeOpacity={0.8} style={ringStyle}
                  onPress={() => (navigation as any).navigate('StoryViewer', { userId: post.user_id })}>
                  {av}
                </TouchableOpacity>
              );
            })()}
            <View style={s.postMetaTxt}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
                <TierName tier={(author as any)?.verified_tier ?? (((author as any)?.is_verified) ? 'business' : null)} baseStyle={s.postAuthor} text={author?.full_name || 'Member'} />
                <VerifiedBadge userId={(author as any)?.id} size={13} />
                {(() => { const list = uniqueCollaborators(collabs[post.id] || [], post.user_id); if (!list.length) return null; if (list.length === 1) { const x: any = list[0]; return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Text style={{ color: t.ink.secondary, fontSize: 13 }}>with</Text>
                    <TouchableOpacity accessibilityRole="link" accessibilityLabel={`Collaborator ${x.full_name || x.username || 'Member'}${x.username ? ', @' + x.username : ''}`} onPress={() => navigation.navigate('UserProfile', { userId: x.id })} activeOpacity={0.7}>
                      <TierName userId={x.id} baseStyle={s.postAuthor} text={collaborationName(x, author?.full_name || author?.username)} />
                    </TouchableOpacity>
                    <VerifiedBadge userId={x.id} size={13} />
                  </View>
                ); } return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Text style={{ color: t.ink.secondary, fontSize: 13 }}>with</Text>
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`View ${list.length} collaborators`} onPress={() => setCollabSheet([...list])} activeOpacity={0.7}><Text style={s.postAuthor}>{list.length} collaborators</Text></TouchableOpacity>
                  </View>
                ); })()}
              </View>
              <Text style={s.postSub}>{author?.username ? `@${author.username}` : ''}{author?.username && post.created_at ? ' · ' : ''}{relTime(post.created_at)}{post.channel === 'innovation' && <Text style={{ color: getTheme().status.innovation, fontWeight: '700' }}> · Innovation</Text>}</Text>
              {(post as any)._promo && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3, alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: t.surface.sunken }}>
                  <Feather name="briefcase" size={10} color={t.ink.secondary} />
                  <Text style={{ fontSize: 10, fontWeight: '800', color: t.ink.secondary, letterSpacing: 0.3 }}>{String((post as any)._promo.label || 'Sponsored').toUpperCase()}</Text>
                </View>
              )}
              {post.is_trending && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3, alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: getTheme().status.innovationBg }}>
                  <Feather name="trending-up" size={10} color={getTheme().status.innovation} />
                  <Text style={{ fontSize: 10, fontWeight: '800', color: getTheme().status.innovation, letterSpacing: 0.3 }}>TRENDING</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
          {userId && post.user_id !== userId && (() => {
            const isFollowing = followingIds.has(post.user_id);
            const isRequested = requestedIds.has(post.user_id);
            return (
              <TouchableOpacity
                onPress={() => toggleFollow(post.user_id)}
                activeOpacity={0.8}
                style={[
                  { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, borderWidth: 1, marginRight: 6 },
                  isFollowing || isRequested
                    ? { borderColor: getTheme().surface.hairline, backgroundColor: 'transparent' }
                    : { borderColor: NAVY, backgroundColor: NAVY },
                ]}
                accessibilityLabel={isFollowing ? 'Following' : 'Follow'}
              >
                <Text style={{ fontSize: 12.5, fontWeight: '600', color: (isFollowing || isRequested) ? t.ink.secondary : t.ink.inverse }}>
                  {isFollowing ? 'Following' : isRequested ? 'Requested' : 'Follow'}
                </Text>
              </TouchableOpacity>
            );
          })()}
          {/* followChipOn */}
          <TouchableOpacity style={s.menuBtn} onPress={() => setMenuPost(post)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="more-horizontal" size={18} color={getTheme().ink.muted} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity activeOpacity={0.95} onPress={() => handleDoubleTap(post.id, openPost)}>
          {(post as any).link && (!post.media || post.media.length === 0) && !(post as any).article_title ? (
            <TouchableOpacity style={s.articleCard} activeOpacity={0.85}
              onPress={() => Linking.openURL((post as any).link.url).catch(() => {})}>
              {(post as any).link.image_url ? (
                <Image source={{ uri: (post as any).link.image_url }} style={s.articleCover} />
              ) : null}
              <View style={s.articleBody}>
                <Text style={s.articleKicker}>{String((post as any).link.domain || 'LINK').toUpperCase()}</Text>
                <Text style={s.articleTitle} numberOfLines={2}>{(post as any).link.title || (post as any).link.url}</Text>
                {(post as any).link.description ? (
                  <Text style={s.articleExcerpt} numberOfLines={2}>{(post as any).link.description}</Text>
                ) : null}
              </View>
            </TouchableOpacity>
          ) : null}
          {(post as any).channel === 'innovation' && ((post as any).innovation_field || (post as any).innovation_stage) ? (
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
              {(post as any).innovation_field ? (
                <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 99, backgroundColor: 'rgba(217,119,6,0.12)' }}>
                  <Text style={{ fontSize: 10.5, fontWeight: '700', color: t.status.innovation }}>{(post as any).innovation_field}</Text>
                </View>
              ) : null}
              {(post as any).innovation_stage ? (
                <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 99, backgroundColor: 'rgba(11,30,61,0.08)' }}>
                  <Text style={{ fontSize: 10.5, fontWeight: '700', color: t.ink.primary }}>{(post as any).innovation_stage}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {(post as any).article_title ? (
            <TouchableOpacity
              style={s.articleCard}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('ArticleReader', { article: {
                title: (post as any).article_title,
                body: post.content,
                cover: post.media?.[0]?.media_type === 'image' ? post.media[0].url : ((post as any).media_url || null),
                author: author?.full_name || 'Member',
                readMinutes: (post as any).read_minutes || null,
              } })}
            >
              {post.media?.[0]?.media_type === 'image' ? (
                <Image source={{ uri: post.media[0].url }} style={s.articleCover} />
              ) : null}
              <View style={s.articleBody}>
                <Text style={s.articleKicker}>ARTICLE</Text>
                <Text style={s.articleTitle} numberOfLines={3}>{(post as any).article_title}</Text>
                <Text style={s.articleExcerpt} numberOfLines={3}>{stripMd(post.content)}</Text>
                <Text style={s.articleMeta}>
                  {(post as any).read_minutes ? (post as any).read_minutes + ' min read' : 'Read article'}
                </Text>
              </View>
            </TouchableOpacity>
          ) : (
            (() => {
              const bodyText = post.content || '';
              const isLong = bodyText.length > 600 || bodyText.split('\n').length > 12;
              const isExpanded = !!expandedPosts[post.id];
              return (
                <View style={s.content}>
                  <View style={!isExpanded && isLong ? { maxHeight: 260, overflow: 'hidden' } : undefined}>
                    <ArticleBody text={bodyText} onMention={openMention} onHashtag={openHashtag} />
                  </View>
                  {isLong && (
                    <TouchableOpacity
                      onPress={() => setExpandedPosts((prev: Record<string, boolean>) => ({ ...prev, [post.id]: !prev[post.id] }))}
                      activeOpacity={0.7}
                      style={{ marginTop: 4 }}
                    >
                      <Text style={s.readMoreBtn}>{isExpanded ? 'Show less' : 'Read more'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })()
          )}
        </TouchableOpacity>
        {(() => {
          const qid = post.quoted_post_id;
          if (!qid) return null;
          const q = quotedMap[qid];
          const qAuthor = q ? profilesMap[q.user_id] : undefined;
          return (
            <View style={{ marginHorizontal: 16, marginTop: 10 }}>
              <SharedPostCard layout="compact" post={q ? { id: qid, content: q.content, author: qAuthor ? { id: q.user_id, full_name: qAuthor.full_name, username: qAuthor.username, avatar_url: qAuthor.avatar_url } : { id: q.user_id }, media: (q as any)?.media || null } : null} onPress={() => navigation.navigate('Post', { postId: qid })} />
            </View>
          );
        })()}

        {pollPosts[post.id] ? <PollCard postId={post.id} /> : null}
        {(() => {
          const openViewer = (idx?: number, at?: number) => {
            const items: any[] = (post.media && post.media.length > 0) ? post.media : (post.media_url ? [{ url: post.media_url, media_type: 'image' }] : []);
            const tappedItem = items[idx ?? 0];
            if (items.length === 1 && tappedItem?.media_type === 'video') { setFsVideo({ id: post.id, url: tappedItem.url, at: at || 0 } as any); return; }
            if (!items.length) { openPost(); return; }
            const media = items.map((item, index) => ({ ...item, id: item.id || `${post.id}:${index}`, sort_order: item.sort_order ?? index, media_type: item.media_type === 'video' ? 'video' as const : 'image' as const }));
            if (tappedItem?.media_type === 'video' && at) seekWhenClaimed(tappedItem.url, at);
            setViewer({ media, index: idx ?? 0, postId: post.id });
          };
          // An article's picture is its cover, drawn inside the article block; the media strip would show it twice.
          if ((post as any).article_title) return null;
          const media = renderMedia(post, screenFocused && appActive && !fsVideo && !viewer && !commentsHold && post.id === activePostId, (idx?: number, at?: number) => handleDoubleTap(post.id, () => openViewer(idx, at)));
          if (!media) return null;
          const isVidPost = post.media?.some((m: any) => m.media_type === 'video') || false;
          return (
            <View style={{ position: 'relative' }} ref={(node) => { if (node) mediaNodeRef.current[post.id] = node; }} onLayout={(e) => { mediaYRef.current[post.id] = e.nativeEvent.layout.y; }}>
              <View
                onTouchStart={() => { mediaTouchRef.current = true; }}
                onTouchEnd={() => { mediaTouchRef.current = false; }}
                onTouchCancel={() => { mediaTouchRef.current = false; }}
              >
                {media}
              </View>

              {heartPost === post.id && (
                <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', opacity: heartAnim, transform: [{ scale: heartAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.3] }) }] }}>
                  <Ionicons name="heart" size={88} color="#FF3040" style={{ textShadowColor: 'rgba(255,255,255,0.55)', textShadowRadius: 14 }} />
                </Animated.View>
              )}
              {isVidPost && (post.views_count ?? 0) > 0 && (
                <TouchableOpacity disabled={post.user_id !== userId} onPress={() => openPostViewers(post)} activeOpacity={0.8} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ position:'absolute', bottom:10, left:10, flexDirection:'row', alignItems:'center', gap:4, backgroundColor:'rgba(0,0,0,0.55)', borderRadius:12, paddingHorizontal:8, paddingVertical:4 }}>
                  <Feather name="eye" size={11} color={getTheme().ink.inverse} />
                  <Text style={{ color:getTheme().ink.inverse, fontSize:11, fontWeight:'600' }}>{fmtCount(post.views_count ?? 0)}</Text>
                  {post.user_id === userId ? <Feather name="chevron-right" size={11} color={getTheme().ink.inverse} /> : null}
                </TouchableOpacity>
              )}
            </View>
          );
        })()}

        {post.thread_parent_id && (
          <TouchableOpacity style={{ paddingHorizontal: 16, paddingTop: 8 }} onPress={openPost} activeOpacity={0.8}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: NAVY }}>Show this thread</Text>
          </TouchableOpacity>
        )}
        <View style={s.actions}>
          <TouchableOpacity style={s.pill} onPress={() => toggleLike(post.id)} activeOpacity={0.75} disabled={isBusy(`like-${post.id}`)}>
            <Ionicons name={isLiked ? 'heart' : 'heart-outline'} size={22} color={isLiked ? '#FF3040' : getTheme().ink.muted} />
            <Text style={[s.pillTxt, isLiked && s.pillTxtLiked]}>{post.likes_count > 0 ? fmtCount(post.likes_count) : ''}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.pill} onPress={() => openComments(post)} activeOpacity={0.75} disabled={isSharing}>
            <Feather name="message-circle" size={20} color={getTheme().ink.muted} />
            <Text style={s.pillTxt}>{post.comments_count > 0 ? fmtCount(post.comments_count) : ''}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.pill} onPress={() => { if (isReposted) { toggleRepost(post.id); } else { Alert.alert('Repost this?', '', [{ text: 'Repost', onPress: () => toggleRepost(post.id) }, { text: 'Quote', onPress: () => { if (!canEditPostDraft()) return; setQuotingPost(post); setComposerOpen(true); } }, { text: 'Cancel', style: 'cancel' }]); } }} activeOpacity={0.75} disabled={isBusy(`rp-${post.id}`)}>
            <Feather name="repeat" size={20} color={isReposted ? getTheme().status.success : getTheme().ink.muted} />
            <TouchableOpacity onPress={() => openLikers(post, 'reposts')} hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }} activeOpacity={0.7}><Text style={[s.pillTxt, isReposted && s.pillTxtReposted]}>{(post.reposts_count + (post.quotes_count ?? 0)) > 0 ? fmtCount(post.reposts_count + (post.quotes_count ?? 0)) : ''}</Text></TouchableOpacity>
          </TouchableOpacity>

          <TouchableOpacity style={[s.pill, s.pillIcon]} onPress={() => toggleBookmark(post.id)} activeOpacity={0.75} disabled={isBusy(`bk-${post.id}`)}>
            <Ionicons name={isBookmarked ? 'bookmark' : 'bookmark-outline'} size={20} color={isBookmarked ? getTheme().status.link : getTheme().ink.muted} />{(post.bookmarks_count ?? 0) > 0 ? <Text style={{ fontSize: 13, color: isBookmarked ? getTheme().status.link : getTheme().ink.muted, marginLeft: 5, fontWeight: '600' }}>{fmtCount(post.bookmarks_count)}</Text> : null}
          </TouchableOpacity>

          <TouchableOpacity style={[s.pill, s.pillIcon]} onPress={() => setSharePostTarget(post)} activeOpacity={0.75}>
            <Feather name="share-2" size={20} color={getTheme().ink.muted} />{(post.shares_count ?? 0) > 0 ? <Text style={{ fontSize: 13, color: getTheme().ink.muted, marginLeft: 5, fontWeight: '600' }}>{fmtCount(post.shares_count ?? 0)}</Text> : null}
          </TouchableOpacity>
        </View>
        {post.products && post.products.length > 0 && (/* carousel holds the tab swipe */
          <View onTouchStart={() => { mediaTouchRef.current = true; }} onTouchEnd={() => { mediaTouchRef.current = false; }} onTouchCancel={() => { mediaTouchRef.current = false; }}>
            <ProductCarousel
              products={post.products}
              onOpenLink={() => { const pr = (post as any)._promo; if (pr?.id) supabase.rpc('record_ad_event', { p_promo_id: pr.id, p_kind: 'click' }).then(() => {}, () => {}); }}
              onOpenListing={(listingId) =>
                navigation.navigate('Market', { screen: 'ListingDetail', params: { listingId } })
              }
            />
          </View>
        )}

        {post.likes_count > 0 && (
          <TouchableOpacity style={{ paddingHorizontal: 16, paddingTop: 4 }} onPress={() => openLikers(post)} activeOpacity={0.8}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: getTheme().ink.primary }}>
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
              <Text style={s.cpAuthor}>{preview.authorName} </Text>{preview.body}{(preview.likes ?? 0) > 0 ? <Text style={{ color: getTheme().ink.muted }}>{'  ·  ' + fmtCount(preview.likes!) + ((preview.likes === 1) ? ' like' : ' likes')}</Text> : null}
            </Text>
            {post.comments_count > 1 && <Text style={s.viewAll}>View all {post.comments_count} comments</Text>}
          </TouchableOpacity>
        )}
      </View>
    );
  }, [
    t,
    marketplaceItems,
    TILE_W,
    activePostId,
    screenFocused,
    appActive,
    fsVideo,
    commentsHold,
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
    openComments,
  ]);

  const flatListExtra = String(heartPost) + '|' + String(activePostId) + '|' + String(screenFocused && appActive) + '|' + String(!!fsVideo) + '|' + String(commentsHold);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={getTheme().surface.canvas} />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} enabled={!composerOpen}>
        <View style={s.container}>
          <View style={s.header}>
            <View style={s.headerRow}>
              <Text style={s.logo}>Platinum<Text style={{ color: '#8E9BAE' }}>Circles</Text></Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <TouchableOpacity
                style={s.iconBtn}
                onPress={() => navigation.navigate('Search')}
                accessibilityRole="button"
                accessibilityLabel="Search"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="search" size={20} color={getTheme().ink.primary} />
              </TouchableOpacity>
              <TouchableOpacity style={s.iconBtn} onPress={() => navigation.navigate('Notifications')}>
                <View>
                  <Feather name="bell" size={20} color={getTheme().ink.primary} />
                  {unreadNotifs > 0 && (
                    <View style={[s.bellBadge, { minWidth: 10, width: 10, height: 10, borderRadius: 5, paddingHorizontal: 0 }]}>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
              </View>
            </View>

            <View style={s.tabRow}>
              {(['forYou', 'latest', 'discover', 'trending'] as const).map(m => {
                const on = feedMode === m;
                const label = m === 'forYou' ? 'For You' : m === 'latest' ? 'Latest' : m === 'discover' ? 'Discover' : 'Trending';
                const accent = m === 'discover' ? t.status.innovation : t.ink.primary;
                return (
                  <TouchableOpacity key={m} style={{ alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4, marginRight: 14 }} onPress={() => setFeedMode(m)} activeOpacity={0.7}>
                    <Text style={{ fontSize: 15, fontWeight: on ? '800' : '500', color: on ? t.ink.primary : t.ink.secondary, letterSpacing: -0.2 }}>{label}</Text>
                    <View style={{ height: 3, width: 20, borderRadius: 2, marginTop: 5, backgroundColor: on ? accent : 'transparent' }} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {visibleFeedScope !== feedScopeRef.current ? <FeedSkeleton /> : feedError && posts.length === 0 ? (
            <View style={[s.emptyWrap, { flex: 1, justifyContent: 'center' }]}>
              <Feather name="alert-circle" size={40} color={getTheme().ink.faint} />
              <Text style={s.emptyTitle}>Could not load your feed</Text>
              <Text style={s.emptySub}>{feedError}</Text>
              <TouchableOpacity
                style={s.emptyBtn}
                onPress={() => { setFeedError(null); loadFeed(true); }}
                accessibilityRole="button"
                accessibilityLabel="Retry loading the feed"
              >
                <Text style={s.emptyBtnTxt}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (loading && posts.length === 0) ? (
            <FeedSkeleton />
          ) : (
            <View style={s.flex} {...tabSwipe.panHandlers}>
              <NewPostsPill count={pendingPostCount} onPress={() => { setRefreshing(true); loadFeed(false); feedListRef.current?.scrollToOffset({ offset: 0, animated: true }); }} />
            <TapTopFlatList innerRef={feedListRef} key={feedMode === 'discover' ? 'discover-grid' : 'feed-list'} numColumns={feedMode === 'discover' ? 2 : 1} columnWrapperStyle={feedMode === 'discover' ? { paddingHorizontal: 12, gap: 10, marginBottom: 10 } : undefined}
              data={displayPosts}
              onScroll={(event: any) => { scrollOffsetRef.current = event.nativeEvent.contentOffset.y; handleTabBarScroll(event); }}
              scrollEventThrottle={16}
              keyExtractor={(p: Post) => p._rk ?? p.id}
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
              ListHeaderComponent={
                <>
                  <AnnouncementBanner />
                  {feedMode === 'trending' && <TrendingStoriesRail />}
                  {feedMode === 'discover' && (
                    <ScrollView ref={discoverPillsRef} horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled directionalLockEnabled bounces={false} scrollEventThrottle={16} onScroll={(e) => { discoverPillsXRef.current = e.nativeEvent.contentOffset.x; }} onLayout={restoreDiscoverPills} onContentSizeChange={restoreDiscoverPills} onTouchStart={() => { mediaTouchRef.current = true; }} onTouchEnd={() => { setTimeout(() => { mediaTouchRef.current = false; }, 150); }} onTouchCancel={() => { setTimeout(() => { mediaTouchRef.current = false; }, 150); }} onScrollBeginDrag={() => { mediaTouchRef.current = true; }} onScrollEndDrag={() => { setTimeout(() => { mediaTouchRef.current = false; }, 150); }} contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4, gap: 6 }}>
                      {[{ key: 'all', label: 'All' }, { key: 'videos', label: 'Videos' }, ...CATEGORIES].map(c => (
                        <TouchableOpacity key={c.key} onPress={() => { restoreDiscoverPills(); setDiscoverCat(c.key); }}
                          style={{ paddingHorizontal: 13, paddingVertical: 6, borderRadius: 99, backgroundColor: discoverCat === c.key ? getTheme().brand.base : getTheme().surface.sunken }}>
                          <Text style={{ fontSize: 12.5, fontWeight: '700', color: discoverCat === c.key ? getTheme().ink.inverse : getTheme().ink.secondary }}>{c.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                  {feedError ? (
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', gap: 8,
                      marginHorizontal: 14, marginTop: 4, marginBottom: 8,
                      paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12,
                      backgroundColor: getTheme().status.dangerBg,
                    }}>
                      <Feather name="alert-circle" size={15} color={getTheme().status.danger} />
                      <Text
                        style={{ flex: 1, fontSize: 12.5, fontWeight: '600', color: getTheme().status.danger }}
                        numberOfLines={2}
                      >
                        {feedError}
                      </Text>
                      <TouchableOpacity
                        onPress={() => { setFeedError(null); loadFeed(true); }}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityRole="button"
                        accessibilityLabel="Retry loading the feed"
                      >
                        <Text style={{ fontSize: 12.5, fontWeight: '800', color: getTheme().status.danger }}>Retry</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                  {(feedMode === 'forYou' || feedMode === 'latest') && <StoryBar />}
                  <TrendingTopicsStrip />
                </>
              }
              contentContainerStyle={[s.list, !displayPosts.length && s.listEmpty, { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }]}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadFeed(false); refreshMarketplace(); setMomentRefreshKey(k => k + 1); }} tintColor={NAVY} />}
              ListEmptyComponent={
                feedMode === 'discover' ? (
                  <View style={s.emptyWrap}>
                    <Text style={s.emptyTitle}>Nothing here yet</Text>
                    <Text style={s.emptySub}>The Innovation channel is for Zimbabwe's builders - science, engineering, inventions and the people behind them. Share what you are working on.</Text>
                    <TouchableOpacity style={s.emptyBtn} onPress={() => setComposerOpen(true)}><Text style={s.emptyBtnTxt}>Post your work</Text></TouchableOpacity>
                  </View>
                ) : feedMode === 'trending' ? (
                  <View style={s.emptyWrap}>
                    <Text style={s.emptyTitle}>Nothing is trending right now</Text>
                    <Text style={s.emptySub}>Trending is earned. When a post or story gets real engagement from real people, it appears here.</Text>
                  </View>
                ) : (
                  <View style={s.emptyWrap}>
                    <Text style={s.emptyTitle}>{search ? 'No posts found' : 'Welcome to PlatinumCircles'}</Text>
                    <Text style={s.emptySub}>{search ? 'Try a different search.' : 'Be the first to share something.'}</Text>
                    {!search && <TouchableOpacity style={s.emptyBtn} onPress={() => setComposerOpen(true)}><Text style={s.emptyBtnTxt}>Create a post</Text></TouchableOpacity>}
                  </View>
                )
              }
            />
            </View>
          )}

          {composerOpen && (
            <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={()=>{if(!posting){setComposerOpen(false);Keyboard.dismiss();}}}>
            <KeyboardAvoidingView style={[s.composerContainer,{paddingTop:insets.top,paddingBottom:Math.max(insets.bottom,12)}]} behavior={Platform.OS==='ios'?'padding':'height'}>
              <View style={s.cHeader}><TouchableOpacity disabled={posting} style={s.cHeaderCancel} onPress={()=>{if(composerReview&&!publicationLocked)setComposerReview(false);else{setComposerOpen(false);Keyboard.dismiss();}}}><Text style={s.cHeaderCancelText}>{composerReview&&!publicationLocked?'Edit':'Cancel'}</Text></TouchableOpacity><Text style={s.cHeaderTitle}>{posting?'Sharing your moment':composerReview?'Review post':'New post'}</Text><TouchableOpacity accessibilityRole="button" disabled={posting||(!composerText.trim()&&!composerMedia.length)} onPress={()=>{Keyboard.dismiss();if(composerReview||publicationLocked)void createPost();else setComposerReview(true);}} style={[s.postBtn,(posting||(!composerText.trim()&&!composerMedia.length))&&s.postBtnOff]}>{posting?<ActivityIndicator color={t.ink.inverse}/>:<Text style={s.postBtnTxt}>{publicationLocked?'Retry':composerReview?'Post':'Review'}</Text>}</TouchableOpacity></View>
              {composerReview&&!posting?<View style={s.cReviewHint}><Text style={s.cReviewHintText}>Ready to share with {AUD_META[postAudience].label.toLowerCase()}? Check your media and caption, then tap Post.</Text></View>:null}
              {posting?<View accessibilityLiveRegion="polite" style={s.cProgress}><View style={{flexDirection:'row',justifyContent:'space-between',gap:12}}><Text style={s.cProgressTitle}>{postProgress.label||'Preparing your post'}</Text>{postProgress.total>0?<Text style={s.cProgressTitle}>{postProgress.completed}/{postProgress.total}</Text>:null}</View><View style={s.cProgressTrack}><View style={[s.cProgressFill,{width:`${postProgress.total?postProgress.completed/postProgress.total*100:0}%`}]}/></View><ScrollView style={{maxHeight:150}} contentContainerStyle={{gap:8}}>{composerMedia.map((media,index)=><View key={media.uri} style={s.cUploadRow}><Image source={{uri:media.type==='video'?(media.edit?.coverLocalUri||media.thumbnail||media.uri):media.uri}} style={s.cUploadThumb}/><Text style={[s.cProgressTitle,{flex:1}]}>{media.type==='video'?'Video':'Photo'} {index+1}</Text>{index<postProgress.completed?<Feather name="check-circle" color="#496B51" size={18}/>:index===postProgress.completed?<ActivityIndicator size="small" color="#775D32"/>:<Feather name="clock" color="#716856" size={17}/>}<Text style={s.cProgressText}>{index<postProgress.completed?'Uploaded':index===postProgress.completed?'Uploading':'Waiting'}</Text></View>)}</ScrollView><Text style={[s.cProgressText,{marginTop:10}]}>Keep Platinum open on this feed until your post is confirmed.</Text><TouchableOpacity accessibilityRole="button" onPress={()=>{Keyboard.dismiss();setComposerOpen(false);}} style={s.cContinue}><Text style={s.cProgressTitle}>Continue browsing this feed</Text><Feather name="arrow-right" size={17} color={t.ink.primary}/></TouchableOpacity></View>:null}
              {threadingPost && (
                <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: getTheme().surface.canvas, borderColor: getTheme().surface.hairline, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 6, gap: 6 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: getTheme().ink.secondary }}>Adding to your thread</Text>
                  <TouchableOpacity onPress={() => { if (canEditPostDraft()) setThreadingPost(null); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Feather name="x" size={13} color={getTheme().ink.muted} />
                  </TouchableOpacity>
                </View>
              )}
              {quotingPost && (
                <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: getTheme().surface.canvas, borderColor: getTheme().surface.hairline, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 6, gap: 6 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: getTheme().ink.secondary }}>Quoting {profilesMap[quotingPost.user_id]?.full_name || profilesMap[quotingPost.user_id]?.username || 'post'}</Text>
                  <TouchableOpacity onPress={() => { if (canEditPostDraft()) setQuotingPost(null); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Feather name="x" size={13} color={getTheme().ink.muted} />
                  </TouchableOpacity>
                </View>
              )}
              {mentionActive && mentionResults.length > 0 && (
                <View style={s.mentionDropdown}>
                  {mentionResults.map(u => (
                    <TouchableOpacity key={u.id} style={s.mentionRow} onPress={() => insertMention(u)}>
                      {u.avatar_url ? <Image source={{ uri: u.avatar_url }} style={s.mAvatar} fadeDuration={200} /> : <View style={s.mAvatarFb}><Text style={s.mAvatarTxt}>{initials(u.full_name || u.username)}</Text></View>}
                      <View><Text style={s.mName}><TierName userId={((u) as any)?.id ?? ((u) as any)?.user_id} baseStyle={s.mName} text={u.full_name || ''} /> <VerifiedBadge userId={((u) as any)?.id ?? ((u) as any)?.user_id} size={12} /></Text><Text style={s.mUser}>@{u.username}</Text></View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {publicationLocked && <TouchableOpacity disabled={posting} onPress={createPost} accessibilityRole="button" style={{ padding: 14, backgroundColor: getTheme().surface.canvas, borderRadius: 14, marginBottom: 8 }}><Text style={{ color: getTheme().ink.primary, fontWeight: '700' }}>{posting ? 'Finishing your post…' : 'Finish post'}</Text><Text style={{ color: getTheme().ink.secondary }}>Your original post and media are kept for a safe retry.</Text></TouchableOpacity>}
              {publicationLocked && !posting && !publicationAttempt.current?.started && <TouchableOpacity onPress={() => { publicationAttempt.current = null; setPublicationLocked(false); }} style={{ padding: 10 }}><Text style={{ color: getTheme().ink.primary }}>Edit draft</Text></TouchableOpacity>}
              <View style={s.composerCard} pointerEvents={publicationLocked ? 'none' : 'auto'}>
                <View style={s.cAuthorRow}>
                  {profile?.avatar_url?<Image source={{uri:profile.avatar_url}} style={s.cAvatar}/>:<View style={s.cAvatarFb}><Text style={s.cAvatarTxt}>{initials(profile?.full_name||profile?.username)}</Text></View>}
                  <View style={{flex:1,gap:5}}><View style={{flexDirection:'row',alignItems:'center',gap:4}}><TierName userId={profile?.id} baseStyle={s.cName} text={profile?.full_name||profile?.username||'You'} numberOfLines={1}/><VerifiedBadge userId={profile?.id} size={13}/></View><TouchableOpacity style={[s.audChip,{alignSelf:'flex-start'}]} onPress={pickAudience}><Feather name={AUD_META[postAudience].icon} size={12} color={NAVY}/><Text style={s.audChipTxt}>{AUD_META[postAudience].label}</Text><Feather name="chevron-down" size={12} color={NAVY}/></TouchableOpacity></View>
                </View>
                {!composerReview ?                 <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.kindRow} keyboardShouldPersistTaps="always">
                  <TouchableOpacity style={[s.kindChip, !innovationPost && s.kindChipOn]} onPress={() => setInnovationPost(false)} accessibilityLabel="Regular post">
                    <Feather name="edit-3" size={15} color={!innovationPost ? t.ink.inverse : t.ink.secondary} />
                    <Text numberOfLines={1} style={[s.kindTxt, !innovationPost && s.kindTxtOn]}>Post</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.kindChip} onPress={() => { setComposerOpen(false); navigation.navigate('ArticleCompose'); }} accessibilityLabel="Write an article">
                    <Feather name="file-text" size={15} color={t.ink.secondary} />
                    <Text numberOfLines={1} style={s.kindTxt}>Article</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.kindChip} onPress={() => { setComposerOpen(false); navigation.navigate('Market', { screen: 'CreateListing' }); }} accessibilityLabel="Create a listing">
                    <Feather name="tag" size={15} color={t.ink.secondary} />
                    <Text numberOfLines={1} style={s.kindTxt}>Listing</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.kindChip, s.kindChipGold, innovationPost && s.kindChipGoldOn]} onPress={() => setInnovationPost(true)} accessibilityLabel="Post to Innovation">
                    <Ionicons name="bulb-outline" size={16} color={getTheme().brand.base} />
                    <Text numberOfLines={1} style={[s.kindTxt, { color: getTheme().brand.base }, innovationPost && { fontWeight: '800' }]}>Innovation</Text>
                  </TouchableOpacity>
                </ScrollView>:null}
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{paddingBottom:12}} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>{/* composer middle scrolls */}
                <TextInput ref={composerRef} editable={!composerReview} style={s.cInput} value={composerText} onChangeText={handleComposerChange} placeholder="Write a caption…" placeholderTextColor={getTheme().ink.secondary} multiline autoFocus maxLength={2000} />
                {pollOpts ? (
                <View style={{ marginTop: 10, gap: 8 }}>
                {pollOpts.map((o, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TextInput value={o} onChangeText={(v) => setPollOpts(p => { const n = [...(p || [])]; n[i] = v; return n; })} accessibilityLabel={'Poll option ' + (i + 1)} placeholder={'Option ' + (i + 1)} placeholderTextColor={getTheme().ink.secondary} maxLength={40}
                style={{ flex: 1, height: 42, borderRadius: 12, borderWidth: 1, borderColor: getTheme().surface.hairline, backgroundColor: getTheme().surface.raised, paddingHorizontal: 12, fontSize: 14.5, color: getTheme().ink.primary }} />
                {pollOpts.length > 2 ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={'Remove poll option ' + (i + 1)} onPress={() => setPollOpts(p => (p || []).filter((_, j) => j !== i))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="x" size={16} color={getTheme().ink.secondary} /></TouchableOpacity> : null}
                </View>
                ))}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {pollOpts.length < 4 ? <TouchableOpacity accessibilityRole="button" onPress={() => setPollOpts(p => [...(p || []), ''])}><Text style={{ fontSize: 13, fontWeight: '700', color: getTheme().ink.primary }}>Add option</Text></TouchableOpacity> : null}
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={'Poll duration, ' + pollDays + (pollDays === 1 ? ' day' : ' days')} onPress={() => setPollDays(d => (d === 1 ? 3 : d === 3 ? 7 : 1))} style={{ marginLeft: 'auto' }}><Text style={{ fontSize: 13, fontWeight: '700', color: getTheme().ink.primary }}>{pollDays === 1 ? '1 day' : pollDays + ' days'}</Text></TouchableOpacity>
                </View>
                </View>
                ) : null}
                                {composerText.length > 1800 && <Text style={s.charCount}>{2000 - composerText.length} left</Text>}
                {exclusivePost && (
                  <View style={s.exclusiveBanner}>
                    <Feather name="shield" size={13} color={getTheme().status.link} />
                    <Text style={s.exclusiveBannerTxt}>Only verified members can see this post</Text>
                  </View>
                )}
                {innovationPost && (
                  <TextInput
                    value={articleTitle}
                    onChangeText={setArticleTitle}
                    placeholder="Article title (optional)"
                    placeholderTextColor={getTheme().ink.secondary}
                    style={{ fontSize: 21, fontWeight: '800', color: getTheme().ink.primary, letterSpacing: -0.5, paddingVertical: 8, marginBottom: 4 }}
                    multiline
                  />
                )}
                {innovationPost && (
                  <View style={[s.exclusiveBanner, { backgroundColor: getTheme().status.innovationBg, borderColor: getTheme().status.innovation }]}>
                    <Feather name="zap" size={13} color={getTheme().status.innovation} />
                    <Text style={[s.exclusiveBannerTxt, { color: t.status.innovation }]}>Posting to Innovation — showcasing what Zimbabwe is building</Text>
                  </View>
                )}
                {innovationPost && (
                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ fontSize: 10.5, fontWeight: '700', letterSpacing: 1.4, color: 'rgba(11,30,61,0.45)', marginBottom: 6 }}>FIELD</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                      {['Agritech', 'Health', 'Energy', 'Fintech', 'Education', 'Other'].map((f) => (
                        <TouchableOpacity key={f} onPress={() => setInnoField(innoField === f ? null : f)}
                          style={{ paddingHorizontal: 11, paddingVertical: 5, borderRadius: 99, borderWidth: 1, borderColor: innoField === f ? t.status.innovation : t.surface.hairline, backgroundColor: innoField === f ? t.status.innovationBg : 'transparent' }}>
                          <Text style={{ fontSize: 12, fontWeight: '600', color: innoField === f ? t.status.innovation : t.ink.secondary }}>{f}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Text style={{ fontSize: 10.5, fontWeight: '700', letterSpacing: 1.4, color: 'rgba(11,30,61,0.45)', marginBottom: 6 }}>STAGE</Text>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {['Idea', 'Prototype', 'Launched'].map((g) => (
                        <TouchableOpacity key={g} onPress={() => setInnoStage(innoStage === g ? null : g)}
                          style={{ paddingHorizontal: 11, paddingVertical: 5, borderRadius: 99, borderWidth: 1, borderColor: innoStage === g ? t.ink.primary : t.surface.hairline, backgroundColor: innoStage === g ? t.brand.tintBg : 'transparent' }}>
                          <Text style={{ fontSize: 12, fontWeight: '600', color: innoStage === g ? t.ink.primary : t.ink.secondary }}>{g}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
                  {CATEGORIES.filter(c => c.key !== 'innovation').map(c => (
                    <TouchableOpacity key={c.key} onPress={() => setPostCategory(postCategory === c.key ? null : c.key)}
                      style={{ paddingHorizontal: 11, paddingVertical: 5, borderRadius: 99, borderWidth: 1, borderColor: postCategory === c.key ? t.ink.primary : t.surface.hairline, backgroundColor: postCategory === c.key ? t.brand.tintBg : 'transparent' }}>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: postCategory === c.key ? t.ink.primary : t.ink.secondary }}>{c.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                {composerPreview && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, padding: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: getTheme().surface.hairline, backgroundColor: getTheme().surface.raised }}>
                    {composerPreview.image_url ? <Image source={{ uri: composerPreview.image_url }} style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: '#EFEFF4' }} /> : null}
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6, color: getTheme().ink.muted }}>{String(composerPreview.domain || '').toUpperCase()}</Text>
                      <Text style={{ fontSize: 13.5, fontWeight: '600', color: getTheme().ink.primary }} numberOfLines={2}>{composerPreview.title || composerPreview.url}</Text>
                    </View>
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Remove link preview" onPress={() => { lpPreviewIntentRef.current.dismissed = true; setComposerPreview(null); }} hitSlop={8}>
                      <Feather name="x" size={16} color={getTheme().ink.muted} />
                    </TouchableOpacity>
                  </View>
                )}
                {composerMedia.length>0?(()=>{const idx=Math.min(selectedComposerMedia,composerMedia.length-1),media=composerMedia[idx];return <><View style={{position:'relative'}}><PostDraftPreview key={media.uri} media={media} active={composerOpen&&!musicOpen&&editMediaIdx===null} soundtrack={composerSoundtrack}/><View pointerEvents="none" style={s.cSelectedCount}><Text style={{color:'#FFF',fontSize:11,fontWeight:'700'}}>{idx+1} / {composerMedia.length}</Text></View></View>{!composerReview?<View style={s.cMediaActions}><TouchableOpacity style={s.cMediaAction} onPress={()=>{Keyboard.dismiss();setEditMediaIdx(idx);}}><Feather name="sliders" size={16} color={NAVY}/><Text style={s.cMediaActionText}>Edit {media.type==='video'?'video':'photo'}</Text></TouchableOpacity>{[-1,1].map(direction=><TouchableOpacity key={direction} accessibilityLabel={direction<0?'Move media earlier':'Move media later'} disabled={idx+direction<0||idx+direction>=composerMedia.length} style={[s.cMediaAction,(idx+direction<0||idx+direction>=composerMedia.length)&&{opacity:.35}]} onPress={()=>{const to=idx+direction;setComposerMedia(prev=>{const next=[...prev];[next[idx],next[to]]=[next[to],next[idx]];return next;});setSelectedComposerMedia(to);}}><Feather name={direction<0?'chevron-left':'chevron-right'} size={18} color={NAVY}/></TouchableOpacity>)}<TouchableOpacity accessibilityLabel="Remove selected media" style={s.cMediaAction} onPress={()=>{setComposerMedia(prev=>prev.filter((_,i)=>i!==idx));setSelectedComposerMedia(Math.max(0,idx-1));}}><Feather name="trash-2" size={17} color={NAVY}/></TouchableOpacity></View>:null}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[s.cMediaScroll,{marginTop:composerReview?12:0}]} contentContainerStyle={{gap:10,padding:2}} keyboardShouldPersistTaps="handled">{composerMedia.map((m,i)=><TouchableOpacity key={m.uri} accessibilityRole="button" accessibilityLabel={`Select media ${i+1}`} accessibilityState={{selected:i===idx}} style={[s.cThumb,i===idx&&s.cThumbSelected]} onPress={()=>setSelectedComposerMedia(i)}><Image source={{uri:m.type==='video'?(m.edit?.coverLocalUri||m.thumbnail||m.uri):m.uri}} style={s.cThumbImg} resizeMode="cover"/><View style={s.cThumbNumber}><Text style={{color:'#FFF',fontSize:10,fontWeight:'700'}}>{i+1}</Text></View>{m.type==='video'?<View style={{position:'absolute',left:6,bottom:6}}><Feather name="play" color="#FFF" size={14}/></View>:null}</TouchableOpacity>)}{!composerReview&&composerMedia.length<10?<TouchableOpacity accessibilityLabel="Add more media" style={s.cAddMore} onPress={()=>pickMedia()}><Feather name="plus" size={25} color={NAVY}/></TouchableOpacity>:null}</ScrollView></>})():null}
                {editMediaIdx!=null&&composerMedia[editMediaIdx]?<PostMediaEditSheet visible uri={composerMedia[editMediaIdx].uri} mediaType={composerMedia[editMediaIdx].type} width={composerMedia[editMediaIdx].width} height={composerMedia[editMediaIdx].height} itemIndex={editMediaIdx} itemCount={composerMedia.length} initial={composerMedia[editMediaIdx].edit||null} onCancel={()=>setEditMediaIdx(null)} onDone={(ed,applyAll)=>{const idx=editMediaIdx;setComposerMedia(prev=>prev.map((m,i)=>i===idx?{...m,edit:ed}:applyAll?{...m,edit:{...m.edit,...postLookRecipe(ed)}}:m));setEditMediaIdx(null);if(composerMedia[idx].type==='video'&&!ed.coverLocalUri){const editedUri=composerMedia[idx].uri;void VideoThumbnails.getThumbnailAsync(editedUri,{time:Math.round((ed.coverAt??ed.trimStart??0)*1000),quality:.7}).then(result=>setComposerMedia(prev=>prev.map(m=>m.uri===editedUri&&m.edit===ed?{...m,thumbnail:result.uri}:m))).catch(()=>{});}}}/>:null}
                <View style={s.cSettings}>{composerMedia.length?<TouchableOpacity accessibilityRole="button" style={s.cSettingRow} onPress={()=>{Keyboard.dismiss();setMusicOpen(true);}}><Feather name="music" size={18} color={NAVY}/><Text style={s.cSettingLabel}>Music</Text><Text style={s.cSettingValue}>{composerSoundtrack?`${composerSoundtrack.durationSec.toFixed(1)}s excerpt`:'Add a soundtrack'}</Text><Feather name="chevron-right" size={16} color={t.ink.secondary}/></TouchableOpacity>:null}<TouchableOpacity style={s.cSettingRow} onPress={pickCommentPolicy}><Feather name="message-circle" size={18} color={NAVY}/><Text style={s.cSettingLabel}>Comments</Text><Text style={s.cSettingValue}>{COMMENT_META[commentPolicy].label}</Text><Feather name="chevron-right" size={16} color={t.ink.secondary}/></TouchableOpacity><TouchableOpacity style={s.cSettingRow} onPress={askCollaborator}><Feather name="users" size={18} color={NAVY}/><Text style={s.cSettingLabel}>Collaborators</Text><Text numberOfLines={1} style={s.cSettingValue}>{collabPicks.length?`${collabPicks.length} selected`:'Invite people'}</Text><Feather name="chevron-right" size={16} color={t.ink.secondary}/></TouchableOpacity><TouchableOpacity style={s.cSettingRow} onPress={()=>setComposerSensitive(v=>!v)}><Feather name="shield" size={18} color={NAVY}/><Text style={s.cSettingLabel}>Sensitive content</Text><Feather name={composerSensitive?'check-circle':'circle'} size={20} color={composerSensitive?'#AE8B49':'#9AA1AD'}/></TouchableOpacity></View>
                </ScrollView>
                {!composerReview?<View style={s.cToolbar}><TouchableOpacity style={s.cToolTile} onPress={()=>pickMedia()}><Feather name="image" size={20} color={NAVY}/><Text style={s.cMediaActionText}>Media</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" accessibilityLabel="Open post camera and lenses" style={[s.cToolTile,composerMedia.length>=10&&{opacity:.4}]} disabled={composerMedia.length>=10} onPress={openCamera}><Feather name="camera" size={20} color={NAVY}/><Text style={s.cMediaActionText}>Camera</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" accessibilityLabel="Add music to post" style={[s.cToolTile,!composerMedia.length&&{opacity:.4}]} disabled={!composerMedia.length} onPress={()=>{Keyboard.dismiss();setMusicOpen(true);}}><Feather name="music" size={20} color={NAVY}/><Text style={s.cMediaActionText}>Music</Text></TouchableOpacity><TouchableOpacity style={s.cToolTile} onPress={()=>setProductPickerOpen(true)}><Feather name="tag" size={19} color={NAVY}/><Text style={s.cMediaActionText}>Products</Text></TouchableOpacity><TouchableOpacity style={[s.cToolTile,composerMedia.length>0&&{opacity:.4}]} disabled={composerMedia.length>0} onPress={()=>setPollOpts(p=>p?null:['',''])}><Feather name="bar-chart-2" size={19} color={NAVY}/><Text style={s.cMediaActionText}>Poll</Text></TouchableOpacity></View>:null}
              </View>
              <SoundtrackPicker visible={composerOpen&&musicOpen} value={composerSoundtrack} use="post" ownerId={userId??undefined} originalAudio={composerMedia[Math.min(selectedComposerMedia,composerMedia.length-1)]?.type==='video'} onChange={setComposerSoundtrack} onClose={()=>setMusicOpen(false)} renderPreview={(selection,active)=>{const media=composerMedia[Math.min(selectedComposerMedia,composerMedia.length-1)];return media?<PostDraftPreview media={media} soundtrack={selection} active={active} autoPlay/>:null;}}/>
              <ProductPickerSheet visible={productPickerOpen} sellerId={userId} selected={composerProducts} onClose={()=>setProductPickerOpen(false)} onSave={setComposerProducts}/>
              <PeoplePickerSheet visible={!!collabPicker} title="Invite a collaborator" excludeId={userId} onClose={()=>setCollabPicker(null)} onPick={p=>{setCollabPicks(prev=>(prev.some(x=>x.id===p.id)||prev.length>=5)?prev:[...prev,{id:p.id,username:p.username,full_name:p.full_name}]);}}/>
            </KeyboardAvoidingView>
            </Modal>
          )}

          {!composerOpen && (posting||publicationLocked||postConfirmed) ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={postConfirmed?'Post shared. Dismiss confirmation.':'View post upload progress'} onPress={()=>postConfirmed?setPostConfirmed(false):setComposerOpen(true)} style={[s.cUploadBanner,{bottom:insets.bottom+TAB_BAR_CLEARANCE}]}>{posting?<ActivityIndicator color={t.ink.primary}/>:<Feather name={postConfirmed?'check-circle':'alert-circle'} color={t.ink.primary} size={22}/>}<View style={{flex:1}}><Text style={{color:t.ink.primary,fontWeight:'700'}}>{postConfirmed?'Your post has been shared':posting?(postProgress.label||'Preparing your post'):'Your post needs attention'}</Text><Text style={{color:t.ink.secondary,fontSize:12,marginTop:3}}>{postConfirmed?'Tap to dismiss':posting?'Keep Platinum open · Tap for progress':'Tap to review and finish the same post'}</Text></View><Feather name={postConfirmed?'x':'chevron-up'} color={t.ink.primary} size={19}/></TouchableOpacity> : null}
          {!composerOpen && !posting && !publicationLocked && !postConfirmed && (
            <TouchableOpacity activeOpacity={0.85} onPress={() => setComposerOpen(true)} style={[s.fabRing, { bottom: insets.bottom + TAB_BAR_CLEARANCE }]}>
              <View style={s.fabDisc}>
                <Feather name="edit-3" size={22} color={t.ink.inverse} />
              </View>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>

      <Modal visible={!!likersPost} transparent animationType="slide" onRequestClose={() => setLikersPost(null)}>
        <TouchableOpacity style={s.menuOverlay} activeOpacity={1} onPress={() => setLikersPost(null)}>
          <TouchableOpacity activeOpacity={1} style={s.menuSheet}>
            <View style={s.menuHandle} />
            <Text style={{ fontSize: 15, fontWeight: '700', color: getTheme().ink.primary, paddingHorizontal: 16, paddingBottom: 8 }}>{likersKind === 'reposts' ? 'Reposts' : likersKind === 'bookmarks' ? 'Bookmarks' : 'Likes'}</Text>
            {likersList.length === 0 && <Text style={{ fontSize: 13, color: getTheme().ink.muted, paddingHorizontal: 16, paddingBottom: 16 }}>{likersLoaded ? (likersKind === 'reposts' ? 'No reposts yet.' : likersKind === 'bookmarks' ? 'No bookmarks yet.' : 'No likes yet.') : 'Loading...'}</Text>}
            <ScrollView style={{ maxHeight: 380 }}>
              {likersList.map((p: any) => (
                <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 9, gap: 12 }}>
                  <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }} activeOpacity={0.8} onPress={() => { setLikersPost(null); navigation.navigate('UserProfile', { userId: p.id, user: p }); }}>
                    {p.avatar_url ? <ExpoImage source={{ uri: p.avatar_url }} style={{ width: 40, height: 40, borderRadius: 20 }} contentFit="cover" /> : <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: getTheme().status.linkBg, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontWeight: '700', color: getTheme().status.link }}>{initials(p.full_name || p.username)}</Text></View>}
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <TierName userId={p.id} baseStyle={{ fontSize: 14, fontWeight: '600', color: getTheme().ink.primary, flexShrink: 1 }} text={p.full_name || p.username || 'Member'} />
                        <VerifiedBadge userId={p.id} size={12} />
                      </View>
                      {p.username ? <Text style={{ fontSize: 12, color: getTheme().ink.muted }} numberOfLines={1}>@{p.username}</Text> : null}
                    </View>
                  </TouchableOpacity>
                  {userId && p.id !== userId && (
                    <TouchableOpacity onPress={() => toggleFollow(p.id)} activeOpacity={0.8} style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: 16, backgroundColor: followingIds.has(p.id) ? t.surface.sunken : NAVY }}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: followingIds.has(p.id) ? t.ink.secondary : t.ink.inverse }}>{followingIds.has(p.id) ? 'Following' : 'Follow'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!viewersPost} transparent animationType="slide" onRequestClose={() => setViewersPost(null)}>
        <TouchableOpacity style={s.menuOverlay} activeOpacity={1} onPress={() => setViewersPost(null)}>
          <TouchableOpacity activeOpacity={1} style={s.menuSheet}>
            <View style={s.menuHandle} />
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, gap: 8 }}>
              <Feather name="eye" size={16} color={getTheme().ink.primary} />
              <Text style={{ fontSize: 15, fontWeight: '700', color: getTheme().ink.primary }}>{fmtCount(viewersPost?.views_count ?? 0)} {(viewersPost?.views_count ?? 0) === 1 ? 'view' : 'views'}</Text>
            </View>
            {viewersLoading && <ActivityIndicator size="small" color={getTheme().brand.base} style={{ paddingVertical: 18 }} />}
            {!viewersLoading && viewersRows.length === 0 && <Text style={{ fontSize: 13, color: getTheme().ink.muted, paddingHorizontal: 16, paddingBottom: 16 }}>No viewers yet. Your own views are not counted.</Text>}
            <ScrollView style={{ maxHeight: 360 }}>
              {viewersRows.map((v: any) => (
                <TouchableOpacity key={v.user_id} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12 }} activeOpacity={0.8} onPress={() => { setViewersPost(null); (navigation as any).navigate('UserProfile', { userId: v.user_id }); }}>
                  {v.avatar_url ? <ExpoImage source={{ uri: v.avatar_url }} style={{ width: 40, height: 40, borderRadius: 20 }} contentFit="cover" /> : <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: getTheme().surface.hairline, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontWeight: '700', color: getTheme().ink.muted }}>{initials(v.full_name || v.username)}</Text></View>}
                  <View style={{ flex: 1 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><TierName userId={v.user_id} baseStyle={{ fontSize: 14, fontWeight: '600', color: getTheme().ink.primary, flexShrink: 1 }} text={v.full_name || v.username || 'Member'} /><VerifiedBadge userId={v.user_id} size={13} /></View>{v.username ? <Text style={{ fontSize: 12, color: getTheme().ink.muted }}>@{v.username}</Text> : null}</View>
                  {v.seen_at ? <Text style={{ fontSize: 11.5, color: getTheme().ink.muted }}>{(() => { const d = (Date.now() - new Date(v.seen_at).getTime()) / 60000; return d < 60 ? Math.max(1, Math.round(d)) + 'm' : d < 1440 ? Math.round(d / 60) + 'h' : Math.round(d / 1440) + 'd'; })()}</Text> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!sharePostTarget} transparent animationType="slide" onRequestClose={() => setSharePostTarget(null)}>
        <TouchableOpacity style={s.menuOverlay} activeOpacity={1} onPress={() => setSharePostTarget(null)}>
          <TouchableOpacity activeOpacity={1} style={s.menuSheet}>
            <View style={s.menuHandle} />
            <Text style={{ fontSize: 15, fontWeight: '700', color: getTheme().ink.primary, paddingHorizontal: 4, paddingBottom: 6 }}>Share</Text>
            {sharePostTarget && isVideoPost(sharePostTarget) ? (
              <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => { const p = sharePostTarget; setSharePostTarget(null); setTimeout(() => { if (p) reactToVideo(p); }, 350); }}>
                <Feather name="video" size={18} color={getTheme().ink.primary} />
                <View style={{ flex: 1 }}><Text style={s.menuOptionTxt}>React to video</Text><Text style={s.menuOptionSub}>Record your reaction and post it as a reply</Text></View>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => { const p = sharePostTarget; setSharePostTarget(null); setTimeout(() => { if (p) addPostToStory(p); }, 350); }}>
              <Feather name="plus-square" size={18} color={getTheme().ink.primary} />
              <View style={{ flex: 1 }}><Text style={s.menuOptionTxt}>Add to your story</Text><Text style={s.menuOptionSub}>Share this post as a card on your story</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => { const p = sharePostTarget; setSharePostTarget(null); if (p && canEditPostDraft()) { setQuotingPost(p); setComposerOpen(true); } }}>
              <Feather name="corner-down-right" size={18} color={getTheme().ink.primary} />
              <View style={{ flex: 1 }}><Text style={s.menuOptionTxt}>Add to thread</Text><Text style={s.menuOptionSub}>Quote this post with your own words</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => { const p = sharePostTarget; setSharePostTarget(null); setTimeout(() => { if (p) openSendSheet(p); }, 350); }}>
              <Feather name="send" size={18} color={getTheme().ink.primary} />
              <View style={{ flex: 1 }}><Text style={s.menuOptionTxt}>Send to</Text><Text style={s.menuOptionSub}>A message, a group or a community</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={async () => { const p = sharePostTarget; setSharePostTarget(null); if (p) { await Clipboard.setStringAsync(postLink(p)); Alert.alert('Link copied', postLink(p)); } }}>
              <Feather name="link" size={18} color={getTheme().ink.primary} />
              <View style={{ flex: 1 }}><Text style={s.menuOptionTxt}>Copy link</Text><Text style={s.menuOptionSub} numberOfLines={1}>{sharePostTarget ? postLink(sharePostTarget) : ''}</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={[s.menuOption, { borderBottomWidth: 0 }]} activeOpacity={0.75} onPress={() => { const p = sharePostTarget; setSharePostTarget(null); setTimeout(() => { if (p) sharePost(p); }, 350); }}>
              <Feather name="share" size={18} color={getTheme().ink.primary} />
              <View style={{ flex: 1 }}><Text style={s.menuOptionTxt}>Share via</Text><Text style={s.menuOptionSub}>WhatsApp, Messages and other apps</Text></View>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!sendPost} transparent animationType="slide" onRequestClose={() => setSendPost(null)}>
        <TouchableOpacity style={s.menuOverlay} activeOpacity={1} onPress={() => setSendPost(null)}>
          <TouchableOpacity activeOpacity={1} style={s.menuSheet}>
            <View style={s.menuHandle} />
            <Text style={{ fontSize: 15, fontWeight: '700', color: getTheme().ink.primary, paddingHorizontal: 16, paddingBottom: 8 }}>Send to</Text>
            {sendLoading && <ActivityIndicator size="small" color={getTheme().brand.base} style={{ paddingVertical: 18 }} />}
            {sendError ? <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}><Text accessibilityRole="alert" style={{ color: getTheme().ink.primary }}>{sendError}</Text><TouchableOpacity accessibilityRole="button" onPress={() => { if (sendPost) void openSendSheet(sendPost); }} style={{ paddingVertical: 12 }}><Text style={{ color: getTheme().brand.base, fontWeight: '700' }}>Retry</Text></TouchableOpacity></View> : null}
            {sendBusy ? <ActivityIndicator accessibilityLabel="Sending post" size="small" color={getTheme().brand.base} /> : null}
            {!sendLoading && !sendError && sendConvs.length === 0 && sendGroups.length === 0 && sendCommunities.length === 0 && <Text style={{ fontSize: 13, color: getTheme().ink.muted, paddingHorizontal: 16, paddingBottom: 16 }}>No conversations yet. Start one from Messages first.</Text>}
            <ScrollView style={{ maxHeight: 320 }}>
              {sendConvs.map((c: any) => (
                <TouchableOpacity key={c.id} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12 }} activeOpacity={0.8} onPress={() => sendPostTo(c)} disabled={sendBusy}>
                  {c.other?.avatar_url ? <ExpoImage source={{ uri: c.other.avatar_url }} style={{ width: 40, height: 40, borderRadius: 20 }} contentFit="cover" /> : <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: getTheme().surface.hairline, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontWeight: '700', color: getTheme().ink.muted }}>{initials(c.other?.full_name || c.other?.username)}</Text></View>}
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}><TierName userId={c.otherId} baseStyle={{ fontSize: 14, fontWeight: '600', color: getTheme().ink.primary, flexShrink: 1 }} text={c.other?.full_name || c.other?.username || 'Member'} /><VerifiedBadge userId={c.otherId} size={13} /></View>
                </TouchableOpacity>
              ))}
              {sendGroups.length > 0 && (
                <>
                  <Text style={{ fontSize: 11.5, fontWeight: '800', letterSpacing: 0.6, color: getTheme().ink.muted, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, textTransform: 'uppercase' }}>Groups</Text>
                  {sendGroups.map((g: any) => (
                    <TouchableOpacity key={g.id} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12 }} activeOpacity={0.8} onPress={() => sendPostTo(g)} disabled={sendBusy}>
                      <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: 'rgba(11,30,61,0.08)', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 18 }}>{g.group_emoji || '\uD83D\uDC65'}</Text></View>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: getTheme().ink.primary, flex: 1 }} numberOfLines={1}>{g.group_name || 'Group'}</Text>
                      <Feather name="users" size={15} color={getTheme().ink.muted} />
                    </TouchableOpacity>
                  ))}
                </>
              )}
              {sendCommunities.length > 0 && (
                <>
                  <Text style={{ fontSize: 11.5, fontWeight: '800', letterSpacing: 0.6, color: getTheme().ink.muted, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, textTransform: 'uppercase' }}>Communities</Text>
                  {sendCommunities.map((cmt: any) => (
                    <TouchableOpacity key={cmt.id} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12 }} activeOpacity={0.8} onPress={() => sendPostToCommunity(cmt)} disabled={sendBusy}>
                      <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: 'rgba(201,191,176,0.28)', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 18 }}>{cmt.emoji || '\uD83C\uDFDB\uFE0F'}</Text></View>
                      <View style={{ flex: 1 }}><Text style={{ fontSize: 14, fontWeight: '600', color: getTheme().ink.primary }} numberOfLines={1}>{cmt.name}</Text>{cmt.member_count != null ? <Text style={{ fontSize: 11.5, color: getTheme().ink.muted }}>{cmt.member_count} members</Text> : null}</View>
                      <Feather name="globe" size={15} color={getTheme().ink.muted} />
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {viewer ? <PostMediaViewer media={viewer.media} initialIndex={viewer.index} postId={viewer.postId} onClose={() => setViewer(null)} /> : null}

      {discoverOpen && feedMode === 'discover' ? <DiscoverViewer
        posts={displayPosts as any} initialId={discoverOpen} profiles={profilesMap} liked={likedPosts} saved={bookmarkedPosts}
        hasMore={hasMoreRef.current} loading={loadingMore} error={feedError} loadMore={loadMore}
        onClose={() => setDiscoverOpen(null)} onLike={toggleLike} onSave={toggleBookmark}
        onRefreshMedia={() => { void loadFeed(false, true); }}
        onShare={id => { const post = posts.find(p => p.id === id); if (post) void sharePost(post); }}
        onOpenPost={id => { setDiscoverOpen(null); navigation.navigate('Post', { postId: id }); }}
      /> : null}
      <CommentsSheet
        visible={!!commentsFor}
        postId={commentsFor?.id ?? ''}
        postAuthorId={commentsFor?.user_id ?? null}
        count={commentsFor?.comments_count ?? 0}
        onHandoff={() => setCommentsHold(false)}
        measureFrame={(id: string) => new Promise((resolve) => { const node = mediaNodeRef.current[id]; if (!node || typeof node.measureInWindow !== 'function') { resolve(null); return; } node.measureInWindow((x: number, y: number, w: number, h: number) => resolve(w > 0 && h > 0 ? { x, y, width: w, height: h } : null)); })}
        media={commentsFor && !(commentsFor as any).article_title ? (Array.isArray((commentsFor as any).media) && (commentsFor as any).media.length > 0 ? (commentsFor as any).media : (commentsFor.media_url ? [{ id: '0', url: commentsFor.media_url, media_type: isVideoUrl(commentsFor.media_url) ? 'video' : 'image', sort_order: 0 }] : null)) : null}
        actions={commentsFor ? { liked: !!likedPosts[commentsFor.id], saved: !!bookmarkedPosts[commentsFor.id], reposted: !!repostedPosts[commentsFor.id], likes: (posts.find((p) => p.id === commentsFor.id) ?? commentsFor).likes_count ?? 0, onLike: () => toggleLike(commentsFor.id), onSave: () => toggleBookmark(commentsFor.id), onRepost: () => toggleRepost(commentsFor.id), onShare: () => { const p = commentsFor; setCommentsHold(false); setCommentsFor(null); setTimeout(() => openSendSheet(p as any), 350); } } : null}
        onClose={() => {
          const id = commentsFor?.id;
          setCommentsFor(null);
          if (id) supabase.from('posts').select('comments_count').eq('id', id).maybeSingle().then(({ data }) => { const n = (data as any)?.comments_count; if (typeof n === 'number') setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, comments_count: n } : p))); }, () => {});
        }}
      />
      <Modal visible={!!fsVideo} animationType="fade" onRequestClose={() => setFsVideo(null)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {fsVideo && videoPosts.some(v => v.id === fsVideo.id) ? (
            <VideoFeedModal
              items={videoPosts}
              startId={fsVideo.id as string}
              likedMap={likedPosts}
              savedMap={bookmarkedPosts}
              repostedMap={repostedPosts}
              followingIds={followingIds}
              myId={userId}
              startAt={(fsVideo as any).at || 0}
              onClose={(resume?: { url: string; at: number }) => { if (resume?.url) seekWhenClaimed(resume.url, resume.at); setFsVideo(null); }}
              onToggleLike={(id: string) => toggleLike(id)}
              onToggleSave={(id: string) => toggleBookmark(id)}
              onToggleRepost={(id: string) => toggleRepost(id)}
              onShare={(id: string) => { const p = displayPosts.find((x: any) => x.id === id); if (p) { setFsVideo(null); openSendSheet(p as any); } }}
              onOpenProfile={(uid: string) => { setFsVideo(null); (navigation as any).navigate('UserProfile', { userId: uid }); }}
              onFollow={async (uid: string) => { try { await supabase.rpc('handle_follow_action', { p_target_id: uid }); setFollowingIds(prev => { const n = new Set(prev); n.add(uid); return n; }); } catch {} }}
              onNotInterested={(id: string) => { setFsVideo(null); hidePost(id); }}
              onReport={(id: string) => { setFsVideo(null); reportPost(id, 'other'); }}
              onViewed={(id: string) => { if (userId) supabase.rpc('record_video_view', { p_post_id: id, p_viewer_id: userId, p_session: viewSessionRef.current, p_duration: 5 }).then(() => {}, () => {}); }}
            />
          ) : fsVideo ? (
            <FullscreenVideo uri={fsVideo.url} onClose={() => setFsVideo(null)} />
          ) : null}
        </View>
      </Modal>


      <ProductPickerSheet visible={productPickerOpen && !composerOpen} sellerId={userId} selected={composerProducts} onClose={() => setProductPickerOpen(false)} onSave={setComposerProducts} />

      <PostInsightsSheet
        postId={insightsPostId}
        onClose={() => setInsightsPostId(null)}
        onOpenProfile={(uid) => navigation.navigate('UserProfile', { userId: uid })}
      />

      <CollaboratorsSheet visible={!!collabSheet} people={collabSheet || []} onClose={() => setCollabSheet(null)} />
      <PeoplePickerSheet visible={!!collabPicker && !composerOpen} title="Invite a collaborator" excludeId={userId}
        onClose={() => setCollabPicker(null)}
        onPick={(p) => { setCollabPicks(prev => (prev.some(x => x.id === p.id) || prev.length >= 5) ? prev : [...prev, { id: p.id, username: p.username, full_name: p.full_name }]); }} />
      <Modal visible={!!menuPost} transparent animationType="slide" onRequestClose={() => setMenuPost(null)}>
        <TouchableOpacity style={s.menuOverlay} activeOpacity={1} onPress={() => setMenuPost(null)}>
          <TouchableOpacity activeOpacity={1} style={s.menuSheet}>
            <View style={s.menuHandle} />
            {menuPost && <Text style={s.menuPreview} numberOfLines={2}>{menuPost.content}</Text>}
            <View style={s.menuDivider} />

            {menuPost?.user_id === userId && (
              <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
                const captured = menuPost;
                setMenuPost(null);
                if (captured) setInsightsPostId(captured.id);
              }}>
                <Feather name="bar-chart-2" size={18} color={getTheme().ink.primary} />
                <Text style={s.menuOptionTxt}>View insights</Text>
              </TouchableOpacity>
            )}

            {menuPost?.user_id === userId && (
              <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={async () => {
                const captured = menuPost; setMenuPost(null); if (!captured) return;
                const off = (captured as any).comment_policy === 'off';
                // Comments are kept, never deleted: off hides them, on brings them back as they were.
                const { error } = await supabase.from('posts').update({ comment_policy: off ? 'everyone' : 'off' }).eq('id', captured.id);
                if (error) { Alert.alert('Not saved', error.message); return; }
                setPosts(prev => prev.map(pp => pp.id === captured.id ? { ...pp, comment_policy: off ? 'everyone' : 'off' } as any : pp));
              }}>
                <Feather name="message-circle" size={18} color={getTheme().ink.primary} />
                <Text style={s.menuOptionTxt}>{(menuPost as any)?.comment_policy === 'off' ? 'Turn on comments' : 'Turn off comments'}</Text>
              </TouchableOpacity>
            )}

            {menuPost?.user_id === userId && (
              <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={async () => {
                const captured = menuPost; setMenuPost(null); if (!captured || !userId) return;
                const { data: me } = await supabase.from('profiles').select('pinned_post_id').eq('id', userId).maybeSingle();
                const next = (me as any)?.pinned_post_id === captured.id ? null : captured.id;
                const { error } = await supabase.from('profiles').update({ pinned_post_id: next }).eq('id', userId);
                if (error) { Alert.alert('Not saved', error.message); return; }
                showMessage({ message: next ? 'Pinned to your profile' : 'Unpinned', type: 'success', duration: 1500 });
              }}>
                <Feather name="bookmark" size={18} color={getTheme().ink.primary} />
                <Text style={s.menuOptionTxt}>Pin or unpin on profile</Text>
              </TouchableOpacity>
            )}

            {menuPost?.user_id === userId && (
              <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
                const captured = menuPost; setMenuPost(null); if (!captured) return;
                Alert.alert('Archive post?', 'It disappears from your profile and every feed. Nothing is deleted; restore it any time from Settings, Archive.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Archive', onPress: async () => {
                    const { error } = await supabase.from('posts').update({ archived_at: new Date().toISOString() }).eq('id', captured.id);
                    if (error) { Alert.alert('Not archived', error.message); return; }
                    setPosts(prev => prev.filter(pp => pp.id !== captured.id));
                  } },
                ]);
              }}>
                <Feather name="archive" size={18} color={getTheme().ink.primary} />
                <Text style={s.menuOptionTxt}>Archive post</Text>
              </TouchableOpacity>
            )}

            {menuPost && (collabs[menuPost.id] || []).some(x => x.id === userId) && (
              <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
                const captured = menuPost; setMenuPost(null); if (!captured || !userId) return;
                Alert.alert('Stop sharing?', 'The post leaves your profile and stays on the creator\'s.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Stop sharing', style: 'destructive', onPress: async () => { await supabase.from('post_collaborators').update({ status: 'declined' }).eq('post_id', captured.id).eq('user_id', userId); setCollabs(prev => ({ ...prev, [captured.id]: (prev[captured.id] || []).filter(x => x.id !== userId) })); } },
                ]);
              }}>
                <Feather name="user-x" size={18} color={getTheme().ink.primary} />
                <Text style={s.menuOptionTxt}>Stop sharing this collab</Text>
              </TouchableOpacity>
            )}

            {menuPost?.user_id === userId && (collabs[menuPost.id] || []).length > 0 && (
              <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
                const captured = menuPost; setMenuPost(null); if (!captured) return;
                const list = collabs[captured.id] || [];
                Alert.alert('Remove a collaborator', 'The post leaves their profile.', [
                  ...list.map(x => ({ text: '@' + (x.username || x.full_name || ''), style: 'destructive' as const, onPress: async () => { await supabase.from('post_collaborators').delete().eq('post_id', captured.id).eq('user_id', x.id); setCollabs(prev => ({ ...prev, [captured.id]: (prev[captured.id] || []).filter(y => y.id !== x.id) })); } })),
                  { text: 'Cancel', style: 'cancel' as const },
                ]);
              }}>
                <Feather name="users" size={18} color={getTheme().ink.primary} />
                <Text style={s.menuOptionTxt}>Remove a collaborator</Text>
              </TouchableOpacity>
            )}


            {menuPost?.user_id === userId && (menuPost?.media?.length ?? 0) > 0 && (
              <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={async () => {
                const captured = menuPost; setMenuPost(null); if (!captured) return;
                const nowSensitive = (captured.media || []).some((m: any) => !!m?.is_sensitive);
                const { error } = await supabase.from('post_media').update({ is_sensitive: !nowSensitive }).eq('post_id', captured.id);
                if (error) { Alert.alert('Not saved', error.message); return; }
                setPosts(prev => prev.map(pp => pp.id === captured.id ? { ...pp, media: (pp.media || []).map((m: any) => ({ ...m, is_sensitive: !nowSensitive })) } : pp));
                showMessage({ message: nowSensitive ? 'Unmarked' : 'Marked as sensitive', type: 'success', duration: 1500 });
              }}>
                <Feather name="alert-triangle" size={18} color={getTheme().ink.primary} />
                <Text style={s.menuOptionTxt}>{(menuPost?.media || []).some((m: any) => !!m?.is_sensitive) ? 'Unmark as sensitive' : 'Mark as sensitive'}</Text>
              </TouchableOpacity>
            )}

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
                <Feather name="trash-2" size={18} color={getTheme().status.danger} />
                <Text style={[s.menuOptionTxt, { color: getTheme().status.danger }]}>Delete post</Text>
              </TouchableOpacity>
            )}

            {menuPost?.user_id === userId && (
              <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
                const captured = menuPost;
                setMenuPost(null);
                if (!canEditPostDraft()) return;
                setQuotingPost(null);
                setThreadingPost(captured);
                setComposerOpen(true);
              }}>
                <Feather name="corner-down-right" size={18} color={getTheme().ink.primary} />
                <Text style={s.menuOptionTxt}>Add to thread</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
              const captured = menuPost;
              const author = captured ? profilesMap[captured.user_id] : null;
              setMenuPost(null);
              setTimeout(() => { if (captured) addPostToStory(captured); }, 350);
            }}>
              <Feather name="plus-square" size={18} color={getTheme().ink.primary} />
              <Text style={s.menuOptionTxt}>Add to your story</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
              const captured = menuPost;
              const author = captured ? profilesMap[captured.user_id] : null;
              setMenuPost(null);
              setTimeout(async () => {
                if (!captured) return;
                await Share.share({ message: `${author?.full_name || 'Someone'} on Platinum Circles:\n\n${captured.content}\n\nOpen in the app: ${ExpoLinking.createURL('post/' + captured.id)}` });
              }, 400);
            }}>
              <Feather name="share-2" size={18} color={getTheme().ink.primary} />
              <Text style={s.menuOptionTxt}>Share post</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
              if (!menuPost) return;
              toggleBookmark(menuPost.id);
              setMenuPost(null);
            }}>
              <Feather name="bookmark" size={18} color={getTheme().ink.primary} />
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
              <Feather name="copy" size={18} color={getTheme().ink.primary} />
              <Text style={s.menuOptionTxt}>Copy text</Text>
            </TouchableOpacity>

            {menuPost?.user_id !== userId && (
              <>
                <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={() => {
                  const id = menuPost?.id;
                  setMenuPost(null);
                  if (id) hidePost(id);
                }}>
                  <Feather name="eye-off" size={18} color={getTheme().ink.primary} />
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
                  <Feather name="flag" size={18} color={getTheme().status.danger} />
                  <Text style={[s.menuOptionTxt, { color: getTheme().status.danger }]}>Report post</Text>
                </TouchableOpacity>
              </>
            )}


            {menuPost?.user_id !== userId && (
              <TouchableOpacity style={s.menuOption} activeOpacity={0.75} onPress={blockAuthor}>
                <Feather name="slash" size={18} color={getTheme().status.danger} />
                <Text style={[s.menuOptionTxt, { color: getTheme().status.danger }]}>
                  Block {menuPost ? profilesMap[menuPost.user_id]?.full_name || 'user' : 'user'}
                </Text>
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

const s = themedSheet((t) => ({
  articleCard: { borderRadius: 18, overflow: 'hidden', marginTop: 8, backgroundColor: t.surface.canvas },
  articleCover: { width: '100%', height: 190, backgroundColor: t.surface.sunken },
  articleBody: { padding: 16 },
  articleKicker: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.2, color: t.ink.muted },
  articleTitle: { fontSize: 20, fontWeight: '800', color: t.ink.primary, letterSpacing: -0.5, lineHeight: 25, marginTop: 6 },
  articleExcerpt: { fontSize: 14.5, color: t.ink.secondary, lineHeight: 21, marginTop: 7 },
  articleMeta: { fontSize: 12.5, fontWeight: '600', color: t.ink.muted, marginTop: 11 },
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: t.surface.canvas },
  header: { paddingHorizontal: 16, paddingBottom: 4, backgroundColor: t.surface.canvas, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, marginBottom: 12 },
  logo: { fontSize: 24, fontFamily: 'SpaceGrotesk_700Bold', color: t.ink.primary, letterSpacing: -0.5 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: t.surface.raised, borderWidth: StyleSheet.hairlineWidth, borderColor: t.surface.hairline, alignItems: 'center', justifyContent: 'center' },
  searchInput: { backgroundColor: t.surface.raised, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, minHeight: 48, fontSize: 16, color: t.ink.primary, marginBottom: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: t.surface.hairline },
  tabRow: { flexDirection: 'row', marginBottom: 10, backgroundColor: t.surface.raised, borderRadius: 12, padding: 3 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: t.surface.canvas, shadowColor: t.ink.primary, shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  tabTxt: { fontSize: 13, fontWeight: '500', color: t.ink.muted },
  tabTxtActive: { color: t.ink.primary, fontWeight: '600' },
  list: { paddingHorizontal: 0, paddingTop: 8 },
  listEmpty: { flexGrow: 1 },
  postCard: { backgroundColor: t.surface.canvas, borderBottomWidth: 6, borderBottomColor: t.surface.sunken },
  postTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  postMeta: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: 10 },
  avatarFb: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.status.linkBg, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarFbTxt: { fontSize: 15, fontWeight: '700', color: t.status.link },
  postMetaTxt: { flex: 1 },
  postAuthor: { fontSize: 15, fontWeight: '700', color: t.ink.primary, letterSpacing: -0.1 },
  postSub: { marginTop: 1, fontSize: 13, color: t.ink.muted },
  menuBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  menuBtnTxt: { fontSize: 16, color: t.ink.primary, letterSpacing: 1 },
  content: { fontSize: 15, lineHeight: 21, color: t.ink.primary, paddingHorizontal: 16, paddingBottom: 12 },
  readMoreBtn: { fontSize: 13.5, fontWeight: '700', color: t.brand.base, paddingHorizontal: 16 },
  hashTag: { color: t.brand.base, fontWeight: '600' },
  mention: { color: t.brand.base, fontWeight: '600' },
  
  
  
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 2 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 4 },
  
  
  
  pillIcon: { paddingHorizontal: 10 },
  pillTxt: { fontSize: 13, fontWeight: '600', color: t.ink.muted, fontVariant: ['tabular-nums'] },
  pillTxtLiked: { color: '#FF3040' },
  pillTxtReposted: { color: '#00BA7C' },
  
  
  cpWrap: { paddingHorizontal: 16, paddingBottom: 14, paddingTop: 4 },
  cpAuthor: { fontWeight: '700', color: t.ink.primary, fontSize: 13 },
  cpTxt: { fontSize: 13, lineHeight: 18, color: t.ink.secondary },
  viewAll: { fontSize: 12, color: t.ink.muted, marginTop: 3 },
  composerContainer: { flex:1,backgroundColor:t.surface.canvas,paddingHorizontal:18 },
  mentionDropdown: { backgroundColor: t.surface.canvas, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: t.surface.hairline, marginBottom: 6, overflow: 'hidden' },
  mentionRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.divider },
  mAvatar: { width: 34, height: 34, borderRadius: 17 },
  mAvatarFb: { width: 34, height: 34, borderRadius: 17, backgroundColor: t.status.linkBg, alignItems: 'center', justifyContent: 'center' },
  mAvatarTxt: { fontSize: 12, fontWeight: '700', color: t.status.link },
  mName: { fontSize: 14, fontWeight: '600', color: t.ink.primary },
  mUser: { fontSize: 12, color: t.ink.muted },
  cHeader: { minHeight:66,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:16,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:t.surface.hairline },
  cHeaderCancel: { minHeight:44,justifyContent:'center',minWidth:58 },
  cHeaderCancelText: { color:t.ink.secondary,fontSize:13 },
  cHeaderTitle: { flex:1,textAlign:'center',fontSize:17,fontWeight:'700',color:t.ink.primary },
  cReviewHint: { padding:13,borderRadius:13,backgroundColor:t.surface.sunken,marginBottom:12 },
  cReviewHintText: { fontSize:12,color:t.ink.secondary,lineHeight:18 },
  cProgress: { padding:16,borderRadius:16,backgroundColor:t.surface.sunken,marginBottom:12 },
  cProgressTitle: { fontSize:13,fontWeight:'700',color:t.ink.primary },
  cProgressText: { fontSize:12,color:t.ink.secondary,lineHeight:18 },
  cProgressTrack: { height:5,backgroundColor:t.surface.hairline,borderRadius:8,overflow:'hidden',marginVertical:12 },
  cProgressFill: { height:'100%',backgroundColor:'#AE8B49' },
  cUploadRow: { flexDirection:'row',alignItems:'center',gap:10 },
  cUploadThumb: { width:38,height:42,borderRadius:8,backgroundColor:t.surface.hairline },
  cContinue: { flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,minHeight:44,marginTop:8,borderRadius:12,borderWidth:1,borderColor:t.surface.hairline },
  cUploadBanner: { position:'absolute',left:16,right:16,minHeight:64,padding:14,borderRadius:18,backgroundColor:t.surface.raised,borderWidth:1,borderColor:t.surface.hairline,flexDirection:'row',alignItems:'center',gap:12,elevation:4,shadowColor:'#000',shadowOffset:{width:0,height:4},shadowOpacity:.12,shadowRadius:12 },
  cSelectedCount: { position:'absolute',top:12,right:12,paddingHorizontal:10,paddingVertical:5,borderRadius:20,backgroundColor:'rgba(16,33,61,.7)' },
  cMediaActions: { flexDirection:'row',alignItems:'center',gap:8,marginVertical:12 },
  cMediaAction: { minHeight:44,paddingHorizontal:13,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,borderWidth:1,borderColor:t.surface.hairline,borderRadius:12,backgroundColor:t.surface.raised },
  cMediaActionText: { fontSize:11.5,color:t.ink.primary,fontWeight:'600' },
  cThumbSelected: { borderColor:'#AE8B49' },
  cThumbNumber: { position:'absolute',right:3,top:3,width:21,height:21,borderRadius:11,backgroundColor:'rgba(16,33,61,.8)',alignItems:'center',justifyContent:'center' },
  cToolTile: { flex:1,minHeight:56,borderWidth:1,borderColor:t.surface.hairline,borderRadius:13,backgroundColor:t.surface.raised,alignItems:'center',justifyContent:'center',gap:6 },
  cSettings: { marginTop:12,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:t.surface.hairline },
  cSettingRow: { flexDirection:'row',alignItems:'center',gap:11,minHeight:54,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:t.surface.hairline },
  cSettingLabel: { flex:1,fontSize:13,color:t.ink.primary },
  cSettingValue: { fontSize:11.5,color:t.ink.secondary,maxWidth:'45%' },
  composerCard: { flex:1,backgroundColor:t.surface.canvas },
  cAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  chipScroller: { flex: 1, marginLeft: 6 },
  cAvatar: { width: 44, height: 44, borderRadius: 22 },
  cAvatarFb: { width: 44, height: 44, borderRadius: 22, backgroundColor: t.status.linkBg, alignItems: 'center', justifyContent: 'center' },
  cAvatarTxt: { fontSize: 13, fontWeight: '700', color: t.status.link },
  cName: { fontSize: 14, fontWeight: '700', color: t.ink.primary },
  cInput: { minHeight: 88, maxHeight: 180, fontSize: 16, color: t.ink.primary, textAlignVertical: 'top', lineHeight: 25, marginBottom: 12 },
  charCount: { fontSize: 12, color: t.status.danger, textAlign: 'right', marginBottom: 4 },
  exclusiveBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.status.linkBg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8 },
  exclusiveBannerTxt: { fontSize: 12, color: t.status.link, fontWeight: '500', flex: 1 },
  cMediaScroll: { marginBottom: 10 },
  cThumb: { width: 70, height: 80, borderRadius: 12,borderWidth:2,borderColor:'transparent', overflow: 'hidden' },
  cThumbImg: { width: '100%', height: '100%' },
  cVideoOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  cVideoPlayIcon: { fontSize: 22, color: t.ink.inverse },
  cRemove: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  cRemoveTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
  cAddMore: { width: 70, height: 80, borderRadius: 10, backgroundColor: t.surface.raised, borderWidth: 1.5, borderColor: t.surface.hairline, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  cAddMoreTxt: { fontSize: 28, color: t.ink.primary, fontWeight: '300' },
  cToolbar: { flexDirection: 'row', alignItems: 'center', marginTop: 8,paddingTop:12,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:t.surface.hairline,gap: 8 },
  cToolbarLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minWidth: 0, overflow: 'hidden' },
  kindRow: { flexDirection: 'row', gap: 8, marginBottom: 12, alignItems: 'center' },
  kindChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 12, backgroundColor: t.surface.raised, borderWidth: StyleSheet.hairlineWidth, borderColor: t.surface.hairline, flexShrink: 0 },
  kindChipOn: { backgroundColor: t.ink.primary, borderColor: t.ink.primary },
  kindChipGold: { backgroundColor: 'rgba(201,191,176,0.30)', borderColor: t.brand.warm },
  kindChipGoldOn: { backgroundColor: 'rgba(201,191,176,0.55)' },
  kindTxt: { fontSize: 12.5, fontWeight: '600', color: t.ink.secondary },
  kindTxtOn: { color: t.ink.inverse },
  audChip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight:30,paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: t.surface.hairline, backgroundColor: t.brand.tintBg },
  audChipTxt: { fontSize: 12, fontWeight: '700', color: t.ink.primary },
  cToolbarRight: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  toolBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: t.surface.raised, borderWidth: StyleSheet.hairlineWidth, borderColor: t.surface.hairline, alignItems: 'center', justifyContent: 'center' },
  toolCap: { fontSize: 9.5, fontWeight: '600', color: t.ink.secondary, marginTop: 3 },
  toolBtnActive: { backgroundColor: t.status.linkBg, borderColor: '#BFDBFE' },
  mediaCount: { fontSize: 12, color: t.ink.muted, fontWeight: '600' },
  cancelBtn: { backgroundColor: t.surface.raised, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  cancelTxt: { color: t.ink.secondary, fontSize: 14, fontWeight: '500' },
  postBtn: { backgroundColor: t.ink.primary, borderRadius: 14, paddingHorizontal: 20, minHeight:44, minWidth: 80, alignItems: 'center',justifyContent:'center' },
  postBtnOff: { opacity: 0.3 },
  postBtnTxt: { color: t.ink.inverse, fontSize: 14, fontWeight: '700' },
  fabRing: { position: 'absolute', right: 18, width: 62, height: 62, borderRadius: 31, borderWidth: 1.5, borderColor: 'rgba(201,191,176,0.9)', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  fabDisc: { width: 52, height: 52, borderRadius: 26, backgroundColor: t.ink.primary, alignItems: 'center', justifyContent: 'center', shadowColor: t.ink.primary, shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 9 },
  
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 60 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: t.ink.primary, textAlign: 'center' },
  emptySub: { marginTop: 8, fontSize: 14, lineHeight: 20, color: t.ink.muted, textAlign: 'center' },
  emptyBtn: { marginTop: 20, backgroundColor: t.ink.primary, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  emptyBtnTxt: { color: t.ink.inverse, fontSize: 15, fontWeight: '600' },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  menuSheet: { backgroundColor: t.surface.canvas, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 10, paddingBottom: 32, paddingHorizontal: 16 },
  menuHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: t.ink.faint, alignSelf: 'center', marginBottom: 14 },
  menuPreview: { fontSize: 14, color: t.ink.muted, lineHeight: 20, marginBottom: 12, paddingHorizontal: 4 },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: t.surface.sunken, marginBottom: 8 },
  menuOption: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.divider },
  menuOptionTxt: { fontSize: 16, color: t.ink.primary, fontWeight: '400' },
  menuOptionSub: { fontSize: 12, color: t.ink.muted, marginTop: 1 },
  menuCancel: { justifyContent: 'center', marginTop: 8, borderBottomWidth: 0 },
  menuCancelTxt: { fontSize: 16, color: t.ink.muted, fontWeight: '500', textAlign: 'center', width: '100%' },
  bellBadge: { position: 'absolute', top: -6, right: -8, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: t.status.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 1.5, borderColor: t.ink.inverse },
  bellBadgeTxt: { fontSize: 10, fontWeight: '700', color: t.ink.inverse },
}));
