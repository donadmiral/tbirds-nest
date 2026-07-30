import EmptyState from '../../components/EmptyState';
import { handleTabBarScroll } from '../../components/AdaptiveTabBar';
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image,
  TextInput, ActivityIndicator, RefreshControl, StatusBar, Alert, Share,
  KeyboardAvoidingView, Platform, FlatList, Modal, Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import ProfileHeader from '../../components/ProfileHeader';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { uploadMedia } from '../../services/mediaService';
import MediaRenderer, { PostMedia } from '../../components/MediaRenderer';
import { Image as ExpoImage } from 'expo-image';
import { storiesService, type StoryHighlight } from '../../services/storiesService';
import HighlightRow from '../../components/stories/HighlightRow';
import { ProfileSkeleton } from '../../components/Skeleton';

const SCREEN_W = Dimensions.get('window').width;
const NAVY = '#0B1E3D';
const TEXT_PRIMARY = '#000000';
const TEXT_SECONDARY = '#8E8E93';
const HAIRLINE = '#E5E5EA';

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
  { label: 'Jobs',        sub: 'Roles & referrals',   ring: '#5856D6', bg: '#F0EEFF', emoji: null, featherIcon: 'briefcase',  featherColor: '#5856D6', route: 'Jobs' },
  { label: 'Support',     sub: 'FAQs & tickets',      ring: '#34C759', bg: '#EDFBF0', emoji: null, featherIcon: 'help-circle', featherColor: '#34C759', route: 'HelpSupport' },
] as const;

type StatsModalKey = 'followers' | 'following' | null;

