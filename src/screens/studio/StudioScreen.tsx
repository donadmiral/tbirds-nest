import { themedSheet, getTheme, useTheme } from '../../theme/useTheme';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, ScrollView, ActivityIndicator, Modal, Alert, KeyboardAvoidingView, Platform, RefreshControl } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { useUploadPreview } from '../../hooks/useUploadPreview';
import { uploadMedia } from '../../services/mediaService';
import { CATEGORIES } from '../../constants/categories';
import { useStudioLive } from '../../hooks/useStudioLive';
import { useStudioResource } from '../../hooks/useStudioResource';
import { StudioLoadError } from '../../components/StudioLoadError';
import { parseStudioLocalDate } from '../../../shared/studioValidation';
import { saveStudioDraft } from '../../../shared/studioDraftRetry';
import { MoreSeg, ReviewsSeg, AudienceSeg, CommerceSeg } from './StudioMoreSegs';
import { RecruiterSeg, AdsSeg } from './StudioHiringAdsSegs';

const NAVY = '#0B1E3D';
const TAB_CLEAR = 110;
type Seg = 'home' | 'inbox' | 'planner' | 'insights' | 'settings' | 'more' | 'reviews' | 'audience' | 'commerce' | 'recruiter' | 'ads';
const MORE_SEGS: Seg[] = ['more', 'settings', 'reviews', 'audience', 'commerce', 'recruiter', 'ads'];
type Me = { is_business: boolean; needs_code: boolean; role: string | null; display_name: string | null; business_name: string | null; username: string | null; avatar_url: string | null };
const PUBLISH_ROLES = ['owner', 'admin', 'editor'];

function pct(n: number, p: number) { if (p === 0) return n === 0 ? 0 : 100; return Math.round(((n - p) / p) * 100); }
function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
// Plain-language comparison. Percentages on small counts mislead (five likes
// going to none reads as "-100%"), so the line always says the actual number.
function compare(n: number, p: number, prior: string): { text: string; color: string } {
  const a = Number(n) || 0, b = Number(p) || 0;
  if (a === 0 && b === 0) return { text: 'nothing yet', color: getTheme().ink.secondary };
  if (a === b) return { text: 'same as ' + prior, color: getTheme().ink.secondary };
  return a > b ? { text: 'up from ' + b.toLocaleString() + ' ' + prior, color: '#1C8C4E' } : { text: 'down from ' + b.toLocaleString() + ' ' + prior, color: '#D64545' };
}
const STAT_MEANING: Record<string, string> = {
  Posts: 'Published by this business', Likes: 'On your posts', Comments: 'On your posts', Views: 'Times your posts were seen',
  Followers: 'New followers', Messages: 'Received in your inbox', 'Ad views': 'Times your ads were shown', 'Ad clicks': 'Taps on your ads',
  Impressions: 'Times your content was shown', Reach: 'People who saw your content', Engagements: 'Likes, comments, shares and saves',
  'Market chats': 'Buyer conversations started', Payments: 'Payments received in chat', Applications: 'Applications to your jobs',
};
function hourLabel(h: number) { return (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'am' : 'pm'); }
function whenLabel(iso: string) { const d = new Date(iso); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
const parseLocal = parseStudioLocalDate;

function fmtLocal(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

export default function StudioScreen() {
  useTheme();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const profile = useAuthStore(st => st.profile) as any;
  const fetchMe = useCallback(async () => { const { data, error } = await supabase.rpc('studio_me'); if (error || !data) throw new Error('Studio unavailable'); return data as Me; }, []);
  const { data: me, loading, error: meError, reload: loadMe } = useStudioResource(fetchMe, 'Business access could not be loaded. Please try again.');
  const [seg, setSeg] = useState<Seg>('home');
  const [code, setCode] = useState('');
  const [binding, setBinding] = useState(false);
  const bindingLock = useRef(false);

  const bind = async () => {
    if (!code.trim() || bindingLock.current) return;
    bindingLock.current = true;
    setBinding(true);
    try {
      const { error } = await supabase.rpc('studio_bind_member', { p_code: code.trim() });
      if (error) throw error;
      setCode(''); await loadMe();
    } catch (e: any) { Alert.alert('Code not recognised', e?.message || 'Check the code and try again.'); }
    finally { bindingLock.current = false; setBinding(false); }
  };

  const canPublish = !!me?.role && PUBLISH_ROLES.includes(me.role);

  if (loading) return <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={getTheme().ink.primary} /></View>;

  if (meError) return <SafeAreaView style={s.safe}><StudioLoadError message={meError} onRetry={loadMe} busy={loading} /></SafeAreaView>;

  if (!me || !me.is_business) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <View style={[s.center, { flex: 1, paddingHorizontal: 32 }]}>
          <Feather name="grid" size={36} color="#E5E5EA" />
          <Text style={s.emptyTitle}>Business Studio</Text>
          <Text style={s.emptySub}>Switch your account to Business in Settings and the Studio opens here: catalogue, storefront, inbox, ads and team.</Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => navigation.navigate('Settings')}><Text style={s.primaryTxt}>Open Settings</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('BusinessSignIn')} style={{ marginTop: 14 }}><Text style={{ fontSize: 13, color: getTheme().ink.secondary, fontWeight: '600' }}>Part of a team? Sign in to the business</Text></TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (me.needs_code) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={[s.center, { flex: 1, paddingHorizontal: 28 }]}>
            <Text style={s.emptyTitle}>Who is working?</Text>
            <Text style={s.emptySub}>Enter your personal access code once for this session. It sets what you can do for {me.business_name || 'this business'}.</Text>
            <TextInput style={s.codeInput} value={code} onChangeText={t => setCode(t.toUpperCase())} placeholder="ACCESS CODE" placeholderTextColor={getTheme().ink.secondary} autoCapitalize="characters" autoCorrect={false} onSubmitEditing={bind} />
            <TouchableOpacity style={[s.primaryBtn, (!code.trim() || binding) && { opacity: 0.4 }]} onPress={bind} disabled={!code.trim() || binding}>
              {binding ? <ActivityIndicator color={getTheme().ink.inverse} size="small" /> : <Text style={s.primaryTxt}>Continue</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['left', 'right']}>
      <View style={[s.band, { paddingTop: insets.top + 8 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {me.avatar_url ? <ExpoImage source={{ uri: me.avatar_url }} style={s.bandIcon} contentFit="cover" /> : <View style={[s.bandIcon, { backgroundColor: '#FFFFFF22', alignItems: 'center', justifyContent: 'center' }]}><Feather name="grid" size={20} color={getTheme().ink.inverse} /></View>}
          <View style={{ flex: 1 }}>
            <Text style={s.bandTitle} numberOfLines={1}>{me.business_name || 'Studio'}</Text>
            <Text style={s.bandMeta} numberOfLines={1}>{me.display_name || 'Member'} · {me.role}</Text>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 14 }} contentContainerStyle={{ gap: 8 }}>
          {(['home', 'inbox', 'planner', 'insights', 'more'] as Seg[]).map(k => { const on = k === 'more' ? MORE_SEGS.includes(seg) : seg === k; return (
            <TouchableOpacity key={k} style={[s.segChip, on && s.segChipOn]} onPress={() => setSeg(k)} activeOpacity={0.85}>
              <Text style={[s.segTxt, on && s.segTxtOn]}>{k === 'home' ? 'Home' : k === 'inbox' ? 'Inbox' : k === 'planner' ? 'Planner' : k === 'insights' ? 'Insights' : 'More'}</Text>
            </TouchableOpacity>
          ); })}
        </ScrollView>
      </View>
      {seg === 'home' ? <HomeSeg me={me} navigation={navigation} setSeg={setSeg} /> : seg === 'inbox' ? <InboxSeg me={me} navigation={navigation} setSeg={setSeg} /> : seg === 'planner' ? <PlannerSeg canPublish={canPublish} meId={profile?.id} /> : seg === 'insights' ? <InsightsSeg navigation={navigation} /> : seg === 'reviews' ? <ReviewsSeg role={me.role} onBack={() => setSeg('more')} /> : seg === 'audience' ? <AudienceSeg role={me.role} navigation={navigation} onBack={() => setSeg('more')} /> : seg === 'commerce' ? <CommerceSeg role={me.role} navigation={navigation} onBack={() => setSeg('more')} /> : seg === 'recruiter' ? <RecruiterSeg role={me.role} navigation={navigation} onBack={() => setSeg('more')} /> : seg === 'ads' ? <AdsSeg role={me.role} navigation={navigation} onBack={() => setSeg('more')} /> : seg === 'more' ? <MoreSeg onMonetization={() => navigation.navigate('Profile', { screen: 'Monetization' })} go={setSeg} /> : <SettingsSeg me={me} reload={loadMe} />}
    </SafeAreaView>
  );
}

