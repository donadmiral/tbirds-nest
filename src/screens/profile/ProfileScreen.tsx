import { ListRowSkeleton } from '../../components/skeletons';
import { themedSheet, useTheme } from '../../theme/useTheme';
import { useRef } from 'react';
import { Pressable } from 'react-native';
import VideoThumb from '../../components/VideoThumb';
import VerifiedBadge from '../../components/VerifiedBadge';
import TierName from '../../components/TierName';
import EmptyState from '../../components/EmptyState';
import { handleTabBarScroll } from '../../components/AdaptiveTabBar';
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image,
  TextInput, ActivityIndicator, RefreshControl, StatusBar, Alert, Share,
  KeyboardAvoidingView, Platform, FlatList, Modal, useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import ProfileHeader from '../../components/ProfileHeader';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '../../services/supabase';
import { hydratePostMedia } from '../../services/contentMedia';
import { normalizeProfilePost } from '../../utils/profilePost';
import MemoryAlbumCard from '../../components/MemoryAlbumCard';
import { useAuthStore } from '../../stores/authStore';
import { uploadMedia } from '../../services/mediaService';
import MediaRenderer, { PostMedia } from '../../components/MediaRenderer';
import { Image as ExpoImage } from 'expo-image';
import { storiesService, type StoryHighlight } from '../../services/storiesService';
import HighlightRow from '../../components/stories/HighlightRow';
import { ProfileSkeleton } from '../../components/Skeleton';


const ROLES = ['student','alumni','faculty','staff'];

type Profile = {
  id: string; full_name: string; username: string; bio: string;
  location: string; degree_program: string;
  avatar_url: string | null; email: string; role: string;
  profile_visibility: 'public' | 'private';
};
type Post = {
  id: string;
  content: string;
  likes_count: number;
  comments_count: number;
  reposts_count: number;
  created_at: string;
  media_url: string | null;
  media: PostMedia[];
  mediaUnavailable?: boolean;
  user_id: string;
  _repostLabel?: string | null;
  _repostedAt?: string | null;
  _savedAt?: string | null;
  _originalAuthor?: { full_name: string; avatar_url: string | null } | null;
};
type Stats = { posts: number; connections: number; followers: number; following: number };
type Person = { id: string; full_name: string; username: string | null; avatar_url: string | null };
type ProfileTab = 'posts' | 'reposts' | 'saved' | 'tagged';

function initials(n?: string | null) {
  if (!n) return 'U';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}
function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff/60000), h = Math.floor(m/60), dy = Math.floor(h/24);
  if (m<1) return 'now'; if (m<60) return m+'m';
  if (h<24) return h+'h'; if (dy<7) return dy+'d';
  return new Date(d).toLocaleDateString([],{month:'short',day:'numeric'});
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={st.field}><Text style={st.fieldLabel}>{label}</Text>{children}</View>;
}

const COMMUNITY = [
  { label: 'Jobs',        sub: 'Roles & referrals',   ring: '#0B1E3D', bg: '#F0EEFF', emoji: null, featherIcon: 'briefcase',  featherColor: '#0B1E3D', route: 'Jobs' },
  { label: 'Support',     sub: 'FAQs & tickets',      ring: '#059669', bg: '#EDFBF0', emoji: null, featherIcon: 'help-circle', featherColor: '#059669', route: 'HelpSupport' },
] as const;

type StatsModalKey = 'followers' | 'following' | null;

