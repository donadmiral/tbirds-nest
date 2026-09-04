import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, ScrollView, ActivityIndicator, Modal, Alert, KeyboardAvoidingView, Platform, RefreshControl } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { uploadMedia } from '../../services/mediaService';
import { CATEGORIES } from '../../constants/categories';
import { MoreSeg, ReviewsSeg, AudienceSeg, CommerceSeg } from './StudioMoreSegs';
import { RecruiterSeg, AdsSeg } from './StudioHiringAdsSegs';

const NAVY = '#0B1E3D';
const TAB_CLEAR = 110;
type Seg = 'home' | 'inbox' | 'planner' | 'insights' | 'settings' | 'more' | 'reviews' | 'audience' | 'commerce' | 'recruiter' | 'ads';
const MORE_SEGS: Seg[] = ['more', 'settings', 'reviews', 'audience', 'commerce', 'recruiter', 'ads'];
type Me = { is_business: boolean; needs_code: boolean; role: string | null; display_name: string | null; business_name: string | null; username: string | null; avatar_url: string | null };
const PUBLISH_ROLES = ['owner', 'admin', 'editor'];

function pct(n: number, p: number) { if (p === 0) return n === 0 ? 0 : 100; return Math.round(((n - p) / p) * 100); }
function hourLabel(h: number) { return (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'am' : 'pm'); }
function whenLabel(iso: string) { const d = new Date(iso); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function parseLocal(s: string): Date | null {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return isNaN(d.getTime()) ? null : d;
}
function fmtLocal(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

export default function StudioScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const profile = useAuthStore(st => st.profile) as any;
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [seg, setSeg] = useState<Seg>('home');
  const [code, setCode] = useState('');
  const [binding, setBinding] = useState(false);

  const loadMe = useCallback(async () => {
    const { data } = await supabase.rpc('studio_me');
    setMe((data as Me) || null);
  }, []);
  useEffect(() => { (async () => { await loadMe(); setLoading(false); })(); }, [loadMe]);

  const bind = async () => {
    if (!code.trim() || binding) return;
    setBinding(true);
    try {
      const { error } = await supabase.rpc('studio_bind_member', { p_code: code.trim() });
      if (error) throw error;
      setCode(''); await loadMe();
    } catch (e: any) { Alert.alert('Code not recognised', e?.message || 'Check the code and try again.'); }
    finally { setBinding(false); }
  };

  const canPublish = !!me?.role && PUBLISH_ROLES.includes(me.role);

  if (loading) return <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={NAVY} /></View>;

  if (!me || !me.is_business) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <View style={[s.center, { flex: 1, paddingHorizontal: 32 }]}>
          <Feather name="grid" size={36} color="#E5E5EA" />
          <Text style={s.emptyTitle}>Business Studio</Text>
          <Text style={s.emptySub}>Studio opens for business sessions. Sign in through the business door with your access code.</Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => navigation.navigate('BusinessSignIn')}><Text style={s.primaryTxt}>Business sign in</Text></TouchableOpacity>
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
            <TextInput style={s.codeInput} value={code} onChangeText={t => setCode(t.toUpperCase())} placeholder="ACCESS CODE" placeholderTextColor="#C7C7CC" autoCapitalize="characters" autoCorrect={false} onSubmitEditing={bind} />
            <TouchableOpacity style={[s.primaryBtn, (!code.trim() || binding) && { opacity: 0.4 }]} onPress={bind} disabled={!code.trim() || binding}>
              {binding ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={s.primaryTxt}>Continue</Text>}
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
          {me.avatar_url ? <ExpoImage source={{ uri: me.avatar_url }} style={s.bandIcon} contentFit="cover" /> : <View style={[s.bandIcon, { backgroundColor: '#FFFFFF22', alignItems: 'center', justifyContent: 'center' }]}><Feather name="grid" size={20} color="#FFF" /></View>}
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
      {seg === 'home' ? <HomeSeg me={me} navigation={navigation} setSeg={setSeg} /> : seg === 'inbox' ? <InboxSeg me={me} navigation={navigation} setSeg={setSeg} /> : seg === 'planner' ? <PlannerSeg canPublish={canPublish} meId={profile?.id} /> : seg === 'insights' ? <InsightsSeg navigation={navigation} /> : seg === 'reviews' ? <ReviewsSeg role={me.role} onBack={() => setSeg('more')} /> : seg === 'audience' ? <AudienceSeg role={me.role} navigation={navigation} onBack={() => setSeg('more')} /> : seg === 'commerce' ? <CommerceSeg role={me.role} navigation={navigation} onBack={() => setSeg('more')} /> : seg === 'recruiter' ? <RecruiterSeg role={me.role} navigation={navigation} onBack={() => setSeg('more')} /> : seg === 'ads' ? <AdsSeg role={me.role} navigation={navigation} onBack={() => setSeg('more')} /> : seg === 'more' ? <MoreSeg go={setSeg} /> : <SettingsSeg me={me} reload={loadMe} />}
    </SafeAreaView>
  );
}

