import MarketOrderPanel from '../../components/market/MarketOrderPanel';
import { prefetch } from '../../lib/screenTransition';
import { ListRowSkeleton } from '../../components/skeletons';
import { themedSheet, useTheme } from '../../theme/useTheme';
import { TapTopFlatList } from '../../components/TapTopList';
import EmptyState from '../../components/EmptyState';
import VerifiedBadge from '../../components/VerifiedBadge';
import { useAuthStore } from '../../stores/authStore';
import MarketFilterSheet, { MarketFilters, EMPTY_FILTERS } from '../../components/market/MarketFilterSheet';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
import { navigationCache, navigationScope, subscribeNavigationScope } from '../../lib/navigationCache';
import { emptyMarketDirectory, marketDirectoryKey, MARKET_PAGE_SIZE, mergeMarketDirectory, mutateDirectory, readMarketDirectory } from '../../services/navigationDirectory';
import type { MarketDirectoryView, MarketSelection } from '../../services/navigationDirectory';
import { supabase } from '../../services/supabase';

const GUTTER = 12;
type MarketControls = { search: string; category: string | null; filters: MarketFilters; tab: MarketSelection['tab'] };

function priceLabel(item: Listing): string {
  const amount = Number(item.price);
  const formatted = Number.isInteger(amount) ? amount.toLocaleString() : amount.toFixed(2);
  return `${item.currency === 'USD' ? '$' : 'ZWG '}${formatted}`;
}

