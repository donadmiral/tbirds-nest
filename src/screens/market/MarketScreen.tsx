import MarketFilterSheet, { MarketFilters, EMPTY_FILTERS } from '../../components/market/MarketFilterSheet';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Dimensions, FlatList, RefreshControl, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
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
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [filters, setFilters] = useState<MarketFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const searchTimer = useRef<any>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const rows = await marketService.listListings({ search, category,
      minPrice: filters.minPrice ? Number(filters.minPrice) : null,
      maxPrice: filters.maxPrice ? Number(filters.maxPrice) : null,
      condition: filters.condition, city: filters.city || null, sort: filters.sort });
    setListings(rows);
    setLoading(false);
    setRefreshing(false);
  }, [search, category, filters]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { load(); }, 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search, category, filters, load]);

  useFocusEffect(useCallback(() => { load({ silent: true }); }, [load]));

  const onRefresh = () => { setRefreshing(true); load({ silent: true }); };

  const categories = useMemo(() => ['All', ...MARKET_CATEGORIES], []);

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
      <View style={s.cardBody}>
        <Text style={s.cardPrice}>{priceLabel(item)}</Text>
        <Text style={s.cardTitle} numberOfLines={1}>{item.title}</Text>
        <View style={s.cardMetaRow}>
          {item.seller?.is_verified && (
            <Ionicons name="checkmark-circle" size={13} color={PLATINUM} style={{ marginRight: 3 }} />
          )}
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
        <TouchableOpacity
          style={s.headerBtn}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('CreateListing')}
        >
          <Feather name="plus" size={20} color={BG} />
        </TouchableOpacity>
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
        <FlatList
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
        <FlatList
          data={listings}
          keyExtractor={(l) => l.id}
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
  searchInput: { flex: 1, fontSize: 15, color: GRAY_900, paddingVertical: 0 },
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