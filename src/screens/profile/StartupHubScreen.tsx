/**
 * StartupHubScreen.tsx
 * Option A: Gradient hero cards. No stage filter pills.
 * Industry filter chips. Stage shown as frosted badge on each card.
 * Existing design preserved. Production fixes added:
 * - true LinearGradient hero
 * - startup_interest realtime listener
 * - interest counts loaded via grouped RPC
 * - unique constraint handled safely on duplicate interest insert
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput,
  Modal, ScrollView, ActivityIndicator, Alert, StatusBar, RefreshControl,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../services/supabase';

const NAVY = '#0B1E3D';
const TEXT_PRIMARY = '#000000';
const TEXT_SECONDARY = '#8E8E93';
const HAIRLINE = '#E5E5EA';

type Startup = {
  id: string; founder_id: string; founder_name: string; startup_name: string;
  industry: string; stage: string; location: string; one_liner: string;
  description: string; funding_need: string | null; website: string | null;
  interest_count: number; interested: boolean; created_at: string;
};

const STAGE_EMOJI: Record<string, string> = {
  'Idea': '💡', 'MVP': '🔧', 'Seed': '🌱', 'Series A+': '🚀', 'Profitable': '💰',
};
const STAGES = ['Idea', 'MVP', 'Seed', 'Series A+', 'Profitable'];
const INDUSTRIES = ['Tech', 'Finance', 'Health', 'Education', 'Food', 'Energy', 'Media', 'Retail', 'Impact', 'Other'];

const HERO_GRADIENTS = [
  ['#0B1E3D', '#1A3560', '#4F7FBF'],
  ['#065F46', '#10B981', '#34D399'],
  ['#7C2D12', '#D97706', '#FBBF24'],
  ['#5B21B6', '#8B5CF6', '#A78BFA'],
  ['#BE185D', '#F472B6', '#FBCFE8'],
  ['#1E3A8A', '#3B82F6', '#60A5FA'],
];

function getGradientIndex(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % HERO_GRADIENTS.length;
  return Math.abs(h) % HERO_GRADIENTS.length;
}

function MField({ label, value, set, placeholder, autoCapitalize }: {
  label: string; value: string; set: (v: string) => void; placeholder: string; autoCapitalize?: 'none' | 'words';
}) {
  return (
    <View style={st.mField}>
      <Text style={st.mLabel}>{label}</Text>
      <TextInput value={value} onChangeText={set} placeholder={placeholder}
        placeholderTextColor="#C7C7CC" style={st.mInput} autoCapitalize={autoCapitalize} />
    </View>
  );
}

export default function StartupHubScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile, session } = useAuthStore();
  const myId = profile?.id ?? session?.user?.id ?? null;

  const [startups, setStartups] = useState<Startup[]>([]);
  const [search, setSearch] = useState('');
  const [industryFilter, setIndustryFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Create form
  const [startupName, setStartupName] = useState('');
  const [industry, setIndustry] = useState('');
  const [stage, setStage] = useState('');
  const [location, setLocation] = useState('');
  const [oneLiner, setOneLiner] = useState('');
  const [description, setDescription] = useState('');
  const [fundingNeed, setFundingNeed] = useState('');
  const [website, setWebsite] = useState('');

  const clearForm = () => {
    setStartupName(''); setIndustry(''); setStage(''); setLocation('');
    setOneLiner(''); setDescription(''); setFundingNeed(''); setWebsite('');
  };

  const load = useCallback(async (showLoader = true) => {
    if (!myId) return;
    try {
      if (showLoader) setLoading(true);

      const { data: sp, error } = await supabase
        .from('startup_posts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) { setStartups([]); return; }
      const safePosts = sp || [];
      if (!safePosts.length) { setStartups([]); return; }

      const fids = Array.from(new Set(safePosts.map((p: any) => p.founder_id)));
      const { data: ps } = await supabase.from('profiles').select('id, full_name').in('id', fids);
      const pm: Record<string, string> = {};
      (ps || []).forEach((p: any) => { pm[p.id] = p.full_name || 'User'; });

      const { data: interests } = await supabase
        .from('startup_interest')
        .select('startup_id')
        .eq('investor_id', myId);
      const myInterests = new Set((interests || []).map((i: any) => i.startup_id));

      const { data: counts, error: countsErr } = await supabase.rpc('get_startup_interest_counts');
      const interestCounts: Record<string, number> = {};
      if (!countsErr) {
        (counts || []).forEach((c: any) => {
          interestCounts[c.startup_id] = Number(c.count || 0);
        });
      }

      setStartups(safePosts.map((p: any) => ({
        ...p,
        founder_name: pm[p.founder_id] || 'User',
        interest_count: interestCounts[p.id] || 0,
        interested: myInterests.has(p.id),
      })));
    } catch (e) { console.log('STARTUP_LOAD', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [myId]);

  useEffect(() => {
    load(true);
    const ch = supabase.channel('startup_hub_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'startup_posts' }, () => load(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'startup_interest' }, () => load(false))
      .subscribe((status) => console.log('STARTUP_REALTIME', status));
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const handleCreate = async () => {
    if (!myId) return;
    if (!startupName.trim() || !industry.trim() || !stage.trim() || !location.trim() || !oneLiner.trim() || !description.trim()) {
      Alert.alert('Missing fields', 'Please fill in all required fields.'); return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from('startup_posts').insert([{
        founder_id: myId, startup_name: startupName.trim(), industry: industry.trim(),
        stage: stage.trim(), location: location.trim(), one_liner: oneLiner.trim(),
        description: description.trim(), funding_need: fundingNeed.trim() || null,
        website: website.trim() || null,
      }]);
      if (error) { Alert.alert('Error', error.message); return; }
      clearForm(); setModalVisible(false);
      Alert.alert('Posted!', 'Your startup is now listed.');
      await load(false);
    } catch { Alert.alert('Error', 'Could not create listing.'); }
    finally { setSubmitting(false); }
  };

  const toggleInterest = async (startup: Startup) => {
    if (!myId || togglingId) return;
    setTogglingId(startup.id);

    const wasInterested = startup.interested;

    // Update only local active state immediately. Count is reconciled by realtime/RPC.
    setStartups(prev => prev.map(s => s.id === startup.id ? { ...s, interested: !wasInterested } : s));

    try {
      if (wasInterested) {
        const { error } = await supabase
          .from('startup_interest')
          .delete()
          .eq('startup_id', startup.id)
          .eq('investor_id', myId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('startup_interest')
          .insert({ startup_id: startup.id, investor_id: myId });
        if (error && error.code !== '23505') throw error;
      }
      await load(false);
    } catch (e: any) {
      setStartups(prev => prev.map(s => s.id === startup.id ? { ...s, interested: wasInterested } : s));
      Alert.alert('Error', e?.message || 'Could not update interest.');
    } finally { setTogglingId(null); }
  };

  const displayed = useMemo(() => {
    const term = search.toLowerCase();
    return startups.filter(s => {
      const matchInd = !industryFilter || s.industry === industryFilter;
      const matchSearch = !term || s.startup_name.toLowerCase().includes(term) ||
        s.industry.toLowerCase().includes(term) || s.one_liner.toLowerCase().includes(term) ||
        s.founder_name.toLowerCase().includes(term);
      return matchInd && matchSearch;
    });
  }, [startups, search, industryFilter]);

  const renderCard = ({ item: p }: { item: Startup }) => {
    const gi = getGradientIndex(p.id);
    const colors = HERO_GRADIENTS[gi];
    const stageEmoji = STAGE_EMOJI[p.stage] || '✨';
    const busy = togglingId === p.id;

    return (
      <TouchableOpacity
        style={st.card}
        activeOpacity={0.88}
        onPress={() => navigation.navigate('StartupHubDetails', { postId: p.id })}
      >
        <LinearGradient colors={colors as any} style={st.hero}>
          <View style={st.stageBadge}>
            <Text style={st.stageBadgeTxt}>{stageEmoji} {p.stage}</Text>
          </View>
          {p.interest_count > 0 && (
            <View style={st.interestBadge}>
              <Text style={st.interestBadgeTxt}>⚡ {p.interest_count}</Text>
            </View>
          )}
          <View style={st.heroBottom}>
            <Text style={st.heroName}>{p.startup_name}</Text>
            <Text style={st.heroLiner} numberOfLines={2}>{p.one_liner}</Text>
          </View>
        </LinearGradient>

        <View style={st.cardBody}>
          <View style={st.metaRow}>
            <Feather name="user" size={12} color={TEXT_SECONDARY} />
            <Text style={st.metaTxt}>{p.founder_name}</Text>
            <Text style={st.metaDot}>.</Text>
            <Feather name="map-pin" size={12} color={TEXT_SECONDARY} />
            <Text style={st.metaTxt}>{p.location}</Text>
          </View>
          <View style={st.metaRow}>
            <Feather name="briefcase" size={12} color={TEXT_SECONDARY} />
            <Text style={st.metaTxt}>{p.industry}</Text>
            {p.funding_need && (
              <>
                <Text style={st.metaDot}>.</Text>
                <Feather name="target" size={12} color="#059669" />
                <Text style={[st.metaTxt, { color: '#059669', fontWeight: '500' }]}>Seeking {p.funding_need}</Text>
              </>
            )}
          </View>

          <View style={st.cardFoot}>
            <TouchableOpacity
              style={[st.intBtn, p.interested && st.intBtnActive]}
              onPress={(e) => { e.stopPropagation(); toggleInterest(p); }}
              disabled={busy}
              activeOpacity={0.7}
            >
              {busy
                ? <ActivityIndicator color={p.interested ? '#FFF' : '#FF9500'} size={12} />
                : <>
                    <Text style={{ fontSize: 13 }}>⚡</Text>
                    <Text style={[st.intBtnTxt, p.interested && st.intBtnTxtActive]}>
                      {p.interested ? 'Interested' : 'Interest'}
                    </Text>
                  </>
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={st.viewBtn}
              onPress={() => navigation.navigate('StartupHubDetails', { postId: p.id })}
              activeOpacity={0.7}
            >
              <Text style={st.viewBtnTxt}>View Details</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />

      <View style={st.header}>
        <View>
          <Text style={st.title}>Startup Hub</Text>
          <Text style={st.subtitle}>PlatinumCircles ventures and ideas</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={st.hdrBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Feather name="chevron-left" size={20} color={NAVY} />
          </TouchableOpacity>
          <TouchableOpacity style={[st.hdrBtn, st.hdrBtnFill]} onPress={() => setModalVisible(true)} activeOpacity={0.7}>
            <Feather name="plus" size={20} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={st.searchBar}>
        <Feather name="search" size={15} color={TEXT_SECONDARY} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search startups..."
          placeholderTextColor={TEXT_SECONDARY} style={st.searchInput} clearButtonMode="while-editing" />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.filterRow}>
        <TouchableOpacity style={[st.filterChip, !industryFilter && st.filterChipOn]}
          onPress={() => setIndustryFilter('')} activeOpacity={0.7}>
          <Text style={[st.filterChipTxt, !industryFilter && st.filterChipTxtOn]}>All</Text>
        </TouchableOpacity>
        {INDUSTRIES.map(ind => (
          <TouchableOpacity key={ind} style={[st.filterChip, industryFilter === ind && st.filterChipOn]}
            onPress={() => setIndustryFilter(industryFilter === ind ? '' : ind)} activeOpacity={0.7}>
            <Text style={[st.filterChipTxt, industryFilter === ind && st.filterChipTxtOn]}>{ind}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={st.center}><ActivityIndicator color={NAVY} size="large" /></View>
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={i => i.id}
          renderItem={renderCard}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[st.list, !displayed.length && st.listEmpty, { paddingBottom: insets.bottom + 60 }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(false); }} tintColor={NAVY} />}
          ListEmptyComponent={
            <View style={st.empty}>
              <View style={st.emptyIcon}><Feather name="zap" size={32} color="#C7C7CC" /></View>
              <Text style={st.emptyTitle}>{search || industryFilter ? 'No results' : 'No startups yet'}</Text>
              <Text style={st.emptySub}>{search || industryFilter ? 'Try a different search or category.' : 'Share your startup idea with the PlatinumCircles community.'}</Text>
              {!search && !industryFilter && (
                <TouchableOpacity style={st.emptyBtn} onPress={() => setModalVisible(true)} activeOpacity={0.85}>
                  <Text style={st.emptyBtnTxt}>List my startup</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet"
        onRequestClose={() => { clearForm(); setModalVisible(false); }}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
          <View style={st.modalHeader}>
            <TouchableOpacity onPress={() => { clearForm(); setModalVisible(false); }}>
              <Text style={st.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={st.modalTitle}>List Your Startup</Text>
            <TouchableOpacity onPress={handleCreate} disabled={submitting}>
              {submitting ? <ActivityIndicator color={NAVY} size={16} /> : <Text style={st.modalPost}>Post</Text>}
            </TouchableOpacity>
          </View>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView contentContainerStyle={st.modalBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <MField label="Startup Name *" value={startupName} set={setStartupName} placeholder="e.g. ZimFin" />
              <MField label="Location *" value={location} set={setLocation} placeholder="Harare, Zimbabwe" />
              <MField label="One Liner *" value={oneLiner} set={setOneLiner} placeholder="We help X do Y through Z" />
              <MField label="Funding Need" value={fundingNeed} set={setFundingNeed} placeholder="$250k pre-seed" />
              <MField label="Website" value={website} set={setWebsite} placeholder="https://..." autoCapitalize="none" />

              <View style={st.mField}>
                <Text style={st.mLabel}>Industry *</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {INDUSTRIES.map(i => (
                    <TouchableOpacity key={i} style={[st.filterChip, industry === i && st.filterChipOn]}
                      onPress={() => setIndustry(i)}>
                      <Text style={[st.filterChipTxt, industry === i && st.filterChipTxtOn]}>{i}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={st.mField}>
                <Text style={st.mLabel}>Stage *</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {STAGES.map(s => (
                    <TouchableOpacity key={s} style={[st.stageChip, stage === s && st.stageChipOn]}
                      onPress={() => setStage(s)}>
                      <Text style={{ fontSize: 14 }}>{STAGE_EMOJI[s] || '✨'}</Text>
                      <Text style={[st.stageChipTxt, stage === s && st.stageChipTxtOn]}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={st.mField}>
                <Text style={st.mLabel}>Description *</Text>
                <TextInput value={description} onChangeText={setDescription}
                  placeholder="What problem are you solving? What makes you different?"
                  placeholderTextColor="#C7C7CC"
                  style={[st.mInput, { minHeight: 110, paddingTop: 12 }]}
                  multiline textAlignVertical="top" />
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  title: { fontSize: 26, fontWeight: '700', color: TEXT_PRIMARY, letterSpacing: -0.4 },
  subtitle: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 2 },
  hdrBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  hdrBtnFill: { backgroundColor: NAVY },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F2F2F7', marginHorizontal: 16, marginBottom: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  searchInput: { flex: 1, fontSize: 14, color: '#000', padding: 0 },
  filterRow: { paddingHorizontal: 16, paddingBottom: 12, gap: 6 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#F5F5F5', borderWidth: 1, borderColor: HAIRLINE },
  filterChipOn: { backgroundColor: NAVY, borderColor: NAVY },
  filterChipTxt: { fontSize: 12, fontWeight: '600', color: '#3C3C43' },
  filterChipTxtOn: { color: '#FFF' },
  list: { paddingHorizontal: 0, paddingTop: 4 },
  listEmpty: { flexGrow: 1 },
  card: { marginHorizontal: 16, marginBottom: 14, borderRadius: 16, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: '#F0F0F0' },
  hero: { height: 120, padding: 14, justifyContent: 'flex-end', position: 'relative' },
  stageBadge: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  stageBadgeTxt: { fontSize: 11, fontWeight: '700', color: '#FFF' },
  interestBadge: { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 3 },
  interestBadgeTxt: { fontSize: 12, fontWeight: '600', color: '#FFF' },
  heroBottom: {},
  heroName: { fontSize: 20, fontWeight: '700', color: '#FFF', textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  heroLiner: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 3, lineHeight: 17 },
  cardBody: { padding: 12 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  metaTxt: { fontSize: 12, color: TEXT_SECONDARY },
  metaDot: { fontSize: 14, color: '#C7C7CC' },
  cardFoot: { flexDirection: 'row', gap: 8, marginTop: 10 },
  intBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: '#FFF9EE', borderWidth: 1, borderColor: '#FEECC0' },
  intBtnActive: { backgroundColor: '#FF9500', borderColor: '#FF9500' },
  intBtnTxt: { fontSize: 13, fontWeight: '600', color: '#FF9500' },
  intBtnTxtActive: { color: '#FFF' },
  viewBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 12, backgroundColor: NAVY },
  viewBtnTxt: { fontSize: 13, fontWeight: '600', color: '#FFF' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: TEXT_PRIMARY, textAlign: 'center' },
  emptySub: { fontSize: 13, color: TEXT_SECONDARY, textAlign: 'center', lineHeight: 18 },
  emptyBtn: { marginTop: 14, backgroundColor: NAVY, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  emptyBtnTxt: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE },
  modalCancel: { fontSize: 17, color: TEXT_SECONDARY },
  modalTitle: { fontSize: 17, fontWeight: '600', color: TEXT_PRIMARY },
  modalPost: { fontSize: 17, fontWeight: '700', color: NAVY },
  modalBody: { padding: 20, paddingBottom: 60 },
  mField: { marginBottom: 18 },
  mLabel: { fontSize: 13, fontWeight: '600', color: TEXT_SECONDARY, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  mInput: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: TEXT_PRIMARY },
  stageChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: '#F5F5F5', borderWidth: 1, borderColor: HAIRLINE },
  stageChipOn: { backgroundColor: NAVY, borderColor: NAVY },
  stageChipTxt: { fontSize: 13, fontWeight: '600', color: '#3C3C43' },
  stageChipTxtOn: { color: '#FFF' },
});
