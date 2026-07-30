/**
 * CampaignsScreen — a business's sponsored placements.
 * Lists promoted_posts with live counters; pause/resume/end; New campaign
 * picks one of the business's own posts and inserts the row that
 * get_active_promos serves into the feed. RLS (can_act_as) is the gate.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, StatusBar, Modal, TextInput, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';

const NAVY = '#0B1E3D';
const DURATIONS = [{ d: 3, label: '3 days' }, { d: 7, label: '7 days' }, { d: 14, label: '14 days' }, { d: 30, label: '30 days' }];

function fmtDate(x?: string | null) {
  if (!x) return 'no end';
  return new Date(x).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function CampaignsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const businessId: string = route.params?.businessId;
  const businessName: string = route.params?.businessName || 'Business';

  const [rows, setRows] = useState<any[]>([]);
  const [postsById, setPostsById] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [pickOpen, setPickOpen] = useState(false);
  const [myPosts, setMyPosts] = useState<any[]>([]);
  const [target, setTarget] = useState<any>(null);
  const [label, setLabel] = useState('Sponsored');
  const [days, setDays] = useState(7);
  const [cap, setCap] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    try {
      const { data: promos, error } = await supabase.from('promoted_posts')
        .select('*').eq('advertiser_id', businessId).order('created_at', { ascending: false });
      if (error) throw error;
      setRows(promos ?? []);
      const ids = Array.from(new Set((promos ?? []).map((r: any) => r.post_id)));
      if (ids.length) {
        const { data: posts } = await supabase.from('posts').select('id, content, article_title').in('id', ids);
        const m: Record<string, any> = {};
        (posts ?? []).forEach((p: any) => { m[p.id] = p; });
        setPostsById(m);
      }
    } catch (e: any) { Alert.alert('Could not load campaigns', e?.message || ''); }
    finally { setLoading(false); }
  }, [businessId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openPicker = useCallback(async () => {
    try {
      const { data } = await supabase.from('posts')
        .select('id, content, article_title, created_at')
        .eq('user_id', businessId).order('created_at', { ascending: false }).limit(20);
      setMyPosts(data ?? []);
      setTarget(null); setLabel('Sponsored'); setDays(7); setCap('');
      setPickOpen(true);
    } catch (e: any) { Alert.alert('Could not load posts', e?.message || ''); }
  }, [businessId]);

  const createCampaign = useCallback(async () => {
    if (!target || saving) return;
    setSaving(true);
    try {
      const capNum = parseInt(cap, 10);
      const { error } = await supabase.from('promoted_posts').insert({
        post_id: target.id,
        advertiser_id: businessId,
        label: label.trim() || 'Sponsored',
        status: 'active',
        ends_at: new Date(Date.now() + days * 86400000).toISOString(),
        total_cap: Number.isFinite(capNum) && capNum > 0 ? capNum : null,
      });
      if (error) throw error;
      setPickOpen(false);
      load();
    } catch (e: any) { Alert.alert('Could not create campaign', e?.message || ''); }
    finally { setSaving(false); }
  }, [target, businessId, label, days, cap, saving, load]);

  const setStatus = useCallback((row: any) => {
    const opts: any[] = [];
    if (row.status === 'active') opts.push({ text: 'Pause', onPress: () => update(row, 'paused') });
    if (row.status === 'paused') opts.push({ text: 'Resume', onPress: () => update(row, 'active') });
    if (row.status !== 'ended') opts.push({ text: 'End campaign', style: 'destructive', onPress: () => update(row, 'ended') });
    opts.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Campaign', undefined, opts);
    async function update(r: any, status: string) {
      const prev = r.status;
      setRows(list => list.map(x => x.id === r.id ? { ...x, status } : x));
      const { error } = await supabase.from('promoted_posts').update({ status }).eq('id', r.id);
      if (error) { setRows(list => list.map(x => x.id === r.id ? { ...x, status: prev } : x)); Alert.alert('Could not update', error.message); }
    }
  }, []);

  const live = useMemo(() => rows.filter(r => r.status === 'active').length, [rows]);

  return (
    <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={26} color={NAVY} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginHorizontal: 10 }}>
          <Text style={st.headerTitle} numberOfLines={1}>Campaigns</Text>
          <Text style={st.headerSub}>{businessName} · {live} live</Text>
        </View>
        <TouchableOpacity onPress={openPicker} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="plus-circle" size={24} color={NAVY} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={st.center}><ActivityIndicator size="large" color={NAVY} /></View>
      ) : rows.length === 0 ? (
        <View style={st.center}>
          <Feather name="trending-up" size={38} color="#C7CDD6" />
          <Text style={st.emptyTitle}>No campaigns yet</Text>
          <Text style={st.emptySub}>Promote one of {businessName}'s posts and it appears as a sponsored card in the feed.</Text>
          <TouchableOpacity style={st.newBtn} onPress={openPicker} activeOpacity={0.9}>
            <Text style={st.newBtnTxt}>New campaign</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={r => r.id}
          contentContainerStyle={{ padding: 14, paddingBottom: 60 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const p = postsById[item.post_id];
            const excerpt = p?.article_title || p?.content || 'Post';
            const on = item.status === 'active';
            return (
              <View style={st.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={st.cardTitle} numberOfLines={1}>{excerpt}</Text>
                  <TouchableOpacity style={[st.statusChip, on ? st.chipOn : item.status === 'paused' ? st.chipPause : st.chipEnd]} onPress={() => setStatus(item)}>
                    <Text style={[st.statusTxt, on ? { color: '#065F46' } : item.status === 'paused' ? { color: '#B45309' } : { color: '#6B7280' }]}>
                      {item.status}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={st.window}>{item.label} · until {fmtDate(item.ends_at)}{item.total_cap ? ' · cap ' + item.total_cap : ''}</Text>
                <View style={st.metricsRow}>
                  <View style={st.metric}><Text style={st.metricNum}>{item.impressions_count ?? 0}</Text><Text style={st.metricLbl}>people reached</Text></View>
                  <View style={st.metric}><Text style={st.metricNum}>{item.clicks_count ?? 0}</Text><Text style={st.metricLbl}>clicks</Text></View>
                </View>
              </View>
            );
          }}
        />
      )}

      <Modal visible={pickOpen} animationType="slide" transparent onRequestClose={() => setPickOpen(false)}>
        <View style={st.scrim}>
          <View style={st.sheet}>
            <View style={st.grab} />
            <Text style={st.sheetTitle}>{target ? 'Campaign details' : 'Choose a post to promote'}</Text>
            {!target ? (
              <FlatList
                data={myPosts}
                keyExtractor={p => p.id}
                style={{ maxHeight: 380 }}
                ListEmptyComponent={<Text style={st.noPosts}>This business has no posts yet. Post first, then promote.</Text>}
                renderItem={({ item }) => (
                  <TouchableOpacity style={st.pickRow} onPress={() => setTarget(item)} activeOpacity={0.85}>
                    <Text style={st.pickTxt} numberOfLines={2}>{item.article_title || item.content || 'Post'}</Text>
                    <Feather name="chevron-right" size={16} color="#9CA3AF" />
                  </TouchableOpacity>
                )}
              />
            ) : (
              <ScrollView automaticallyAdjustKeyboardInsets={true} showsVerticalScrollIndicator={false}>
                <Text style={st.pickedExcerpt} numberOfLines={2}>{target.article_title || target.content}</Text>
                <Text style={st.fieldLbl}>Label</Text>
                <TextInput style={st.input} value={label} onChangeText={setLabel} maxLength={24} placeholder="Sponsored" placeholderTextColor="#9CA3AF" />
                <Text style={st.fieldLbl}>Duration</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {DURATIONS.map(x => (
                    <TouchableOpacity key={x.d} style={[st.durChip, days === x.d && st.durChipOn]} onPress={() => setDays(x.d)}>
                      <Text style={[st.durTxt, days === x.d && { color: '#FFFFFF' }]}>{x.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={st.fieldLbl}>Impression cap (optional)</Text>
                <TextInput style={st.input} value={cap} onChangeText={setCap} keyboardType="number-pad" maxLength={7} placeholder="e.g. 5000 — blank for unlimited" placeholderTextColor="#9CA3AF" />
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                  <TouchableOpacity style={st.backBtn} onPress={() => setTarget(null)}><Text style={st.backTxt}>Back</Text></TouchableOpacity>
                  <TouchableOpacity style={st.goBtn} onPress={createCampaign} disabled={saving} activeOpacity={0.9}>
                    {saving ? <ActivityIndicator color="#FFF" size={16} /> : <Text style={st.goTxt}>Start campaign</Text>}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
            <TouchableOpacity style={st.closeX} onPress={() => setPickOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(11,30,61,0.08)' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: NAVY, textAlign: 'center' },
  headerSub: { fontSize: 11.5, color: 'rgba(11,30,61,0.5)', textAlign: 'center', marginTop: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyTitle: { fontSize: 16.5, fontWeight: '800', color: NAVY, marginTop: 12 },
  emptySub: { fontSize: 13.5, color: 'rgba(11,30,61,0.55)', textAlign: 'center', marginTop: 4, lineHeight: 19 },
  newBtn: { marginTop: 16, backgroundColor: NAVY, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12 },
  newBtnTxt: { color: '#FFF', fontSize: 14.5, fontWeight: '700' },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,30,61,0.10)', padding: 14, marginBottom: 12, backgroundColor: '#FFFFFF' },
  cardTitle: { flex: 1, fontSize: 14.5, fontWeight: '700', color: NAVY },
  statusChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  chipOn: { backgroundColor: '#ECFDF5' }, chipPause: { backgroundColor: '#FFFBEB' }, chipEnd: { backgroundColor: '#F3F4F6' },
  statusTxt: { fontSize: 11.5, fontWeight: '800', textTransform: 'capitalize' },
  window: { fontSize: 12.5, color: 'rgba(11,30,61,0.5)', marginTop: 4 },
  metricsRow: { flexDirection: 'row', gap: 22, marginTop: 12 },
  metric: {},
  metricNum: { fontSize: 20, fontWeight: '800', color: NAVY, fontVariant: ['tabular-nums'] },
  metricLbl: { fontSize: 11.5, color: 'rgba(11,30,61,0.5)', marginTop: 1 },
  scrim: { flex: 1, backgroundColor: 'rgba(11,30,61,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 28, maxHeight: '88%' },
  grab: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: 'rgba(11,30,61,0.16)', marginBottom: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: NAVY, marginBottom: 12 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(11,30,61,0.07)' },
  pickTxt: { flex: 1, fontSize: 14, color: 'rgba(11,30,61,0.85)' },
  noPosts: { fontSize: 13.5, color: 'rgba(11,30,61,0.5)', paddingVertical: 20, textAlign: 'center' },
  pickedExcerpt: { fontSize: 14, color: 'rgba(11,30,61,0.75)', backgroundColor: '#FAFAF9', borderRadius: 12, padding: 12 },
  fieldLbl: { fontSize: 12, fontWeight: '800', color: 'rgba(11,30,61,0.5)', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 14, marginBottom: 6 },
  input: { borderRadius: 12, borderWidth: 1, borderColor: 'rgba(11,30,61,0.14)', paddingHorizontal: 12, paddingVertical: 11, fontSize: 14.5, color: NAVY },
  durChip: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: 'rgba(11,30,61,0.05)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,30,61,0.10)' },
  durChipOn: { backgroundColor: NAVY, borderColor: NAVY },
  durTxt: { fontSize: 13, fontWeight: '700', color: NAVY },
  backBtn: { paddingHorizontal: 16, justifyContent: 'center' },
  backTxt: { fontSize: 14, fontWeight: '600', color: 'rgba(11,30,61,0.6)' },
  goBtn: { flex: 1, backgroundColor: NAVY, borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  goTxt: { color: '#FFF', fontSize: 14.5, fontWeight: '700' },
  closeX: { position: 'absolute', top: 14, right: 16 },
});