function HomeSeg({ me, navigation, setSeg }: { me: Me; navigation: any; setSeg: (k: Seg) => void }) {
  const [h, setH] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => { const { data } = await supabase.rpc('studio_home'); setH(data || null); }, []);
  useEffect(() => { void load(); }, [load]);
  if (!h) return <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={NAVY} /></View>;
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
      <Text style={s.h1}>Good day, {me.display_name || me.business_name || 'team'}</Text>
      <Text style={s.sub}>Last 7 days against the 7 before.</Text>
      <Text style={s.section}>Needs attention</Text>
      {todos.length === 0 ? <View style={s.card}><Text style={s.cardMuted}>Nothing waiting on you. Inbox, offers, applicants and ads are clear.</Text></View>
        : todos.map(t => (
          <TouchableOpacity key={t.label} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]} onPress={t.go} activeOpacity={0.85}>
            <Feather name={t.icon as any} size={16} color={NAVY} />
            <Text style={s.cardTxt}><Text style={{ fontWeight: '800' }}>{t.n}</Text> {t.label}</Text>
          </TouchableOpacity>
        ))}
      <Text style={s.section}>Performance</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {stats.map(([label, n, p]) => { const d = pct(n, p); return (
          <View key={label} style={[s.card, { width: '48%', marginBottom: 0 }]}>
            <Text style={s.statLabel}>{label}</Text>
            <Text style={s.statNum}>{Number(n).toLocaleString()}</Text>
            <Text style={[s.statDelta, { color: d === 0 ? '#8E8E93' : d > 0 ? '#1C8C4E' : '#D64545' }]}>{d === 0 ? 'no change' : (d > 0 ? '+' : '') + d + '% vs prior week'}</Text>
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
  const [items, setItems] = useState<any[]>([]);
  const [filter, setFilter] = useState<'all' | 'dm' | 'offer' | 'applicant' | 'review'>('all');
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await supabase.rpc('studio_inbox', { p_filter: filter, p_limit: 120 }); setItems((data as any[]) || []); }
    finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  const setState = async (it: any, patch: any) => {
    setItems(prev => prev.map(x => x.id === it.id ? { ...x, ...patch } : x));
    const { error } = await supabase.rpc('studio_set_thread', { p_conversation: it.id, p_label: patch.label ?? null, p_assignee: null, p_done: patch.done ?? null, p_note: patch.note ?? null });
    if (error) { Alert.alert('Could not update', error.message); void load(); }
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
        const { error } = await supabase.rpc('respond_offer', { p_offer_id: it.id, p_action: action, p_counter_amount: null });
        if (error) { Alert.alert('Failed', error.message); return; }
        setItems(prev => prev.filter(x => x.id !== it.id));
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }} style={{ flexGrow: 0 }}>
        {(['all', 'dm', 'offer', 'applicant', 'review'] as const).map(f => (
          <TouchableOpacity key={f} style={[s.filterChip, filter === f && s.filterChipOn]} onPress={() => setFilter(f)}>
            <Text style={[s.filterTxt, filter === f && s.filterTxtOn]}>{f === 'all' ? 'All' : f === 'dm' ? 'Messages' : f === 'offer' ? 'Offers' : f === 'applicant' ? 'Applicants' : 'Reviews'}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[s.filterChip, showDone && s.filterChipOn]} onPress={() => setShowDone(v => !v)}><Text style={[s.filterTxt, showDone && s.filterTxtOn]}>Done</Text></TouchableOpacity>
      </ScrollView>
      {loading ? <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={NAVY} /></View>
      : shown.length === 0 ? <View style={[s.center, { flex: 1 }]}><Feather name="inbox" size={34} color="#E5E5EA" /><Text style={s.emptyTitle}>Queue is clear</Text></View>
      : <FlatList data={shown} keyExtractor={i => i.kind + i.id} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_CLEAR }}
          renderItem={({ item: it }) => (
            <TouchableOpacity style={[s.card, it.done && { opacity: 0.55 }]} onPress={() => open(it)} onLongPress={() => actions(it)} activeOpacity={0.85}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {it.avatar_url ? <ExpoImage source={{ uri: it.avatar_url }} style={s.avatar} contentFit="cover" /> : <View style={[s.avatar, { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' }]}><Text style={{ color: '#FFF', fontWeight: '700' }}>{(it.title || '?')[0]}</Text></View>}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[s.cardTxt, { fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>{it.title}</Text>
                    <Feather name={icon(it.kind) as any} size={12} color="#8E8E93" />
                    {it.unread > 0 ? <View style={s.unread}><Text style={s.unreadTxt}>{it.unread}</Text></View> : null}
                    {it.label ? <Text style={s.labelPill}>{it.label}</Text> : null}
                  </View>
                  <Text style={s.cardMeta} numberOfLines={1}>{it.waiting && !it.done ? 'Waiting on you · ' : ''}{whenLabel(it.at)}</Text>
                </View>
                <TouchableOpacity onPress={() => actions(it)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="more-horizontal" size={18} color="#8E8E93" /></TouchableOpacity>
              </View>
              {it.preview ? <Text style={[s.cardTxt, { marginTop: 6, color: '#3A3F47' }]} numberOfLines={2}>{it.preview}</Text> : null}
              {it.note ? <Text style={[s.cardMeta, { fontStyle: 'italic' }]}>Note: {it.note}</Text> : null}
            </TouchableOpacity>
          )} />}
    </View>
  );
}

function PlannerSeg({ canPublish, meId }: { canPublish: boolean; meId: string | null }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'upcoming' | 'drafts' | 'published'>('upcoming');
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [media, setMedia] = useState<{ url: string; media_type: string; width?: number; height?: number }[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [listings, setListings] = useState<any[]>([]);
  const [pickOpen, setPickOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await supabase.rpc('studio_list_posts', { p_status: null, p_limit: 100 }); setRows((data as any[]) || []); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!meId) return;
    supabase.rpc('get_seller_listings', { p_seller_id: meId, p_cursor: null, p_limit: 50, p_include_sold: false }).then(({ data }) => setListings((data as any[]) || []));
  }, [meId]);

  const shown = rows.filter(r => tab === 'upcoming' ? ['scheduled', 'publishing', 'failed'].includes(r.status) : tab === 'drafts' ? ['draft', 'cancelled'].includes(r.status) : r.status === 'published');

  const reset = () => { setEditId(null); setContent(''); setCategory(null); setMedia([]); setProducts([]); setWhen(''); };
  const openEdit = (r: any) => {
    setEditId(r.id); setContent(r.content || r.body || ''); setCategory(r.category || null); setMedia(r.media || []); setProducts(r.products || []);
    setWhen(r.publish_at ? fmtLocal(new Date(r.publish_at)) : ''); setOpen(true);
  };

  const addPhoto = async () => {
    if (!meId || media.length >= 4) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access in your device settings.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      preferredAssetRepresentationMode: 'compatible' as ImagePicker.UIImagePickerPreferredAssetRepresentationMode,
      mediaTypes: ['images', 'videos'] as ImagePicker.MediaType[], allowsEditing: false, quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const isVideo = a.type === 'video';
    const ext = (a.uri.split('.').pop() || (isVideo ? 'mp4' : 'jpg')).toLowerCase().replace('jpeg', 'jpg');
    setBusy(true);
    try {
      const { url } = await uploadMedia('post-media', meId, { uri: a.uri, kind: isVideo ? 'video' : 'image', ext, mimeType: isVideo ? 'video/mp4' : (ext === 'png' ? 'image/png' : 'image/jpeg'), width: a.width, height: a.height, base64: null } as any, {});
      setMedia(m => [...m, { url, media_type: isVideo ? 'video' : 'image', width: a.width, height: a.height }]);
    } catch (e: any) { Alert.alert('Upload failed', e?.message || 'Please try again.'); }
    finally { setBusy(false); }
  };

  const toggleListing = (l: any) => {
    setProducts(p => p.some(x => x.listing_id === l.id) ? p.filter(x => x.listing_id !== l.id)
      : [...p, { title: l.title, price: l.price, currency: l.currency, image_url: l.images?.[0] || null, listing_id: l.id, cta_label: 'View listing' }]);
  };

  const save = async (mode: 'draft' | 'schedule' | 'now') => {
    if (busy) return;
    if (!content.trim() && media.length === 0) { Alert.alert('Empty post', 'Write something or add media first.'); return; }
    let publishAt: string | null = null;
    if (mode === 'schedule') {
      const d = parseLocal(when);
      if (!d) { Alert.alert('Pick a time', 'Use the format YYYY-MM-DD HH:MM, for example 2026-09-01 09:30.'); return; }
      publishAt = d.toISOString();
    }
    setBusy(true);
    try {
      const { data: id, error } = await supabase.rpc('studio_save_post', { p_id: editId, p_content: content.trim() || null, p_body: null, p_category: category, p_community: null, p_media: media, p_products: products, p_publish_at: publishAt });
      if (error) throw error;
      if (mode === 'now') {
        const { data: postId, error: e2 } = await supabase.rpc('studio_publish_now', { p_id: id });
        if (e2) throw e2;
        if (!postId) Alert.alert('Publish failed', 'The post is kept as failed with the reason in the list.');
      }
      setOpen(false); reset(); await load();
    } catch (e: any) { Alert.alert('Could not save', e?.message || 'Please try again.'); }
    finally { setBusy(false); }
  };

  const rowActions = (r: any) => {
    const buttons: any[] = [];
    if (r.status !== 'published' && r.status !== 'publishing') buttons.push({ text: 'Edit', onPress: () => openEdit(r) });
    if (r.status === 'scheduled') buttons.push({ text: 'Unschedule', onPress: async () => { await supabase.rpc('studio_cancel_post', { p_id: r.id }); await load(); } });
    buttons.push({ text: 'Delete', style: 'destructive', onPress: async () => { await supabase.rpc('studio_delete_post', { p_id: r.id }); await load(); } });
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
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
        {(['upcoming', 'drafts', 'published'] as const).map(t => (
          <TouchableOpacity key={t} style={[s.filterChip, tab === t && s.filterChipOn]} onPress={() => setTab(t)}><Text style={[s.filterTxt, tab === t && s.filterTxtOn]}>{t === 'upcoming' ? 'Upcoming' : t === 'drafts' ? 'Drafts' : 'Published'}</Text></TouchableOpacity>
        ))}
        <View style={{ flex: 1 }} />
        {canPublish ? <TouchableOpacity style={s.plusBtn} onPress={() => { reset(); setOpen(true); }}><Feather name="plus" size={18} color="#FFF" /></TouchableOpacity> : null}
      </View>
      {loading ? <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={NAVY} /></View>
      : shown.length === 0 ? <View style={[s.center, { flex: 1, paddingHorizontal: 40 }]}><Feather name="calendar" size={34} color="#E5E5EA" /><Text style={s.emptyTitle}>{tab === 'upcoming' ? 'Nothing scheduled' : tab === 'drafts' ? 'No drafts' : 'Nothing published from here yet'}</Text><Text style={s.emptySub}>Scheduled posts go out on the minute, even with the app closed.</Text></View>
      : <FlatList data={shown} keyExtractor={r => r.id} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_CLEAR }}
          renderItem={({ item: r }) => (
            <TouchableOpacity style={[s.card, { flexDirection: 'row', gap: 10 }]} onPress={() => canPublish && rowActions(r)} activeOpacity={0.85}>
              {r.media?.[0]?.url ? <ExpoImage source={{ uri: r.media[0].url }} style={s.thumb} contentFit="cover" /> : <View style={[s.thumb, { backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' }]}><Feather name="file-text" size={16} color="#C7C7CC" /></View>}
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

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={s.modalHeader}>
              <TouchableOpacity onPress={() => setOpen(false)} style={{ width: 70 }}><Text style={{ fontSize: 16, color: '#8E8E93' }}>Cancel</Text></TouchableOpacity>
              <Text style={s.modalTitle}>{editId ? 'Edit post' : 'New post'}</Text>
              <TouchableOpacity onPress={() => save('draft')} disabled={busy} style={{ width: 70, alignItems: 'flex-end' }}><Text style={{ fontSize: 15, fontWeight: '700', color: NAVY }}>Save draft</Text></TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
              <TextInput style={s.textArea} placeholder="What do you want to say?" placeholderTextColor="#C7C7CC" value={content} onChangeText={setContent} multiline maxLength={2000} />
              {media.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {media.map((m, i) => (
                    <View key={i}>
                      {m.media_type === 'video' ? <View style={[s.thumbLg, { backgroundColor: '#0F1419', alignItems: 'center', justifyContent: 'center' }]}><Feather name="play" size={20} color="#FFF" /></View> : <ExpoImage source={{ uri: m.url }} style={s.thumbLg} contentFit="cover" />}
                      <TouchableOpacity onPress={() => setMedia(x => x.filter((_, j) => j !== i))} style={s.removeX}><Feather name="x" size={12} color="#FFF" /></TouchableOpacity>
                    </View>
                  ))}
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={[s.toolChip, (media.length >= 4 || busy) && { opacity: 0.4 }]} onPress={addPhoto} disabled={media.length >= 4 || busy}><Feather name="image" size={15} color={NAVY} /><Text style={s.toolTxt}>Media</Text></TouchableOpacity>
                <TouchableOpacity style={s.toolChip} onPress={() => setPickOpen(o => !o)}><Feather name="tag" size={15} color={NAVY} /><Text style={s.toolTxt}>Products{products.length ? ' (' + products.length + ')' : ''}</Text></TouchableOpacity>
              </View>
              {pickOpen ? (
                <View style={s.pickBox}>
                  {listings.length === 0 ? <Text style={s.cardMuted}>No active listings. Create one in Market to attach product cards.</Text>
                    : listings.map(l => { const on = products.some(p => p.listing_id === l.id); return (
                      <TouchableOpacity key={l.id} style={[s.pickRow, on && { backgroundColor: NAVY }]} onPress={() => toggleListing(l)}>
                        {l.images?.[0] ? <ExpoImage source={{ uri: l.images[0] }} style={s.pickThumb} contentFit="cover" /> : <View style={[s.pickThumb, { backgroundColor: '#E5E5EA' }]} />}
                        <Text style={[s.cardTxt, { flex: 1 }, on && { color: '#FFF' }]} numberOfLines={1}>{l.title}</Text>
                        <Text style={[s.cardMeta, on && { color: '#FFFFFFAA' }]}>{l.currency} {l.price}</Text>
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
                <TextInput style={s.input} placeholder="YYYY-MM-DD HH:MM" placeholderTextColor="#C7C7CC" value={when} onChangeText={setWhen} autoCapitalize="none" autoCorrect={false} />
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity style={[s.secondaryBtn, (!when || busy) && { opacity: 0.4 }]} onPress={() => save('schedule')} disabled={!when || busy}><Feather name="clock" size={15} color={NAVY} /><Text style={s.secondaryTxt}>Schedule</Text></TouchableOpacity>
                <TouchableOpacity style={[s.primaryBtn, { flex: 1, marginTop: 0 }, busy && { opacity: 0.4 }]} onPress={() => save('now')} disabled={busy}>
                  {busy ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={s.primaryTxt}>Publish now</Text>}
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
  const [ins, setIns] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { setLoading(true); const { data } = await supabase.rpc('studio_insights', { p_days: days }); setIns(data || null); setLoading(false); })(); }, [days]);
  if (loading || !ins) return <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={NAVY} /></View>;
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
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        {[7, 30, 90].map(d => <TouchableOpacity key={d} style={[s.filterChip, days === d && s.filterChipOn]} onPress={() => setDays(d)}><Text style={[s.filterTxt, days === d && s.filterTxtOn]}>{d} days</Text></TouchableOpacity>)}
      </View>
      <Text style={s.sub}>Rolled up nightly. Followers now: {Number(cur.followers_end || 0).toLocaleString()} ({Number((cur.followers_end || 0) - (cur.followers_start || 0)) >= 0 ? '+' : ''}{Number((cur.followers_end || 0) - (cur.followers_start || 0))} in period).</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {tiles.map(([label, n, p]) => (
          <View key={label} style={[s.card, { width: '48%', marginBottom: 0 }]}>
            <Text style={s.statLabel}>{label}</Text>
            <Text style={s.statNum}>{Number(n || 0).toLocaleString()}</Text>
            <Text style={[s.statDelta, { color: pct(n || 0, p || 0) === 0 ? '#8E8E93' : pct(n || 0, p || 0) > 0 ? '#1C8C4E' : '#D64545' }]}>{pctLabel(n || 0, p || 0)}</Text>
          </View>
        ))}
      </View>
      {(cur.paid_usd || cur.paid_zwg) ? <Text style={[s.sub, { marginTop: 10 }]}>Received: {cur.paid_usd ? 'USD ' + Number(cur.paid_usd).toLocaleString() : ''}{cur.paid_usd && cur.paid_zwg ? ' · ' : ''}{cur.paid_zwg ? 'ZWG ' + Number(cur.paid_zwg).toLocaleString() : ''}</Text> : null}
      <Text style={s.section}>Funnels</Text>
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
      <Text style={s.section}>Top content</Text>
      {(ins.top_posts || []).length === 0 ? <View style={s.card}><Text style={s.cardMuted}>No posts in this period.</Text></View>
        : ins.top_posts.map((p: any, i: number) => (
          <TouchableOpacity key={p.post_id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]} onPress={() => navigation.navigate('Post', { postId: p.post_id })} activeOpacity={0.85}>
            <Text style={[s.statNum, { fontSize: 16, color: '#8E8E93', width: 20 }]}>{i + 1}</Text>
            {p.thumb ? <ExpoImage source={{ uri: p.thumb }} style={s.thumb} contentFit="cover" /> : <View style={[s.thumb, { backgroundColor: '#F2F2F7' }]} />}
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
  const [info, setInfo] = useState<any>(null);
  const [b, setB] = useState<any>({});
  const [bio, setBio] = useState('');
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [issued, setIssued] = useState<{ name: string; code: string } | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('studio_get_business');
    if (error) { Alert.alert('Could not load', error.message); return; }
    setInfo(data);
    setB({ category: data?.business?.category || '', location: data?.business?.location || '', address: data?.business?.address || '', phone: data?.business?.phone || '', email: data?.business?.email || '', website: data?.business?.website || '' });
    setBio(data?.profile?.bio || '');
  }, []);
  useEffect(() => { void load(); }, [load]);
  const isOwner = info?.role === 'owner';
  const isAdmin = isOwner || info?.role === 'admin';
  const act = async (fn: () => PromiseLike<{ error: any }>) => {
    if (busy) return;
    setBusy(true);
    try { const { error } = await fn(); if (error) throw error; await load(); await reload(); }
    catch (e: any) { Alert.alert('Failed', e?.message || 'Please try again.'); }
    finally { setBusy(false); }
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
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('studio_create_member', { p_name: newName.trim(), p_role: 'admin' });
      if (error) throw error;
      setIssued({ name: newName.trim(), code: String(data) }); setNewName(''); await load();
    } catch (e: any) { Alert.alert('Could not create', e?.message || 'Please try again.'); } finally { setBusy(false); }
  };
  if (!info) return <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={NAVY} /></View>;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: TAB_CLEAR }} keyboardShouldPersistTaps="handled">
        <Text style={s.section}>Business details</Text>
        <TextInput style={[s.textArea, { minHeight: 70 }]} placeholder="What you do, in two lines" placeholderTextColor="#C7C7CC" value={bio} onChangeText={setBio} multiline maxLength={300} />
        {[['category', 'Category'], ['location', 'City'], ['address', 'Street address'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website']].map(([k, l]) => (
          <TextInput key={k} style={[s.input, { marginTop: 8 }]} placeholder={l} placeholderTextColor="#C7C7CC" value={b[k]} onChangeText={v => setB((x: any) => ({ ...x, [k]: v }))} autoCapitalize={k === 'email' || k === 'website' ? 'none' : 'sentences'} />
        ))}
        <Text style={[s.cardMeta, { marginTop: 8 }]}>Opening hours are set on the web Studio and drive the away message.</Text>
        {isAdmin ? <TouchableOpacity style={[s.primaryBtn, busy && { opacity: 0.4 }]} onPress={save} disabled={busy}><Text style={s.primaryTxt}>Save details</Text></TouchableOpacity> : null}

        <Text style={s.section}>Team</Text>
        {(info.members || []).map((m: any) => (
          <TouchableOpacity key={m.id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]} onPress={() => isOwner && roleMenu(m)} activeOpacity={isOwner ? 0.8 : 1}>
            <View style={{ flex: 1 }}>
              <Text style={[s.cardTxt, { fontWeight: '700' }]}>{m.display_name}{!m.active ? '  · inactive' : ''}</Text>
              <Text style={s.cardMeta}>{m.last_sign_in_at ? 'last sign in ' + new Date(m.last_sign_in_at).toLocaleDateString() : 'never signed in'}</Text>
            </View>
            <Text style={s.labelPill}>{m.role}</Text>
          </TouchableOpacity>
        ))}
        {isOwner ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <TextInput style={[s.input, { flex: 1 }]} placeholder="Person's name" placeholderTextColor="#C7C7CC" value={newName} onChangeText={setNewName} />
            <TouchableOpacity style={[s.primaryBtn, { marginTop: 0, paddingHorizontal: 14 }, (!newName.trim() || busy) && { opacity: 0.4 }]} onPress={addMember} disabled={!newName.trim() || busy}><Text style={s.primaryTxt}>Issue code</Text></TouchableOpacity>
          </View>
        ) : null}
        {issued ? (
          <View style={[s.card, { borderWidth: 1, borderColor: NAVY }]}>
            <Text style={s.cardTxt}>Access code for {issued.name}. Shown once, write it down.</Text>
            <Text selectable style={{ fontSize: 22, fontWeight: '800', letterSpacing: 4, color: NAVY, marginTop: 6 }}>{issued.code}</Text>
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
              {isAdmin && d.status !== 'approved' ? <TouchableOpacity style={s.approveBtn} onPress={() => act(() => supabase.rpc('studio_set_device', { p_device: d.id, p_status: 'approved' }))}><Feather name="check" size={15} color="#FFF" /></TouchableOpacity> : null}
              {isAdmin ? <TouchableOpacity style={s.denyBtn} onPress={() => Alert.alert('Remove device?', 'It will need approval again.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => act(() => supabase.rpc('studio_set_device', { p_device: d.id, p_status: 'removed' })) }])}><Feather name="x" size={15} color="#5B6B84" /></TouchableOpacity> : null}
            </View>
          ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  band: { backgroundColor: NAVY, paddingHorizontal: 16, paddingBottom: 12 },
  bandIcon: { width: 44, height: 44, borderRadius: 13 },
  bandTitle: { fontSize: 17, fontWeight: '800', color: '#FFF' },
  bandMeta: { fontSize: 12, color: '#FFFFFFAA', marginTop: 1 },
  segChip: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: '#FFFFFF1A' },
  segChipOn: { backgroundColor: '#FFF' },
  segTxt: { fontSize: 13, fontWeight: '700', color: '#FFFFFFCC' },
  segTxtOn: { color: NAVY },
  h1: { fontSize: 20, fontWeight: '800', color: '#0F1419' },
  sub: { fontSize: 12.5, color: '#8E8E93', marginTop: 2 },
  section: { fontSize: 11.5, fontWeight: '800', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 18, marginBottom: 8 },
  card: { backgroundColor: '#F8F9FB', borderRadius: 14, padding: 12, marginBottom: 8 },
  cardTxt: { fontSize: 14, color: '#0F1419', lineHeight: 19 },
  cardMuted: { fontSize: 13, color: '#8E8E93', lineHeight: 18 },
  cardMeta: { fontSize: 11.5, color: '#8E8E93', marginTop: 3 },
  statLabel: { fontSize: 11.5, color: '#8E8E93' },
  statNum: { fontSize: 22, fontWeight: '800', color: '#0F1419', marginTop: 2 },
  statDelta: { fontSize: 11, marginTop: 2 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#0F1419', textAlign: 'center' },
  emptySub: { fontSize: 13, color: '#8E8E93', textAlign: 'center', lineHeight: 18 },
  primaryBtn: { marginTop: 16, backgroundColor: NAVY, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  primaryTxt: { color: '#FFF', fontWeight: '700', fontSize: 15 },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F2F2F7', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16 },
  secondaryTxt: { color: NAVY, fontWeight: '700', fontSize: 15 },
  codeInput: { marginTop: 18, width: '100%', backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 18, letterSpacing: 4, textAlign: 'center', color: '#0F1419' },
  filterChip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, backgroundColor: '#F2F2F7' },
  filterChipOn: { backgroundColor: NAVY },
  filterTxt: { fontSize: 12.5, fontWeight: '700', color: '#5B6B84' },
  filterTxtOn: { color: '#FFF' },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  unread: { backgroundColor: NAVY, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  unreadTxt: { color: '#FFF', fontSize: 10.5, fontWeight: '800' },
  labelPill: { fontSize: 10.5, fontWeight: '700', color: NAVY, backgroundColor: 'rgba(11,30,61,0.08)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  plusBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 52, height: 52, borderRadius: 10 },
  thumbLg: { width: 72, height: 72, borderRadius: 12 },
  removeX: { position: 'absolute', right: -5, top: -5, width: 20, height: 20, borderRadius: 10, backgroundColor: '#0F1419', alignItems: 'center', justifyContent: 'center' },
  statusPill: { fontSize: 10.5, fontWeight: '800' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA' },
  modalTitle: { fontSize: 16.5, fontWeight: '700', color: '#0F1419' },
  textArea: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15.5, color: '#0F1419', minHeight: 110, textAlignVertical: 'top' },
  input: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#0F1419' },
  toolChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F2F2F7', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  toolTxt: { fontSize: 13, fontWeight: '700', color: NAVY },
  pickBox: { borderWidth: 1, borderColor: '#E5E5EA', borderRadius: 12, padding: 6, maxHeight: 220 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 8 },
  pickThumb: { width: 34, height: 34, borderRadius: 6 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  catChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#F5F5F5', borderWidth: 1, borderColor: '#E5E5EA' },
  catChipOn: { backgroundColor: NAVY, borderColor: NAVY },
  catTxt: { fontSize: 12.5, fontWeight: '600', color: '#5B6B84' },
  catTxtOn: { color: '#FFF' },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: '#E5E5EA', marginTop: 4 },
  barFill: { height: 6, borderRadius: 3, backgroundColor: NAVY },
  approveBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  denyBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
});
