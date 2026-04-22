import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput,
  Modal, ScrollView, ActivityIndicator, Alert, StatusBar, RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../services/supabase';

type Startup = {
  id: string; founder_id: string; founder_name: string; startup_name: string;
  industry: string; stage: string; location: string; one_liner: string;
  description: string; funding_need: string | null; website: string | null;
  interest_count: number; interested: boolean; created_at: string;
};

const STAGE_EMOJI: Record<string, string> = {
  'All': '🌍', 'Idea': '💡', 'MVP': '🔧', 'Seed': '🌱', 'Series A+': '🚀', 'Profitable': '💰',
};
const STAGES = ['All', 'Idea', 'MVP', 'Seed', 'Series A+', 'Profitable'];
const INDUSTRIES = ['Tech', 'Finance', 'Health', 'Education', 'Food', 'Energy', 'Media', 'Retail', 'Impact', 'Other'];

export default function StartupHubScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile, session } = useAuthStore();
  const myId = profile?.id ?? session?.user?.id ?? null;

  const [startups, setStartups] = useState<Startup[]>([]);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [startupName, setStartupName] = useState('');
  const [industry, setIndustry] = useState('');
  const [stage, setStage] = useState('');
  const [location, setLocation] = useState('');
  const [oneLiner, setOneLiner] = useState('');
  const [description, setDescription] = useState('');
  const [fundingNeed, setFundingNeed] = useState('');
  const [website, setWebsite] = useState('');

  const clearForm = () => { setStartupName(''); setIndustry(''); setStage(''); setLocation(''); setOneLiner(''); setDescription(''); setFundingNeed(''); setWebsite(''); };

  const load = useCallback(async (showLoader = true) => {
    if (!myId) return;
    try {
      if (showLoader) setLoading(true);
      const { data: sp, error } = await supabase.from('startup_posts').select('*').order('created_at', { ascending: false });
      if (error) { setStartups([]); return; }
      const safePosts = sp || [];
      if (!safePosts.length) { setStartups([]); return; }
      const fids = Array.from(new Set(safePosts.map((p: any) => p.founder_id)));
      const { data: ps } = await supabase.from('profiles').select('id, full_name').in('id', fids);
      const pm: Record<string, string> = {};
      (ps || []).forEach((p: any) => { pm[p.id] = p.full_name || 'User'; });
      const { data: interests } = await supabase.from('startup_interest').select('startup_id').eq('investor_id', myId);
      const myInterests = new Set((interests || []).map((i: any) => i.startup_id));
      const { data: allInterests } = await supabase.from('startup_interest').select('startup_id');
      const interestCounts: Record<string, number> = {};
      (allInterests || []).forEach((i: any) => { interestCounts[i.startup_id] = (interestCounts[i.startup_id] || 0) + 1; });
      setStartups(safePosts.map((p: any) => ({
        ...p, founder_name: pm[p.founder_id] || 'User',
        interest_count: interestCounts[p.id] || 0, interested: myInterests.has(p.id),
      })));
    } catch (e) { console.log('STARTUP_LOAD', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [myId]);

  useEffect(() => {
    load(true);
    const ch = supabase.channel('startup_hub_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'startup_posts' }, () => load(false))
      .subscribe();
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
    if (!myId) return;
    if (startup.interested) {
      await supabase.from('startup_interest').delete().eq('startup_id', startup.id).eq('investor_id', myId);
    } else {
      await supabase.from('startup_interest').insert({ startup_id: startup.id, investor_id: myId });
    }
    setStartups(prev => prev.map(s => s.id === startup.id ? { ...s, interested: !s.interested, interest_count: s.interest_count + (s.interested ? -1 : 1) } : s));
  };

  const displayedStartups = useMemo(() => {
    const term = search.toLowerCase();
    return startups.filter(s => {
      const matchStage = stageFilter === 'All' || s.stage === stageFilter;
      const matchSearch = !term || s.startup_name.toLowerCase().includes(term) || s.industry.toLowerCase().includes(term) || s.one_liner.toLowerCase().includes(term);
      return matchStage && matchSearch;
    });
  }, [startups, search, stageFilter]);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>‹</Text><Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Startup Hub</Text>
          <Text style={s.headerSub}>TBirds ventures & ideas</Text>
        </View>
        <TouchableOpacity style={s.addBtn} onPress={() => setModalVisible(true)} activeOpacity={0.8}>
          <Feather name="plus" size={20} color="#FFF" />
        </TouchableOpacity>
      </View>

      <View style={s.searchWrap}>
        <Feather name="search" size={16} color="#8E8E93" />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search startups..." placeholderTextColor="#8E8E93" style={s.searchInput} clearButtonMode="while-editing" />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.stageRow}>
        {STAGES.map(st => (
          <TouchableOpacity key={st} style={[s.chip, stageFilter === st && s.chipActive]} onPress={() => setStageFilter(st)}>
            <Text style={[s.chipTxt, stageFilter === st && s.chipTxtActive]}>{st}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={s.loader}><ActivityIndicator color="#007AFF" size="large" /></View>
      ) : (
        <FlatList
          data={displayedStartups}
          keyExtractor={i => i.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.list, !displayedStartups.length && s.listEmpty, { paddingBottom: Math.max(insets.bottom + 40, 60) }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(false); }} tintColor="#007AFF" />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="zap" size={40} color="#E5E5EA" />
              <Text style={s.emptyTitle}>{search || stageFilter !== 'All' ? 'No results' : 'No startups yet'}</Text>
              <Text style={s.emptyTxt}>{search || stageFilter !== 'All' ? 'Try a different search.' : 'Share your startup idea with the TBirds community.'}</Text>
              {!search && stageFilter === 'All' && <TouchableOpacity style={s.emptyBtn} onPress={() => setModalVisible(true)}><Text style={s.emptyBtnTxt}>List my startup</Text></TouchableOpacity>}
            </View>
          }
          renderItem={({ item: p }) => (
            <TouchableOpacity style={s.card} activeOpacity={0.88} onPress={() => navigation.navigate('StartupHubDetails', { postId: p.id })}>
              <View style={s.cardTop}>
                <View style={s.stagePill}><Text style={s.stagePillTxt}>{p.stage}</Text></View>
                <View style={s.industryPill}><Text style={s.industryPillTxt}>{p.industry}</Text></View>
              </View>
              <Text style={s.startupName}>{p.startup_name}</Text>
              <Text style={s.oneLiner}>{p.one_liner}</Text>
              <Text style={s.founder}>by {p.founder_name} · 📍 {p.location}</Text>
              {p.funding_need && <Text style={s.funding}>🎯 Seeking {p.funding_need}</Text>}
              <View style={s.cardActions}>
                <TouchableOpacity style={s.viewBtn} onPress={() => navigation.navigate('StartupHubDetails', { postId: p.id })} activeOpacity={0.8}>
                  <Text style={s.viewBtnTxt}>View details</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.interestBtn, p.interested && s.interestedBtn]} onPress={() => toggleInterest(p)} activeOpacity={0.8}>
                  <Feather name="zap" size={14} color={p.interested ? '#FFF' : '#FF9500'} />
                  <Text style={[s.interestBtnTxt, p.interested && s.interestedBtnTxt]}>{p.interest_count} Interested</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { clearForm(); setModalVisible(false); }}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => { clearForm(); setModalVisible(false); }}><Text style={s.modalCancel}>Cancel</Text></TouchableOpacity>
            <Text style={s.modalTitle}>List Your Startup</Text>
            <TouchableOpacity onPress={handleCreate} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#007AFF" size={16} /> : <Text style={s.modalPost}>Post</Text>}
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={s.modalBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {[
              { label: 'Startup Name *', value: startupName, set: setStartupName, placeholder: 'e.g. ZimFin' },
              { label: 'Location *', value: location, set: setLocation, placeholder: 'Phoenix, AZ' },
              { label: 'One Liner *', value: oneLiner, set: setOneLiner, placeholder: 'We help X do Y through Z' },
              { label: 'Funding Need', value: fundingNeed, set: setFundingNeed, placeholder: '$250k pre-seed' },
              { label: 'Website', value: website, set: setWebsite, placeholder: 'https://...', autoCapitalize: 'none' as const },
            ].map(f => (
              <View key={f.label} style={s.modalField}>
                <Text style={s.modalFieldLabel}>{f.label}</Text>
                <TextInput value={f.value} onChangeText={f.set} placeholder={f.placeholder} placeholderTextColor="#C7C7CC" style={s.modalInput} autoCapitalize={f.autoCapitalize} />
              </View>
            ))}
            <View style={s.modalField}>
              <Text style={s.modalFieldLabel}>Industry *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 4 }}>
                {INDUSTRIES.map(i => <TouchableOpacity key={i} style={[s.chip, industry === i && s.chipActive]} onPress={() => setIndustry(i)}><Text style={[s.chipTxt, industry === i && s.chipTxtActive]}>{i}</Text></TouchableOpacity>)}
              </ScrollView>
            </View>
            <View style={s.modalField}>
              <Text style={s.modalFieldLabel}>Stage *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 4 }}>
                {STAGES.filter(st => st !== 'All').map(st => <TouchableOpacity key={st} style={[s.chip, stage === st && s.chipActive]} onPress={() => setStage(st)}><Text style={[s.chipTxt, stage === st && s.chipTxtActive]}>{st}</Text></TouchableOpacity>)}
              </ScrollView>
            </View>
            <View style={s.modalField}>
              <Text style={s.modalFieldLabel}>Description *</Text>
              <TextInput value={description} onChangeText={setDescription} placeholder="What problem are you solving? What makes you different?" placeholderTextColor="#C7C7CC" style={[s.modalInput, { minHeight: 110, paddingTop: 12 }]} multiline textAlignVertical="top" />
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  backBtn: { flexDirection: 'row', alignItems: 'center', minWidth: 60 },
  backChev: { fontSize: 30, color: '#007AFF', lineHeight: 34, marginRight: 1 },
  backLbl: { fontSize: 17, color: '#007AFF' },
  headerCenter: { alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#000' },
  headerSub: { fontSize: 11, color: '#8E8E93', marginTop: 1 },
  addBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginVertical: 10, backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 12, height: 40 },
  searchInput: { flex: 1, fontSize: 15, color: '#000' },
  stageRow: { paddingHorizontal: 16, paddingBottom: 10, gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, borderWidth: 1, borderColor: '#E5E5EA', backgroundColor: '#F5F5F5' },
  chipActive: { borderColor: '#5856D6' },
  chipTxt: { fontSize: 11, fontWeight: '600', color: '#3C3C43', letterSpacing: -0.1 },
  chipTxtActive: { color: '#5856D6', fontWeight: '700' },
  list: { paddingHorizontal: 16, paddingTop: 4 },
  listEmpty: { flexGrow: 1 },
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: '#F0F0F0' },
  cardTop: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  stagePill: { backgroundColor: '#FFF9EE', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#FEECC0' },
  stagePillTxt: { fontSize: 12, fontWeight: '700', color: '#FF9500' },
  industryPill: { backgroundColor: '#EFF6FF', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  industryPillTxt: { fontSize: 12, fontWeight: '700', color: '#007AFF' },
  startupName: { fontSize: 20, fontWeight: '700', color: '#000', marginBottom: 4 },
  oneLiner: { fontSize: 14, color: '#3C3C43', lineHeight: 20, marginBottom: 6 },
  founder: { fontSize: 13, color: '#8E8E93', marginBottom: 4 },
  funding: { fontSize: 13, color: '#34C759', fontWeight: '500', marginBottom: 12 },
  cardActions: { flexDirection: 'row', gap: 8 },
  viewBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#E5E5EA', alignItems: 'center' },
  viewBtnTxt: { fontSize: 13, fontWeight: '600', color: '#3C3C43' },
  interestBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#FEECC0', backgroundColor: '#FFF9EE' },
  interestedBtn: { backgroundColor: '#FF9500', borderColor: '#FF9500' },
  interestBtnTxt: { fontSize: 13, fontWeight: '600', color: '#FF9500' },
  interestedBtnTxt: { color: '#FFF' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 32, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#000', textAlign: 'center' },
  emptyTxt: { fontSize: 14, color: '#8E8E93', textAlign: 'center', lineHeight: 20 },
  emptyBtn: { marginTop: 8, backgroundColor: '#000', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  emptyBtnTxt: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  modalCancel: { fontSize: 17, color: '#8E8E93' },
  modalTitle: { fontSize: 17, fontWeight: '600', color: '#000' },
  modalPost: { fontSize: 17, fontWeight: '600', color: '#007AFF' },
  modalBody: { padding: 20 },
  modalField: { marginBottom: 18 },
  modalFieldLabel: { fontSize: 13, fontWeight: '600', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  modalInput: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#000' },
});