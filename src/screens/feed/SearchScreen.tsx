import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList,
  ActivityIndicator, Image, StatusBar, Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

type Tab = 'people' | 'posts' | 'jobs' | 'events';

const TABS: { id: Tab; label: string; emoji: string }[] = [
  { id: 'people', label: 'People', emoji: '👥' },
  { id: 'posts',  label: 'Posts',  emoji: '📝' },
  { id: 'jobs',   label: 'Jobs',   emoji: '💼' },
  { id: 'events', label: 'Events', emoji: '📅' },
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
  const { profile } = useAuthStore();
  const myId = profile?.id ?? null;

  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('people');
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);

  const [people, setPeople] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(RECENT_KEY).then(v => {
      if (v) try { setRecent(JSON.parse(v)); } catch {}
    });
  }, []);

  const saveRecent = useCallback(async (term: string) => {
    const t = term.trim();
    if (!t) return;
    setRecent(prev => {
      const next = [t, ...prev.filter(x => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX_RECENT);
      AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const clearRecent = async () => {
    setRecent([]);
    await AsyncStorage.removeItem(RECENT_KEY);
  };

  const runSearch = useCallback(async (term: string) => {
    const q = term.trim();
    if (!q) {
      setPeople([]); setPosts([]); setJobs([]); setEvents([]);
      return;
    }
    setLoading(true);
    try {
      const like = `%${q}%`;

      const [pplRes, postRes, jobRes, evtRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url, degree_program, cohort, location, bio')
          .or(`full_name.ilike.${like},username.ilike.${like},degree_program.ilike.${like}`)
          .neq('id', myId ?? '')
          .limit(25),
        supabase
          .from('posts')
          .select('id, user_id, content, body, media_url, likes_count, comments_count, created_at')
          .or(`content.ilike.${like},body.ilike.${like}`)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('jobs')
          .select('id, title, company, location, category, salary_range, posted_by, created_at')
          .or(`title.ilike.${like},company.ilike.${like},location.ilike.${like},industry.ilike.${like}`)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('mingle_posts')
          .select('id, host_id, title, category, location, event_time, image_url, created_at')
          .or(`title.ilike.${like},location.ilike.${like},category.ilike.${like}`)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      const postList = postRes.data || [];
      if (postList.length) {
        const authorIds = Array.from(new Set(postList.map((p: any) => p.user_id)));
        const { data: authors } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url')
          .in('id', authorIds);
        const authorMap: Record<string, any> = {};
        (authors || []).forEach((a: any) => { authorMap[a.id] = a; });
        postList.forEach((p: any) => { p.profile = authorMap[p.user_id]; });
      }

      setPeople(pplRes.data || []);
      setPosts(postList);
      setJobs(jobRes.data || []);
      setEvents(evtRes.data || []);
    } catch (e) {
      console.log('SEARCH_ERR', e);
    } finally {
      setLoading(false);
    }
  }, [myId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { runSearch(query); }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, runSearch]);

  const submitSearch = () => {
    if (query.trim()) saveRecent(query.trim());
    Keyboard.dismiss();
  };

  const activeCount = useMemo(() => ({
    people: people.length,
    posts:  posts.length,
    jobs:   jobs.length,
    events: events.length,
  }), [people, posts, jobs, events]);

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
        <Text style={s.personName} numberOfLines={1}>{item.full_name || item.username || 'User'}</Text>
        {item.username ? <Text style={s.personHandle}>@{item.username}</Text> : null}
        {item.degree_program ? <Text style={s.personMeta} numberOfLines={1}>{item.degree_program}{item.cohort ? ` · ${item.cohort}` : ''}</Text> : null}
        {item.location ? <Text style={s.personMeta}>📍 {item.location}</Text> : null}
      </View>
      <Feather name="chevron-right" size={18} color="#C7C7CC" />
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
          <Text style={s.postAuthor} numberOfLines={1}>{item.profile?.full_name || 'User'}</Text>
          <Text style={s.postTime}>{formatTime(item.created_at)}</Text>
        </View>
      </View>
      <Text style={s.postBody} numberOfLines={3}>{item.content || item.body || ''}</Text>
      {item.media_url ? <Image source={{ uri: item.media_url }} style={s.postMedia} /> : null}
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
      onPress={() => { saveRecent(query); navigation.navigate('Jobs', { screen: 'JobsMain' }); }}
    >
      <View style={[s.jobBadge, { backgroundColor: '#EFF6FF' }]}>
        <Text style={s.jobBadgeTxt}>💼</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.jobTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={s.jobCompany} numberOfLines={1}>{item.company}</Text>
        <Text style={s.jobMeta} numberOfLines={1}>
          {[item.location, item.category, item.salary_range].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color="#C7C7CC" />
    </TouchableOpacity>
  );

  const renderEvent = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={s.eventRow}
      activeOpacity={0.85}
      onPress={() => { saveRecent(query); navigation.navigate('MingleDetails', { postId: item.id }); }}
    >
      {item.image_url
        ? <Image source={{ uri: item.image_url }} style={s.eventImg} />
        : <View style={[s.eventImg, { backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ fontSize: 22 }}>📅</Text>
          </View>}
      <View style={{ flex: 1 }}>
        <Text style={s.eventTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={s.eventMeta} numberOfLines={1}>{item.category}</Text>
        <Text style={s.eventMeta} numberOfLines={1}>📍 {item.location}</Text>
        <Text style={s.eventMeta} numberOfLines={1}>⏰ {item.event_time}</Text>
      </View>
    </TouchableOpacity>
  );

  const currentData =
    activeTab === 'people' ? people :
    activeTab === 'posts'  ? posts  :
    activeTab === 'jobs'   ? jobs   :
    events;

  const currentRenderer =
    activeTab === 'people' ? renderPerson :
    activeTab === 'posts'  ? renderPost :
    activeTab === 'jobs'   ? renderJob :
    renderEvent;

  const showResults = query.trim().length > 0;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <Text style={s.title}>Search</Text>
        <View style={s.searchBox}>
          <Feather name="search" size={16} color="#8E8E93" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search people, posts, jobs, events..."
            placeholderTextColor="#8E8E93"
            style={s.searchInput}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={submitSearch}
            clearButtonMode="while-editing"
          />
          {query.length > 0 ? (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name="x-circle" size={16} color="#8E8E93" />
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
                  {t.emoji} {t.label}{count > 0 ? ` ${count}` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {!showResults ? (
        <FlatList
          data={recent}
          keyExtractor={(item, i) => `${item}-${i}`}
          ListHeaderComponent={
            recent.length > 0 ? (
              <View style={s.recentHeader}>
                <Text style={s.recentTitle}>Recent</Text>
                <TouchableOpacity onPress={clearRecent}><Text style={s.recentClear}>Clear</Text></TouchableOpacity>
              </View>
            ) : null
          }
          contentContainerStyle={[{ paddingBottom: insets.bottom + 40 }, !recent.length && { flexGrow: 1 }]}
          ListEmptyComponent={
            <View style={s.emptyIntro}>
              <Feather name="search" size={44} color="#E5E5EA" />
              <Text style={s.emptyIntroTitle}>Discover the community</Text>
              <Text style={s.emptyIntroSub}>Find classmates, posts, jobs, and events.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={s.recentRow} onPress={() => setQuery(item)} activeOpacity={0.7}>
              <Feather name="clock" size={15} color="#8E8E93" />
              <Text style={s.recentTxt} numberOfLines={1}>{item}</Text>
              <TouchableOpacity
                onPress={() => {
                  setRecent(prev => {
                    const next = prev.filter(x => x !== item);
                    AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => {});
                    return next;
                  });
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Feather name="x" size={15} color="#C7C7CC" />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      ) : loading && currentData.length === 0 ? (
        <View style={s.loader}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={s.loaderTxt}>Searching...</Text>
        </View>
      ) : (
        <FlatList
          data={currentData}
          keyExtractor={(item: any) => item.id}
          renderItem={currentRenderer as any}
          contentContainerStyle={[
            { paddingHorizontal: 14, paddingTop: 8, paddingBottom: Math.max(insets.bottom + 40, 60) },
            !currentData.length && { flexGrow: 1 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
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

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, gap: 10 },
  title: { fontSize: 28, fontWeight: '800', color: '#000', letterSpacing: -0.5 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F2F2F7', borderRadius: 12,
    paddingHorizontal: 12, height: 40,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#000', padding: 0 },

  tabRow: {
    flexDirection: 'row', gap: 6, paddingHorizontal: 14, paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0',
  },
  tab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: '#F2F2F7' },
  tabActive: { backgroundColor: '#000' },
  tabTxt: { fontSize: 12, fontWeight: '600', color: '#3C3C43' },
  tabTxtActive: { color: '#FFF' },

  recentHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
  },
  recentTitle: { fontSize: 13, fontWeight: '700', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.5 },
  recentClear: { fontSize: 13, color: '#007AFF', fontWeight: '600' },
  recentRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 11,
  },
  recentTxt: { flex: 1, fontSize: 15, color: '#000' },

  emptyIntro: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 32, gap: 10 },
  emptyIntroTitle: { fontSize: 17, fontWeight: '700', color: '#000' },
  emptyIntroSub: { fontSize: 14, color: '#8E8E93', textAlign: 'center' },

  emptyResults: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 8 },
  emptyResultsEmoji: { fontSize: 40 },
  emptyResultsTitle: { fontSize: 17, fontWeight: '700', color: '#000' },
  emptyResultsSub: { fontSize: 14, color: '#8E8E93', textAlign: 'center' },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loaderTxt: { fontSize: 13, color: '#8E8E93' },

  personRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 11, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F5F5F5',
  },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFb: { backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 16, fontWeight: '700', color: '#1D4ED8' },
  avatarTxtSm: { fontSize: 12, fontWeight: '700', color: '#1D4ED8' },
  personName: { fontSize: 15, fontWeight: '700', color: '#000' },
  personHandle: { fontSize: 13, color: '#2563EB', marginTop: 1 },
  personMeta: { fontSize: 12, color: '#8E8E93', marginTop: 1 },

  postRow: {
    backgroundColor: '#FFF', borderRadius: 14, padding: 12, marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#F0F0F0',
  },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  postAvatar: { width: 36, height: 36, borderRadius: 18 },
  postAuthor: { fontSize: 14, fontWeight: '700', color: '#000' },
  postTime: { fontSize: 11, color: '#8E8E93' },
  postBody: { fontSize: 14, color: '#111', lineHeight: 19 },
  postMedia: { width: '100%', height: 160, borderRadius: 10, marginTop: 8 },
  postStats: { flexDirection: 'row', gap: 14, marginTop: 8 },
  postStat: { fontSize: 12, color: '#8E8E93', fontWeight: '600' },

  jobRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFF', borderRadius: 14, padding: 12, marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#F0F0F0',
  },
  jobBadge: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  jobBadgeTxt: { fontSize: 22 },
  jobTitle: { fontSize: 15, fontWeight: '700', color: '#000' },
  jobCompany: { fontSize: 13, color: '#475569', marginTop: 1 },
  jobMeta: { fontSize: 11, color: '#8E8E93', marginTop: 2 },

  eventRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFF', borderRadius: 14, padding: 12, marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#F0F0F0',
  },
  eventImg: { width: 56, height: 56, borderRadius: 10 },
  eventTitle: { fontSize: 15, fontWeight: '700', color: '#000' },
  eventMeta: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
});