export default function MarketScreen({ navigation }: any) {
  const { t, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const cardWidth = (width - GUTTER * 3) / 2;
  const scope = useSyncExternalStore(subscribeNavigationScope, navigationScope, navigationScope);
  const controlsScope = useRef(scope), controlsOwner = controlsScope.current;
  const meProfile = useAuthStore(state => state.profile);
  const [initialControls] = useState(() => navigationCache.read<MarketControls>(scope, 'market:controls'));
  const [search, setSearch] = useState(initialControls?.search ?? '');
  const [query, setQuery] = useState(search.trim());
  const [category, setCategory] = useState<string | null>(initialControls?.category ?? null);
  const [filters, setFilters] = useState<MarketFilters>(initialControls?.filters ?? EMPTY_FILTERS);
  const [marketTab, setMarketTab] = useState<MarketSelection['tab']>(initialControls?.tab ?? 'browse');
  const selection = useMemo<MarketSelection>(() => ({ tab: marketTab, search: query, category, filters, homeCity: meProfile?.location || null }), [marketTab, query, category, filters, meProfile?.location]);
  const cacheKey = marketDirectoryKey(selection);
  const saveContext = useMemo(() => ({ scope, cacheKey }), [scope, cacheKey]);
  const saveContextRef = useRef(saveContext); saveContextRef.current = saveContext;
  const [view, setView] = useState(() => navigationCache.read<MarketDirectoryView>(scope, cacheKey) ?? emptyMarketDirectory());
  const viewRef = useRef(view);
  const listings = view.rows, savedIds = useMemo(() => new Set(view.savedIds), [view.savedIds]);
  const [loading, setLoading] = useState(!view.ready);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const marketUnread = useUnreadStore(st => st.counts.market);
  useFocusEffect(useCallback(() => { useUnreadStore.getState().refresh(); }, []));
  const [filterOpen, setFilterOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const activeRead = useRef<AbortController | null>(null);
  const pendingSaves = useRef(new Map<string, object>());
  const saveRevision = useRef(0);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageFailed, setPageFailed] = useState(false);
  const commit = useCallback((next: MarketDirectoryView) => {
    if (saveContextRef.current !== saveContext || navigationScope() !== scope) return;
    viewRef.current = next; setView(next);
    if (next.ready) navigationCache.save(scope, cacheKey, next);
  }, [scope, cacheKey, saveContext]);

  // Only typing is debounced. A tab return or filter choice starts immediately.
  useEffect(() => {
    if (query === search.trim()) return;
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search, query]);
  useEffect(() => { if (controlsOwner === scope) navigationCache.save(scope, 'market:controls', { search, category, filters, tab: marketTab }); }, [scope, controlsOwner, search, category, filters, marketTab]);
  useLayoutEffect(() => {
    if (controlsScope.current !== scope) {
      controlsScope.current = scope;
      setSearch(''); setQuery(''); setCategory(null); setFilters(EMPTY_FILTERS); setMarketTab('browse'); setFilterOpen(false); setOrdersOpen(false);
    }
    activeRead.current?.abort(); activeRead.current = null;
    const cached = navigationCache.read<MarketDirectoryView>(scope, cacheKey) ?? emptyMarketDirectory();
    viewRef.current = cached; setView(cached); setLoading(!cached.ready);
    setLoadFailed(false); setPageFailed(false); setLoadingMore(false); setRefreshing(false); setSavingIds(new Set(pendingSaves.current.keys()));
  }, [scope, cacheKey]);
  useEffect(() => {
    const contextRef = saveContextRef, work = activeRead;
    return () => { contextRef.current = { scope: null, cacheKey: '' }; work.current?.abort(); };
  }, []);

  const load = useCallback(async (opts?: { append?: boolean; reset?: boolean }) => {
    if (!scope || controlsOwner !== scope || saveContextRef.current !== saveContext || navigationScope() !== scope) return;
    const append = opts?.append === true;
    const previous = viewRef.current;
    if (append && (activeRead.current || !previous.hasMore || marketTab !== 'browse')) return;
    activeRead.current?.abort();
    const controller = new AbortController(); activeRead.current = controller;
    const current = () => activeRead.current === controller && !controller.signal.aborted && saveContextRef.current === saveContext && navigationScope() === scope;
    const offset = append ? previous.offset : 0, savedVersion = saveRevision.current;
    const preserve = !append && !opts?.reset && marketTab === 'browse' && previous.ready && (previous.top > 0 || previous.offset > MARKET_PAGE_SIZE);
    setPageFailed(false);
    if (append) setLoadingMore(true); else { setLoadingMore(false); setLoading(!previous.ready); setLoadFailed(false); }
    try {
      const result = await readMarketDirectory(scope, selection, offset, preserve ? previous.rows.map(row => row.id) : [], !append, controller.signal);
      if (!current()) return;
      if (savedVersion !== saveRevision.current) result.savedIds = null;
      const next = mergeMarketDirectory(viewRef.current, result, append, preserve);
      if (savedVersion !== saveRevision.current && marketTab === 'saved') next.rows = next.rows.filter(row => next.savedIds.includes(row.id));
      commit(next);
    } catch {
      if (current()) { if (append) setPageFailed(true); else setLoadFailed(true); }
    } finally {
      if (current()) {
        activeRead.current = null;
        setLoading(false); setRefreshing(false); setLoadingMore(false);
      }
    }
  }, [scope, controlsOwner, saveContext, marketTab, selection, commit]);

  useFocusEffect(useCallback(() => {
    const work = activeRead;
    void load();
    return () => { work.current?.abort(); work.current = null; };
  }, [load]));

  const onRefresh = () => { setRefreshing(true); void load({ reset: true }); };
  const categories = useMemo(() => ['All', ...MARKET_CATEGORIES], []);
  const toggleSave = useCallback(async (id: string) => {
    if (saveContextRef.current !== saveContext || navigationScope() !== scope || pendingSaves.current.has(id)) return;
    const operation = {};
    pendingSaves.current.set(id, operation);
    const next = !viewRef.current.savedIds.includes(id);
    saveRevision.current++; setSavingIds(ids => new Set(ids).add(id));
    try {
      await mutateDirectory(scope, (pin, ownerId) => pin(next
        ? supabase.from('saved_listings').upsert({ user_id: ownerId, listing_id: id })
        : supabase.from('saved_listings').delete().eq('user_id', ownerId).eq('listing_id', id)));
      if (saveContextRef.current !== saveContext || navigationScope() !== scope) return;
      const latest = viewRef.current, ids = new Set(latest.savedIds);
      if (next) ids.add(id); else ids.delete(id);
      commit({ ...latest, savedIds: [...ids], rows: !next && marketTab === 'saved' ? latest.rows.filter(row => row.id !== id) : latest.rows });
    } catch {
      if (saveContextRef.current === saveContext && navigationScope() === scope) Alert.alert('Could not confirm saved listing', 'Refresh your saved listings before retrying.');
    } finally {
      saveRevision.current++;
      if (pendingSaves.current.get(id) === operation) pendingSaves.current.delete(id);
      if (saveContextRef.current.scope === scope && navigationScope() === scope) setSavingIds(ids => { const remaining = new Set(ids); remaining.delete(id); return remaining; });
    }
  }, [scope, saveContext, marketTab, commit]);

  const renderItem = ({ item }: { item: Listing }) => (
    <TouchableOpacity
      accessibilityRole="button" accessibilityLabel={`View listing: ${item.title}`}
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
        accessibilityRole="button" accessibilityLabel={savedIds.has(item.id) ? "Unsave listing" : "Save listing"} accessibilityState={{ selected: savedIds.has(item.id), busy: savingIds.has(item.id), disabled: savingIds.has(item.id) }} disabled={savingIds.has(item.id)} onPress={() => toggleSave(item.id)} activeOpacity={0.8} hitSlop={{ top: 9, bottom: 9, left: 9, right: 9 }}
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
            accessibilityRole="tab" accessibilityState={{ selected: marketTab === tab }}
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
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Market filters" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginHorizontal: 14, marginBottom: 8, backgroundColor: t.surface.sunken, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 }} onPress={() => setFilterOpen(true)} activeOpacity={0.75}>
        <Feather name="sliders" size={13} color={t.ink.primary} />
        <Text style={{ fontSize: 13.5, fontWeight: '700', color: t.ink.primary }}>Filters</Text>
      </TouchableOpacity>

      <MarketFilterSheet visible={filterOpen} onClose={() => setFilterOpen(false)} value={filters} onApply={setFilters} />

      <View style={s.searchWrap}>
        <Feather name="search" size={16} color={t.ink.muted} style={{ marginRight: 8 }} />
        <TextInput
          style={s.searchInput}
          accessibilityLabel="Search the market" maxLength={100}
          value={search}
          onChangeText={setSearch}
          placeholder="Search the market"
          placeholderTextColor={t.ink.muted}
          returnKeyType="search"
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear market search" onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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
          key={cacheKey}
          data={listings}
          extraData={{ isDark, savedIds, savingIds }}
          contentOffset={{ x: 0, y: view.top }}
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
          onScroll={(event: any) => {
            handleTabBarScroll(event);
            const top = event.nativeEvent.contentOffset.y;
            if (saveContextRef.current !== saveContext || navigationScope() !== scope || !Number.isFinite(top) || top < 0 || !viewRef.current.ready) return;
            viewRef.current = { ...viewRef.current, top };
            navigationCache.save(scope, cacheKey, viewRef.current);
          }}
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
