import { TapTopFlatList } from '../../components/TapTopList';
import EmptyState from '../../components/EmptyState';
import VerifiedBadge from '../../components/VerifiedBadge';
import { useAuthStore } from '../../stores/authStore';
import MarketFilterSheet, { MarketFilters, EMPTY_FILTERS } from '../../components/market/MarketFilterSheet';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Dimensions, FlatList, RefreshControl, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { useUnreadStore } from '../../stores/unreadStore';
import { Feather, Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import { handleTabBarScroll } from '../../components/AdaptiveTabBar';

import { marketService, Listing, MARKET_CATEGORIES } from '../../services/marketService';

const NAVY = '#0B1E3D';
const BG = '#FFFFFF';
const GRAY_100 = '#F3F4F6';
const GRAY_400 = '#9CA3AF';
const GRAY_500 = '#6B7280';
const GRAY_900 = '#111827';
const PLATINUM = '#8E9BAE';

const { width: SCREEN_W } = Dimensions.get('window');
const GUTTER = 12;
const CARD_W = (SCREEN_W - GUTTER * 3) / 2;

function priceLabel(item: Listing): string {
  const amount = Number(item.price);
  const formatted = Number.isInteger(amount) ? amount.toLocaleString() : amount.toFixed(2);
  return `${item.currency === 'USD' ? '$' : 'ZWG '}${formatted}`;
}

export default function MarketScreen({ navigation }: any) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [filters, setFilters] = useState<MarketFilters>(EMPTY_FILTERS);
  const [marketTab, setMarketTab] = useState<'browse' | 'saved' | 'selling'>('browse');
  const marketUnread = useUnreadStore(st => st.counts.market);
  useFocusEffect(React.useCallback(() => { useUnreadStore.getState().refresh(); }, []));
  const { profile: meProfile } = useAuthStore();
  const [filterOpen, setFilterOpen] = useState(false);
  const searchTimer = useRef<any>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setLoadFailed(false);
    try {
    if (marketTab === 'saved') {
      const saved = await marketService.getSavedListings();
      setListings(saved); setLoading(false); setRefreshing(false); return;
    }
    if (marketTab === 'selling') {
      const mine = meProfile?.id ? await marketService.myListings(meProfile.id) : [];
      setListings(mine); setLoading(false); setRefreshing(false); return;
    }
    const noExplicitFilters = !filters.minPrice && !filters.maxPrice && !filters.condition && !filters.city && (!filters.sort || filters.sort === 'recent');
    const rows = noExplicitFilters
      ? await marketService.getMarketFeed({
          search, category: category === 'All' ? null : category,
          city: (meProfile as any)?.location || null,
        })
      : await marketService.listListings({ search, category,
          minPrice: filters.minPrice ? Number(filters.minPrice) : null,
          maxPrice: filters.maxPrice ? Number(filters.maxPrice) : null,
          condition: filters.condition, city: filters.city || null, sort: filters.sort });
    setListings(rows);
    try { const ids = await marketService.getSavedIds(); setSavedIds(new Set(ids)); } catch {}
    } catch (e) { setLoadFailed(true); console.log('[market] load failed', (e as any)?.message); } finally { setLoading(false); setRefreshing(false); }
    setRefreshing(false);
  }, [search, category, filters, marketTab, meProfile?.id]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { load(); }, 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search, category, filters, load]);

  useFocusEffect(useCallback(() => { load({ silent: true }); }, [load]));

  const onRefresh = () => { setRefreshing(true); load({ silent: true }); };

  const categories = useMemo(() => ['All', ...MARKET_CATEGORIES], []);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const toggleSave = useCallback(async (id: string) => {
    const next = !savedIds.has(id);
    setSavedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    try { await marketService.toggleSaved(id, next); } catch {
      setSavedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    }
  }, [savedIds]);

  const renderItem = ({ item }: { item: Listing }) => (
    <TouchableOpacity
      style={s.card}
      activeOpacity={0.85}
      onPress={() => navigation.navigate('ListingDetail', { listingId: item.id })}
    >
      {item.images?.[0] ? (
        <ExpoImage
          source={{ uri: item.images[0] }}
          style={s.cardImg}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={120}
        />
      ) : (
        <View style={[s.cardImg, s.cardImgEmpty]}>
          <Feather name="image" size={26} color={GRAY_400} />
        </View>
      )}
      <TouchableOpacity
        onPress={() => toggleSave(item.id)} activeOpacity={0.8} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        style={{ position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 }}>
        <Ionicons name={savedIds.has(item.id) ? 'heart' : 'heart-outline'} size={17} color={savedIds.has(item.id) ? '#FF3040' : '#0B1E3D'} />
      </TouchableOpacity>
      {item.condition ? (
        <View style={{ position: 'absolute', top: 8, left: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(11,30,61,0.78)' }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#FFF' }}>{item.condition}</Text>
        </View>
      ) : null}
      {(item as any).delivery_available ? (
        <View style={{ position: 'absolute', bottom: 74, left: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(5,150,105,0.92)' }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#FFF' }}>🚚 Delivery</Text>
        </View>
      ) : null}
      {item.status === 'sold' ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(11,30,61,0.45)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: '#0B1E3D' }}>
            <Text style={{ fontSize: 13, fontWeight: '800', color: '#FFF', letterSpacing: 1 }}>SOLD</Text>
          </View>
        </View>
      ) : null}
      <View style={s.cardBody}>
        <Text style={s.cardPrice}>{priceLabel(item)}</Text>
        <Text style={s.cardTitle} numberOfLines={1}>{item.title}</Text>
        <View style={s.cardMetaRow}>
          <VerifiedBadge userId={(item as any).seller?.id ?? (item as any).seller_id} size={13} />
          <Text style={s.cardMeta} numberOfLines={1}>
            {item.location_city || 'Zimbabwe'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Market</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('MarketInbox')}
          accessibilityRole="button"
          accessibilityLabel="Market messages"
        >
          <Feather name="message-circle" size={21} color="#0B1E3D" />
          {marketUnread > 0 ? (
            <View style={{ position: 'absolute', top: 4, right: 3, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 10, fontWeight: '800', color: '#FFFFFF' }}>{marketUnread > 99 ? '99+' : marketUnread}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
        <TouchableOpacity
          style={s.headerBtn}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('CreateListing')}
        >
          <Feather name="plus" size={20} color={BG} />
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row', paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB', marginBottom: 10 }}>
        {(['browse', 'saved', 'selling'] as const).map(t => (
          <TouchableOpacity
            key={t}
            style={{ marginRight: 22, paddingVertical: 11, borderBottomWidth: 2, borderBottomColor: marketTab === t ? '#0B1E3D' : 'transparent' }}
            onPress={() => setMarketTab(t)}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 14.5, fontWeight: marketTab === t ? '700' : '600', color: marketTab === t ? '#0B1E3D' : '#6B7280' }}>
              {t === 'browse' ? 'Browse' : t === 'saved' ? 'Saved' : 'Selling'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginHorizontal: 14, marginBottom: 8, backgroundColor: '#F3F4F6', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 }} onPress={() => setFilterOpen(true)} activeOpacity={0.75}>
        <Feather name="sliders" size={13} color="#111827" />
        <Text style={{ fontSize: 13.5, fontWeight: '700', color: '#111827' }}>Filters</Text>
      </TouchableOpacity>

      <MarketFilterSheet visible={filterOpen} onClose={() => setFilterOpen(false)} value={filters} onApply={setFilters} />

      <View style={s.searchWrap}>
        <Feather name="search" size={16} color={GRAY_400} style={{ marginRight: 8 }} />
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search the market"
          placeholderTextColor={GRAY_400}
          returnKeyType="search"
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={16} color={GRAY_400} />
          </TouchableOpacity>
        )}
      </View>

      <View>
        <FlatList automaticallyAdjustKeyboardInsets={true}
          horizontal
          showsHorizontalScrollIndicator={false}
          data={categories}
          keyExtractor={(c) => c}
          contentContainerStyle={s.chipRow}
          renderItem={({ item: c }) => {
            const active = (c === 'All' && !category) || c === category;
            return (
              <TouchableOpacity
                style={[s.chip, active && s.chipActive]}
                activeOpacity={0.8}
                onPress={() => setCategory(c === 'All' ? null : c)}
              >
                <Text style={[s.chipTxt, active && s.chipTxtActive]}>{c}</Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={NAVY} size="large" /></View>
      ) : listings.length === 0 ? (
        <View style={s.center}>
          <Feather name="shopping-bag" size={40} color="#E5E5EA" />
          <Text style={s.emptyTitle}>Nothing here yet</Text>
          <Text style={s.emptyTxt}>Be the first to list something for sale.</Text>
        </View>
      ) : (
        <TapTopFlatList ListEmptyComponent={<EmptyState icon="shopping-bag" title="Nothing listed yet" line="New listings appear here as people post them." />} automaticallyAdjustKeyboardInsets={true}
          data={listings}
          keyExtractor={(l: { id: string }) => l.id}
          numColumns={2}
          columnWrapperStyle={{ gap: GUTTER, paddingHorizontal: GUTTER }}
          contentContainerStyle={{ gap: GUTTER, paddingTop: 4, paddingBottom: TAB_BAR_CLEARANCE + 24 }}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={NAVY} />}
          onScroll={handleTabBarScroll}
          scrollEventThrottle={16}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10,
  },
  headerTitle: { fontSize: 26, fontWeight: '800', color: GRAY_900, letterSpacing: -0.5 },
  headerBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: NAVY,
    alignItems: 'center', justifyContent: 'center',
  },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', marginHorizontal: 16,
    backgroundColor: GRAY_100, borderRadius: 12, paddingHorizontal: 12, height: 40,
  },
  searchInput: { flex: 1, height: 40, fontSize: 15, color: GRAY_900, paddingVertical: 0, includeFontPadding: false, textAlignVertical: 'center' },
  chipRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  chip: {
    paddingHorizontal: 14, height: 32, borderRadius: 16, backgroundColor: GRAY_100,
    alignItems: 'center', justifyContent: 'center',
  },
  chipActive: { backgroundColor: NAVY },
  chipTxt: { fontSize: 13.5, fontWeight: '600', color: GRAY_900 },
  chipTxtActive: { color: BG },
  card: { width: CARD_W },
  cardImg: { width: CARD_W, height: CARD_W * 1.15, borderRadius: 8, backgroundColor: GRAY_100 },
  cardImgEmpty: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { paddingTop: 6, paddingHorizontal: 1 },
  cardPrice: { fontSize: 16, fontWeight: '700', color: GRAY_900, letterSpacing: -0.3 },
  cardTitle: { fontSize: 13.5, color: GRAY_900, marginTop: 2, letterSpacing: -0.1 },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  cardMeta: { fontSize: 12.5, color: GRAY_500, flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: GRAY_900, marginTop: 12 },
  emptyTxt: { fontSize: 13, color: GRAY_500, marginTop: 4, textAlign: 'center' },
});