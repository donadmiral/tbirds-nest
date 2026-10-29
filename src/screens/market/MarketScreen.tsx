import MarketOrderPanel from '../../components/market/MarketOrderPanel';
import { prefetch } from '../../lib/screenTransition';
import { ListRowSkeleton } from '../../components/skeletons';
import { themedSheet, useTheme } from '../../theme/useTheme';
import { TapTopFlatList } from '../../components/TapTopList';
import EmptyState from '../../components/EmptyState';
import VerifiedBadge from '../../components/VerifiedBadge';
import { useAuthStore } from '../../stores/authStore';
import MarketFilterSheet, { MarketFilters, EMPTY_FILTERS } from '../../components/market/MarketFilterSheet';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, useWindowDimensions, FlatList, RefreshControl, StyleSheet,
  Text, TextInput, TouchableOpacity, View, Alert, Modal, ScrollView,
} from 'react-native';
import { SafeAreaView } from '../../components/SafeArea';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { useUnreadStore } from '../../stores/unreadStore';
import { Feather, Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import { handleTabBarScroll } from '../../components/AdaptiveTabBar';

import { marketService, Listing, MARKET_CATEGORIES } from '../../services/marketService';

const GUTTER = 12;
const PAGE_SIZE = 30;

function priceLabel(item: Listing): string {
  const amount = Number(item.price);
  const formatted = Number.isInteger(amount) ? amount.toLocaleString() : amount.toFixed(2);
  return `${item.currency === 'USD' ? '$' : 'ZWG '}${formatted}`;
}

export default function MarketScreen({ navigation }: any) {
  const { t, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const cardWidth = (width - GUTTER * 3) / 2;
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
  const [ordersOpen, setOrdersOpen] = useState(false);
  const request = useRef(0);
  const saveContext = useMemo(() => ({}), [marketTab, meProfile?.id]);
  const saveContextRef = useRef(saveContext);
  saveContextRef.current = saveContext;
  useEffect(() => {
    saveContextRef.current = saveContext;
    return () => { saveContextRef.current = {}; };
  }, [saveContext]);
  const pendingSaves = useRef(new Map<string, { context: object }>());
  const page = useRef({ offset: 0, hasMore: false, busy: false });
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageFailed, setPageFailed] = useState(false);

  const load = useCallback(async (opts?: { silent?: boolean; append?: boolean }) => {
    const append = opts?.append === true;
    if (append && (page.current.busy || !page.current.hasMore || marketTab !== 'browse')) return;
    const token = ++request.current;
    const offset = append ? page.current.offset : 0;
    page.current.busy = true;
    setPageFailed(false);
    if (append) setLoadingMore(true);
    else {
      setLoadingMore(false);
      if (!opts?.silent) setLoading(true);
      setLoadFailed(false);
    }
    try {
      let rows: Listing[];
      if (marketTab === 'saved') {
        rows = await marketService.getSavedListings();
      } else if (marketTab === 'selling') {
        rows = meProfile?.id ? await marketService.myListings(meProfile.id) : [];
      } else {
        const noExplicitFilters = !filters.minPrice && !filters.maxPrice && !filters.condition && !filters.city && (!filters.sort || filters.sort === 'recent');
        rows = noExplicitFilters
          ? await marketService.getMarketFeed({ search, category, city: (meProfile as any)?.location || null, limit: PAGE_SIZE + 1, offset })
          : await marketService.listListings({ search, category, limit: PAGE_SIZE + 1, offset,
              minPrice: filters.minPrice ? Number(filters.minPrice) : null,
              maxPrice: filters.maxPrice ? Number(filters.maxPrice) : null,
              condition: filters.condition, city: filters.city || null, sort: filters.sort });
      }
      const ids = append ? null : await marketService.getSavedIds();
      if (token !== request.current) return;
      const batch = marketTab === 'browse' ? rows.slice(0, PAGE_SIZE) : rows;
      page.current = { offset: offset + batch.length, hasMore: marketTab === 'browse' && rows.length > PAGE_SIZE, busy: false };
      setListings(previous => append ? [...new Map([...previous, ...batch].map(row => [row.id, row])).values()] : batch);
      if (ids) setSavedIds(new Set(ids));
    } catch {
      if (token === request.current) append ? setPageFailed(true) : setLoadFailed(true);
    } finally {
      if (token === request.current) {
        page.current.busy = false;
        setLoading(false); setRefreshing(false); setLoadingMore(false);
      }
    }
  }, [search, category, filters, marketTab, meProfile?.id, meProfile?.location]);

  // One debounced request per focused query. Invalidate older results on filter changes or blur.
  useFocusEffect(useCallback(() => {
    page.current = { offset: 0, hasMore: false, busy: true };
    setLoading(true);
    const timer = setTimeout(() => { void load(); }, 350);
    return () => { clearTimeout(timer); request.current += 1; page.current.hasMore = false; page.current.busy = true; };
  }, [load]));

  const onRefresh = () => { setRefreshing(true); load({ silent: true }); };

  const categories = useMemo(() => ['All', ...MARKET_CATEGORIES], []);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const toggleSave = useCallback(async (id: string) => {
    if (pendingSaves.current.get(id)?.context === saveContext) return;
    const operation = { context: saveContext };
    pendingSaves.current.set(id, operation);
    const wasSaved = savedIds.has(id);
    const next = !wasSaved;
    setSavedIds(prev => { const n = new Set(prev); next ? n.add(id) : n.delete(id); return n; });
    try {
      await marketService.toggleSaved(id, next);
      if (saveContextRef.current !== saveContext) return;
      if (!next && marketTab === 'saved') setListings(rows => rows.filter(row => row.id !== id));
    } catch {
      if (saveContextRef.current !== saveContext) return;
      setSavedIds(prev => { const n = new Set(prev); wasSaved ? n.add(id) : n.delete(id); return n; });
      Alert.alert('Could not save listing', 'Please try again.');
    } finally { if (pendingSaves.current.get(id) === operation) pendingSaves.current.delete(id); }
  }, [savedIds, marketTab, saveContext]);

  const renderItem = ({ item }: { item: Listing }) => (
    <TouchableOpacity
      style={[s.card, { width: cardWidth }]}
      activeOpacity={0.85}
      onPress={() => { prefetch('listing:' + item.id, () => marketService.getListing(item.id)); navigation.navigate('ListingDetail', { listingId: item.id }); }}
    >
      {item.images?.[0] ? (
        <ExpoImage
          source={{ uri: item.images[0] }}
          style={[s.cardImg, { width: cardWidth, height: cardWidth * 1.15 }]}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={120}
        />
      ) : (
        <View style={[s.cardImg, s.cardImgEmpty, { width: cardWidth, height: cardWidth * 1.15 }]}>
          <Feather name="image" size={26} color={t.ink.muted} />
        </View>
      )}
      <TouchableOpacity
        accessibilityRole="button" accessibilityLabel={savedIds.has(item.id) ? "Unsave listing" : "Save listing"} accessibilityState={{ selected: savedIds.has(item.id) }} onPress={() => toggleSave(item.id)} activeOpacity={0.8} hitSlop={{ top: 9, bottom: 9, left: 9, right: 9 }}
        style={{ position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: t.surface.raised, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 }}>
        <Ionicons name={savedIds.has(item.id) ? 'heart' : 'heart-outline'} size={17} color={savedIds.has(item.id) ? t.status.danger : t.ink.primary} />
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
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Marketplace orders" onPress={() => setOrdersOpen(true)} style={{ padding: 12 }}><Feather name="package" size={21} color={t.ink.primary} /></TouchableOpacity>
        <TouchableOpacity
          style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('MarketInbox')}
          accessibilityRole="button"
          accessibilityLabel="Market messages"
        >
          <Feather name="message-circle" size={21} color={t.ink.primary} />
          {marketUnread > 0 ? (
            <View style={{ position: 'absolute', top: 4, right: 3, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 10, fontWeight: '800', color: '#FFFFFF' }}>{marketUnread > 99 ? '99+' : marketUnread}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button" accessibilityLabel="Create listing"
          style={s.headerBtn}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('CreateListing')}
        >
          <Feather name="plus" size={20} color={t.ink.inverse} />
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row', paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline, marginBottom: 10 }}>
        {(['browse', 'saved', 'selling'] as const).map(tab => (
          <TouchableOpacity
            key={tab}
            style={{ marginRight: 22, paddingVertical: 11, borderBottomWidth: 2, borderBottomColor: marketTab === tab ? t.ink.primary : 'transparent' }}
            onPress={() => setMarketTab(tab)}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 14.5, fontWeight: marketTab === tab ? '700' : '600', color: marketTab === tab ? t.ink.primary : t.ink.secondary }}>
              {tab === 'browse' ? 'Browse' : tab === 'saved' ? 'Saved' : 'Selling'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginHorizontal: 14, marginBottom: 8, backgroundColor: t.surface.sunken, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 }} onPress={() => setFilterOpen(true)} activeOpacity={0.75}>
        <Feather name="sliders" size={13} color={t.ink.primary} />
        <Text style={{ fontSize: 13.5, fontWeight: '700', color: t.ink.primary }}>Filters</Text>
      </TouchableOpacity>

      <MarketFilterSheet visible={filterOpen} onClose={() => setFilterOpen(false)} value={filters} onApply={setFilters} />

      <View style={s.searchWrap}>
        <Feather name="search" size={16} color={t.ink.muted} style={{ marginRight: 8 }} />
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search the market"
          placeholderTextColor={t.ink.muted}
          returnKeyType="search"
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={16} color={t.ink.muted} />
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
                accessibilityRole="button" accessibilityState={{ selected: active }}
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

      {loadFailed ? (
        <TouchableOpacity onPress={() => void load()} style={{ padding: 14 }} accessibilityRole="button">
          <Text style={s.emptyTxt}>Could not load listings. Tap to retry.</Text>
        </TouchableOpacity>
      ) : null}
      {loading ? (
        <ListRowSkeleton />
      ) : listings.length === 0 && !loadFailed ? (
        <View style={s.center}>
          <Feather name="shopping-bag" size={40} color={t.ink.muted} />
          <Text style={s.emptyTitle}>Nothing here yet</Text>
          <Text style={s.emptyTxt}>Be the first to list something for sale.</Text>
        </View>
      ) : (
        <TapTopFlatList ListEmptyComponent={loadFailed ? null : <EmptyState icon="shopping-bag" title="Nothing listed yet" line="New listings appear here as people post them." />} automaticallyAdjustKeyboardInsets={true}
          data={listings}
          extraData={isDark}
          onEndReached={() => { if (!pageFailed) void load({ append: true }); }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={t.ink.primary} style={{ padding: 20 }} /> : pageFailed ? (
            <TouchableOpacity accessibilityRole="button" onPress={() => void load({ append: true })} style={{ minHeight: 48, padding: 14 }}>
              <Text style={s.emptyTxt}>Could not load more listings. Tap to retry.</Text>
            </TouchableOpacity>
          ) : null}
          keyExtractor={(l: { id: string }) => l.id}
          numColumns={2}
          columnWrapperStyle={{ gap: GUTTER, paddingHorizontal: GUTTER }}
          contentContainerStyle={{ gap: GUTTER, paddingTop: 4, paddingBottom: TAB_BAR_CLEARANCE + 24 }}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.brand.base} />}
          onScroll={handleTabBarScroll}
          scrollEventThrottle={16}
        />
      )}
      <Modal visible={ordersOpen} animationType="slide" onRequestClose={() => setOrdersOpen(false)}>
        <SafeAreaView style={s.safe} edges={['top', 'bottom']}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Close orders" onPress={() => setOrdersOpen(false)} style={{ padding: 16 }}><Text style={{ color: t.ink.primary, fontWeight: '600' }}>Close orders</Text></TouchableOpacity>
          <ScrollView>{ordersOpen && <MarketOrderPanel onMessage={order => { setOrdersOpen(false); navigation.navigate('Chat', { conversationId: order.conversation_id, otherUserId: order.buyer_id === meProfile?.id ? order.seller_id : order.buyer_id }); }} />}</ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10,
  },
  headerTitle: { fontSize: 26, fontWeight: '800', color: t.ink.primary, letterSpacing: -0.5 },
  headerBtn: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: t.brand.base,
    alignItems: 'center', justifyContent: 'center',
  },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', marginHorizontal: 16,
    backgroundColor: t.surface.sunken, borderRadius: 12, paddingHorizontal: 12, minHeight: 48,
  },
  searchInput: { flex: 1, minWidth: 0, minHeight: 48, fontSize: 16, color: t.ink.primary, paddingVertical: 10, includeFontPadding: false, textAlignVertical: 'center' },
  chipRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  chip: {
    paddingHorizontal: 14, minHeight: 48, borderRadius: 24, backgroundColor: t.surface.sunken,
    alignItems: 'center', justifyContent: 'center',
  },
  chipActive: { backgroundColor: t.brand.base },
  chipTxt: { fontSize: 13.5, fontWeight: '600', color: t.ink.primary },
  chipTxtActive: { color: t.ink.inverse },
  card: {},
  cardImg: { borderRadius: 8, backgroundColor: t.surface.sunken },
  cardImgEmpty: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { paddingTop: 6, paddingHorizontal: 1 },
  cardPrice: { fontSize: 16, fontWeight: '700', color: t.ink.primary, letterSpacing: -0.3 },
  cardTitle: { fontSize: 13.5, color: t.ink.primary, marginTop: 2, letterSpacing: -0.1 },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  cardMeta: { fontSize: 12.5, color: t.ink.secondary, flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: t.ink.primary, marginTop: 12 },
  emptyTxt: { fontSize: 13, color: t.ink.secondary, marginTop: 4, textAlign: 'center' },
}));