function HomeSeg({ me, navigation, setSeg }: { me: Me; navigation: any; setSeg: (k: Seg) => void }) {
  const fetchHome = useCallback(async () => { const { data, error } = await supabase.rpc('studio_home'); if (error || !data) throw new Error('Overview unavailable'); return data as any; }, []);
  const { data: h, error: loadError, reload: load } = useStudioResource(fetchHome, 'Your business overview could not be refreshed.');
  const [refreshing, setRefreshing] = useState(false);
  useStudioLive(load);
  if (!h && loadError) return <StudioLoadError message={loadError} onRetry={load} />;
  if (!h) return <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={getTheme().ink.primary} /></View>;
  const todos = [
    { n: h.todos.unanswered, label: 'unanswered messages', icon: 'message-circle', go: () => navigation.navigate('Messages') },
    { n: h.todos.offers, label: 'offers waiting on you', icon: 'tag', go: () => navigation.navigate('Messages') },
    { n: h.todos.applicants, label: 'applicants to review', icon: 'briefcase', go: () => setSeg('recruiter') },
    { n: h.todos.ads_ending, label: 'ads ending or near cap', icon: 'radio', go: () => setSeg('ads') },
    { n: h.todos.reviews, label: 'new reviews this month', icon: 'star', go: () => setSeg('reviews') },
    { n: h.todos.scheduled_today, label: 'posts scheduled today', icon: 'clock', go: () => setSeg('planner') },
    { n: h.todos.failed_posts, label: 'posts failed to publish', icon: 'alert-triangle', go: () => setSeg('planner') },
  ].filter(t => t.n > 0);
  const stats = [
    ['Posts', h.now.posts, h.prev.posts], ['Likes', h.now.likes, h.prev.likes], ['Comments', h.now.comments, h.prev.comments],
    ['Views', h.now.views, h.prev.views], ['Followers', h.now.followers, h.prev.followers], ['Messages', h.now.messages, h.prev.messages],
    ['Ad views', h.now.ad_impressions, h.prev.ad_impressions], ['Ad clicks', h.now.ad_clicks, h.prev.ad_clicks],
  ] as [string, number, number][];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: TAB_CLEAR }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <StudioLoadError message={loadError} onRetry={load} busy={refreshing} />
      <Text style={s.h1}>{greeting()}, {me.business_name || me.display_name || 'team'}</Text>
      <Text style={s.sub}>Last 7 days against the 7 before.</Text>
      <Text style={s.section}>Needs attention</Text>
      {todos.length === 0 ? <View style={s.card}><Text style={s.cardMuted}>Nothing waiting on you. Inbox, offers, applicants and ads are clear.</Text></View>
        : todos.map(t => (
          <TouchableOpacity key={t.label} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]} onPress={t.go} activeOpacity={0.85}>
            <Feather name={t.icon as any} size={16} color={getTheme().ink.primary} />
            <Text style={s.cardTxt}><Text style={{ fontWeight: '800' }}>{t.n}</Text> {t.label}</Text>
          </TouchableOpacity>
        ))}
      <Text style={s.section}>Performance</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {stats.map(([label, n, p]) => { const cmp = compare(n, p, 'last week'); return (
          <View key={label} style={[s.card, { width: '48%', marginBottom: 0 }]}>
            <Text style={s.statLabel}>{label}</Text>
            <Text style={s.statHint}>{STAT_MEANING[label] || ''}</Text>
            <Text style={[s.statNum, (Number(n) || 0) === 0 && s.statNumZero]}>{Number(n).toLocaleString()}</Text>
            <Text style={[s.statDelta, { color: cmp.color }]}>{cmp.text}</Text>
          </View>
        ); })}
      </View>
      {Array.isArray(h.payments) && h.payments.length > 0 ? <Text style={[s.sub, { marginTop: 10 }]}>Received this week: {h.payments.map((p: any) => p.currency + ' ' + Number(p.total).toLocaleString() + ' (' + p.count + ')').join(' · ')}</Text> : null}
      <Text style={s.section}>Recent posts</Text>
      {(h.recent || []).length === 0 ? <View style={s.card}><Text style={s.cardMuted}>No posts yet. Plan the first one in Planner.</Text></View>
        : h.recent.map((p: any) => (
          <TouchableOpacity key={p.post_id} style={s.card} onPress={() => navigation.navigate('Post', { postId: p.post_id })} activeOpacity={0.85}>
            <Text style={s.cardTxt} numberOfLines={2}>{p.content || p.body || 'Media post'}</Text>
            <Text style={s.cardMeta}>{p.views_count} views · {p.likes_count} likes · {p.comments_count} comments · {p.reposts_count} reposts</Text>
          </TouchableOpacity>
        ))}
      <Text style={s.section}>Best times to post</Text>
      <View style={s.card}>
        {(h.best_hours || []).length === 0 ? <Text style={s.cardMuted}>Appears after your posts collect engagement.</Text>
          : h.best_hours.map((b: any) => <Text key={b.hour} style={s.cardTxt}>{hourLabel(b.hour)} · {b.score} engagements</Text>)}
      </View>
    </ScrollView>
  );
}

