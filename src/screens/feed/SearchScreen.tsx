import { ListRowSkeleton } from '../../components/skeletons';
import { themedSheet, useTheme } from '../../theme/useTheme';
import TierName from '../../components/TierName';
import VerifiedBadge from '../../components/VerifiedBadge';
import VideoThumb from '../../components/VideoThumb';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList,
  ActivityIndicator, Image, StatusBar, Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { hydratePostMedia, withoutPrivateMedia } from '../../services/contentMedia';
import { normalizeProfilePost } from '../../utils/profilePost';
import { profileRead } from '../../utils/profileRead';
import { useProfileMediaRefresh } from '../../hooks/useProfileMediaRefresh';
import { useIsFocused } from '@react-navigation/native';

type Tab = 'people' | 'posts' | 'jobs' | 'market';

const TABS: { id: Tab; label: string }[] = [
  { id: 'people', label: 'People' },
  { id: 'posts',  label: 'Posts' },
  { id: 'jobs',   label: 'Jobs' },
  { id: 'market', label: 'Market' },
];

const RECENT_KEY = 'tbn_recent_searches_v1';
const MAX_RECENT = 8;

function initials(name?: string | null) {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

function formatTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`;
  if (dy < 7) return `${dy}d`;
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function SearchScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { t, isDark } = useTheme();
  const { profile } = useAuthStore();
  const myId = profile?.id ?? null;
  const focused = useIsFocused();
  const recentKey = `${RECENT_KEY}:${myId || 'signed-out'}`;

  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('people');
  const [postMode, setPostMode] = useState<'top' | 'latest'>('top');
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);

  const [people, setPeople] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [listings, setListings] = useState<any[]>([]);
  const [trendingTags, setTrendingTags] = useState<any[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef(0), mounted = useRef(true);
  const identity = useRef({ myId });
  if (identity.current.myId !== myId) identity.current = { myId };
  const scope = `${myId}:${query.trim()}:${postMode}`;
  const searchScope = useRef(scope); searchScope.current = scope;
  const [visibleScope, setVisibleScope] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Tab, string>>>({});
  useProfileMediaRefresh(posts, setPosts, scope, focused && activeTab === 'posts', message => setErrors(previous => ({ ...previous, posts: message })));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, []);
  useEffect(() => {
    let alive = true;
    setRecent([]); setQuery(''); setPeople([]); setPosts([]); setJobs([]); setListings([]); setTrendingTags([]); setErrors({});
    request.current++;
    if (myId) {
      AsyncStorage.getItem(recentKey).then(value => {
        if (!alive || !value) return;
        try { const saved = JSON.parse(value); if (Array.isArray(saved)) setRecent(saved.filter(item => typeof item === 'string').slice(0, MAX_RECENT)); } catch {}
      }).catch(() => {});
      void Promise.resolve(supabase.rpc('get_trending_topics', { p_limit: 8 })).then(({ data, error }) => {
        if (alive && !error) setTrendingTags(data || []);
      }).catch(() => {});
    }
    return () => { alive = false; };
  }, [myId, recentKey]);

  const saveRecent = useCallback(async (term: string) => {
    const value = term.trim();
    if (!value || !myId) return;
    setRecent(previous => {
      const next = [value, ...previous.filter(item => item.toLowerCase() !== value.toLowerCase())].slice(0, MAX_RECENT);
      void AsyncStorage.setItem(recentKey, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [recentKey, myId]);

  const clearRecent = async () => {
    setRecent([]);
    await AsyncStorage.removeItem(recentKey).catch(() => {});
  };

  const runSearch = useCallback(async (term: string) => {
    const q = term.trim(), owner = identity.current, version = ++request.current;
    const expected = `${myId}:${q}:${postMode}`;
    const current = () => mounted.current && owner === identity.current && version === request.current && searchScope.current === expected;
    if (!current()) return;
    if (!q || !myId) { setPeople([]); setPosts([]); setJobs([]); setListings([]); setLoading(false); setErrors({}); setVisibleScope(expected); return; }
    setLoading(true); setErrors({});
    const readRows = async (request: any): Promise<any[]> => {
      const { data, error } = await profileRead(request) as any;
      if (error) throw error;
      return data || [];
    };
    try {
      const [blocked, peopleResult, postResult, jobResult, marketResult] = await Promise.allSettled([
        readRows(supabase.from('blocked_users').select('blocker_id, blocked_id').or(`blocker_id.eq.${myId},blocked_id.eq.${myId}`)),
        readRows(supabase.rpc('search_people', { p_q: q, p_limit: 25 })),
        readRows(supabase.rpc('search_posts', { p_q: q, p_mode: postMode, p_limit: 20 })),
        readRows(supabase.rpc('search_jobs_fts', { p_q: q, p_limit: 20 })),
        readRows(supabase.rpc('search_listings_fts', { p_q: q, p_limit: 20 })),
      ]);
      if (!current()) return;
      // Do not publish any result if the viewer's block restrictions were unavailable.
      if (blocked.status === 'rejected') throw new Error('Privacy settings could not load. Please retry.');
      const blockedIds = new Set(blocked.value.map(row => row.blocker_id === myId ? row.blocked_id : row.blocker_id));
      const nextErrors: Partial<Record<Tab, string>> = {};
      if (peopleResult.status === 'fulfilled') setPeople(peopleResult.value.filter(row => !blockedIds.has(row.id)));
      else { setPeople([]); nextErrors.people = 'People could not load. Please retry.'; }
      if (jobResult.status === 'fulfilled') setJobs(jobResult.value);
      else { setJobs([]); nextErrors.jobs = 'Jobs could not load. Please retry.'; }
      if (marketResult.status === 'fulfilled') setListings(marketResult.value.filter(row => !blockedIds.has(row.seller_id)));
      else { setListings([]); nextErrors.market = 'Market results could not load. Please retry.'; }
      const postRows = postResult.status === 'fulfilled' ? postResult.value.map(row => ({ ...row,
        id: row.id || row.post_id, user_id: row.user_id || row.author_id,
        post_media: Array.isArray(row.media) ? row.media : row.post_media || [],
        profile: row.profile || { id: row.user_id || row.author_id, full_name: row.author_name, username: row.author_username, avatar_url: row.author_avatar },
        _mediaExpected: !!(row.media?.length || row.post_media?.length || row.media_url),
      })).filter(row => !blockedIds.has(row.user_id)) : [];
      setPosts(withoutPrivateMedia(postRows).map(row => normalizeProfilePost({ ...row, _mediaPending: true })));
      if (postResult.status === 'rejected') nextErrors.posts = 'Posts could not load. Please retry.';
      setErrors(nextErrors); setVisibleScope(expected); setLoading(false);
      if (postRows.length) {
        try {
          const media = await profileRead(hydratePostMedia(postRows), 25000);
          if (current()) setPosts(media.map(normalizeProfilePost));
        } catch {
          if (current()) {
            setPosts(withoutPrivateMedia(postRows).map(normalizeProfilePost));
            setErrors(previous => ({ ...previous, posts: 'Photos and videos could not load. Tap Retry to restore access.' }));
          }
        }
      }
      if (current()) void Promise.resolve(supabase.rpc('log_search_event', { p_query: q, p_vertical: 'all' })).catch(() => {});
    } catch (error: any) {
      if (current()) {
        setPeople([]); setPosts([]); setJobs([]); setListings([]); setVisibleScope(expected);
        const message = error?.message || 'Search could not load. Please retry.';
        setErrors({ people: message, posts: message, jobs: message, market: message });
      }
    } finally { if (current()) setLoading(false); }
  }, [myId, postMode]);

  useEffect(() => {
    request.current++;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLoading(!!query.trim()); setErrors({});
    debounceRef.current = setTimeout(() => void runSearch(query), 300);
    return () => { request.current++; if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, runSearch]);

  const submitSearch = () => {
    if (query.trim()) saveRecent(query.trim());
    Keyboard.dismiss();
  };

  const activeCount = useMemo(() => ({
    people: visibleScope === scope ? people.length : 0,
    posts: visibleScope === scope ? posts.length : 0,
    jobs: visibleScope === scope ? jobs.length : 0,
    market: visibleScope === scope ? listings.length : 0,
  }), [people, posts, jobs, listings, scope, visibleScope]);

  const renderPerson = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={s.personRow}
      activeOpacity={0.8}
      onPress={() => { saveRecent(query); navigation.navigate('UserProfile', { userId: item.id, user: item }); }}
    >
      {item.avatar_url
        ? <Image source={{ uri: item.avatar_url }} style={s.avatar} />
        : <View style={[s.avatar, s.avatarFb]}><Text style={s.avatarTxt}>{initials(item.full_name || item.username)}</Text></View>}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TierName userId={item.id} baseStyle={[s.personName, { flexShrink: 1 }]} text={item.full_name || item.username || 'User'} />
          <VerifiedBadge userId={item.id} size={13} />
        </View>
        {item.username ? <Text style={s.personHandle}>@{item.username}</Text> : null}
        {item.degree_program ? <Text style={s.personMeta} numberOfLines={1}>{item.degree_program}{item.cohort ? ` · ${item.cohort}` : ''}</Text> : null}
        {item.location ? <Text style={s.personMeta}>📍 {item.location}</Text> : null}
      </View>
      <Feather name="chevron-right" size={18} color={t.ink.muted} />
    </TouchableOpacity>
  );

  const renderPost = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={s.postRow}
      activeOpacity={0.85}
      onPress={() => { saveRecent(query); navigation.navigate('Post', { postId: item.id }); }}
    >
      <View style={s.postHeader}>
        {item.profile?.avatar_url
          ? <Image source={{ uri: item.profile.avatar_url }} style={s.postAvatar} />
          : <View style={[s.postAvatar, s.avatarFb]}><Text style={s.avatarTxtSm}>{initials(item.profile?.full_name)}</Text></View>}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TierName userId={(item as any).profile?.id ?? (item as any).user_id} baseStyle={[s.postAuthor, { flexShrink: 1 }]} text={item.profile?.full_name || 'User'} />
            <VerifiedBadge userId={(item as any).profile?.id ?? (item as any).user_id} size={12} />
          </View>
          <Text style={s.postTime}>{formatTime(item.created_at)}</Text>
        </View>
      </View>
      <Text style={s.postBody} numberOfLines={3}>{item.content || item.body || ''}</Text>
      {item.mediaPending ? <View style={s.mediaState} accessibilityRole="progressbar" accessibilityLabel="Loading post media"><ActivityIndicator color={t.ink.muted}/></View> : item.mediaUnavailable ? <TouchableOpacity accessibilityRole="button" onPress={() => void runSearch(query)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={s.postTime}>A photo or video could not load. Tap to retry.</Text></TouchableOpacity> : null}
      {(() => { const mm = Array.isArray(item.media) && item.media[0] ? item.media[0] : (item.media_url ? { url: item.media_url, media_type: 'image' } : null); if (!mm) return null; if (mm.media_type === 'video') return (<View style={[s.postMedia, { backgroundColor: t.surface.sunken, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }]}><VideoThumb uri={mm.url} fill chip={false} /><View style={{ position: 'absolute', width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}><Feather name="play" size={18} color="#FFFFFF" /></View></View>); return <Image source={{ uri: mm.url }} style={s.postMedia} />; })()}
      <View style={s.postStats}>
        <Text style={s.postStat}>♥ {item.likes_count || 0}</Text>
        <Text style={s.postStat}>💬 {item.comments_count || 0}</Text>
      </View>
    </TouchableOpacity>
  );

  const renderJob = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={s.jobRow}
      activeOpacity={0.85}
      onPress={() => { saveRecent(query); navigation.navigate('JobDetail', { job: item }); }}
    >
      <View style={[s.jobBadge, { backgroundColor: t.status.linkBg }]}>
        <Text style={s.jobBadgeTxt}>💼</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.jobTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={s.jobCompany} numberOfLines={1}>{item.company}</Text>
        <Text style={s.jobMeta} numberOfLines={1}>
          {[item.location, item.category, item.salary_range].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={t.ink.muted} />
    </TouchableOpacity>
  );

  const renderListing = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={s.jobRow}
      onPress={() => { saveRecent(query); (navigation as any).navigate('Market', { screen: 'ListingDetail', params: { listingId: item.id } }); }}
      activeOpacity={0.8}
    >
      {Array.isArray(item.images) && item.images.length > 0
        ? <Image source={{ uri: item.images[0] }} style={{ width: 52, height: 52, borderRadius: 10, backgroundColor: t.surface.sunken }} />
        : <View style={{ width: 52, height: 52, borderRadius: 10, backgroundColor: t.surface.sunken, alignItems: 'center', justifyContent: 'center' }}><Feather name="shopping-bag" size={20} color={t.ink.secondary} /></View>}
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={s.jobTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={s.jobCompany} numberOfLines={1}>{item.currency === 'ZWG' ? 'ZWG' : '$'}{item.price}</Text>
        <Text style={s.jobMeta} numberOfLines={1}>{[item.condition, item.location_city].filter(Boolean).join(' · ')}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={t.ink.muted} />
    </TouchableOpacity>
  );

  const currentData = visibleScope !== scope ? [] :
    activeTab === 'people' ? people :
    activeTab === 'posts'  ? posts  :
    activeTab === 'market' ? listings :
    jobs;

  const currentRenderer =
    activeTab === 'people' ? renderPerson :
    activeTab === 'posts'  ? renderPost :
    activeTab === 'market' ? renderListing :
    renderJob;

  const showResults = query.trim().length > 0;
  const postModeBar = activeTab === 'posts' && showResults ? (<View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 6 }}>{(['top', 'latest'] as const).map(m => (<TouchableOpacity key={m} onPress={() => setPostMode(m)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: postMode === m ? t.brand.base : t.surface.sunken }}><Text style={{ fontSize: 12.5, fontWeight: '700', color: postMode === m ? t.ink.inverse : t.ink.primary }}>{m === 'top' ? 'Top' : 'Latest'}</Text></TouchableOpacity>))}</View>) : null;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <View style={s.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            onPress={() => { if (navigation.canGoBack()) navigation.goBack(); else navigation.navigate('Main', { screen: 'Feed', params: { screen: 'FeedMain' } }); }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Feather name="chevron-left" size={26} color={t.ink.primary} />
          </TouchableOpacity>
          <Text style={s.title}>Search</Text>
        </View>
        <View style={s.searchBox}>
          <Feather name="search" size={16} color={t.ink.secondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="People, posts, jobs, market"
            accessibilityLabel="Search Platinum"
            autoCorrect={false}
            placeholderTextColor={t.ink.secondary}
            keyboardAppearance={isDark ? "dark" : "light"}
            style={s.searchInput}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={submitSearch}
          />
          {query.length > 0 ? (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="x-circle" size={16} color={t.ink.secondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {showResults ? (
        <View style={s.tabRow}>
          {TABS.map(t => {
            const count = activeCount[t.id];
            const isActive = activeTab === t.id;
            return (
              <TouchableOpacity
                key={t.id}
                style={[s.tab, isActive && s.tabActive]}
                onPress={() => setActiveTab(t.id)}
                activeOpacity={0.7}
              >
                <Text style={[s.tabTxt, isActive && s.tabTxtActive]}>
                  {t.label}{count > 0 ? `  ${count}` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {!showResults ? (
        <FlatList automaticallyAdjustKeyboardInsets={true}
          data={recent}
          keyExtractor={(item, i) => `${item}-${i}`}
          ListHeaderComponent={
            <View>
              {trendingTags.length > 0 && (
                <View style={{ marginBottom: 18, paddingHorizontal: 14, paddingTop: 8 }}>
                  <Text style={[s.recentTitle, { marginBottom: 10 }]}>Trending</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {trendingTags.map((topic: any) => (
                      <TouchableOpacity key={topic.tag} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: t.surface.sunken, borderWidth: StyleSheet.hairlineWidth, borderColor: t.surface.hairline }} onPress={() => (navigation as any).navigate('TrendFeed', { tag: topic.tag })} activeOpacity={0.75}>
                        <Feather name="trending-up" size={12} color={t.ink.primary} />
                        <Text style={{ fontSize: 13, fontWeight: '600', color: t.ink.primary }}>#{topic.tag}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
              {recent.length > 0 ? (
              <View style={s.recentHeader}>
                <Text style={s.recentTitle}>Recent</Text>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear recent searches" style={{ minHeight: 44, justifyContent: 'center' }} onPress={clearRecent}><Text style={s.recentClear}>Clear</Text></TouchableOpacity>
              </View>
            ) : null}
            </View>
          }
          contentContainerStyle={[{ paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 24 }, !recent.length && { flexGrow: 1 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            <View style={s.emptyIntro}>
              <Feather name="search" size={44} color={t.ink.muted} />
              <Text style={s.emptyIntroTitle}>Discover the community</Text>
              <Text style={s.emptyIntroSub}>Find people, posts, jobs, and the Market.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={s.recentRow} onPress={() => setQuery(item)} activeOpacity={0.7}>
              <Feather name="clock" size={15} color={t.ink.secondary} />
              <Text style={s.recentTxt} numberOfLines={1}>{item}</Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item} from recent searches`}
                style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}
                onPress={() => {
                  setRecent(prev => {
                    const next = prev.filter(x => x !== item);
                    AsyncStorage.setItem(recentKey, JSON.stringify(next)).catch(() => {});
                    return next;
                  });
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Feather name="x" size={15} color={t.ink.muted} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      ) : (loading || visibleScope !== scope) && currentData.length === 0 ? (
        <View style={s.loader}>
          <ListRowSkeleton rows={6} />
          <Text style={s.loaderTxt}>Searching...</Text>
        </View>
      ) : (
        <FlatList automaticallyAdjustKeyboardInsets={true}
          data={currentData} ListHeaderComponent={<>{postModeBar}{!!errors[activeTab] && <TouchableOpacity accessibilityRole="button" onPress={() => void runSearch(query)} style={s.error}><Text accessibilityRole="alert" style={s.emptyResultsSub}>{errors[activeTab]}</Text><Text style={s.retryText}>Retry</Text></TouchableOpacity>}</>}
          keyExtractor={(item: any) => item.id}
          renderItem={currentRenderer as any}
          contentContainerStyle={[
            { paddingHorizontal: 14, paddingTop: 8, paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 24 },
            !currentData.length && { flexGrow: 1 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={errors[activeTab] ? null :
            <View style={s.emptyResults}>
              <Text style={s.emptyResultsEmoji}>🔍</Text>
              <Text style={s.emptyResultsTitle}>No {activeTab} found</Text>
              <Text style={s.emptyResultsSub}>Try a different keyword or tab.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  error: { padding: 16, borderRadius: 12, backgroundColor: t.surface.sunken, marginBottom: 12 },
  retryText: { marginTop: 10, color: t.ink.primary, fontWeight: '700', textAlign: 'center' },
  mediaState: { minHeight: 100, marginTop: 8, backgroundColor: t.surface.sunken, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, gap: 10 },
  title: { fontSize: 28, fontWeight: '800', color: t.ink.primary, letterSpacing: -0.5 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.surface.sunken, borderRadius: 12,
    paddingHorizontal: 12, minHeight: 48,
  },
  searchInput: { flex: 1, minWidth: 0, minHeight: 48, fontSize: 16, color: t.ink.primary, paddingVertical: 10, paddingHorizontal: 0, includeFontPadding: false, textAlignVertical: 'center' },

  tabRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 14, paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline,
  },
  tab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: t.surface.sunken },
  tabActive: { backgroundColor: t.ink.primary },
  tabTxt: { fontSize: 12, fontWeight: '600', color: t.ink.secondary },
  tabTxtActive: { color: t.ink.inverse },

  recentHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
  },
  recentTitle: { fontSize: 13, fontWeight: '700', color: t.ink.secondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  recentClear: { fontSize: 13, color: t.status.link, fontWeight: '600' },
  recentRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 11,
  },
  recentTxt: { flex: 1, fontSize: 15, color: t.ink.primary },

  emptyIntro: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 32, gap: 10 },
  emptyIntroTitle: { fontSize: 17, fontWeight: '700', color: t.ink.primary },
  emptyIntroSub: { fontSize: 14, color: t.ink.secondary, textAlign: 'center' },

  emptyResults: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 8 },
  emptyResultsEmoji: { fontSize: 40 },
  emptyResultsTitle: { fontSize: 17, fontWeight: '700', color: t.ink.primary },
  emptyResultsSub: { fontSize: 14, color: t.ink.secondary, textAlign: 'center' },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loaderTxt: { fontSize: 13, color: t.ink.secondary },

  personRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 11, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline,
  },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFb: { backgroundColor: t.status.linkBg, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 16, fontWeight: '700', color: t.status.link },
  avatarTxtSm: { fontSize: 12, fontWeight: '700', color: t.status.link },
  personName: { fontSize: 15, fontWeight: '700', color: t.ink.primary },
  personHandle: { fontSize: 13, color: t.status.link, marginTop: 1 },
  personMeta: { fontSize: 12, color: t.ink.secondary, marginTop: 1 },

  postRow: {
    backgroundColor: t.surface.canvas, borderRadius: 14, padding: 12, marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: t.surface.hairline,
  },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  postAvatar: { width: 36, height: 36, borderRadius: 18 },
  postAuthor: { fontSize: 14, fontWeight: '700', color: t.ink.primary },
  postTime: { fontSize: 11, color: t.ink.secondary },
  postBody: { fontSize: 14, color: t.ink.primary, lineHeight: 19 },
  postMedia: { width: '100%', height: 160, borderRadius: 10, marginTop: 8 },
  postStats: { flexDirection: 'row', gap: 14, marginTop: 8 },
  postStat: { fontSize: 12, color: t.ink.secondary, fontWeight: '600' },

  jobRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: t.surface.canvas, borderRadius: 14, padding: 12, marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth, borderColor: t.surface.hairline,
  },
  jobBadge: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  jobBadgeTxt: { fontSize: 22 },
  jobTitle: { fontSize: 15, fontWeight: '700', color: t.ink.primary },
  jobCompany: { fontSize: 13, color: t.ink.secondary, marginTop: 1 },
  jobMeta: { fontSize: 11, color: t.ink.secondary, marginTop: 2 },

  eventRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: t.surface.canvas, borderRadius: 14, padding: 12, marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth, borderColor: t.surface.hairline,
  },
  eventImg: { width: 56, height: 56, borderRadius: 10 },
  eventTitle: { fontSize: 15, fontWeight: '700', color: t.ink.primary },
  eventMeta: { fontSize: 12, color: t.ink.secondary, marginTop: 2 },
}));