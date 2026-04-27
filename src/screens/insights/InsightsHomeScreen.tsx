/**
 * InsightsHomeScreen.tsx
 * Option B: Sections Home — categories grid, trending businesses, recent adverts.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput,
  ActivityIndicator, StatusBar, RefreshControl, ScrollView, Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

const NAVY = '#0B1E3D';
const TEXT_PRIMARY = '#000000';
const TEXT_SECONDARY = '#8E8E93';
const HAIRLINE = '#E5E5EA';

type BusinessLite = {
  id: string;
  name: string;
  category: string;
  location: string;
  avg_rating: number;
  review_count: number;
  logo_url: string | null;
  owner_id: string;
  owner_name?: string;
};

type AdvertLite = {
  id: string;
  business_id: string;
  business_name: string;
  business_logo: string | null;
  body: string;
  link_url: string | null;
  cta_label: string;
  is_promoted: boolean;
  created_at: string;
};

const CATEGORIES = [
  { label: 'Consulting', emoji: '💼', bg: '#EFF6FF' },
  { label: 'Technology', emoji: '💻', bg: '#F0EEFF' },
  { label: 'Finance',    emoji: '💰', bg: '#EDFBF0' },
  { label: 'Food',       emoji: '🍽️', bg: '#FFF0F7' },
  { label: 'Education',  emoji: '📚', bg: '#FEF3C7' },
  { label: 'Health',     emoji: '❤️', bg: '#FEE2E2' },
  { label: 'Creative',   emoji: '✨', bg: '#E8E4F7' },
  { label: 'Other',      emoji: '🔗', bg: '#F2F2F7' },
];

function initials(n?: string | null) {
  if (!n) return '?';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}
function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (m < 1) return 'now';
  if (m < 60) return m + 'm';
  if (h < 24) return h + 'h';
  if (dy < 7) return dy + 'd';
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function renderStars(rating: number) {
  const full = Math.round(rating);
  let s = '';
  for (let i = 0; i < 5; i++) s += i < full ? '★' : '☆';
  return s;
}

export default function InsightsHomeScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const [businesses, setBusinesses] = useState<BusinessLite[]>([]);
  const [adverts, setAdverts] = useState<AdvertLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedCat, setSelectedCat] = useState('');

  const loadData = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    try {
      // Load businesses
      const { data: bizData } = await supabase
        .from('business_profiles')
        .select('id, name, category, location, avg_rating, review_count, logo_url, owner_id')
        .order('avg_rating', { ascending: false })
        .limit(50);

      if (bizData && bizData.length > 0) {
        const ownerIds = Array.from(new Set(bizData.map((b: any) => b.owner_id)));
        const { data: profiles } = await supabase
          .from('profiles').select('id, full_name').in('id', ownerIds);
        const nameMap: Record<string, string> = {};
        (profiles || []).forEach((p: any) => { nameMap[p.id] = p.full_name || 'Member'; });
        setBusinesses(bizData.map((b: any) => ({ ...b, owner_name: nameMap[b.owner_id] || 'Member' })));
      } else {
        setBusinesses([]);
      }

      // Load recent adverts
      const { data: advData } = await supabase
        .from('business_posts')
        .select('id, business_id, body, link_url, cta_label, is_promoted, created_at')
        .order('created_at', { ascending: false })
        .limit(20);

      if (advData && advData.length > 0) {
        const bizIds = Array.from(new Set(advData.map((a: any) => a.business_id)));
        const { data: bizProfiles } = await supabase
          .from('business_profiles').select('id, name, logo_url').in('id', bizIds);
        const bizMap: Record<string, any> = {};
        (bizProfiles || []).forEach((b: any) => { bizMap[b.id] = b; });
        setAdverts(advData.map((a: any) => ({
          ...a,
          business_name: bizMap[a.business_id]?.name || 'Business',
          business_logo: bizMap[a.business_id]?.logo_url || null,
        })));
      } else {
        setAdverts([]);
      }
    } catch (e) { console.log('[INSIGHTS_LOAD]', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { loadData(true); }, [loadData]);

  const trending = useMemo(() => {
    let list = [...businesses];
    if (selectedCat) list = list.filter(b => b.category === selectedCat);
    if (search.trim()) {
      const term = search.trim().toLowerCase();
      list = list.filter(b =>
        b.name.toLowerCase().includes(term) ||
        b.category.toLowerCase().includes(term) ||
        (b.location || '').toLowerCase().includes(term) ||
        (b.owner_name || '').toLowerCase().includes(term)
      );
    }
    return list.slice(0, 10);
  }, [businesses, selectedCat, search]);

  const myBusiness = useMemo(() => {
    if (!userId) return null;
    return businesses.find(b => b.owner_id === userId) || null;
  }, [businesses, userId]);

  if (loading) return (
    <SafeAreaView style={st.safe}><View style={st.center}><ActivityIndicator color={NAVY} size="large" /></View></SafeAreaView>
  );

  return (
    <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(false); }} tintColor={NAVY} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 60 }}
      >
        {/* Header */}
        <View style={st.header}>
          <View>
            <Text style={st.title}>Insights</Text>
            <Text style={st.subtitle}>Discover and support Thunderbird businesses</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={st.hdrBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
              <Feather name="chevron-left" size={20} color={NAVY} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.hdrBtn, { backgroundColor: NAVY }]}
              onPress={() => navigation.navigate('CreateBusiness' as any)}
              activeOpacity={0.7}
            >
              <Feather name="plus" size={20} color="#FFF" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Search */}
        <View style={st.searchBar}>
          <Feather name="search" size={15} color={TEXT_SECONDARY} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search businesses..."
            placeholderTextColor={TEXT_SECONDARY}
            style={st.searchInput}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}><Feather name="x" size={15} color={TEXT_SECONDARY} /></TouchableOpacity>
          )}
        </View>

        {/* My Business banner */}
        {!myBusiness && userId && (
          <TouchableOpacity
            style={st.createBanner}
            onPress={() => navigation.navigate('CreateBusiness' as any)}
            activeOpacity={0.8}
          >
            <View style={st.createBannerIcon}><Feather name="briefcase" size={18} color={NAVY} /></View>
            <View style={{ flex: 1 }}>
              <Text style={st.createBannerTitle}>List your business</Text>
              <Text style={st.createBannerSub}>Create a profile and reach the Thunderbird network</Text>
            </View>
            <Feather name="chevron-right" size={18} color={NAVY} />
          </TouchableOpacity>
        )}

        {myBusiness && (
          <TouchableOpacity
            style={st.myBizBanner}
            onPress={() => navigation.navigate('BusinessProfile', { businessId: myBusiness.id })}
            activeOpacity={0.8}
          >
            <View style={st.myBizLogo}>
              <Text style={st.myBizLogoTxt}>{initials(myBusiness.name)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.myBizName}>{myBusiness.name}</Text>
              <Text style={st.myBizSub}>{myBusiness.category} · {renderStars(myBusiness.avg_rating)} ({myBusiness.review_count})</Text>
            </View>
            <Feather name="chevron-right" size={18} color={TEXT_SECONDARY} />
          </TouchableOpacity>
        )}

        {/* Categories */}
        <View style={st.secHeader}>
          <Text style={st.secTitle}>Categories</Text>
        </View>
        <View style={st.catGrid}>
          {CATEGORIES.map(c => (
            <TouchableOpacity
              key={c.label}
              style={st.catCell}
              activeOpacity={0.7}
              onPress={() => setSelectedCat(selectedCat === c.label ? '' : c.label)}
            >
              <View style={[st.catIcon, { backgroundColor: selectedCat === c.label ? NAVY : c.bg }]}>
                <Text style={{ fontSize: 22 }}>{c.emoji}</Text>
              </View>
              <Text style={[st.catLabel, selectedCat === c.label && { color: NAVY, fontWeight: '700' }]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Trending */}
        <View style={st.secHeader}>
          <Text style={st.secTitle}>
            {selectedCat ? selectedCat : 'Trending'}
          </Text>
          {selectedCat ? (
            <TouchableOpacity onPress={() => setSelectedCat('')}>
              <Text style={st.secLink}>Clear filter</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {trending.length === 0 ? (
          <View style={st.emptySmall}>
            <Text style={st.emptySmallTxt}>No businesses found{selectedCat ? ' in ' + selectedCat : ''}</Text>
          </View>
        ) : (
          trending.map((biz, idx) => (
            <TouchableOpacity
              key={biz.id}
              style={st.trendItem}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('BusinessProfile', { businessId: biz.id })}
            >
              <Text style={st.trendRank}>{idx + 1}</Text>
              {biz.logo_url ? (
                <Image source={{ uri: biz.logo_url }} style={st.trendLogo} />
              ) : (
                <View style={[st.trendLogo, { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '700' }}>{initials(biz.name)}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={st.trendName} numberOfLines={1}>{biz.name}</Text>
                <Text style={st.trendSub}>{biz.category} · {biz.location || 'Global'}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={st.trendRatingNum}>{biz.avg_rating > 0 ? biz.avg_rating.toFixed(1) : 'New'}</Text>
                {biz.review_count > 0 && (
                  <Text style={st.trendReviewCount}>{biz.review_count} reviews</Text>
                )}
              </View>
            </TouchableOpacity>
          ))
        )}

        {/* Recent Adverts */}
        {adverts.length > 0 && (
          <>
            <View style={st.secHeader}>
              <Text style={st.secTitle}>Recent Adverts</Text>
            </View>
            {adverts.slice(0, 5).map(adv => (
              <TouchableOpacity
                key={adv.id}
                style={st.advCard}
                activeOpacity={0.8}
                onPress={() => navigation.navigate('BusinessProfile', { businessId: adv.business_id })}
              >
                <View style={st.advTop}>
                  <View style={st.advLogo}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: NAVY }}>{initials(adv.business_name)}</Text>
                  </View>
                  <Text style={st.advBizName}>{adv.business_name}</Text>
                  <View style={st.advLabel}>
                    <Text style={st.advLabelTxt}>{adv.is_promoted ? 'Promoted' : 'Advert'}</Text>
                  </View>
                  <Text style={st.advTime}>{relTime(adv.created_at)}</Text>
                </View>
                <Text style={st.advBody} numberOfLines={3}>{adv.body}</Text>
                {adv.link_url && (
                  <View style={st.advLink}>
                    <Feather name="link" size={13} color={NAVY} />
                    <Text style={st.advLinkTxt} numberOfLines={1}>{adv.link_url}</Text>
                  </View>
                )}
                {adv.cta_label && (
                  <View style={st.advCta}>
                    <Text style={st.advCtaTxt}>{adv.cta_label}</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* Empty state */}
        {businesses.length === 0 && adverts.length === 0 && (
          <View style={st.empty}>
            <View style={st.emptyIcon}><Feather name="briefcase" size={32} color="#C7C7CC" /></View>
            <Text style={st.emptyTitle}>No businesses yet</Text>
            <Text style={st.emptySub}>Be the first to list your business and reach the Thunderbird community.</Text>
            <TouchableOpacity style={st.emptyBtn} onPress={() => navigation.navigate('CreateBusiness' as any)} activeOpacity={0.85}>
              <Text style={st.emptyBtnTxt}>Create a listing</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  title: { fontSize: 26, fontWeight: '700', color: TEXT_PRIMARY, letterSpacing: -0.4 },
  subtitle: { fontSize: 13, color: TEXT_SECONDARY, marginTop: 2 },
  hdrBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F2F2F7', marginHorizontal: 16, marginBottom: 12, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  searchInput: { flex: 1, fontSize: 14, color: '#000', padding: 0 },
  createBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 14, backgroundColor: '#F2F2F7', borderRadius: 14, padding: 14 },
  createBannerIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  createBannerTitle: { fontSize: 14, fontWeight: '600', color: TEXT_PRIMARY },
  createBannerSub: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 2 },
  myBizBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 14, backgroundColor: '#F9F9F9', borderRadius: 14, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE },
  myBizLogo: { width: 42, height: 42, borderRadius: 12, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  myBizLogoTxt: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  myBizName: { fontSize: 15, fontWeight: '600', color: TEXT_PRIMARY },
  myBizSub: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 2 },
  secHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  secTitle: { fontSize: 16, fontWeight: '700', color: TEXT_PRIMARY },
  secLink: { fontSize: 13, color: NAVY, fontWeight: '600' },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 0 },
  catCell: { width: '25%', alignItems: 'center', paddingVertical: 8 },
  catIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 5 },
  catLabel: { fontSize: 11, fontWeight: '600', color: '#3C3C43', textAlign: 'center' },
  trendItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F5F5F5' },
  trendRank: { width: 22, fontSize: 14, fontWeight: '700', color: '#C7C7CC', textAlign: 'center' },
  trendLogo: { width: 42, height: 42, borderRadius: 12 },
  trendName: { fontSize: 15, fontWeight: '600', color: TEXT_PRIMARY },
  trendSub: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 2 },
  trendRatingNum: { fontSize: 14, fontWeight: '700', color: TEXT_PRIMARY },
  trendReviewCount: { fontSize: 11, color: TEXT_SECONDARY, marginTop: 1 },
  advCard: { marginHorizontal: 16, marginBottom: 10, padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: '#F0F0F0', backgroundColor: '#FFF' },
  advTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  advLogo: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  advBizName: { fontSize: 13, fontWeight: '600', color: TEXT_PRIMARY, flex: 1 },
  advLabel: { backgroundColor: '#F2F2F7', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  advLabelTxt: { fontSize: 10, fontWeight: '600', color: TEXT_SECONDARY },
  advTime: { fontSize: 11, color: '#C7C7CC' },
  advBody: { fontSize: 14, color: '#1A1A1A', lineHeight: 20, marginBottom: 8 },
  advLink: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F2F2F7', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8 },
  advLinkTxt: { fontSize: 13, color: NAVY, fontWeight: '500', flex: 1 },
  advCta: { alignSelf: 'flex-start', backgroundColor: NAVY, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  advCtaTxt: { fontSize: 13, fontWeight: '600', color: '#FFF' },
  emptySmall: { paddingHorizontal: 16, paddingVertical: 24, alignItems: 'center' },
  emptySmallTxt: { fontSize: 14, color: TEXT_SECONDARY },
  empty: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32, gap: 8 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: TEXT_PRIMARY },
  emptySub: { fontSize: 13, color: TEXT_SECONDARY, textAlign: 'center', lineHeight: 18 },
  emptyBtn: { marginTop: 14, backgroundColor: NAVY, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  emptyBtnTxt: { color: '#FFF', fontSize: 14, fontWeight: '700' },
});