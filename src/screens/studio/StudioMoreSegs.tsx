// src/screens/studio/StudioMoreSegs.tsx
// Phone Studio desks that only existed on web: Reviews, Audience, Commerce,
// reached through the More grid. Same RPC contracts as the web pages
// (studio_reviews / studio_reply_review, studio_audience / studio_audience_summary /
// studio_set_contact_label, studio_orders / studio_catalog / studio_set_listing).
// Every screen is keyboard-safe, safe-area-aware and clears the tab bar.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, ScrollView, ActivityIndicator, Modal, Alert, KeyboardAvoidingView, Platform, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { supabase } from '../../services/supabase';

const NAVY = '#0B1E3D';
const TAB_CLEAR = 110;
const LABELS = ['customer', 'lead', 'vip', 'supplier', 'partner'];
const REPLY_ROLES = ['owner', 'admin', 'editor', 'support'];
const LISTING_ROLES = ['owner', 'admin', 'editor'];

export type MoreKey = 'reviews' | 'audience' | 'commerce' | 'recruiter' | 'ads' | 'settings';

function whenLabel(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function money(n: any, cur?: string | null) { return (cur || 'USD') + ' ' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }

function Avatar({ uri, name, size = 38 }: { uri?: string | null; name?: string | null; size?: number }) {
  if (uri) return <ExpoImage source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />;
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#FFF', fontWeight: '700' }}>{(name || '?').trim()[0]?.toUpperCase() || '?'}</Text></View>;
}
function Stars({ n }: { n: number }) {
  return <View style={{ flexDirection: 'row', gap: 2 }}>{[1, 2, 3, 4, 5].map(i => <Feather key={i} name="star" size={12} color={i <= n ? '#C9A227' : '#D9D9DE'} />)}</View>;
}
function BackRow({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingTop: 12 }}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <Feather name="chevron-left" size={20} color={NAVY} /><Text style={{ fontSize: 14, fontWeight: '700', color: NAVY }}>More</Text>
      </TouchableOpacity>
      <Text style={[s.h1, { marginLeft: 6 }]}>{title}</Text>
    </View>
  );
}