function InboxSeg({ me, navigation, setSeg }: { me: Me; navigation: any; setSeg: (k: Seg) => void }) {
  const [filter, setFilter] = useState<'all' | 'dm' | 'offer' | 'applicant' | 'review'>('all');
  const [showDone, setShowDone] = useState(false);
  const fetchInbox = useCallback(async () => {
    const { data, error } = await supabase.rpc('studio_inbox', { p_filter: filter, p_limit: 120 });
    if (error) throw error;
    return (data || []) as any[];
  }, [filter]);
  const { data, error: loadError, loading, reload: load } = useStudioResource(fetchInbox, 'Your business inbox could not be refreshed.');
  const items = data || [];
  const pending = useRef(new Set<string>());
  useStudioLive(load);

  const setState = async (it: any, patch: any) => {
    if (pending.current.has(it.id)) return;
    pending.current.add(it.id);
    try {
      const { error } = await supabase.rpc('studio_set_thread', { p_conversation: it.id, p_label: patch.label ?? null, p_assignee: null, p_done: patch.done ?? null, p_note: patch.note ?? null });
      if (error) throw error;
      await load();
    } catch { Alert.alert('Could not update', 'The thread was not confirmed. Refresh and try again.'); }
    finally { pending.current.delete(it.id); }
  };
  const open = (it: any) => {
    if (it.kind === 'dm') navigation.navigate('Chat', { conversationId: it.id, userId: it.other_id, userName: it.title, otherUser: { id: it.other_id, full_name: it.title, username: it.username, avatar_url: it.avatar_url } });
    else if (it.kind === 'offer') navigation.navigate('Market', { screen: 'ListingDetail', params: { listingId: it.ref } });
    else if (it.kind === 'applicant') setSeg('recruiter');
    else setSeg('reviews');
  };
  const respond = (it: any, action: 'accepted' | 'declined') => {
    Alert.alert(action === 'accepted' ? 'Accept this offer?' : 'Decline this offer?', it.preview, [
      { text: 'Cancel', style: 'cancel' },
      { text: action === 'accepted' ? 'Accept' : 'Decline', style: action === 'declined' ? 'destructive' : 'default', onPress: async () => {
        if (pending.current.has(it.id)) return;
        pending.current.add(it.id);
        try {
          const { error } = await supabase.rpc('respond_offer', { p_offer_id: it.id, p_action: action, p_counter_amount: null });
          if (error) throw error;
          await load();
        } catch { Alert.alert('Offer not confirmed', 'Refresh the inbox to check its status before trying again.'); }
        finally { pending.current.delete(it.id); }
      } },
    ]);
  };
  const actions = (it: any) => {
    const labels = ['lead', 'customer', 'vip', 'urgent', 'follow up', 'spam'];
    const buttons: any[] = [{ text: it.done ? 'Reopen' : 'Mark done', onPress: () => setState(it, { done: !it.done }) }];
    buttons.push({ text: 'Set label', onPress: () => Alert.alert('Label', undefined, [...labels.map(l => ({ text: l, onPress: () => setState(it, { label: l }) })), { text: 'Cancel', style: 'cancel' }]) });
    if (it.kind === 'offer' && it.waiting) { buttons.push({ text: 'Accept offer', onPress: () => respond(it, 'accepted') }); buttons.push({ text: 'Decline offer', style: 'destructive', onPress: () => respond(it, 'declined') }); }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(it.title, it.preview || undefined, buttons);
  };
  const shown = items.filter(i => showDone || !i.done);
  const icon = (k: string) => k === 'dm' ? 'message-circle' : k === 'offer' ? 'tag' : k === 'applicant' ? 'briefcase' : 'star';
  return (
    <View style={{ flex: 1 }}>
      <StudioLoadError message={loadError} onRetry={load} busy={loading} />
      <Text style={[s.sub, { paddingHorizontal: 16, paddingTop: 10 }]}>Messages, offers, applicants and reviews in one queue. Label, assign, and mark done.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }} style={{ flexGrow: 0 }}>
        {(['all', 'dm', 'offer', 'applicant', 'review'] as const).map(f => (
          <TouchableOpacity key={f} style={[s.filterChip, filter === f && s.filterChipOn]} onPress={() => setFilter(f)}>
            <Text style={[s.filterTxt, filter === f && s.filterTxtOn]}>{f === 'all' ? 'All' : f === 'dm' ? 'Messages' : f === 'offer' ? 'Offers' : f === 'applicant' ? 'Applicants' : 'Reviews'}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[s.filterChip, showDone && s.filterChipOn]} onPress={() => setShowDone(v => !v)}><Text style={[s.filterTxt, showDone && s.filterTxtOn]}>Done</Text></TouchableOpacity>
      </ScrollView>
      {loading ? <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={getTheme().ink.primary} /></View>
      : loadError && !data ? null : shown.length === 0 ? <View style={[s.center, { flex: 1 }]}><Feather name="inbox" size={34} color="#E5E5EA" /><Text style={s.emptyTitle}>Queue is clear</Text></View>
      : <FlatList data={shown} keyExtractor={i => i.kind + i.id} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_CLEAR }}
          renderItem={({ item: it }) => (
            <TouchableOpacity style={[s.card, it.done && { opacity: 0.55 }]} onPress={() => open(it)} onLongPress={() => actions(it)} activeOpacity={0.85}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {it.avatar_url ? <ExpoImage source={{ uri: it.avatar_url }} style={s.avatar} contentFit="cover" /> : <View style={[s.avatar, { backgroundColor: getTheme().brand.base, alignItems: 'center', justifyContent: 'center' }]}><Text style={{ color: getTheme().ink.inverse, fontWeight: '700' }}>{(it.title || '?')[0]}</Text></View>}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[s.cardTxt, { fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>{it.title}</Text>
                    <Feather name={icon(it.kind) as any} size={12} color={getTheme().ink.secondary} />
                    {it.unread > 0 ? <View style={s.unread}><Text style={s.unreadTxt}>{it.unread}</Text></View> : null}
                    {it.label ? <Text style={s.labelPill}>{it.label}</Text> : null}
                  </View>
                  <Text style={s.cardMeta} numberOfLines={1}>{it.waiting && !it.done ? 'Waiting on you · ' : ''}{whenLabel(it.at)}</Text>
                </View>
                <TouchableOpacity onPress={() => actions(it)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="more-horizontal" size={18} color={getTheme().ink.secondary} /></TouchableOpacity>
              </View>
              {it.preview ? <Text style={[s.cardTxt, { marginTop: 6, color: getTheme().ink.secondary }]} numberOfLines={2}>{it.preview}</Text> : null}
              {it.note ? <Text style={[s.cardMeta, { fontStyle: 'italic' }]}>Note: {it.note}</Text> : null}
            </TouchableOpacity>
          )} />}
    </View>
  );
}

function PlannerSeg({ canPublish, meId }: { canPublish: boolean; meId: string | null }) {
  const [tab, setTab] = useState<'upcoming' | 'drafts' | 'published'>('upcoming');
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [media, setMedia] = useState<{ url: string; media_type: string; width?: number; height?: number }[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const working = useRef(false);
  const editorVersion = useRef(0);
  const mounted = useRef(true);
  const currentOwner = useRef(meId); currentOwner.current = meId;
  const editingId = useRef<string | null>(null);
  const pendingRows = useRef(new Set<string>());
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ++editorVersion.current; };
  }, []);

  const fetchPosts = useCallback(async () => { const { data, error } = await supabase.rpc('studio_list_posts', { p_status: null, p_limit: 100 }); if (error) throw error; return (data || []) as any[]; }, []);
  const { data: loadedRows, error: loadError, loading, reload: load } = useStudioResource(fetchPosts, 'Your planned content could not be refreshed.');
  const rows = loadedRows || [];
  const previewSource = useMemo(() => ({ rows: loadedRows || [], media }), [loadedRows, media]);
  const mediaPreview = useUploadPreview(previewSource);
  const fetchListings = useCallback(async () => {
    if (!meId) return [];
    const { data, error } = await supabase.rpc('get_seller_listings', { p_seller_id: meId, p_cursor: null, p_limit: 50, p_include_sold: false });
    if (error) throw error;
    return (data || []) as any[];
  }, [meId]);
  const { data: listingsData, error: listingsError, loading: listingsLoading, reload: reloadListings } = useStudioResource(fetchListings, 'Product listings could not be loaded.');
  const listings = listingsData || [];

  const shown = rows.filter(r => tab === 'upcoming' ? ['scheduled', 'publishing', 'failed'].includes(r.status) : tab === 'drafts' ? ['draft', 'cancelled'].includes(r.status) : r.status === 'published');

  const reset = () => { ++editorVersion.current; editingId.current = null; setEditId(null); setContent(''); setCategory(null); setMedia([]); setProducts([]); setWhen(''); setPickOpen(false); };
  const closeEditor = () => { if (!working.current) { ++editorVersion.current; setOpen(false); } };
  const openEdit = (r: any) => {
    if (working.current) return;
    ++editorVersion.current; editingId.current = r.id;
    setEditId(r.id); setContent(r.content || r.body || ''); setCategory(r.category || null); setMedia(r.media || []); setProducts(r.products || []);
    setWhen(r.publish_at ? fmtLocal(new Date(r.publish_at)) : ''); setOpen(true);
  };

  const addPhoto = async () => {
    if (!meId || media.length >= 4 || working.current) return;
    working.current = true;
    const editor = editorVersion.current;
    const current = () => mounted.current && currentOwner.current === meId && editorVersion.current === editor;
    setBusy(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!current()) return;
      if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access in your device settings.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({
        preferredAssetRepresentationMode: 'compatible' as ImagePicker.UIImagePickerPreferredAssetRepresentationMode,
        mediaTypes: ['images', 'videos'] as ImagePicker.MediaType[], allowsEditing: false, quality: 1,
      });
      if (!current() || result.canceled || !result.assets?.[0]) return;
      const a = result.assets[0];
      const isVideo = a.type === 'video';
      const ext = ((a.fileName || a.uri).split('.').pop()?.split('?')[0] || (isVideo ? 'mp4' : 'jpg')).toLowerCase().replace('jpeg', 'jpg');
      const { url } = await uploadMedia('post-media', meId, { uri: a.uri, kind: isVideo ? 'video' : 'image', ext, mimeType: a.mimeType || (isVideo ? 'video/mp4' : (ext === 'png' ? 'image/png' : 'image/jpeg')), width: a.width, height: a.height, base64: null } as any, {});
      if (current()) setMedia(m => [...m, { url, media_type: isVideo ? 'video' : 'image', width: a.width, height: a.height }].slice(0, 4));
    } catch (e: any) { if (current()) Alert.alert('Upload failed', e?.message || 'Please try again.'); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };

  const toggleListing = (l: any) => {
    setProducts(p => p.some(x => x.listing_id === l.id) ? p.filter(x => x.listing_id !== l.id)
      : [...p, { title: l.title, price: l.price, currency: l.currency, image_url: l.images?.[0] || null, listing_id: l.id, cta_label: 'View listing' }]);
  };

  const save = async (mode: 'draft' | 'schedule' | 'now') => {
    if (working.current || !canPublish || !meId) return;
    if (!content.trim() && media.length === 0) { Alert.alert('Empty post', 'Write something or add media first.'); return; }
    let publishAt: string | null = null;
    if (mode === 'schedule') {
      const d = parseLocal(when);
      if (!d) { Alert.alert('Pick a time', 'Use the format YYYY-MM-DD HH:MM, for example 2026-09-01 09:30.'); return; }
      if (d.getTime() <= Date.now()) { Alert.alert('Choose a future time', 'The scheduled time must be later than now.'); return; }
      publishAt = d.toISOString();
    }
    working.current = true; setBusy(true);
    const editor = editorVersion.current;
    const current = () => mounted.current && currentOwner.current === meId && editorVersion.current === editor;
    try {
      const id = await saveStudioDraft(supabase, { ownerId: meId, id: editingId.current, content: content.trim() || null, category, media, products, publishAt }, AsyncStorage, randomUUID);
      if (!current()) return;
      editingId.current = id; setEditId(id);
      if (mode === 'now') {
        const { data: postId, error: e2 } = await supabase.rpc('studio_publish_now', { p_id: id });
        if (e2) throw e2;
        if (!postId) throw new Error('Your draft was saved, but publishing failed. You can correct it and retry here.');
      }
      if (!current()) return;
      setOpen(false); reset(); await load();
    } catch (e: any) { if (current()) { Alert.alert('Post not confirmed', e?.message || 'Check Planner before retrying. Your editor is still open.'); await load(); } }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };

  const updateRow = async (id: string, rpc: 'studio_cancel_post' | 'studio_delete_post') => {
    if (pendingRows.current.has(id)) return;
    pendingRows.current.add(id);
    try { const { error } = await supabase.rpc(rpc, { p_id: id }); if (error) throw error; await load(); }
    catch { Alert.alert('Post not updated', 'Refresh Planner to check its status and try again.'); }
    finally { pendingRows.current.delete(id); }
  };

  const rowActions = (r: any) => {
    const buttons: any[] = [];
    if (r.status !== 'published' && r.status !== 'publishing') buttons.push({ text: 'Edit', onPress: () => openEdit(r) });
    if (r.status === 'scheduled') buttons.push({ text: 'Unschedule', onPress: () => updateRow(r.id, 'studio_cancel_post') });
    if (r.status !== 'publishing') buttons.push({ text: 'Delete', style: 'destructive', onPress: () => Alert.alert('Delete this planned post?', 'This removes the Planner entry.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => updateRow(r.id, 'studio_delete_post') }]) });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(r.content || r.body || 'Post', undefined, buttons);
  };

  const quick = [
    { label: 'In 1 hour', d: () => new Date(Date.now() + 3600000) },
    { label: 'Tomorrow 9:00', d: () => { const x = new Date(); x.setDate(x.getDate() + 1); x.setHours(9, 0, 0, 0); return x; } },
    { label: 'Tomorrow 18:00', d: () => { const x = new Date(); x.setDate(x.getDate() + 1); x.setHours(18, 0, 0, 0); return x; } },
    { label: 'Saturday 10:00', d: () => { const x = new Date(); x.setDate(x.getDate() + ((6 - x.getDay() + 7) % 7 || 7)); x.setHours(10, 0, 0, 0); return x; } },
  ];
  const chip = (st: string) => st === 'scheduled' ? '#0B1E3D' : st === 'published' ? '#1C8C4E' : st === 'failed' ? '#D64545' : '#8E8E93';

  return (
    <View style={{ flex: 1 }}>
      <StudioLoadError message={loadError} onRetry={load} busy={loading} />
      <Text style={[s.sub, { paddingHorizontal: 16, paddingTop: 10 }]}>Drafts, schedule and publish. Scheduled posts go out on the minute, even with the app closed.</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
        {(['upcoming', 'drafts', 'published'] as const).map(t => (
          <TouchableOpacity key={t} style={[s.filterChip, tab === t && s.filterChipOn]} onPress={() => setTab(t)}><Text style={[s.filterTxt, tab === t && s.filterTxtOn]}>{t === 'upcoming' ? 'Upcoming' : t === 'drafts' ? 'Drafts' : 'Published'}</Text></TouchableOpacity>
        ))}
        <View style={{ flex: 1 }} />
        {canPublish ? <TouchableOpacity style={s.plusBtn} onPress={() => { reset(); setOpen(true); }}><Feather name="plus" size={18} color={getTheme().ink.inverse} /></TouchableOpacity> : null}
      </View>
      {loading ? <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={getTheme().ink.primary} /></View>
      : loadError && !loadedRows ? null : shown.length === 0 ? <View style={[s.center, { flex: 1, paddingHorizontal: 40 }]}><Feather name="calendar" size={34} color="#E5E5EA" /><Text style={s.emptyTitle}>{tab === 'upcoming' ? 'Nothing scheduled' : tab === 'drafts' ? 'No drafts' : 'Nothing published from here yet'}</Text><Text style={s.emptySub}>Scheduled posts go out on the minute, even with the app closed.</Text></View>
      : <FlatList ListHeaderComponent={mediaPreview.error ? <TouchableOpacity onPress={mediaPreview.retry}><Text style={{ color: '#A21B2D', padding: 12 }}>{mediaPreview.error}</Text></TouchableOpacity> : null} data={shown} keyExtractor={r => r.id} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_CLEAR }}
          renderItem={({ item: r }) => (
            <TouchableOpacity style={[s.card, { flexDirection: 'row', gap: 10 }]} onPress={() => canPublish && rowActions(r)} activeOpacity={0.85}>
              {r.media?.[0]?.url ? <ExpoImage source={{ uri: mediaPreview.preview.rows.find((row: any) => row.id === r.id)?.media?.[0]?.url || undefined }} style={s.thumb} contentFit="cover" /> : <View style={[s.thumb, { backgroundColor: getTheme().surface.raised, alignItems: 'center', justifyContent: 'center' }]}><Feather name="file-text" size={16} color="#C7C7CC" /></View>}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[s.statusPill, { color: chip(r.status) }]}>{String(r.status).toUpperCase()}</Text>
                  {r.publish_at ? <Text style={s.cardMeta}>{whenLabel(r.publish_at)}</Text> : null}
                  {r.products?.length ? <Text style={s.cardMeta}>· {r.products.length} products</Text> : null}
                </View>
                <Text style={s.cardTxt} numberOfLines={2}>{r.content || r.body || 'Media post'}</Text>
                {r.status === 'failed' && r.error ? <Text style={[s.cardMeta, { color: '#D64545' }]}>{r.error}</Text> : null}
              </View>
            </TouchableOpacity>
          )} />}

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeEditor}>
        <SafeAreaView style={{ flex: 1, backgroundColor: getTheme().surface.canvas }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={s.modalHeader}>
              <TouchableOpacity onPress={closeEditor} disabled={busy} style={{ width: 70, opacity: busy ? .4 : 1 }}><Text style={{ fontSize: 16, color: getTheme().ink.secondary }}>Cancel</Text></TouchableOpacity>
              <Text style={s.modalTitle}>{editId ? 'Edit post' : 'New post'}</Text>
              <TouchableOpacity onPress={() => save('draft')} disabled={busy} style={{ width: 70, alignItems: 'flex-end' }}><Text style={{ fontSize: 15, fontWeight: '700', color: getTheme().ink.primary }}>Save draft</Text></TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
              <TextInput style={s.textArea} placeholder="What do you want to say?" placeholderTextColor={getTheme().ink.secondary} value={content} onChangeText={setContent} editable={!busy} multiline maxLength={2000} />
              {media.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {media.map((m, i) => (
                    <View key={i}>
                      {m.media_type === 'video' ? <View style={[s.thumbLg, { backgroundColor: '#0F1419', alignItems: 'center', justifyContent: 'center' }]}><Feather name="play" size={20} color={getTheme().ink.inverse} /></View> : <ExpoImage source={{ uri: mediaPreview.preview.media[i]?.url || undefined }} style={s.thumbLg} contentFit="cover" />}
                      <TouchableOpacity disabled={busy} onPress={() => setMedia(x => x.filter((_, j) => j !== i))} style={s.removeX}><Feather name="x" size={12} color={getTheme().ink.inverse} /></TouchableOpacity>
                    </View>
                  ))}
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={[s.toolChip, (media.length >= 4 || busy) && { opacity: 0.4 }]} onPress={addPhoto} disabled={media.length >= 4 || busy}><Feather name="image" size={15} color={getTheme().ink.primary} /><Text style={s.toolTxt}>Media</Text></TouchableOpacity>
                <TouchableOpacity style={s.toolChip} onPress={() => setPickOpen(o => !o)}><Feather name="tag" size={15} color={getTheme().ink.primary} /><Text style={s.toolTxt}>Products{products.length ? ' (' + products.length + ')' : ''}</Text></TouchableOpacity>
              </View>
              {pickOpen ? (
                <View style={s.pickBox}>
                  <StudioLoadError message={listingsError} onRetry={reloadListings} busy={listingsLoading} />
                  {listingsLoading && !listingsData ? <ActivityIndicator color={getTheme().ink.primary} /> : listingsError && !listingsData ? null : listings.length === 0 ? <Text style={s.cardMuted}>No active listings. Create one in Market to attach product cards.</Text>
                    : listings.map(l => { const on = products.some(p => p.listing_id === l.id); return (
                      <TouchableOpacity key={l.id} disabled={busy} style={[s.pickRow, on && { backgroundColor: getTheme().brand.base }]} onPress={() => toggleListing(l)}>
                        {l.images?.[0] ? <ExpoImage source={{ uri: l.images[0] }} style={s.pickThumb} contentFit="cover" /> : <View style={[s.pickThumb, { backgroundColor: getTheme().surface.raised }]} />}
                        <Text style={[s.cardTxt, { flex: 1 }, on && { color: getTheme().ink.inverse }]} numberOfLines={1}>{l.title}</Text>
                        <Text style={[s.cardMeta, on && { color: getTheme().ink.inverse }]}>{l.currency} {l.price}</Text>
                      </TouchableOpacity>
                    ); })}
                </View>
              ) : null}
              <View>
                <Text style={s.fieldLabel}>Category</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {CATEGORIES.map(c => (
                    <TouchableOpacity key={c.key} style={[s.catChip, category === c.key && s.catChipOn]} onPress={() => setCategory(category === c.key ? null : c.key)}><Text style={[s.catTxt, category === c.key && s.catTxtOn]}>{c.label}</Text></TouchableOpacity>
                  ))}
                </View>
              </View>
              <View>
                <Text style={s.fieldLabel}>Schedule</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  {quick.map(q => <TouchableOpacity key={q.label} style={s.catChip} onPress={() => setWhen(fmtLocal(q.d()))}><Text style={s.catTxt}>{q.label}</Text></TouchableOpacity>)}
                </View>
                <TextInput style={s.input} placeholder="YYYY-MM-DD HH:MM" placeholderTextColor={getTheme().ink.secondary} value={when} onChangeText={setWhen} autoCapitalize="none" autoCorrect={false} />
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity style={[s.secondaryBtn, (!when || busy) && { opacity: 0.4 }]} onPress={() => save('schedule')} disabled={!when || busy}><Feather name="clock" size={15} color={getTheme().ink.primary} /><Text style={s.secondaryTxt}>Schedule</Text></TouchableOpacity>
                <TouchableOpacity style={[s.primaryBtn, { flex: 1, marginTop: 0 }, busy && { opacity: 0.4 }]} onPress={() => save('now')} disabled={busy}>
                  {busy ? <ActivityIndicator color={getTheme().ink.inverse} size="small" /> : <Text style={s.primaryTxt}>Publish now</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function pctLabel(n: number, p: number) { const d = pct(n, p); return d === 0 ? 'no change' : (d > 0 ? '+' : '') + d + '% vs prior period'; }

function InsightsSeg({ navigation }: { navigation: any }) {
  const [days, setDays] = useState(30);
  const fetchInsights = useCallback(async () => { const { data, error } = await supabase.rpc('studio_insights', { p_days: days }); if (error || !data) throw new Error('Insights unavailable'); return data as any; }, [days]);
  const { data: ins, error: loadError, loading, reload: load } = useStudioResource(fetchInsights, 'Business insights could not be refreshed.');
  if (!ins && loadError) return <StudioLoadError message={loadError} onRetry={load} busy={loading} />;
  if (loading || !ins) return <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={getTheme().ink.primary} /></View>;
  const cur = ins.current || {}, prev = ins.previous || {};
  const tiles: [string, number, number][] = [
    ['Impressions', cur.impressions, prev.impressions], ['Reach', cur.reach, prev.reach], ['Engagements', cur.engagements, prev.engagements],
    ['Messages', cur.messages, prev.messages], ['Market chats', cur.market_chats, prev.market_chats], ['Payments', cur.payments, prev.payments],
    ['Applications', cur.applications, prev.applications], ['Ad clicks', cur.ad_clicks, prev.ad_clicks],
  ];
  const bar = (n: number, base: number) => Math.max(2, Math.min(100, (Number(n) / (Number(base) || 1)) * 100));
  const fun = ins.funnel || { commerce: {}, recruiting: {} };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: TAB_CLEAR }}>
      <StudioLoadError message={loadError} onRetry={load} busy={loading} />
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        {[7, 30, 90].map(d => <TouchableOpacity key={d} style={[s.filterChip, days === d && s.filterChipOn]} onPress={() => setDays(d)}><Text style={[s.filterTxt, days === d && s.filterTxtOn]}>{d} days</Text></TouchableOpacity>)}
      </View>
      <Text style={s.sub}>Rolled up nightly. Followers now: {Number(cur.followers_end || 0).toLocaleString()} ({Number((cur.followers_end || 0) - (cur.followers_start || 0)) >= 0 ? '+' : ''}{Number((cur.followers_end || 0) - (cur.followers_start || 0))} in period).</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {tiles.map(([label, n, p]) => { const cmp = compare(n || 0, p || 0, 'the ' + days + ' days before'); return (
          <View key={label} style={[s.card, { width: '48%', marginBottom: 0 }]}>
            <Text style={s.statLabel}>{label}</Text>
            <Text style={s.statHint}>{STAT_MEANING[label] || ''}</Text>
            <Text style={[s.statNum, (Number(n) || 0) === 0 && s.statNumZero]}>{Number(n || 0).toLocaleString()}</Text>
            <Text style={[s.statDelta, { color: cmp.color }]}>{cmp.text}</Text>
          </View>
        ); })}
      </View>
      {(cur.paid_usd || cur.paid_zwg) ? <Text style={[s.sub, { marginTop: 10 }]}>Received: {cur.paid_usd ? 'USD ' + Number(cur.paid_usd).toLocaleString() : ''}{cur.paid_usd && cur.paid_zwg ? ' · ' : ''}{cur.paid_zwg ? 'ZWG ' + Number(cur.paid_zwg).toLocaleString() : ''}</Text> : null}
      <Text style={s.section}>Funnels</Text>
      {(Number(fun.commerce.chats || 0) + Number(fun.commerce.offers || 0) + Number(fun.commerce.payments || 0) + Number(fun.recruiting.applications || 0) + Number(fun.recruiting.interviews || 0) + Number(fun.recruiting.hired || 0)) === 0 ? (
        <View style={s.card}><Text style={s.cardMuted}>Funnels fill in as buyers message you, make offers and pay, and as people apply, reach interview and get hired. Nothing has happened in this period yet.</Text></View>
      ) : (<>
      <View style={s.card}>
        <Text style={[s.cardTxt, { fontWeight: '700' }]}>Commerce</Text>
        {[['Market conversations', fun.commerce.chats], ['Offers received', fun.commerce.offers], ['Payments', fun.commerce.payments]].map(([l, n]) => (
          <View key={String(l)} style={{ marginTop: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={s.cardMeta}>{l}</Text><Text style={s.cardMeta}>{Number(n || 0)}</Text></View>
            <View style={s.barTrack}><View style={[s.barFill, { width: `${bar(n || 0, fun.commerce.chats)}%` as const }]} /></View>
          </View>
        ))}
      </View>
      <View style={s.card}>
        <Text style={[s.cardTxt, { fontWeight: '700' }]}>Recruiting</Text>
        {[['Applications', fun.recruiting.applications], ['Reached interview', fun.recruiting.interviews], ['Hired', fun.recruiting.hired]].map(([l, n]) => (
          <View key={String(l)} style={{ marginTop: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={s.cardMeta}>{l}</Text><Text style={s.cardMeta}>{Number(n || 0)}</Text></View>
            <View style={s.barTrack}><View style={[s.barFill, { width: `${bar(n || 0, fun.recruiting.applications)}%` as const }]} /></View>
          </View>
        ))}
      </View>
      </>)}
      <Text style={s.section}>Top content</Text>
      {(ins.top_posts || []).length === 0 ? <View style={s.card}><Text style={s.cardMuted}>No posts in this period.</Text></View>
        : ins.top_posts.map((p: any, i: number) => (
          <TouchableOpacity key={p.post_id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]} onPress={() => navigation.navigate('Post', { postId: p.post_id })} activeOpacity={0.85}>
            <Text style={[s.statNum, { fontSize: 16, color: getTheme().ink.secondary, width: 20 }]}>{i + 1}</Text>
            {p.thumb ? <ExpoImage source={{ uri: p.thumb }} style={s.thumb} contentFit="cover" /> : <View style={[s.thumb, { backgroundColor: getTheme().surface.raised }]} />}
            <View style={{ flex: 1 }}>
              <Text style={s.cardTxt} numberOfLines={1}>{p.content || 'Media post'}</Text>
              <Text style={s.cardMeta}>{p.views} views · {p.likes} likes · {p.comments} comments · {p.reposts} reposts</Text>
            </View>
          </TouchableOpacity>
        ))}
    </ScrollView>
  );
}

function SettingsSeg({ me, reload }: { me: Me; reload: () => Promise<void> }) {
  const ownerId = useAuthStore(state => state.session?.user.id || '');
  const currentOwner = useRef(ownerId); currentOwner.current = ownerId;
  const mounted = useRef(true);
  const acting = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && currentOwner.current === ownerId && useAuthStore.getState().session?.user.id === ownerId;
  const [b, setB] = useState<any>({});
  const [bio, setBio] = useState('');
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [issued, setIssued] = useState<{ name: string; code: string } | null>(null);
  const fetchSettings = useCallback(async () => {
    const { data, error } = await supabase.rpc('studio_get_business');
    if (error || !data?.business || !data?.profile || !data?.role) throw new Error('Business settings unavailable');
    return data as any;
  }, []);
  const { data: info, error: loadError, loading, reload: load } = useStudioResource(fetchSettings, 'Business settings could not be refreshed.');
  useEffect(() => {
    if (!info) return;
    setB({ category: info.business.category || '', location: info.business.location || '', address: info.business.address || '', phone: info.business.phone || '', email: info.business.email || '', website: info.business.website || '' });
    setBio(info.profile.bio || '');
  }, [info]);
  const isOwner = info?.role === 'owner';
  const isAdmin = isOwner || info?.role === 'admin';
  const act = async (fn: () => PromiseLike<{ error: any }>) => {
    if (acting.current || !current()) return;
    acting.current = true; setBusy(true);
    try { const { error } = await fn(); if (error) throw error; if (!current()) return; await load(); if (current()) await reload(); }
    catch (e: any) { if (current()) Alert.alert('Could not update', e?.message || 'Refresh settings to check the result and try again.'); }
    finally { acting.current = false; if (current()) setBusy(false); }
  };
  const save = () => act(() => supabase.rpc('studio_set_business', { p_bio: bio, p_category: b.category || null, p_location: b.location || null, p_address: b.address || null, p_phone: b.phone || null, p_email: b.email || null, p_website: b.website || null, p_social: info?.business?.social_links || {}, p_hours: null }));
  const roleMenu = (m: any) => {
    const roles = ['owner', 'admin', 'editor', 'recruiter', 'support'];
    Alert.alert(m.display_name, 'Role: ' + m.role, [
      ...roles.filter(r => r !== m.role).map(r => ({ text: 'Make ' + r, onPress: () => act(() => supabase.rpc('studio_set_member_role', { p_member: m.id, p_role: r })) })),
      { text: m.active ? 'Deactivate' : 'Reactivate', style: 'destructive', onPress: () => act(() => supabase.rpc('studio_set_member_active', { p_member: m.id, p_active: !m.active })) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };
  const addMember = async () => {
    if (!newName.trim() || acting.current || !isOwner || !current()) return;
    acting.current = true; setBusy(true);
    try {
      const { data, error } = await supabase.rpc('studio_create_member', { p_name: newName.trim(), p_role: 'admin' });
      if (error) throw error;
      if (!current()) return;
      if (typeof data !== 'string' || !data.trim()) throw new Error('The code was not confirmed. Refresh Team before trying again.');
      setIssued({ name: newName.trim(), code: String(data) }); setNewName(''); await load();
    } catch (e: any) { if (current()) Alert.alert('Code not confirmed', e?.message || 'Refresh Team before trying again.'); } finally { acting.current = false; if (current()) setBusy(false); }
  };
  if (!info && loadError) return <StudioLoadError message={loadError} onRetry={load} busy={loading} />;
  if (!info) return <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={getTheme().ink.primary} /></View>;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: TAB_CLEAR }} keyboardShouldPersistTaps="handled">
        <StudioLoadError message={loadError} onRetry={load} busy={loading} />
        <Text style={s.section}>Business details</Text>
        <TextInput style={[s.textArea, { minHeight: 70 }]} placeholder="What you do, in two lines" placeholderTextColor={getTheme().ink.secondary} value={bio} editable={isAdmin && !busy} onChangeText={setBio} multiline maxLength={300} />
        {[['category', 'Category'], ['location', 'City'], ['address', 'Street address'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website']].map(([k, l]) => (
          <TextInput key={k} style={[s.input, { marginTop: 8 }]} placeholder={l} placeholderTextColor={getTheme().ink.secondary} value={b[k]} editable={isAdmin && !busy} onChangeText={v => setB((x: any) => ({ ...x, [k]: v }))} autoCapitalize={k === 'email' || k === 'website' ? 'none' : 'sentences'} />
        ))}
        <Text style={[s.cardMeta, { marginTop: 8 }]}>Opening hours are set on the web Studio and drive the away message.</Text>
        {isAdmin ? <TouchableOpacity style={[s.primaryBtn, busy && { opacity: 0.4 }]} onPress={save} disabled={busy}><Text style={s.primaryTxt}>Save details</Text></TouchableOpacity> : null}

        <Text style={s.section}>Team</Text>
        {(info.members || []).map((m: any) => (
          <TouchableOpacity key={m.id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]} disabled={busy} onPress={() => isOwner && roleMenu(m)} activeOpacity={isOwner ? 0.8 : 1}>
            <View style={{ flex: 1 }}>
              <Text style={[s.cardTxt, { fontWeight: '700' }]}>{m.display_name}{!m.active ? '  · inactive' : ''}</Text>
              <Text style={s.cardMeta}>{m.last_sign_in_at ? 'last sign in ' + new Date(m.last_sign_in_at).toLocaleDateString() : 'never signed in'}</Text>
            </View>
            <Text style={s.labelPill}>{m.role}</Text>
          </TouchableOpacity>
        ))}
        {isOwner ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <TextInput style={[s.input, { flex: 1 }]} placeholder="Person's name" placeholderTextColor={getTheme().ink.secondary} value={newName} editable={!busy} onChangeText={setNewName} />
            <TouchableOpacity style={[s.primaryBtn, { marginTop: 0, paddingHorizontal: 14 }, (!newName.trim() || busy) && { opacity: 0.4 }]} onPress={addMember} disabled={!newName.trim() || busy}><Text style={s.primaryTxt}>Issue code</Text></TouchableOpacity>
          </View>
        ) : null}
        {issued ? (
          <View style={[s.card, { borderWidth: 1, borderColor: getTheme().ink.primary }]}>
            <Text style={s.cardTxt}>Access code for {issued.name}. Shown once, write it down.</Text>
            <Text selectable style={{ fontSize: 22, fontWeight: '800', letterSpacing: 4, color: getTheme().ink.primary, marginTop: 6 }}>{issued.code}</Text>
            <TouchableOpacity onPress={() => setIssued(null)}><Text style={[s.cardMeta, { marginTop: 8 }]}>Dismiss</Text></TouchableOpacity>
          </View>
        ) : null}

        <Text style={s.section}>Devices</Text>
        {(info.devices || []).length === 0 ? <View style={s.card}><Text style={s.cardMuted}>No devices yet.</Text></View>
          : info.devices.map((d: any) => (
            <View key={d.id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTxt}>{d.label || 'Device'} <Text style={{ color: d.status === 'approved' ? '#1C8C4E' : '#8E8E93', fontSize: 11, fontWeight: '800' }}>{String(d.status).toUpperCase()}</Text></Text>
                <Text style={s.cardMeta}>{String(d.device_id).slice(0, 12)} · {new Date(d.created_at).toLocaleDateString()}</Text>
              </View>
              {isAdmin && d.status !== 'approved' ? <TouchableOpacity style={s.approveBtn} onPress={() => act(() => supabase.rpc('studio_set_device', { p_device: d.id, p_action: 'approve' }))}><Feather name="check" size={15} color={getTheme().ink.inverse} /></TouchableOpacity> : null}
              {isAdmin ? <TouchableOpacity style={s.denyBtn} onPress={() => Alert.alert('Remove device?', 'It will need approval again.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => act(() => supabase.rpc('studio_set_device', { p_device: d.id, p_action: 'remove' })) }])}><Feather name="x" size={15} color={getTheme().ink.secondary} /></TouchableOpacity> : null}
            </View>
          ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  center: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  band: { backgroundColor: t.brand.base, paddingHorizontal: 16, paddingBottom: 12 },
  bandIcon: { width: 44, height: 44, borderRadius: 13 },
  bandTitle: { fontSize: 17, fontWeight: '800', color: t.ink.inverse },
  bandMeta: { fontSize: 12, color: t.ink.inverse, marginTop: 1 },
  segChip: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: t.surface.hairline },
  segChipOn: { backgroundColor: t.surface.canvas },
  segTxt: { fontSize: 13, fontWeight: '700', color: t.ink.inverse },
  segTxtOn: { color: t.ink.primary },
  h1: { fontSize: 20, fontWeight: '800', color: t.ink.primary },
  sub: { fontSize: 12.5, color: t.ink.secondary, marginTop: 2 },
  section: { fontSize: 11.5, fontWeight: '800', color: t.ink.secondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 18, marginBottom: 8 },
  card: { backgroundColor: t.surface.raised, borderRadius: 14, padding: 12, marginBottom: 8 },
  cardTxt: { fontSize: 14, color: t.ink.primary, lineHeight: 19 },
  cardMuted: { fontSize: 13, color: t.ink.secondary, lineHeight: 18 },
  cardMeta: { fontSize: 11.5, color: t.ink.secondary, marginTop: 3 },
  statLabel: { fontSize: 11.5, color: t.ink.secondary },
  statNum: { fontSize: 22, fontWeight: '800', color: t.ink.primary, marginTop: 2 },
  statNumZero: { color: t.ink.secondary, fontWeight: '600' },
  statHint: { fontSize: 10.5, color: t.ink.secondary, marginTop: 1 },
  statDelta: { fontSize: 11, marginTop: 2 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: t.ink.primary, textAlign: 'center' },
  emptySub: { fontSize: 13, color: t.ink.secondary, textAlign: 'center', lineHeight: 18 },
  primaryBtn: { marginTop: 16, backgroundColor: t.brand.base, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  primaryTxt: { color: t.ink.inverse, fontWeight: '700', fontSize: 15 },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface.raised, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16 },
  secondaryTxt: { color: t.ink.primary, fontWeight: '700', fontSize: 15 },
  codeInput: { marginTop: 18, width: '100%', backgroundColor: t.surface.raised, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 18, letterSpacing: 4, textAlign: 'center', color: t.ink.primary },
  filterChip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, backgroundColor: t.surface.raised },
  filterChipOn: { backgroundColor: t.brand.base },
  filterTxt: { fontSize: 12.5, fontWeight: '700', color: t.ink.secondary },
  filterTxtOn: { color: t.ink.inverse },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  unread: { backgroundColor: t.brand.base, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  unreadTxt: { color: t.ink.inverse, fontSize: 10.5, fontWeight: '800' },
  labelPill: { fontSize: 10.5, fontWeight: '700', color: t.ink.primary, backgroundColor: t.surface.hairline, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  plusBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: t.brand.base, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 52, height: 52, borderRadius: 10 },
  thumbLg: { width: 72, height: 72, borderRadius: 12 },
  removeX: { position: 'absolute', right: -5, top: -5, width: 20, height: 20, borderRadius: 10, backgroundColor: '#0F1419', alignItems: 'center', justifyContent: 'center' },
  statusPill: { fontSize: 10.5, fontWeight: '800' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline },
  modalTitle: { fontSize: 16.5, fontWeight: '700', color: t.ink.primary },
  textArea: { backgroundColor: t.surface.raised, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15.5, color: t.ink.primary, minHeight: 110, textAlignVertical: 'top' },
  input: { backgroundColor: t.surface.raised, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: t.ink.primary },
  toolChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface.raised, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  toolTxt: { fontSize: 13, fontWeight: '700', color: t.ink.primary },
  pickBox: { borderWidth: 1, borderColor: t.surface.hairline, borderRadius: 12, padding: 6, maxHeight: 220 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 8 },
  pickThumb: { width: 34, height: 34, borderRadius: 6 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: t.ink.secondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  catChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: t.surface.raised, borderWidth: 1, borderColor: t.surface.hairline },
  catChipOn: { backgroundColor: t.brand.base, borderColor: t.ink.primary },
  catTxt: { fontSize: 12.5, fontWeight: '600', color: t.ink.secondary },
  catTxtOn: { color: t.ink.inverse },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: t.surface.raised, marginTop: 4 },
  barFill: { height: 6, borderRadius: 3, backgroundColor: t.brand.base },
  approveBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: t.brand.base, alignItems: 'center', justifyContent: 'center' },
  denyBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: t.surface.raised, alignItems: 'center', justifyContent: 'center' },
}));