export default function ProfileScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { profile: authProfile, setProfile: setAuthProfile } = useAuthStore();
  const userId = authProfile?.id ?? null;

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


  const [statsModal, setStatsModal] = useState<StatsModalKey>(null);
  const [statsPeople, setStatsPeople] = useState<Person[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);

  const [highlights, setHighlights] = useState<StoryHighlight[]>([]);

  const normalizePost = (row: any): Post => {
    const mediaArr: PostMedia[] = Array.isArray(row.post_media) && row.post_media.length > 0
      ? (row.post_media as PostMedia[]).sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      : (row.media_url ? [{ id: '0', url: row.media_url, media_type: 'image' as const, sort_order: 0 }] : []);
    return {
      id: row.id, content: row.content || row.body || '', likes_count: row.likes_count ?? 0,
      comments_count: row.comments_count ?? 0, reposts_count: row.reposts_count ?? 0,
      created_at: row.created_at, media_url: row.media_url || null, media: mediaArr, user_id: row.user_id,
    };
  };

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const { data: pj, error: pErr } = await supabase.rpc('get_profile', { p_profile_id: userId });
      if (pErr) { console.log('PROFILE_LOAD', pErr.message); setLoadError(pErr.message); return; }
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
      if (setAuthProfile) setAuthProfile({ ...(authProfile as any), ...pd });
      const c = pd.counts || {};
      setTabCounts({ posts: c.posts ?? 0, reposts: c.reposts ?? 0, saved: c.saved ?? 0, tagged: c.media ?? 0 });
      setStats({ posts: c.posts ?? 0, connections: 0, followers: c.followers ?? 0, following: c.following ?? 0, reach: c.reach ?? null } as any);
    } catch(e){ console.log('PROFILE_LOAD',e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [userId]);

  const loadHighlights = useCallback(async () => {
    if (!userId) return;
    try {
      const list = await storiesService.getUserHighlights(userId);
      setHighlights(list);
    } catch (e) { console.log('[loadHighlights]', e); }
  }, [userId]);

  const loadTabContent = useCallback(async (tab: ProfileTab) => {
    if (!userId) return;
    setTabLoading(true);
    try {
      if (tab === 'posts') {
        let postsData: any[] = [];
        try {
          const { data } = await supabase.from('posts').select('*, post_media(id, url, media_type, width, height, sort_order)').eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
          postsData = data || [];
        } catch {
          const { data } = await supabase.from('posts').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
          postsData = data || [];
        }
        setTabPosts(postsData.map(normalizePost));
        setPostsHasMore(postsData.length >= 50);
        setTabCounts(prev => ({ ...prev, posts: postsData.length }));
      }
      if (tab === 'reposts') {
        const { data: repostRows } = await supabase.from('post_reposts').select('post_id, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
        const postIds = (repostRows || []).map((r: any) => r.post_id);
        if (postIds.length > 0) {
          let postsData: any[] = [];
          try { const { data } = await supabase.from('posts').select('*, post_media(id, url, media_type, width, height, sort_order)').in('id', postIds); postsData = data || []; }
          catch { const { data } = await supabase.from('posts').select('*').in('id', postIds); postsData = data || []; }
          const authorIds = Array.from(new Set(postsData.map((p: any) => p.user_id)));
          let authorMap: Record<string, any> = {};
          if (authorIds.length > 0) { const { data: authors } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', authorIds); (authors || []).forEach((a: any) => { authorMap[a.id] = a; }); }
          const repostTimeMap: Record<string, string> = {};
          (repostRows || []).forEach((r: any) => { repostTimeMap[r.post_id] = r.created_at; });
          const sorted = postsData.map((p: any) => ({ ...normalizePost(p), _repostLabel: 'You reposted', _repostedAt: repostTimeMap[p.id] || null, _originalAuthor: authorMap[p.user_id] || null })).sort((a, b) => { const ta = a._repostedAt ? new Date(a._repostedAt).getTime() : 0; const tb = b._repostedAt ? new Date(b._repostedAt).getTime() : 0; return tb - ta; });
          setTabReposts(sorted);
        } else { setTabReposts([]); }
        setTabCounts(prev => ({ ...prev, reposts: postIds.length }));
      }
      if (tab === 'saved') {
        const { data: bookmarkRows } = await supabase.from('post_bookmarks').select('post_id, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
        const postIds = (bookmarkRows || []).map((r: any) => r.post_id);
        if (postIds.length > 0) {
          let postsData: any[] = [];
          try { const { data } = await supabase.from('posts').select('*, post_media(id, url, media_type, width, height, sort_order)').in('id', postIds); postsData = data || []; }
          catch { const { data } = await supabase.from('posts').select('*').in('id', postIds); postsData = data || []; }
          const authorIds = Array.from(new Set(postsData.map((p: any) => p.user_id)));
          let authorMap: Record<string, any> = {};
          if (authorIds.length > 0) { const { data: authors } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', authorIds); (authors || []).forEach((a: any) => { authorMap[a.id] = a; }); }
          const bookmarkTimeMap: Record<string, string> = {};
          (bookmarkRows || []).forEach((r: any) => { bookmarkTimeMap[r.post_id] = r.created_at; });
          const sorted = postsData.map((p: any) => ({ ...normalizePost(p), _savedAt: bookmarkTimeMap[p.id] || null, _originalAuthor: authorMap[p.user_id] || null })).sort((a, b) => { const ta = a._savedAt ? new Date(a._savedAt).getTime() : 0; const tb = b._savedAt ? new Date(b._savedAt).getTime() : 0; return tb - ta; });
          setTabSaved(sorted);
        } else { setTabSaved([]); }
        setTabCounts(prev => ({ ...prev, saved: postIds.length }));
      }
      if (tab === 'tagged') {
        // media tab: your own posts that carry an image or video
        let postsData: any[] = [];
        try {
          const { data } = await supabase
            .from('posts')
            .select('*, post_media(id, url, media_type, width, height, sort_order)')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(80);
          postsData = data || [];
        } catch {
          const { data } = await supabase.from('posts').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(80);
          postsData = data || [];
        }
        const withMedia = postsData.filter((p: any) =>
          (Array.isArray(p.post_media) && p.post_media.length > 0) || !!p.media_url
        );
        setTabTagged(withMedia.map((p: any) => normalizePost(p)));
        setTabCounts(prev => ({ ...prev, tagged: withMedia.length }));
      }
    } catch (e) { console.log('[PROFILE_TAB]', e); }
    finally { setTabLoading(false); }
  }, [userId, profile?.username]);

  // Counts arrive with get_profile now. The old version derived the Media
  // badge from ilike('content', '%@username%'), which counted mentions rather
  // than media and substring-matched other usernames.
  const loadTabCounts = useCallback(async () => {}, []);

  useFocusEffect(useCallback(() => { load(); loadHighlights(); }, [load, loadHighlights]));
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
    if (profile) { loadTabContent(activeTab); loadTabCounts(); }
  }, [activeTab, profile, loadTabContent, loadTabCounts]);

  useEffect(() => {
    if (route.params?.edit && profile) { openEdit(); navigation.setParams({ edit: undefined } as any); }
  }, [route.params?.edit, profile]);

  const changePhoto = async () => {
    if (!userId) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed','Allow photo access in your device settings.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as ImagePicker.MediaType[], allowsEditing: true, aspect: [1,1], quality: 0.85 });
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
        const { data } = await supabase.from('follows').select('follower_id').eq('following_id',userId);
        ids=(data||[]).map((r:any)=>r.follower_id);
      } else {
        const { data } = await supabase.from('follows').select('following_id').eq('follower_id',userId);
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
    const mediaWidth = SCREEN_W - 32;
    return (
      <TouchableOpacity key={post.id} style={st.postCard} activeOpacity={0.85} onPress={() => navigation.navigate('Post', { postId: post.id })}>
        {post._repostLabel && (<View style={st.repostBanner}><Feather name="repeat" size={12} color="#059669" /><Text style={st.repostBannerTxt}>{post._repostLabel}{post._repostedAt ? ' \u00b7 ' + relTime(post._repostedAt) : ''}</Text></View>)}
        {post._savedAt && !post._repostLabel && (<View style={st.repostBanner}><Feather name="bookmark" size={12} color={NAVY} /><Text style={[st.repostBannerTxt, { color: NAVY }]}>Saved {relTime(post._savedAt)}</Text></View>)}
        <View style={st.postHeader}>
          {displayAvatar ? <ExpoImage source={{ uri: displayAvatar }} style={st.postAvatar} contentFit="cover" cachePolicy="memory-disk" transition={150} /> : <View style={[st.postAvatar, st.postAvatarFb]}><Text style={st.postAvatarTxt}>{initials(displayName)}</Text></View>}
          <View style={{ flex: 1 }}><Text style={st.postAuthorName} numberOfLines={1}>{displayName}</Text><Text style={st.postTime}>{relTime(post.created_at)}</Text></View>
          <TouchableOpacity onPress={() => {
            const buttons: any[] = [];
            if (isOwnPost) { buttons.push({ text: 'Delete post', style: 'destructive' as const, onPress: () => { Alert.alert('Delete post?', 'This will permanently remove your post.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await supabase.from('posts').delete().eq('id', post.id); load(); } }]); } }); }
            buttons.push({ text: 'Share post', onPress: async () => { await Share.share({ message: post.content || 'Check out this post on PlatinumCircles' }); } });
            buttons.push({ text: 'Cancel', style: 'cancel' as const });
            Alert.alert(undefined as any, undefined, buttons);
          }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ padding: 4 }}><Feather name="more-horizontal" size={18} color={TEXT_SECONDARY} /></TouchableOpacity>
        </View>
        {post.content ? <Text style={st.postContent} numberOfLines={4}>{post.content}</Text> : null}
        {post.media.length > 0 && (
          <View style={st.postMediaWrap}>
            {post.media.map((m, idx) => (
              <View key={m.id || idx} style={{ width: mediaWidth, aspectRatio: 4/5, borderRadius: 12, overflow: 'hidden', marginBottom: post.media.length > 1 ? 4 : 0 }}>
                {m.media_type === 'video' ? (<MediaRenderer media={[m]} containerWidth={mediaWidth} maxHeight={mediaWidth * 1.25} />) : (<ExpoImage source={{ uri: m.url }} style={{ width: '100%', height: '100%' }} contentFit="cover" cachePolicy="memory-disk" transition={150} />)}
              </View>
            ))}
          </View>
        )}
        <View style={st.postMetrics}>
          <View style={st.postMetricItem}><Feather name="heart" size={13} color={TEXT_SECONDARY} /><Text style={st.postMetricTxt}>{post.likes_count}</Text></View>
          <View style={st.postMetricItem}><Feather name="message-circle" size={13} color={TEXT_SECONDARY} /><Text style={st.postMetricTxt}>{post.comments_count}</Text></View>
          {post.reposts_count > 0 && <View style={st.postMetricItem}><Feather name="repeat" size={13} color={TEXT_SECONDARY} /><Text style={st.postMetricTxt}>{post.reposts_count}</Text></View>}
          <Text style={{ marginLeft: 'auto', fontSize: 12, color: '#C7C7CC' }}>{relTime(post.created_at)}</Text>
        </View>
      </TouchableOpacity>
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
    return (<View style={st.tabEmpty}><View style={st.tabEmptyIcon}><Feather name={c.icon as any} size={28} color="#C7C7CC" /></View><Text style={st.tabEmptyTitle}>{c.title}</Text><Text style={st.tabEmptySub}>{c.sub}</Text></View>);
  };

const loadMorePosts = useCallback(async () => {
    if (!userId || loadingMorePosts || tabPosts.length === 0) return;
    setLoadingMorePosts(true);
    try {
      const before = (tabPosts[tabPosts.length - 1] as any)?.created_at;
      let rows: any[] = [];
      try {
        const { data } = await supabase.from('posts').select('*, post_media(id, url, media_type, width, height, sort_order)')
          .eq('user_id', userId).lt('created_at', before)
          .order('created_at', { ascending: false }).limit(50);
        rows = data || [];
      } catch {
        const { data } = await supabase.from('posts').select('*')
          .eq('user_id', userId).lt('created_at', before)
          .order('created_at', { ascending: false }).limit(50);
        rows = data || [];
      }
      setTabPosts(prev => [...prev, ...rows.map(normalizePost)]);
      setPostsHasMore(rows.length >= 50);
    } catch {} finally { setLoadingMorePosts(false); }
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


  if (loading) return <SafeAreaView style={st.safe}><ProfileSkeleton /></SafeAreaView>;
  if (!profile) return <SafeAreaView style={st.safe}><View style={st.center}><Text style={{color:TEXT_SECONDARY}}>Profile not found.</Text></View></SafeAreaView>;

  const statsModalTitle = statsModal === 'followers' ? 'Followers' : statsModal === 'following' ? 'Following' : '';
  const statsEmptyMsg = statsModal === 'followers' ? 'When someone follows you they appear here.' : 'Follow people to see their updates.';
  const tabData = getTabData();

  return (
    <SafeAreaView style={st.safe} edges={['top','left','right']}>
      <StatusBar barStyle="dark-content"/>
      <ScrollView showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);load();loadHighlights();loadTabContent(activeTab);}} tintColor={NAVY}/>} onScroll={handleTabBarScroll} scrollEventThrottle={16} contentContainerStyle={{paddingBottom:insets.bottom+TAB_BAR_CLEARANCE}}>
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
          onOpenStats={openStats}
          hasStory={hasStory}
          onOpenStory={() => (navigation as any).navigate('StoryViewer', { userId })}
        />

        {tabLoading?(<View style={{paddingVertical:40,alignItems:'center'}}><ActivityIndicator color={NAVY}/></View>):tabData.length===0?emptyState(activeTab):tabData.map(post=>renderPostCard(post))}
        {activeTab === 'posts' && postsHasMore && !tabLoading && (
          <TouchableOpacity onPress={loadMorePosts} disabled={loadingMorePosts} activeOpacity={0.8}
            style={{ alignSelf: 'center', marginVertical: 16, paddingHorizontal: 22, paddingVertical: 10, borderRadius: 999, backgroundColor: 'rgba(11,30,61,0.06)' }}>
            {loadingMorePosts ? <ActivityIndicator size="small" color={NAVY} /> : <Text style={{ fontSize: 13.5, fontWeight: '700', color: NAVY }}>Show more posts</Text>}
          </TouchableOpacity>
        )}
      </ScrollView>

      <Modal visible={!!statsModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={()=>setStatsModal(null)}>
        <SafeAreaView style={{flex:1,backgroundColor:'#FFF'}}>
          <View style={st.modalHeader}><View style={{width:60}}/><Text style={st.modalTitle}>{statsModalTitle}</Text><TouchableOpacity onPress={()=>setStatsModal(null)} style={{width:60,alignItems:'flex-end'}}><Feather name="x" size={22} color="#000"/></TouchableOpacity></View>
          {statsLoading?<View style={st.center}><ActivityIndicator color={NAVY} size="large"/></View>:statsPeople.length===0?<View style={st.empty}><Feather name="users" size={40} color="#E5E5EA"/><Text style={st.emptyTitle}>Nobody here yet</Text><Text style={st.emptyTxt}>{statsEmptyMsg}</Text></View>:<FlatList  ListEmptyComponent={<EmptyState icon="grid" title="No posts yet" line="What you share appears here." />}data={statsPeople} keyExtractor={p=>p.id} contentContainerStyle={{padding:16}} renderItem={({item:person})=>(<TouchableOpacity style={st.personRow} activeOpacity={0.85} onPress={()=>{setStatsModal(null);navigation.navigate('UserProfile',{userId:person.id});}}>{person.avatar_url?<ExpoImage source={{uri:person.avatar_url}} style={st.personAvatar} contentFit="cover" cachePolicy="memory-disk" transition={150} />:<View style={[st.personAvatar,st.personAvatarFb]}><Text style={st.personAvatarTxt}>{initials(person.full_name)}</Text></View>}<View style={{flex:1}}><Text style={st.personName}>{person.full_name||'Member'}</Text>{person.username?<Text style={st.personHandle}>@{person.username}</Text>:null}</View><Feather name="chevron-right" size={16} color="#C7C7CC"/></TouchableOpacity>)}/>}
        </SafeAreaView>
      </Modal>

    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  twTabRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EFF3F4', backgroundColor: '#FFFFFF' },
  twTab: { flex: 1, alignItems: 'center', paddingVertical: 15, position: 'relative' },
  twTabTxt: { fontSize: 15, fontWeight: '600', color: '#536471' },
  twTabTxtOn: { color: '#0F1419', fontWeight: '700' },
  twTabBar: { position: 'absolute', bottom: 0, height: 4, width: 56, borderRadius: 2, backgroundColor: '#1D9BF0' },
  twBanner: { height: 140, backgroundColor: '#CBD5E1' },
  twSettings: { position: 'absolute', right: 14, top: 14, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  twHead: { paddingHorizontal: 16, paddingBottom: 12 },
  twAvatarRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: -42 },
  twAvatarWrap: { borderRadius: 44, borderWidth: 4, borderColor: '#FFFFFF', backgroundColor: '#FFFFFF' },
  twAvatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#E5E5EA' },
  twAvatarTxt: { fontSize: 28, fontWeight: '800', color: '#8E8E93' },
  twEditBtn: { borderWidth: 1, borderColor: '#CFD9DE', borderRadius: 18, paddingHorizontal: 16, paddingVertical: 8, marginBottom: 6 },
  twEditTxt: { fontSize: 14.5, fontWeight: '700', color: '#0F1419' },
  twName: { fontSize: 21, fontWeight: '800', color: '#0F1419', letterSpacing: -0.5, marginTop: 10 },
  twHandle: { fontSize: 15, color: '#536471', marginTop: 1 },
  twBio: { fontSize: 15, color: '#0F1419', lineHeight: 21, marginTop: 12 },
  twBioEmpty: { fontSize: 15, color: '#8E8E93', marginTop: 12 },
  twMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12 },
  twMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  twMeta: { fontSize: 14.5, color: '#536471' },
  twCounts: { flexDirection: 'row', gap: 20, marginTop: 14 },
  twCountItem: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  twCountNum: { fontSize: 14.5, fontWeight: '700', color: '#0F1419' },
  twCountLbl: { fontSize: 14.5, color: '#536471' },
  safe:{flex:1,backgroundColor:'#FFF'},
  center:{flex:1,alignItems:'center',justifyContent:'center'},
  identityRegion:{backgroundColor:'#F9F9FB',paddingBottom:20,marginBottom:8},
  identityTopRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingTop:10,paddingBottom:20},
  iconBtn:{width:36,height:36,borderRadius:18,backgroundColor:'rgba(0,0,0,0.04)',alignItems:'center',justifyContent:'center'},
  identityCenter:{alignItems:'center',paddingHorizontal:24},
  avatar:{width:96,height:96,borderRadius:48},
  avatarLoading:{backgroundColor:'#F2F2F7',alignItems:'center',justifyContent:'center'},
  avatarFb:{backgroundColor:'#F2F2F7',alignItems:'center',justifyContent:'center'},
  avatarFbTxt:{fontSize:34,fontWeight:'700',color:NAVY},
  cameraBadge:{position:'absolute',bottom:2,right:2,width:28,height:28,borderRadius:14,backgroundColor:NAVY,alignItems:'center',justifyContent:'center',borderWidth:2.5,borderColor:'#F9F9FB'},
  nameText:{fontSize:24,fontWeight:'800',color:TEXT_PRIMARY,marginTop:14,letterSpacing:-0.4},
  handleText:{fontSize:15,color:NAVY,fontWeight:'500',marginTop:3},
  roleBadge:{marginTop:8,backgroundColor:'rgba(11,30,61,0.06)',borderRadius:8,paddingHorizontal:12,paddingVertical:5},
  roleBadgeTxt:{fontSize:12,fontWeight:'600',color:'#3C3C43'},
  identityBio:{fontSize:15,color:'#3C3C43',lineHeight:22,textAlign:'center',marginTop:12,paddingHorizontal:8},
  identityMeta:{gap:5,marginTop:10,alignItems:'center'},
  statsBar:{flexDirection:'row',alignItems:'center',marginHorizontal:16,marginTop:20,backgroundColor:'#FFFFFF',borderRadius:14,overflow:'hidden'},
  statCell:{flex:1,alignItems:'center',paddingVertical:14},
  statNum:{fontSize:20,fontWeight:'700',color:TEXT_PRIMARY},
  statLbl:{fontSize:11,color:TEXT_SECONDARY,marginTop:2,textAlign:'center'},
  statDivider:{width:StyleSheet.hairlineWidth,height:36,backgroundColor:HAIRLINE},
  bioTxt:{fontSize:15,color:'#1A1A1A',lineHeight:22},
  bioEmpty:{fontSize:15,color:'#C7C7CC'},
  metaRow:{flexDirection:'row',alignItems:'center',gap:6},
  metaTxt:{fontSize:14,color:'#6B6B6B',flexShrink:1},
  communitySection:{paddingHorizontal:16,marginBottom:16},
  communityTitle:{fontSize:14,fontWeight:'700',color:TEXT_PRIMARY,marginBottom:10},
  communityList:{gap:2},
  communityRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:11,paddingHorizontal:4},
  communityIconBadge:{width:36,height:36,borderRadius:10,alignItems:'center',justifyContent:'center'},
  communityRowText:{flex:1},
  communityLabel:{fontSize:15,fontWeight:'600',color:TEXT_PRIMARY},
  communitySub:{fontSize:12,color:TEXT_SECONDARY,marginTop:1},
  instSection:{paddingHorizontal:16,marginBottom:16},
  instHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:10},
  instSectionTitle:{fontSize:15,fontWeight:'700',color:TEXT_PRIMARY},
  instEmpty:{flexDirection:'row',alignItems:'center',gap:8,backgroundColor:'#F2F2F7',borderRadius:12,padding:14},
  instEmptyTxt:{fontSize:14,color:NAVY,fontWeight:'600'},
  instItemRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:10,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#F2F2F7'},
  instItemIcon:{width:40,height:40,borderRadius:10,backgroundColor:'#F2F2F7',alignItems:'center',justifyContent:'center'},
  instItemName:{fontSize:15,fontWeight:'600',color:TEXT_PRIMARY},
  instItemMeta:{fontSize:12,color:TEXT_SECONDARY,marginTop:2},
  primaryChip:{backgroundColor:NAVY,borderRadius:6,paddingHorizontal:6,paddingVertical:2},
  primaryChipTxt:{fontSize:10,color:'#FFF',fontWeight:'700'},
  tabsContainer:{backgroundColor:'#FFFFFF',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:HAIRLINE},
  tabsScroll:{paddingHorizontal:14,paddingVertical:12,gap:8,flexDirection:'row',alignItems:'center'},
  tabPill:{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:14,height:34,borderRadius:17,backgroundColor:'#FFFFFF',borderWidth:StyleSheet.hairlineWidth,borderColor:HAIRLINE},
  tabPillActive:{backgroundColor:NAVY,borderColor:NAVY},
  tabPillTxt:{fontSize:13,fontWeight:'600',color:TEXT_SECONDARY},
  tabPillTxtActive:{color:'#FFFFFF'},
  tabPillCount:{backgroundColor:'rgba(11,30,61,0.10)',borderRadius:8,paddingHorizontal:7,paddingVertical:1},
  tabPillCountActive:{backgroundColor:'rgba(255,255,255,0.22)'},
  tabPillCountTxt:{fontSize:11,fontWeight:'700',color:NAVY},
  tabPillCountTxtActive:{color:'#FFFFFF'},
  postCard:{padding:16,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#F2F2F7'},
  repostBanner:{flexDirection:'row',alignItems:'center',gap:6,paddingBottom:8},
  repostBannerTxt:{fontSize:12,color:'#059669',fontWeight:'500'},
  postHeader:{flexDirection:'row',alignItems:'center',gap:10,marginBottom:10},
  postAvatar:{width:38,height:38,borderRadius:19},
  postAvatarFb:{backgroundColor:NAVY,alignItems:'center',justifyContent:'center'},
  postAvatarTxt:{fontSize:14,fontWeight:'700',color:'#FFF'},
  postAuthorName:{fontSize:14,fontWeight:'600',color:TEXT_PRIMARY},
  postTime:{fontSize:12,color:TEXT_SECONDARY,marginTop:1},
  postContent:{fontSize:15,color:'#1A1A1A',lineHeight:22,marginBottom:10},
  postMediaWrap:{borderRadius:12,overflow:'hidden',marginBottom:10},
  postMetrics:{flexDirection:'row',alignItems:'center',gap:14},
  postMetricItem:{flexDirection:'row',alignItems:'center',gap:4},
  postMetricTxt:{fontSize:13,color:TEXT_SECONDARY},
  tabEmpty:{alignItems:'center',paddingVertical:60,paddingHorizontal:32,gap:6},
  tabEmptyIcon:{width:64,height:64,borderRadius:32,backgroundColor:'#F2F2F7',alignItems:'center',justifyContent:'center',marginBottom:10},
  tabEmptyTitle:{fontSize:16,fontWeight:'700',color:TEXT_PRIMARY},
  tabEmptySub:{fontSize:13,color:TEXT_SECONDARY,textAlign:'center',lineHeight:18},
  addInstSearch:{margin:14,backgroundColor:'#F2F2F7',borderRadius:12,paddingHorizontal:12,paddingVertical:10,fontSize:15},
  addInstRow:{flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:16,paddingVertical:12,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'#F2F2F7'},
  modalHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:14,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:HAIRLINE},
  modalTitle:{fontSize:17,fontWeight:'600',color:TEXT_PRIMARY},
  personRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#F5F5F5'},
  personAvatar:{width:46,height:46,borderRadius:23},
  personAvatarFb:{backgroundColor:'#F2F2F7',alignItems:'center',justifyContent:'center'},
  personAvatarTxt:{fontSize:17,fontWeight:'700',color:NAVY},
  personName:{fontSize:16,fontWeight:'600',color:TEXT_PRIMARY},
  personHandle:{fontSize:13,color:TEXT_SECONDARY,marginTop:2},
  empty:{alignItems:'center',paddingVertical:60,paddingHorizontal:32,gap:8},
  emptyTitle:{fontSize:18,fontWeight:'600',color:TEXT_PRIMARY},
  emptyTxt:{fontSize:14,color:TEXT_SECONDARY,textAlign:'center',lineHeight:20},
  editHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:13,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:HAIRLINE},
  editCancel:{fontSize:17,color:TEXT_SECONDARY,minWidth:60},
  editTitle:{fontSize:17,fontWeight:'600',color:TEXT_PRIMARY},
  editSave:{fontSize:17,fontWeight:'700',color:NAVY,textAlign:'right',minWidth:60},
  editScroll:{padding:20},
  editPhotoRow:{flexDirection:'row',alignItems:'center',gap:16,marginBottom:28},
  editAvatar:{width:80,height:80,borderRadius:40},
  editAvatarFb:{backgroundColor:'#F2F2F7',alignItems:'center',justifyContent:'center'},
  editAvatarTxt:{fontSize:28,fontWeight:'700',color:NAVY},
  editCameraBadge:{position:'absolute',bottom:0,right:0,width:28,height:28,borderRadius:14,backgroundColor:NAVY,alignItems:'center',justifyContent:'center',borderWidth:2,borderColor:'#FFF'},
  field:{marginBottom:22},
  fieldLabel:{fontSize:12,fontWeight:'700',color:TEXT_SECONDARY,textTransform:'uppercase',letterSpacing:0.5,marginBottom:8},
  input:{backgroundColor:'#F5F5F5',borderRadius:12,paddingHorizontal:14,paddingVertical:13,fontSize:16,color:TEXT_PRIMARY},
  inputMulti:{minHeight:90,paddingTop:13,textAlignVertical:'top'},
  visRow:{flexDirection:'row',gap:10},
  visChip:{flex:1,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,paddingVertical:12,borderRadius:12,borderWidth:1.5,borderColor:HAIRLINE,backgroundColor:'#F5F5F5'},
  visChipOn:{backgroundColor:NAVY,borderColor:NAVY},
  visChipTxt:{fontSize:15,fontWeight:'500',color:TEXT_SECONDARY},
  visChipTxtOn:{color:'#FFF',fontWeight:'600'},
  picker:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:'#F5F5F5',borderRadius:12,paddingHorizontal:14,paddingVertical:13},
  pickerTxt:{fontSize:16,color:TEXT_PRIMARY,flex:1,paddingRight:8},
  pickerPh:{color:'#C7C7CC'},
  dropList:{marginTop:4,backgroundColor:'#FFF',borderRadius:12,borderWidth:StyleSheet.hairlineWidth,borderColor:HAIRLINE,overflow:'hidden'},
  dropItem:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:14,paddingVertical:13,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#F0F0F0'},
  dropItemOn:{backgroundColor:'#F2F2F7'},
  dropTxt:{fontSize:15,color:TEXT_PRIMARY,flex:1,paddingRight:8},
  dropTxtOn:{color:NAVY,fontWeight:'500'},
  semesterRow:{flexDirection:'row',gap:10},
  semesterChip:{flex:1,alignItems:'center',justifyContent:'center',paddingVertical:13,borderRadius:12,borderWidth:1.5,borderColor:HAIRLINE,backgroundColor:'#F5F5F5'},
  semesterChipOn:{backgroundColor:NAVY,borderColor:NAVY},
  semesterChipTxt:{fontSize:15,fontWeight:'500',color:TEXT_SECONDARY},
  semesterChipTxtOn:{color:'#FFF',fontWeight:'700'},
  roleRow:{flexDirection:'row',flexWrap:'wrap',gap:8},
  roleChip:{paddingHorizontal:18,paddingVertical:10,borderRadius:20,borderWidth:1,borderColor:HAIRLINE,backgroundColor:'#F5F5F5'},
  roleChipOn:{backgroundColor:NAVY,borderColor:NAVY},
  roleChipTxt:{fontSize:14,color:TEXT_SECONDARY,fontWeight:'500'},
  roleChipTxtOn:{color:'#FFF',fontWeight:'600'},
});