// ── More grid ──────────────────────────────────────────────────────────────
export function MoreSeg({ go }: { go: (k: MoreKey) => void }) {
  const items: { k: MoreKey; label: string; sub: string; icon: string }[] = [
    { k: 'reviews', label: 'Reviews', sub: 'Ratings and replies', icon: 'star' },
    { k: 'audience', label: 'Audience', sub: 'Followers, customers, labels', icon: 'users' },
    { k: 'commerce', label: 'Commerce', sub: 'Orders and catalog', icon: 'shopping-bag' },
    { k: 'recruiter', label: 'Recruiter', sub: 'Jobs, applicants, interviews', icon: 'briefcase' },
    { k: 'ads', label: 'Ads', sub: 'Campaigns and sponsored posts', icon: 'radio' },
    { k: 'settings', label: 'Settings', sub: 'Business, team, devices', icon: 'settings' },
  ];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: TAB_CLEAR }}>
      <Text style={s.h1}>More desks</Text>
      <Text style={s.sub}>Every web desk, on the phone.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
        {items.map(it => (
          <TouchableOpacity key={it.k} style={[s.card, { width: '48%', marginBottom: 0, minHeight: 96 }]} onPress={() => go(it.k)} activeOpacity={0.85}>
            <View style={s.iconBox}><Feather name={it.icon as any} size={16} color={NAVY} /></View>
            <Text style={[s.cardTxt, { fontWeight: '800', marginTop: 10 }]}>{it.label}</Text>
            <Text style={s.cardMeta}>{it.sub}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

// ── Reviews ────────────────────────────────────────────────────────────────
type Review = { id: string; rating: number; body: string | null; created_at: string; helpful_count: number; user_id: string; name: string; username: string | null; avatar_url: string | null; reply: string | null; replied_at: string | null };
export function ReviewsSeg({ role, onBack }: { role: string | null; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<{ average: number; count: number; distribution: Record<string, number>; reviews: Review[] } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Review | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const canReply = !!role && REPLY_ROLES.includes(role);
  const load = useCallback(async () => { const { data: d } = await supabase.rpc('studio_reviews'); setData((d as any) || null); }, []);
  useEffect(() => { void load(); }, [load]);

  const send = async (remove: boolean) => {
    if (!editing || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('studio_reply_review', { p_review: editing.id, p_body: remove ? '' : draft.trim() });
      if (error) throw error;
      setEditing(null); setDraft(''); await load();
    } catch (e: any) { Alert.alert('Could not save reply', e?.message || 'Please try again.'); }
    finally { setBusy(false); }
  };

  if (!data) return <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={NAVY} /></View>;
  const dist = [5, 4, 3, 2, 1].map(r => ({ r, n: Number((data.distribution || {})[String(r)] || 0) }));
  const max = Math.max(1, ...dist.map(d => d.n));
  return (
    <View style={{ flex: 1 }}>
      <BackRow title="Reviews" onBack={onBack} />
      <FlatList
        data={data.reviews}
        keyExtractor={r => r.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_CLEAR }}
        ListHeaderComponent={
          <View>
            <View style={[s.card, { flexDirection: 'row', gap: 14, alignItems: 'center', marginTop: 12 }]}>
              <View style={{ alignItems: 'center', minWidth: 72 }}>
                <Text style={s.statNum}>{Number(data.average || 0).toFixed(1)}</Text>
                <Stars n={Math.round(Number(data.average || 0))} />
                <Text style={s.cardMeta}>{data.count} review{data.count === 1 ? '' : 's'}</Text>
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                {dist.map(d => (
                  <View key={d.r} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[s.cardMeta, { marginTop: 0, width: 10 }]}>{d.r}</Text>
                    <View style={[s.barTrack, { flex: 1, marginTop: 0 }]}><View style={[s.barFill, { width: `${Math.round((d.n / max) * 100)}%` }]} /></View>
                    <Text style={[s.cardMeta, { marginTop: 0, width: 22, textAlign: 'right' }]}>{d.n}</Text>
                  </View>
                ))}
              </View>
            </View>
            <Text style={s.section}>All reviews</Text>
          </View>
        }
        ListEmptyComponent={<View style={s.card}><Text style={s.cardMuted}>No reviews yet. Reviews from customers land here.</Text></View>}
        renderItem={({ item: r }) => (
          <View style={s.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Avatar uri={r.avatar_url} name={r.name} />
              <View style={{ flex: 1 }}>
                <Text style={[s.cardTxt, { fontWeight: '700' }]} numberOfLines={1}>{r.name}{r.username ? <Text style={{ color: '#8E8E93', fontWeight: '400' }}> @{r.username}</Text> : null}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}><Stars n={r.rating} /><Text style={[s.cardMeta, { marginTop: 0 }]}>{whenLabel(r.created_at)}</Text></View>
              </View>
            </View>
            {r.body ? <Text style={[s.cardTxt, { marginTop: 8 }]}>{r.body}</Text> : null}
            {r.reply ? (
              <View style={s.replyBox}>
                <Text style={[s.cardMeta, { marginTop: 0, fontWeight: '700', color: NAVY }]}>Your reply · {whenLabel(r.replied_at)}</Text>
                <Text style={[s.cardTxt, { marginTop: 3 }]}>{r.reply}</Text>
              </View>
            ) : null}
            {canReply ? (
              <TouchableOpacity style={s.linkBtn} onPress={() => { setEditing(r); setDraft(r.reply || ''); }}>
                <Feather name="corner-down-right" size={13} color={NAVY} /><Text style={s.linkTxt}>{r.reply ? 'Edit reply' : 'Reply'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      />
      <Modal visible={!!editing} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#FFF' }}>
          <View style={[s.modalHeader, { paddingTop: Platform.OS === 'ios' ? 14 : insets.top + 8 }]}>
            <TouchableOpacity onPress={() => setEditing(null)} style={{ width: 70 }}><Text style={{ fontSize: 16, color: '#8E8E93' }}>Cancel</Text></TouchableOpacity>
            <Text style={s.modalTitle}>Reply to {editing?.name || 'review'}</Text>
            <TouchableOpacity onPress={() => send(false)} disabled={busy || !draft.trim()} style={{ width: 70, alignItems: 'flex-end' }}><Text style={{ fontSize: 15, fontWeight: '700', color: NAVY, opacity: busy || !draft.trim() ? 0.4 : 1 }}>Send</Text></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
            {editing ? <View style={s.card}><Stars n={editing.rating} />{editing.body ? <Text style={[s.cardMuted, { marginTop: 6 }]}>{editing.body}</Text> : null}</View> : null}
            <TextInput value={draft} onChangeText={setDraft} placeholder="Write a public reply" placeholderTextColor="#9AA0A6" multiline autoFocus style={s.textArea} />
            {editing?.reply ? <TouchableOpacity style={[s.secondaryBtn, { marginTop: 12, justifyContent: 'center' }]} onPress={() => send(true)} disabled={busy}><Text style={[s.secondaryTxt, { color: '#D64545' }]}>Remove reply</Text></TouchableOpacity> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── Audience ───────────────────────────────────────────────────────────────
type Person = { id: string; name: string; username: string | null; avatar_url: string | null; location: string | null; followed_at: string; label: string | null; note: string | null; paid: number; messages: number };
export function AudienceSeg({ role, navigation, onBack }: { role: string | null; navigation: any; onBack: () => void }) {
  const [summary, setSummary] = useState<any>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [q, setQ] = useState('');
  const [label, setLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const canLabel = !!role && REPLY_ROLES.includes(role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sm, pp] = await Promise.all([
        supabase.rpc('studio_audience_summary'),
        supabase.rpc('studio_audience', { p_q: q.trim() || null, p_label: label, p_limit: 200 }),
      ]);
      setSummary(sm.data || null);
      setPeople(((pp.data as any[]) || []) as Person[]);
    } finally { setLoading(false); }
  }, [q, label]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 250); return () => clearTimeout(t); }, [load]);

  const setPersonLabel = (p: Person) => {
    if (!canLabel) return;
    Alert.alert(p.name, 'Set a label', [
      ...LABELS.map(l => ({ text: l + (p.label === l ? ' (current)' : ''), onPress: async () => { await supabase.rpc('studio_set_contact_label', { p_contact: p.id, p_label: l, p_note: null }); await load(); } })),
      ...(p.label ? [{ text: 'Remove label', style: 'destructive' as const, onPress: async () => { await supabase.rpc('studio_set_contact_label', { p_contact: p.id, p_label: null, p_note: null }); await load(); } }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const labelKeys = useMemo(() => Object.keys((summary?.labels as Record<string, number>) || {}), [summary]);
  return (
    <View style={{ flex: 1 }}>
      <BackRow title="Audience" onBack={onBack} />
      <FlatList
        data={people}
        keyExtractor={p => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_CLEAR }}
        ListHeaderComponent={
          <View>
            {summary ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {[['Followers', summary.followers], ['New in 30 days', summary.new_30d], ['Customers', summary.customers]].map(([l, n]) => (
                  <View key={String(l)} style={[s.card, { width: '31%', marginBottom: 0, flexGrow: 1 }]}><Text style={s.statLabel}>{String(l)}</Text><Text style={s.statNum}>{Number(n || 0).toLocaleString()}</Text></View>
                ))}
              </View>
            ) : null}
            {Array.isArray(summary?.top_cities) && summary.top_cities.length > 0 ? <Text style={[s.sub, { marginTop: 10 }]}>Top places: {summary.top_cities.map((c: any) => c.city + ' (' + c.n + ')').join(' · ')}</Text> : null}
            <View style={[s.input, { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingVertical: 9 }]}>
              <Feather name="search" size={15} color="#8E8E93" />
              <TextInput value={q} onChangeText={setQ} placeholder="Search followers" placeholderTextColor="#9AA0A6" style={{ flex: 1, fontSize: 15, color: '#0F1419', padding: 0 }} autoCorrect={false} returnKeyType="search" />
              {q ? <TouchableOpacity onPress={() => setQ('')}><Feather name="x" size={15} color="#8E8E93" /></TouchableOpacity> : null}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 10 }} style={{ flexGrow: 0 }}>
              <TouchableOpacity style={[s.filterChip, !label && s.filterChipOn]} onPress={() => setLabel(null)}><Text style={[s.filterTxt, !label && s.filterTxtOn]}>All</Text></TouchableOpacity>
              {LABELS.map(l => (
                <TouchableOpacity key={l} style={[s.filterChip, label === l && s.filterChipOn]} onPress={() => setLabel(label === l ? null : l)}>
                  <Text style={[s.filterTxt, label === l && s.filterTxtOn]}>{l}{labelKeys.includes(l) ? ' · ' + summary.labels[l] : ''}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={loading ? <View style={[s.center, { paddingTop: 30 }]}><ActivityIndicator color={NAVY} /></View> : <View style={s.card}><Text style={s.cardMuted}>{q || label ? 'Nobody matches.' : 'No followers yet.'}</Text></View>}
        renderItem={({ item: p }) => (
          <TouchableOpacity style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]} onPress={() => navigation.navigate('UserProfile', { userId: p.id })} onLongPress={() => setPersonLabel(p)} activeOpacity={0.85}>
            <Avatar uri={p.avatar_url} name={p.name} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[s.cardTxt, { fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>{p.name}</Text>
                {p.label ? <Text style={s.labelPill}>{p.label}</Text> : null}
              </View>
              <Text style={s.cardMeta} numberOfLines={1}>{p.username ? '@' + p.username : ''}{p.location ? ' · ' + p.location : ''}{p.paid > 0 ? ' · ' + p.paid + ' order' + (p.paid === 1 ? '' : 's') : ''}{p.messages > 0 ? ' · ' + p.messages + ' msg' : ''}</Text>
              {p.note ? <Text style={[s.cardMeta, { fontStyle: 'italic' }]} numberOfLines={1}>{p.note}</Text> : null}
            </View>
            {canLabel ? <TouchableOpacity onPress={() => setPersonLabel(p)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="tag" size={16} color="#8E8E93" /></TouchableOpacity> : null}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

// ── Commerce ───────────────────────────────────────────────────────────────
type Order = { id: string; amount: number; currency: string; status: string; note: string | null; created_at: string; completed_at: string | null; conversation_id: string | null; payer_id: string; payer_name: string; payer_username: string | null; payer_avatar: string | null; listing_id: string | null; listing_title: string | null; listing_image: string | null };
type Listing = { id: string; title: string; price: number; currency: string; images: string[] | null; status: string; hidden: boolean; created_at: string; delivery_available: boolean | null; delivery_fee: number | null; pending_offers: number; sold_count: number; in_posts: number };
export function CommerceSeg({ role, navigation, onBack }: { role: string | null; navigation: any; onBack: () => void }) {
  const [tab, setTab] = useState<'orders' | 'catalog'>('orders');
  const [orders, setOrders] = useState<Order[]>([]);
  const [catalog, setCatalog] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const canEdit = !!role && LISTING_ROLES.includes(role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, c] = await Promise.all([supabase.rpc('studio_orders', { p_limit: 200 }), supabase.rpc('studio_catalog')]);
      setOrders(((o.data as any[]) || []) as Order[]);
      setCatalog(((c.data as any[]) || []) as Listing[]);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const setListing = async (l: Listing, patch: { p_status?: string }) => {
    try { const { error } = await supabase.rpc('studio_set_listing', { p_id: l.id, ...patch }); if (error) throw error; await load(); }
    catch (e: any) { Alert.alert('Could not update listing', e?.message || 'Please try again.'); }
  };
  const listingActions = (l: Listing) => {
    const buttons: any[] = [{ text: 'Open listing', onPress: () => navigation.navigate('Market', { screen: 'ListingDetail', params: { listingId: l.id } }) }];
    if (canEdit) {
      if (l.status === 'available') buttons.push({ text: 'Mark sold', onPress: () => setListing(l, { p_status: 'sold' }) });
      if (l.status === 'sold') buttons.push({ text: 'Mark available', onPress: () => setListing(l, { p_status: 'available' }) });
      buttons.push({ text: 'Remove listing', style: 'destructive', onPress: () => Alert.alert('Remove listing?', l.title, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => setListing(l, { p_status: 'removed' }) }]) });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(l.title, money(l.price, l.currency) + ' · ' + l.status, buttons);
  };
  const openOrder = (o: Order) => {
    if (!o.conversation_id) return;
    navigation.navigate('Chat', { conversationId: o.conversation_id, userId: o.payer_id, userName: o.payer_name, otherUser: { id: o.payer_id, full_name: o.payer_name, username: o.payer_username, avatar_url: o.payer_avatar } });
  };

  const totals = useMemo(() => {
    const m: Record<string, { total: number; n: number }> = {};
    for (const o of orders) { if (!o.completed_at) continue; const k = o.currency || 'USD'; (m[k] ||= { total: 0, n: 0 }); m[k].total += Number(o.amount || 0); m[k].n += 1; }
    return Object.entries(m);
  }, [orders]);
  const statusColor = (st: string) => st === 'completed' ? '#1C8C4E' : st === 'pending' ? '#B8860B' : st === 'failed' || st === 'cancelled' ? '#D64545' : '#5B6B84';

  return (
    <View style={{ flex: 1 }}>
      <BackRow title="Commerce" onBack={onBack} />
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
        {(['orders', 'catalog'] as const).map(t => (
          <TouchableOpacity key={t} style={[s.filterChip, tab === t && s.filterChipOn]} onPress={() => setTab(t)}><Text style={[s.filterTxt, tab === t && s.filterTxtOn]}>{t === 'orders' ? 'Orders · ' + orders.length : 'Catalog · ' + catalog.length}</Text></TouchableOpacity>
        ))}
      </View>
      {loading && orders.length === 0 && catalog.length === 0 ? <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={NAVY} /></View>
      : tab === 'orders' ? (
        <FlatList
          data={orders}
          keyExtractor={o => o.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_CLEAR }}
          ListHeaderComponent={totals.length > 0 ? <Text style={[s.sub, { marginBottom: 10 }]}>Received: {totals.map(([k, v]) => money(v.total, k) + ' (' + v.n + ')').join(' · ')}</Text> : null}
          ListEmptyComponent={<View style={s.card}><Text style={s.cardMuted}>No orders yet. In-chat payments to this business land here.</Text></View>}
          renderItem={({ item: o }) => (
            <TouchableOpacity style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]} onPress={() => openOrder(o)} activeOpacity={o.conversation_id ? 0.85 : 1}>
              {o.listing_image ? <ExpoImage source={{ uri: o.listing_image }} style={s.thumb} contentFit="cover" /> : <Avatar uri={o.payer_avatar} name={o.payer_name} size={52} />}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[s.cardTxt, { fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>{o.payer_name}</Text>
                  <Text style={[s.statusPill, { color: statusColor(o.status) }]}>{(o.status || '').toUpperCase()}</Text>
                </View>
                <Text style={s.cardTxt} numberOfLines={1}>{money(o.amount, o.currency)}{o.listing_title ? ' · ' + o.listing_title : ''}</Text>
                <Text style={s.cardMeta} numberOfLines={1}>{whenLabel(o.completed_at || o.created_at)}{o.note ? ' · ' + o.note : ''}</Text>
              </View>
              {o.conversation_id ? <Feather name="chevron-right" size={16} color="#8E8E93" /> : null}
            </TouchableOpacity>
          )}
        />
      ) : (
        <FlatList
          data={catalog}
          keyExtractor={l => l.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_CLEAR }}
          ListEmptyComponent={<View style={s.card}><Text style={s.cardMuted}>No listings. Post products from the Market tab and they show here.</Text></View>}
          renderItem={({ item: l }) => (
            <TouchableOpacity style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }, l.status !== 'available' && { opacity: 0.6 }]} onPress={() => listingActions(l)} activeOpacity={0.85}>
              {l.images && l.images[0] ? <ExpoImage source={{ uri: l.images[0] }} style={s.thumb} contentFit="cover" /> : <View style={[s.thumb, { backgroundColor: '#E5E5EA' }]} />}
              <View style={{ flex: 1 }}>
                <Text style={[s.cardTxt, { fontWeight: '700' }]} numberOfLines={1}>{l.title}</Text>
                <Text style={s.cardTxt}>{money(l.price, l.currency)}<Text style={{ color: '#8E8E93' }}> · {l.status}{l.hidden ? ' · hidden' : ''}</Text></Text>
                <Text style={s.cardMeta} numberOfLines={1}>{l.pending_offers > 0 ? l.pending_offers + ' offer' + (l.pending_offers === 1 ? '' : 's') + ' waiting · ' : ''}{l.sold_count} sold · in {l.in_posts} post{l.in_posts === 1 ? '' : 's'}</Text>
              </View>
              <Feather name="more-horizontal" size={18} color="#8E8E93" />
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  h1: { fontSize: 20, fontWeight: '800', color: '#0F1419' },
  sub: { fontSize: 12.5, color: '#8E8E93', marginTop: 2 },
  section: { fontSize: 11.5, fontWeight: '800', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 18, marginBottom: 8 },
  card: { backgroundColor: '#F8F9FB', borderRadius: 14, padding: 12, marginBottom: 8 },
  cardTxt: { fontSize: 14, color: '#0F1419', lineHeight: 19 },
  cardMuted: { fontSize: 13, color: '#8E8E93', lineHeight: 18 },
  cardMeta: { fontSize: 11.5, color: '#8E8E93', marginTop: 3 },
  statLabel: { fontSize: 11.5, color: '#8E8E93' },
  statNum: { fontSize: 22, fontWeight: '800', color: '#0F1419', marginTop: 2 },
  iconBox: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(11,30,61,0.08)', alignItems: 'center', justifyContent: 'center' },
  filterChip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, backgroundColor: '#F2F2F7' },
  filterChipOn: { backgroundColor: NAVY },
  filterTxt: { fontSize: 12.5, fontWeight: '700', color: '#5B6B84' },
  filterTxtOn: { color: '#FFF' },
  labelPill: { fontSize: 10.5, fontWeight: '700', color: NAVY, backgroundColor: 'rgba(11,30,61,0.08)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  thumb: { width: 52, height: 52, borderRadius: 10 },
  statusPill: { fontSize: 10.5, fontWeight: '800' },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: '#E5E5EA', marginTop: 4 },
  barFill: { height: 6, borderRadius: 3, backgroundColor: NAVY },
  replyBox: { marginTop: 8, backgroundColor: '#FFF', borderRadius: 10, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E5EA' },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, alignSelf: 'flex-start' },
  linkTxt: { fontSize: 12.5, fontWeight: '700', color: NAVY },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA' },
  modalTitle: { fontSize: 16.5, fontWeight: '700', color: '#0F1419' },
  textArea: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15.5, color: '#0F1419', minHeight: 110, textAlignVertical: 'top' },
  input: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#0F1419' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F2F2F7', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16 },
  secondaryTxt: { color: NAVY, fontWeight: '700', fontSize: 15 },
});