export default function ProfileScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { t, isDark } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const contentWidth = Math.max(0, windowWidth - insets.left - insets.right);
  const authProfile = useAuthStore(state => state.profile);
  const setAuthProfile = useAuthStore(state => state.setProfile);
  const userId = authProfile?.id ?? null;
  const authProfileRef = useRef(authProfile);
  authProfileRef.current = authProfile;
  const scope = useRef({ userId });
  if (scope.current.userId !== userId) scope.current = { userId };
  const profileRequest = useRef(0), tabRequest = useRef(0), moreRequest = useRef(0), highlightsRequest = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [contentRevision, setContentRevision] = useState(0);
  const [tabError, setTabError] = useState<string | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<Stats>({ posts: 0, connections: 0, followers: 0, following: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [activeTab, setActiveTab] = useState<ProfileTab>('posts');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tabPosts, setTabPosts] = useState<Post[]>([]);
  const [postsHasMore, setPostsHasMore] = useState(false);
  const [loadingMorePosts, setLoadingMorePosts] = useState(false);
  const [tabReposts, setTabReposts] = useState<Post[]>([]);
  const [tabSaved, setTabSaved] = useState<Post[]>([]);
  const [tabTagged, setTabTagged] = useState<Post[]>([]);
  const [tabCounts, setTabCounts] = useState({ posts: 0, reposts: 0, saved: 0, tagged: 0 });
  const [tabLoading, setTabLoading] = useState(false);
  const tabLoadedRef = useRef<Record<string, boolean>>({});


  const [statsModal, setStatsModal] = useState<StatsModalKey>(null);
  const [statsPeople, setStatsPeople] = useState<Person[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);

  const [highlights, setHighlights] = useState<StoryHighlight[]>([]);

  const normalizePost = normalizeProfilePost;

  const load = useCallback(async () => {
    const owner = scope.current, request = ++profileRequest.current;
    const current = () => mounted.current && scope.current === owner && request === profileRequest.current;
    if (!userId) { setLoading(false); return; }
    try {
      const { data: pj, error: pErr } = await supabase.rpc('get_profile', { p_profile_id: userId });
      if (!current()) return;
      if (pErr) throw pErr;
      if (!pj || (pj as any).id !== userId) throw new Error('Profile is unavailable. Please retry.');
      setLoadError(null);
      const pd: any = pj || {};
      setProfile({
        id: pd.id, full_name: pd.full_name || '', username: pd.username || '',
        bio: pd.bio || '', location: pd.location || '', degree_program: pd.degree_program || '',
        avatar_url: pd.avatar_url || null, email: pd.email || '', role: pd.role || 'student',
        profile_visibility: pd.profile_visibility || 'public',
        banner_url: pd.banner_url || null, headline: pd.headline || null,
        workplace: pd.workplace || null, account_type: pd.account_type || 'personal',
        is_verified: !!pd.is_verified, verified_tier: pd.verified_tier ?? null, created_at: pd.created_at, business: pd.business || null,
      } as any);
      if (setAuthProfile) setAuthProfile({ ...(authProfileRef.current as any), ...pd });
      setContentRevision(value => value + 1);
      const c = pd.counts || {};
      setTabCounts({ posts: c.posts ?? 0, reposts: c.reposts ?? 0, saved: c.saved ?? 0, tagged: c.media ?? 0 });
      // Reach comes from the 28-day function a moment later; keep the number already shown until it lands, so it never flips.
      setStats(prev => ({ posts: c.posts ?? 0, connections: 0, followers: c.followers ?? 0, following: c.following ?? 0, reach: (prev as any)?.reach ?? c.reach ?? null } as any));
      supabase.rpc('get_profile_reach_28d', { p_profile_id: pd.id }).then(({ data }) => { if (current() && data != null) setStats(prev => ({ ...(prev as any), reach: data })); }, () => {});
    } catch(e: any){ if (current()) setLoadError(e?.message || 'Could not load your profile. Please retry.'); }
    finally { if (current()) { setLoading(false); setRefreshing(false); } }
  }, [userId]);

  const loadHighlights = useCallback(async () => {
    const owner = scope.current, request = ++highlightsRequest.current;
    if (!userId) return;
    try {
      const list = await storiesService.getUserHighlights(userId);
      if (mounted.current && scope.current === owner && request === highlightsRequest.current) setHighlights(list);
    } catch (e) { console.log('[loadHighlights]', e); }
  }, [userId]);

  const loadTabContent = useCallback(async (tab: ProfileTab) => {
    const owner = scope.current, request = ++tabRequest.current;
    const current = () => mounted.current && scope.current === owner && request === tabRequest.current;
    if (!userId) return;
    setTabLoading(!tabLoadedRef.current[tab]);
    setTabError(null);
    let succeeded = false;
    try {
      if (tab === 'posts') {
        let postsData: any[] = [];
        try {
          const { data, error } = await supabase.from('posts').select('*, post_media(id, url, media_type, width, height, sort_order, edit)').eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
          if (error) throw error; postsData = data || [];
        } catch {
          const { data, error } = await supabase.from('posts').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
          if (error) throw error; postsData = data || [];
        }
        // Posts this person collaborated on show here too, as on Instagram.
        try {
          const { data: cl } = await supabase.from('post_collaborators').select('post_id').eq('user_id', userId).eq('status', 'accepted');
          const collabIds = (cl || []).map((x: any) => x.post_id).filter((id: string) => !postsData.some((p: any) => p.id === id));
          if (collabIds.length) { const { data: cp } = await supabase.from('posts').select('*, post_media(id, url, media_type, width, height, sort_order, edit)').in('id', collabIds); const cps = ((cp as any[]) || []); const authorIds = Array.from(new Set(cps.map((x: any) => x.user_id))); const { data: aps } = authorIds.length ? await supabase.from('profiles').select('id, full_name, avatar_url').in('id', authorIds) : { data: [] as any[] }; const am: Record<string, any> = {}; ((aps as any[]) || []).forEach((a: any) => { am[a.id] = { full_name: a.full_name || '', avatar_url: a.avatar_url || null }; }); postsData = [...postsData, ...cps.map((x: any) => ({ ...x, _collabAuthor: am[x.user_id] || null }))].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); }
        } catch {}
        // Archived posts never show; the pinned post leads.
        postsData = postsData.filter((x: any) => !x.archived_at);
        postsData = await hydratePostMedia(postsData);
        if (!current()) return;
        const pinnedId = (authProfileRef.current as any)?.pinned_post_id ?? null;
        const pinnedFirst = pinnedId ? [...postsData.filter((x: any) => x.id === pinnedId), ...postsData.filter((x: any) => x.id !== pinnedId)] : postsData;
        setTabPosts(pinnedFirst.map((x: any) => ({ ...normalizePost(x), is_pinned: x.id === pinnedId, _originalAuthor: x._collabAuthor || undefined, _repostLabel: x._collabAuthor ? 'Collab' : undefined })));
        setPostsHasMore(postsData.length >= 50);
        setTabCounts(prev => ({ ...prev, posts: postsData.length }));
      }
      if (tab === 'reposts') {
        const { data: repostRows, error: repostError } = await supabase.from('post_reposts').select('post_id, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
        if (repostError) throw repostError;
        const postIds = (repostRows || []).map((r: any) => r.post_id);
        if (postIds.length > 0) {
          let postsData: any[] = [];
          try { const { data, error } = await supabase.from('posts').select('*, post_media(id, url, media_type, width, height, sort_order, edit)').in('id', postIds); if (error) throw error; postsData = data || []; }
          catch { const { data, error } = await supabase.from('posts').select('*').in('id', postIds); if (error) throw error; postsData = data || []; }
          const authorIds = Array.from(new Set(postsData.map((p: any) => p.user_id)));
          let authorMap: Record<string, any> = {};
          if (authorIds.length > 0) { const { data: authors } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', authorIds); (authors || []).forEach((a: any) => { authorMap[a.id] = a; }); }
          const repostTimeMap: Record<string, string> = {};
          (repostRows || []).forEach((r: any) => { repostTimeMap[r.post_id] = r.created_at; });
          postsData = await hydratePostMedia(postsData.filter((row: any) => !row.archived_at));
          if (!current()) return;
          const sorted = postsData.map((p: any) => ({ ...normalizePost(p), _repostLabel: 'You reposted', _repostedAt: repostTimeMap[p.id] || null, _originalAuthor: authorMap[p.user_id] || null })).sort((a, b) => { const ta = a._repostedAt ? new Date(a._repostedAt).getTime() : 0; const tb = b._repostedAt ? new Date(b._repostedAt).getTime() : 0; return tb - ta; });
          setTabReposts(sorted);
        } else { if (!current()) return; setTabReposts([]); }
        setTabCounts(prev => ({ ...prev, reposts: postIds.length }));
      }
      if (tab === 'saved') {
        const { data: bookmarkRows, error: bookmarkError } = await supabase.from('post_bookmarks').select('post_id, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
        if (bookmarkError) throw bookmarkError;
        const postIds = (bookmarkRows || []).map((r: any) => r.post_id);
        if (postIds.length > 0) {
          let postsData: any[] = [];
          try { const { data, error } = await supabase.from('posts').select('*, post_media(id, url, media_type, width, height, sort_order, edit)').in('id', postIds); if (error) throw error; postsData = data || []; }
          catch { const { data, error } = await supabase.from('posts').select('*').in('id', postIds); if (error) throw error; postsData = data || []; }
          const authorIds = Array.from(new Set(postsData.map((p: any) => p.user_id)));
          let authorMap: Record<string, any> = {};
          if (authorIds.length > 0) { const { data: authors } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', authorIds); (authors || []).forEach((a: any) => { authorMap[a.id] = a; }); }
          const bookmarkTimeMap: Record<string, string> = {};
          (bookmarkRows || []).forEach((r: any) => { bookmarkTimeMap[r.post_id] = r.created_at; });
          postsData = await hydratePostMedia(postsData.filter((row: any) => !row.archived_at));
          if (!current()) return;
          const sorted = postsData.map((p: any) => ({ ...normalizePost(p), _savedAt: bookmarkTimeMap[p.id] || null, _originalAuthor: authorMap[p.user_id] || null })).sort((a, b) => { const ta = a._savedAt ? new Date(a._savedAt).getTime() : 0; const tb = b._savedAt ? new Date(b._savedAt).getTime() : 0; return tb - ta; });
          setTabSaved(sorted);
        } else { if (!current()) return; setTabSaved([]); }
        setTabCounts(prev => ({ ...prev, saved: postIds.length }));
      }
      if (tab === 'tagged') {
        // media tab: your own posts that carry an image or video
        let postsData: any[] = [];
        try {
          const { data, error } = await supabase
            .from('posts')
            .select('*, post_media(id, url, media_type, width, height, sort_order, edit)')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(80);
          if (error) throw error; postsData = data || [];
        } catch {
          const { data, error } = await supabase.from('posts').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(80);
          if (error) throw error; postsData = data || [];
        }
        const withMedia = postsData.filter((p: any) =>
          (Array.isArray(p.post_media) && p.post_media.length > 0) || !!p.media_url
        );
        const authorized = await hydratePostMedia(withMedia.filter((row: any) => !row.archived_at));
        if (!current()) return;
        setTabTagged(authorized.map((p: any) => normalizePost(p)));
        setTabCounts(prev => ({ ...prev, tagged: withMedia.length }));
      }
      succeeded = true;
    } catch (e: any) { if (current()) setTabError(e?.message || 'Could not load these posts. Please retry.'); }
    finally { if (current()) { setTabLoading(false); if (succeeded) tabLoadedRef.current[tab] = true; } }
  }, [userId]);

  useEffect(() => {
    tabLoadedRef.current = {};
    setProfile(null); setTabPosts([]); setTabReposts([]); setTabSaved([]); setTabTagged([]);
    setHighlights([]); setTabError(null); setLoadError(null); setLoading(!!userId);
    setPostsHasMore(false); setLoadingMorePosts(false); setTabLoading(false);
  }, [userId]);
  useFocusEffect(useCallback(() => {
    setLoadingMorePosts(false);
    void load(); void loadHighlights();
    return () => { profileRequest.current++; tabRequest.current++; moreRequest.current++; highlightsRequest.current++; };
  }, [load, loadHighlights]));
  const [hasStory, setHasStory] = useState(false);
  useFocusEffect(useCallback(() => {
    let alive = true;
    if (!userId) return;
    supabase.from('stories').select('id').eq('user_id', userId)
      .gte('created_at', new Date(Date.now() - 86400000).toISOString()).limit(1)
      .then(({ data }) => { if (alive) setHasStory((data || []).length > 0); });
    return () => { alive = false; };
  }, [userId]));

  useEffect(() => {
    if (profile?.id === userId) void loadTabContent(activeTab);
  }, [activeTab, profile?.id, userId, contentRevision, loadTabContent]);

  useEffect(() => {
    if (route.params?.edit && profile) { openEdit(); navigation.setParams({ edit: undefined } as any); }
  }, [route.params?.edit, profile]);

  const changePhoto = async () => {
    if (!userId) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed','Allow photo access in your device settings.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
        preferredAssetRepresentationMode: "compatible" as ImagePicker.UIImagePickerPreferredAssetRepresentationMode, mediaTypes: ['images'] as ImagePicker.MediaType[], allowsEditing: true, aspect: [1,1], quality: 0.85 });
    if (result.canceled || !result.assets?.[0]) return;
    setUploadingPhoto(true);
    try {
      const asset = result.assets[0];
      const ext = (asset.uri.split('.').pop() || 'jpg').toLowerCase().replace('jpeg','jpg');
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      const { url } = await uploadMedia('avatars', userId, { uri: asset.uri, kind: 'image', ext, mimeType: mime, width: asset.width, height: asset.height, base64: null }, { filename: `avatar_${Date.now()}.${ext}` });
      const { error: dbErr } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', userId);
      if (dbErr) { Alert.alert('Save failed', dbErr.message); return; }
      setProfile(prev => prev ? { ...prev, avatar_url: url } : prev);
      if (setAuthProfile) setAuthProfile({ ...(authProfile as any), avatar_url: url });
    } catch(e:any) { Alert.alert('Error', e?.message || 'Could not update photo.'); }
    finally { setUploadingPhoto(false); }
  };

  const openStats = async (type: 'followers'|'following') => {
    setStatsModal(type); setStatsLoading(true); setStatsPeople([]);
    try {
      let ids:string[]=[];
      if (type==='followers') {
        const { data } = await supabase.from('follows').select('follower_id').eq('following_id',userId).neq('follower_id',userId);
        ids=(data||[]).map((r:any)=>r.follower_id);
      } else {
        const { data } = await supabase.from('follows').select('following_id').eq('follower_id',userId).neq('following_id',userId);
        ids=(data||[]).map((r:any)=>r.following_id);
      }
      if (ids.length>0) { const { data: people } = await supabase.from('profiles').select('id,full_name,username,avatar_url').in('id',ids); setStatsPeople((people||[]) as Person[]); }
    } catch(e){ console.log('STATS',e); }
    finally { setStatsLoading(false); }
  };

  const openEdit = () => {
    if (!profile) return;
    navigation.navigate('EditProfile');
  };

  const handleHighlightTap = useCallback((h: StoryHighlight) => {
    if (!userId) return;
    navigation.navigate('StoryViewer', {
      userIds: [userId],
      startUserId: userId,
      highlightId: h.id,
      highlightTitle: h.title,
    });
  }, [userId, navigation]);

  const handleHighlightCreate = useCallback(() => {
    Alert.prompt(
      'New Highlight',
      'Enter a name for your highlight',
      async (title) => {
        const trimmed = (title || '').trim();
        if (!trimmed) return;
        try {
          await storiesService.createHighlight(trimmed);
          loadHighlights();
        } catch (e: any) { Alert.alert('Error', e?.message || 'Could not create highlight'); }
      },
      'plain-text',
      '',
      'default'
    );
  }, [loadHighlights]);

  const handleHighlightLongPress = useCallback((h: StoryHighlight) => {
    Alert.alert(h.title, undefined, [
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await storiesService.deleteHighlight(h.id); loadHighlights(); }
        catch (e: any) { Alert.alert('Error', e?.message || 'Could not delete'); }
      }},
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [loadHighlights]);

  const renderPostCard = (post: Post) => {
    const isOwnPost = post.user_id === userId;
    const author = post._originalAuthor || (isOwnPost ? { full_name: profile?.full_name || '', avatar_url: profile?.avatar_url || null } : null);
    const displayName = author?.full_name || 'Member';
    const displayAvatar = author?.avatar_url;
    const mediaWidth = contentWidth - 32;
    return (
      <Pressable key={post.id} style={[st.postCard, { marginBottom: 10, borderBottomWidth: 6, borderBottomColor: t.surface.sunken }]} onPress={() => navigation.navigate('Post', { postId: post.id })}>
        {post._savedAt && !post._repostLabel && (<View style={st.repostBanner}><Feather name="bookmark" size={12} color={t.brand.base} /><Text style={[st.repostBannerTxt, { color: t.brand.base }]}>Saved {relTime(post._savedAt)}</Text></View>)}
        <View style={st.postHeader}>
          {displayAvatar ? <ExpoImage source={{ uri: displayAvatar }} style={st.postAvatar} contentFit="cover" cachePolicy="memory-disk" transition={150} /> : <View style={[st.postAvatar, st.postAvatarFb]}><Text style={st.postAvatarTxt}>{initials(displayName)}</Text></View>}
          <View style={{ flex: 1 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><TierName userId={post.user_id} baseStyle={[st.postAuthorName, { flexShrink: 1 }]} text={displayName} /><VerifiedBadge userId={post.user_id} size={13} /></View><Text style={st.postTime}>{relTime(post.created_at)}</Text></View>
          <TouchableOpacity onPress={() => {
            const buttons: any[] = [];
            if (isOwnPost) { buttons.push({ text: 'Delete post', style: 'destructive' as const, onPress: () => { Alert.alert('Delete post?', 'This will permanently remove your post.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await supabase.from('posts').delete().eq('id', post.id); load(); } }]); } }); }
            buttons.push({ text: 'Share post', onPress: async () => { await Share.share({ message: post.content || 'Check out this post on PlatinumCircles' }); } });
            buttons.push({ text: 'Cancel', style: 'cancel' as const });
            Alert.alert(undefined as any, undefined, buttons);
          }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ padding: 4 }}><Feather name="more-horizontal" size={18} color={t.ink.muted} /></TouchableOpacity>
        </View>
        {post.content ? <Text style={st.postContent} numberOfLines={3}>{post.content}</Text> : null}
        {post.mediaUnavailable ? <Text style={{color:t.ink.muted,paddingVertical:12}}>Some media is unavailable.</Text> : null}
        {post.media.length > 0 && (
          <View>
            <ScrollView horizontal directionalLockEnabled showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} contentContainerStyle={{ gap: 6 }}>
              {post.media.map((m, idx) => (
                <View key={m.id || idx} style={{ width: post.media.length === 1 ? mediaWidth : 192, height: post.media.length === 1 ? 148 : 128, borderRadius: 10, overflow: 'hidden', backgroundColor: '#0B1E3D', alignItems: 'center', justifyContent: 'center' }}>
                  <Pressable onPress={() => navigation.navigate('Post', { postId: post.id })} style={{ width: '100%', height: '100%' }}>{m.media_type === 'video' ? (<VideoThumb uri={m.url} posterUri={m.edit?.coverUrl} fill radius={0} />) : (<ExpoImage source={{ uri: m.url }} onError={() => setTabError('A media preview could not load. Retry to refresh access.')} style={{ width: '100%', height: '100%' }} contentFit="cover" cachePolicy="memory-disk" transition={150} />)}</Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        )}
        <View style={st.postMetrics}>
          <View style={st.postMetricItem}><Feather name="heart" size={13} color={t.ink.muted} /><Text style={st.postMetricTxt}>{post.likes_count}</Text></View>
          <View style={st.postMetricItem}><Feather name="message-circle" size={13} color={t.ink.muted} /><Text style={st.postMetricTxt}>{post.comments_count}</Text></View>
          {post.reposts_count > 0 && <View style={st.postMetricItem}><Feather name="repeat" size={13} color={t.ink.muted} /><Text style={st.postMetricTxt}>{post.reposts_count}</Text></View>}
          <Text style={{ marginLeft: 'auto', fontSize: 12, color: t.ink.faint }}>{relTime(post.created_at)}</Text>
        </View>
      </Pressable>
    );
  };

  const emptyState = (tab: ProfileTab) => {
    const configs: Record<ProfileTab, { icon: string; title: string; sub: string }> = {
      posts:   { icon: 'edit-3',   title: 'No posts yet',       sub: 'Share something with the community.' },
      reposts: { icon: 'repeat',   title: 'No reposts yet',     sub: 'Repost content you find valuable.' },
      saved:   { icon: 'bookmark', title: 'No saved posts yet', sub: 'Bookmark posts from the feed and they will appear here.' },
      tagged: { icon: 'image', title: 'No media yet', sub: 'Photos and videos you post will show here.' },
    };
    const c = configs[tab];
    return (<View style={st.tabEmpty}><View style={st.tabEmptyIcon}><Feather name={c.icon as any} size={28} color={t.ink.faint} /></View><Text style={st.tabEmptyTitle}>{c.title}</Text><Text style={st.tabEmptySub}>{c.sub}</Text></View>);
  };

const loadMorePosts = useCallback(async () => {
    if (!userId || loadingMorePosts || tabPosts.length === 0) return;
    const owner = scope.current, request = ++moreRequest.current, tabGeneration = tabRequest.current;
    const current = () => mounted.current && scope.current === owner && request === moreRequest.current && tabGeneration === tabRequest.current;
    setLoadingMorePosts(true);
    setTabError(null);
    try {
      const before = (tabPosts[tabPosts.length - 1] as any)?.created_at;
      let rows: any[] = [];
      try {
        const { data, error } = await supabase.from('posts').select('*, post_media(id, url, media_type, width, height, sort_order, edit)')
          .eq('user_id', userId).lt('created_at', before)
          .order('created_at', { ascending: false }).limit(50);
        if (error) throw error; rows = data || [];
      } catch {
        const { data, error } = await supabase.from('posts').select('*')
          .eq('user_id', userId).lt('created_at', before)
          .order('created_at', { ascending: false }).limit(50);
        if (error) throw error; rows = data || [];
      }
      const authorized = await hydratePostMedia(rows.filter((row: any) => !row.archived_at));
      if (!current()) return;
      setTabPosts(prev => { const ids = new Set(prev.map(post => post.id)); return [...prev, ...authorized.filter(row => !ids.has(row.id)).map(normalizePost)]; });
      setPostsHasMore(rows.length >= 50);
    } catch (error: any) { if (current()) setTabError(error?.message || 'Could not load more posts. Please retry.'); } finally { if (mounted.current && scope.current === owner && request === moreRequest.current) setLoadingMorePosts(false); }
  }, [userId, loadingMorePosts, tabPosts]);

  const getTabData = () => {
    switch (activeTab) {
      case 'posts': return tabPosts;
      case 'reposts': return tabReposts;
      case 'saved': return tabSaved;
      case 'tagged': return tabTagged;
    }
  };

  // Inline editor deleted — EditProfileScreen is the editor.


  if (loading || (profile && profile.id !== userId)) return <SafeAreaView style={st.safe}><ProfileSkeleton /></SafeAreaView>;
  if (!profile) return <SafeAreaView style={st.safe}><View style={st.center}><Text style={{color:t.ink.muted}}>{loadError || 'Profile not found.'}</Text><TouchableOpacity accessibilityRole="button" onPress={() => { setLoading(true); void load(); }}><Text style={{color:t.brand.base,padding:16}}>Retry profile</Text></TouchableOpacity></View></SafeAreaView>;

  const statsModalTitle = statsModal === 'followers' ? 'Followers' : statsModal === 'following' ? 'Following' : '';
  const statsEmptyMsg = statsModal === 'followers' ? 'When someone follows you they appear here.' : 'Follow people to see their updates.';
  const tabData = getTabData();

  return (
    <SafeAreaView style={st.safe} edges={['top','left','right']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'}/>
      <ScrollView contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);load();loadHighlights();}} tintColor={t.brand.base}/>} onScroll={handleTabBarScroll} scrollEventThrottle={16} contentContainerStyle={{paddingBottom:insets.bottom+TAB_BAR_CLEARANCE}}>
        <ProfileHeader
          profile={profile}
          stats={stats}
          uploadingPhoto={uploadingPhoto}
          isSelf
          tabs={[{ key: 'posts', label: 'Posts' }, { key: 'reposts', label: 'Reposts' }, { key: 'saved', label: 'Likes' }, { key: 'tagged', label: 'Media' }]}
          activeTab={activeTab}
          onTabChange={(k) => setActiveTab(k as ProfileTab)}
          onSettings={() => navigation.navigate('Settings')}
          onEdit={openEdit}
          onChangePhoto={changePhoto}
          onOpenStats={(k) => (navigation as any).navigate('FollowList', { userId, initial: k, isSelf: true, username: profile?.username })}
          hasStory={hasStory}
          onOpenStory={() => (navigation as any).navigate('StoryViewer', { userId })}
        />

        <MemoryAlbumCard ownerId={userId} navigation={navigation} />
        {loadError ? <Text accessibilityRole="alert" style={{padding:16,color:t.brand.base}}>{loadError}</Text> : null}
        {tabError ? <View style={{padding:16}}><Text accessibilityRole="alert" style={{color:t.brand.base}}>{tabError}</Text><TouchableOpacity accessibilityRole="button" onPress={() => void loadTabContent(activeTab)}><Text style={{color:t.brand.base,paddingVertical:12}}>Retry posts</Text></TouchableOpacity></View> : null}
        {tabLoading && tabData.length === 0?(<View style={{paddingVertical:40,alignItems:'center'}}><ActivityIndicator color={t.brand.base}/></View>):tabData.length===0?(tabError ? null : emptyState(activeTab)):tabData.map(post=>renderPostCard(post))}
        {activeTab === 'posts' && postsHasMore && !tabLoading && (
          <TouchableOpacity onPress={loadMorePosts} disabled={loadingMorePosts} activeOpacity={0.8}
            style={{ alignSelf: 'center', marginVertical: 16, paddingHorizontal: 22, paddingVertical: 10, borderRadius: 999, backgroundColor: t.brand.tintBg }}>
            {loadingMorePosts ? <ActivityIndicator size="small" color={t.brand.base} /> : <Text style={{ fontSize: 13.5, fontWeight: '700', color: t.brand.base }}>Show more posts</Text>}
          </TouchableOpacity>
        )}
      </ScrollView>

      <Modal visible={!!statsModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={()=>setStatsModal(null)}>
        <SafeAreaView style={{flex:1,backgroundColor:t.surface.raised,paddingTop:insets.top}} edges={['left','right','bottom']}>
          <View style={st.modalHeader}><View style={{width:60}}/><Text style={st.modalTitle}>{statsModalTitle}</Text><TouchableOpacity onPress={()=>setStatsModal(null)} style={{width:60,alignItems:'flex-end'}}><Feather name="x" size={22} color={t.ink.primary}/></TouchableOpacity></View>
          {statsLoading?<ListRowSkeleton />:statsPeople.length===0?<View style={st.empty}><Feather name="users" size={40} color={t.ink.faint}/><Text style={st.emptyTitle}>Nobody here yet</Text><Text style={st.emptyTxt}>{statsEmptyMsg}</Text></View>:<FlatList  ListEmptyComponent={<EmptyState icon="grid" title="No posts yet" line="What you share appears here." />}data={statsPeople} keyExtractor={p=>p.id} contentContainerStyle={{padding:16}} renderItem={({item:person})=>(<TouchableOpacity style={st.personRow} activeOpacity={0.85} onPress={()=>{setStatsModal(null);navigation.navigate('UserProfile',{userId:person.id});}}>{person.avatar_url?<ExpoImage source={{uri:person.avatar_url}} style={st.personAvatar} contentFit="cover" cachePolicy="memory-disk" transition={150} />:<View style={[st.personAvatar,st.personAvatarFb]}><Text style={st.personAvatarTxt}>{initials(person.full_name)}</Text></View>}<View style={{flex:1}}><View style={{flexDirection:'row',alignItems:'center'}}><TierName userId={person.id} baseStyle={st.personName} text={person.full_name||'Member'} /><VerifiedBadge userId={person.id} size={12} /></View>{person.username?<Text style={st.personHandle}>@{person.username}</Text>:null}</View><Feather name="chevron-right" size={16} color={t.ink.faint}/></TouchableOpacity>)}/>}
        </SafeAreaView>
      </Modal>

    </SafeAreaView>
  );
}

const st = themedSheet((t) => ({
  twTabRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline, backgroundColor: t.surface.canvas },
  twTab: { flex: 1, alignItems: 'center', paddingVertical: 15, position: 'relative' },
  twTabTxt: { fontSize: 15, fontWeight: '600', color: t.ink.muted },
  twTabTxtOn: { color: t.ink.primary, fontWeight: '700' },
  twTabBar: { position: 'absolute', bottom: 0, height: 4, width: 56, borderRadius: 2, backgroundColor: '#1D9BF0' },
  twBanner: { height: 140, backgroundColor: '#CBD5E1' },
  twSettings: { position: 'absolute', right: 14, top: 14, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  twHead: { paddingHorizontal: 16, paddingBottom: 12 },
  twAvatarRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: -42 },
  twAvatarWrap: { borderRadius: 44, borderWidth: 4, borderColor: t.ink.inverse, backgroundColor: t.surface.canvas },
  twAvatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: t.surface.hairline },
  twAvatarTxt: { fontSize: 28, fontWeight: '800', color: t.ink.muted },
  twEditBtn: { borderWidth: 1, borderColor: '#CFD9DE', borderRadius: 18, paddingHorizontal: 16, paddingVertical: 8, marginBottom: 6 },
  twEditTxt: { fontSize: 14.5, fontWeight: '700', color: t.ink.primary },
  twName: { fontSize: 21, fontWeight: '800', color: t.ink.primary, letterSpacing: -0.5, marginTop: 10 },
  twHandle: { fontSize: 15, color: t.ink.muted, marginTop: 1 },
  twBio: { fontSize: 15, color: t.ink.primary, lineHeight: 21, marginTop: 12 },
  twBioEmpty: { fontSize: 15, color: t.ink.muted, marginTop: 12 },
  twMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12 },
  twMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  twMeta: { fontSize: 14.5, color: t.ink.muted },
  twCounts: { flexDirection: 'row', gap: 20, marginTop: 14 },
  twCountItem: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  twCountNum: { fontSize: 14.5, fontWeight: '700', color: t.ink.primary },
  twCountLbl: { fontSize: 14.5, color: t.ink.muted },
  safe:{flex:1,backgroundColor: t.surface.canvas},
  center:{flex:1,alignItems:'center',justifyContent:'center'},
  identityRegion:{backgroundColor: t.surface.raised,paddingBottom:20,marginBottom:8},
  identityTopRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingTop:10,paddingBottom:20},
  iconBtn:{width:36,height:36,borderRadius:18,backgroundColor:'rgba(0,0,0,0.04)',alignItems:'center',justifyContent:'center'},
  identityCenter:{alignItems:'center',paddingHorizontal:24},
  avatar:{width:96,height:96,borderRadius:48},
  avatarLoading:{backgroundColor:t.surface.sunken,alignItems:'center',justifyContent:'center'},
  avatarFb:{backgroundColor:t.surface.sunken,alignItems:'center',justifyContent:'center'},
  avatarFbTxt:{fontSize:34,fontWeight:'700',color:t.brand.base},
  cameraBadge:{position:'absolute',bottom:2,right:2,width:28,height:28,borderRadius:14,backgroundColor:t.brand.base,alignItems:'center',justifyContent:'center',borderWidth:2.5,borderColor:'#FAFAF9'},
  nameText:{fontSize:24,fontWeight:'800',color:t.ink.primary,marginTop:14,letterSpacing:-0.4},
  handleText:{fontSize:15,color:t.brand.base,fontWeight:'500',marginTop:3},
  roleBadge:{marginTop:8,backgroundColor: t.brand.tintBg,borderRadius:8,paddingHorizontal:12,paddingVertical:5},
  roleBadgeTxt:{fontSize:12,fontWeight:'600',color:t.ink.secondary},
  identityBio:{fontSize:15,color:t.ink.secondary,lineHeight:22,textAlign:'center',marginTop:12,paddingHorizontal:8},
  identityMeta:{gap:5,marginTop:10,alignItems:'center'},
  statsBar:{flexDirection:'row',alignItems:'center',marginHorizontal:16,marginTop:20,backgroundColor: t.surface.canvas,borderRadius:14,overflow:'hidden'},
  statCell:{flex:1,alignItems:'center',paddingVertical:14},
  statNum:{fontSize:20,fontWeight:'700',color:t.ink.primary},
  statLbl:{fontSize:11,color:t.ink.muted,marginTop:2,textAlign:'center'},
  statDivider:{width:StyleSheet.hairlineWidth,height:36,backgroundColor:t.surface.hairline},
  bioTxt:{fontSize:15,color: t.ink.primary,lineHeight:22},
  bioEmpty:{fontSize:15,color:t.ink.faint},
  metaRow:{flexDirection:'row',alignItems:'center',gap:6},
  metaTxt:{fontSize:14,color:'#6B6B6B',flexShrink:1},
  communitySection:{paddingHorizontal:16,marginBottom:16},
  communityTitle:{fontSize:14,fontWeight:'700',color:t.ink.primary,marginBottom:10},
  communityList:{gap:2},
  communityRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:11,paddingHorizontal:4},
  communityIconBadge:{width:36,height:36,borderRadius:10,alignItems:'center',justifyContent:'center'},
  communityRowText:{flex:1},
  communityLabel:{fontSize:15,fontWeight:'600',color:t.ink.primary},
  communitySub:{fontSize:12,color:t.ink.muted,marginTop:1},
  instSection:{paddingHorizontal:16,marginBottom:16},
  instHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:10},
  instSectionTitle:{fontSize:15,fontWeight:'700',color:t.ink.primary},
  instEmpty:{flexDirection:'row',alignItems:'center',gap:8,backgroundColor:t.surface.sunken,borderRadius:12,padding:14},
  instEmptyTxt:{fontSize:14,color:t.brand.base,fontWeight:'600'},
  instItemRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:10,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:t.surface.hairline},
  instItemIcon:{width:40,height:40,borderRadius:10,backgroundColor:t.surface.sunken,alignItems:'center',justifyContent:'center'},
  instItemName:{fontSize:15,fontWeight:'600',color:t.ink.primary},
  instItemMeta:{fontSize:12,color:t.ink.muted,marginTop:2},
  primaryChip:{backgroundColor:t.brand.base,borderRadius:6,paddingHorizontal:6,paddingVertical:2},
  primaryChipTxt:{fontSize:10,color: t.ink.inverse,fontWeight:'700'},
  tabsContainer:{backgroundColor: t.surface.canvas,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:t.surface.hairline},
  tabsScroll:{paddingHorizontal:14,paddingVertical:12,gap:8,flexDirection:'row',alignItems:'center'},
  tabPill:{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:14,height:34,borderRadius:17,backgroundColor: t.surface.canvas,borderWidth:StyleSheet.hairlineWidth,borderColor:t.surface.hairline},
  tabPillActive:{backgroundColor:t.brand.base,borderColor:t.brand.base},
  tabPillTxt:{fontSize:13,fontWeight:'600',color:t.ink.muted},
  tabPillTxtActive:{color: t.ink.inverse},
  tabPillCount:{backgroundColor:t.surface.hairline,borderRadius:8,paddingHorizontal:7,paddingVertical:1},
  tabPillCountActive:{backgroundColor:'rgba(255,255,255,0.22)'},
  tabPillCountTxt:{fontSize:11,fontWeight:'700',color:t.brand.base},
  tabPillCountTxtActive:{color: t.ink.inverse},
  postCard:{padding:16,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:t.surface.hairline},
  repostBanner:{flexDirection:'row',alignItems:'center',gap:6,paddingBottom:8},
  repostBannerTxt:{fontSize:12,color:'#059669',fontWeight:'500'},
  postHeader:{flexDirection:'row',alignItems:'center',gap:10,marginBottom:10},
  postAvatar:{width:38,height:38,borderRadius:19},
  postAvatarFb:{backgroundColor:t.brand.base,alignItems:'center',justifyContent:'center'},
  postAvatarTxt:{fontSize:14,fontWeight:'700',color: t.ink.inverse},
  postAuthorName:{fontSize:14,fontWeight:'600',color:t.ink.primary},
  postTime:{fontSize:12,color:t.ink.muted,marginTop:1},
  postContent:{fontSize:15,color: t.ink.primary,lineHeight:22,marginBottom:10},
  postMediaWrap:{borderRadius:12,overflow:'hidden',marginBottom:10},
  postMetrics:{flexDirection:'row',alignItems:'center',gap:14},
  postMetricItem:{flexDirection:'row',alignItems:'center',gap:4},
  postMetricTxt:{fontSize:13,color:t.ink.muted},
  tabEmpty:{alignItems:'center',paddingVertical:60,paddingHorizontal:32,gap:6},
  tabEmptyIcon:{width:64,height:64,borderRadius:32,backgroundColor:t.surface.sunken,alignItems:'center',justifyContent:'center',marginBottom:10},
  tabEmptyTitle:{fontSize:16,fontWeight:'700',color:t.ink.primary},
  tabEmptySub:{fontSize:13,color:t.ink.muted,textAlign:'center',lineHeight:18},
  addInstSearch:{margin:14,backgroundColor:t.surface.sunken,borderRadius:12,paddingHorizontal:12,paddingVertical:10,fontSize:15},
  addInstRow:{flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:16,paddingVertical:12,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'#F2F2F7'},
  modalHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:14,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:t.surface.hairline},
  modalTitle:{fontSize:17,fontWeight:'600',color:t.ink.primary},
  personRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:t.surface.hairline},
  personAvatar:{width:46,height:46,borderRadius:23},
  personAvatarFb:{backgroundColor:t.surface.sunken,alignItems:'center',justifyContent:'center'},
  personAvatarTxt:{fontSize:17,fontWeight:'700',color:t.brand.base},
  personName:{fontSize:16,fontWeight:'600',color:t.ink.primary},
  personHandle:{fontSize:13,color:t.ink.muted,marginTop:2},
  empty:{alignItems:'center',paddingVertical:60,paddingHorizontal:32,gap:8},
  emptyTitle:{fontSize:18,fontWeight:'600',color:t.ink.primary},
  emptyTxt:{fontSize:14,color:t.ink.muted,textAlign:'center',lineHeight:20},
  editHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:13,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:t.surface.hairline},
  editCancel:{fontSize:17,color:t.ink.muted,minWidth:60},
  editTitle:{fontSize:17,fontWeight:'600',color:t.ink.primary},
  editSave:{fontSize:17,fontWeight:'700',color:t.brand.base,textAlign:'right',minWidth:60},
  editScroll:{padding:20},
  editPhotoRow:{flexDirection:'row',alignItems:'center',gap:16,marginBottom:28},
  editAvatar:{width:80,height:80,borderRadius:40},
  editAvatarFb:{backgroundColor:t.surface.sunken,alignItems:'center',justifyContent:'center'},
  editAvatarTxt:{fontSize:28,fontWeight:'700',color:t.brand.base},
  editCameraBadge:{position:'absolute',bottom:0,right:0,width:28,height:28,borderRadius:14,backgroundColor:t.brand.base,alignItems:'center',justifyContent:'center',borderWidth:2,borderColor: t.ink.inverse},
  field:{marginBottom:22},
  fieldLabel:{fontSize:12,fontWeight:'700',color:t.ink.muted,textTransform:'uppercase',letterSpacing:0.5,marginBottom:8},
  input:{backgroundColor: t.surface.sunken,borderRadius:12,paddingHorizontal:14,paddingVertical:13,fontSize:16,color:t.ink.primary},
  inputMulti:{minHeight:90,paddingTop:13,textAlignVertical:'top'},
  visRow:{flexDirection:'row',gap:10},
  visChip:{flex:1,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,paddingVertical:12,borderRadius:12,borderWidth:1.5,borderColor:t.surface.hairline,backgroundColor: t.surface.sunken},
  visChipOn:{backgroundColor:t.brand.base,borderColor:t.brand.base},
  visChipTxt:{fontSize:15,fontWeight:'500',color:t.ink.muted},
  visChipTxtOn:{color: t.ink.inverse,fontWeight:'600'},
  picker:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor: t.surface.sunken,borderRadius:12,paddingHorizontal:14,paddingVertical:13},
  pickerTxt:{fontSize:16,color:t.ink.primary,flex:1,paddingRight:8},
  pickerPh:{color:t.ink.faint},
  dropList:{marginTop:4,backgroundColor: t.surface.canvas,borderRadius:12,borderWidth:StyleSheet.hairlineWidth,borderColor:t.surface.hairline,overflow:'hidden'},
  dropItem:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:14,paddingVertical:13,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:t.surface.hairline},
  dropItemOn:{backgroundColor:t.surface.sunken},
  dropTxt:{fontSize:15,color:t.ink.primary,flex:1,paddingRight:8},
  dropTxtOn:{color:t.brand.base,fontWeight:'500'},
  semesterRow:{flexDirection:'row',gap:10},
  semesterChip:{flex:1,alignItems:'center',justifyContent:'center',paddingVertical:13,borderRadius:12,borderWidth:1.5,borderColor:t.surface.hairline,backgroundColor: t.surface.sunken},
  semesterChipOn:{backgroundColor:t.brand.base,borderColor:t.brand.base},
  semesterChipTxt:{fontSize:15,fontWeight:'500',color:t.ink.muted},
  semesterChipTxtOn:{color: t.ink.inverse,fontWeight:'700'},
  roleRow:{flexDirection:'row',flexWrap:'wrap',gap:8},
  roleChip:{paddingHorizontal:18,paddingVertical:10,borderRadius:20,borderWidth:1,borderColor:t.surface.hairline,backgroundColor: t.surface.sunken},
  roleChipOn:{backgroundColor:t.brand.base,borderColor:t.brand.base},
  roleChipTxt:{fontSize:14,color:t.ink.muted,fontWeight:'500'},
  roleChipTxtOn:{color: t.ink.inverse,fontWeight:'600'},
}));