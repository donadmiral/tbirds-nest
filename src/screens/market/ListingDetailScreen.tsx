import { takePrefetched } from '../../lib/screenTransition';
import { useAfterTransition } from '../../lib/screenTransition';
import { ListingSkeleton } from '../../components/skeletons';
import { themedSheet, getTheme, useTheme } from '../../theme/useTheme';
import TierName from '../../components/TierName';
import VerifiedBadge from '../../components/VerifiedBadge';
import SellerTrust from '../../components/market/SellerTrust';
import ReportListingSheet from '../../components/market/ReportListingSheet';
import { useSafeAreaInsets } from '../../components/SafeArea';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import MarketOrderPanel from '../../components/market/MarketOrderPanel';
import SellerReviews from '../../components/market/SellerReviews';
import React, { useCallback, useState, useEffect, useRef } from 'react';
import {
  ActivityIndicator, Alert, Dimensions, ScrollView, StyleSheet,
  Text, TouchableOpacity, View, Modal, TextInput , KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { Share } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';

import { marketService, Listing } from '../../services/marketService';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../services/supabase';
import Avatar from '../../components/common/Avatar';

const NAVY = '#0B1E3D';
const BG = '#FFFFFF';
const GRAY_100 = '#F3F4F6';
const GRAY_400 = '#9CA3AF';
const GRAY_500 = '#6B7280';
const GRAY_900 = '#111827';
const PLATINUM = '#8E9BAE';
const RED = '#DC2626';

const { width: SCREEN_W } = Dimensions.get('window');

function priceLabel(item: Listing): string {
  const amount = Number(item.price);
  const formatted = Number.isInteger(amount) ? amount.toLocaleString() : amount.toFixed(2);
  return `${item.currency === 'USD' ? '$' : 'ZWG '}${formatted}`;
}

export default function ListingDetailScreen({ navigation, route }: any) {
  useTheme();
  const listingId: string = route.params?.listingId;
  const { profile } = useAuthStore();
  const userId: string | undefined = profile?.id;

  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const afterSlide = useAfterTransition();
  const [imgIndex, setImgIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    setLoading(true); setLoadError(false);
    (async () => {
      try {
        const row = await (takePrefetched<any>('listing:' + listingId) ?? marketService.getListing(listingId));
        if (!cancelled) setListing(row);
      } catch { if (!cancelled) setLoadError(true); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [listingId, retry]));

  const insets = useSafeAreaInsets();
  const [reportOpen, setReportOpen] = useState(false);
  const [savedListing, setSavedListing] = useState(false);

  useEffect(() => {
    let off = false;
    (async () => {
      if (!listing?.id) return;
      try {
        const ids = await marketService.getSavedIds();
        if (!off) setSavedListing(ids.has(listing.id));
      } catch (e) { console.log('[savedIds]', e); }
    })();
    return () => { off = true; };
  }, [listing?.id]);

  const toggleSaved = useCallback(async () => {
    if (!listing?.id || saving.current) return;
    saving.current = true;
    const next = !savedListing;
    setSavedListing(next);
    try { await marketService.toggleSaved(listing.id, next); }
    catch (e: any) { setSavedListing(!next); Alert.alert('Could not save', e?.message || 'Try again.'); }
    finally { saving.current = false; }
  }, [listing?.id, savedListing]);

  const blockSeller = () => {
    if (!listing || !userId) return;
    Alert.alert(
      'Block this seller?',
      'You will not see their listings and they will not see yours. You can undo this in settings.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Block', style: 'destructive', onPress: async () => {
          const { error } = await supabase.from('blocked_users').upsert({ blocker_id: userId, blocked_id: listing.seller_id });
          if (error) { Alert.alert('Could not block', error.message); return; }
          navigation.goBack();
        } },
      ]
    );
  };
  const isOwner = !!listing && !!userId && listing.seller_id === userId;

  const [offerOpen, setOfferOpen] = useState(false);
  const [offerAmt, setOfferAmt] = useState('');
  const [offerBusy, setOfferBusy] = useState(false);
  const submitOffer = async () => {
    const amt = Number(offerAmt.replace(/,/g, ''));
    if (!listing || !Number.isFinite(amt) || amt <= 0) { Alert.alert('Enter a valid amount'); return; }
    setOfferBusy(true);
    try {
      const { error } = await supabase.rpc('make_offer', { p_listing_id: listing.id, p_amount: amt });
      if (error) throw error;
      setOfferOpen(false); setOfferAmt('');
      messageSeller(); // land in the thread where the offer now lives
    } catch (e: any) {
      Alert.alert('Offer not sent', e?.message || 'Try again.');
    } finally { setOfferBusy(false); }
  };

  const messageSeller = async () => {
    if (!listing || !userId || isOwner) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('start_dm_ctx', { p_receiver_id: listing.seller_id, p_context: 'market', p_ref_id: listing.id });
      if (error || !data) throw error || new Error('Could not start conversation');
      navigation.navigate('Chat', {
        conversationId: data as string,
        userId: listing.seller_id,
        userName: listing.seller?.full_name || 'Seller',
        otherUser: {
          id: listing.seller_id,
          full_name: listing.seller?.full_name || 'Seller',
          username: listing.seller?.username || null,
          avatar_url: listing.seller?.avatar_url || null,
        },
      });
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not open conversation');
    } finally {
      setBusy(false);
    }
  };

  const markSold = () => {
    if (!listing) return;
    Alert.alert('Mark as sold', 'Buyers will no longer see this listing.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark sold', style: 'destructive',
        onPress: async () => {
          try {
            await marketService.setStatus(listing.id, 'sold');
            setListing({ ...listing, status: 'sold' });
          } catch (e: any) {
            Alert.alert('Error', e?.message || 'Could not update listing');
          }
        },
      },
    ]);
  };

  if (loadError && !loading) return <SafeAreaView style={s.safe}><View style={s.center}><Text>Could not load listing.</Text><TouchableOpacity onPress={() => setRetry(n => n + 1)}><Text>Try again</Text></TouchableOpacity></View></SafeAreaView>;

  if (loading || !afterSlide) {
    return <SafeAreaView style={s.safe} edges={['top']}><ListingSkeleton /></SafeAreaView>;
  }
  if (!listing) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={22} color={getTheme().ink.primary} />
        </TouchableOpacity>
        <View style={s.center}><Text style={s.emptyTxt}>Listing not found.</Text></View>
      </SafeAreaView>
    );
  }

  const images = listing.images?.length ? listing.images : [null];

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView automaticallyAdjustKeyboardInsets={true} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 100 }} keyboardShouldPersistTaps="handled">
        <View>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setImgIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W))}
          >
            {images.map((uri, i) => (
              uri ? (
                <ExpoImage key={i} source={{ uri }} style={s.heroImg} contentFit="cover" cachePolicy="memory-disk" />
              ) : (
                <View key={i} style={[s.heroImg, s.heroEmpty]}>
                  <Feather name="image" size={40} color={getTheme().ink.secondary} />
                </View>
              )
            ))}
          </ScrollView>
          <TouchableOpacity style={s.backBtnFloat} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={21} color={getTheme().ink.primary} />
          </TouchableOpacity>
          <View style={{ position: 'absolute', top: 12, right: 12, flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={savedListing ? 'Unsave listing' : 'Save listing'} hitSlop={6} onPress={toggleSaved} activeOpacity={0.8}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: getTheme().surface.raised, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 3 }}>
              <Ionicons name={savedListing ? 'heart' : 'heart-outline'} size={19} color={savedListing ? getTheme().status.danger : getTheme().ink.primary} />
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Share listing" hitSlop={6} activeOpacity={0.8}
              onPress={() => listing && Share.share({ message: listing.title + ' · ' + priceLabel(listing) + ' on Platinum Circles' })}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: getTheme().surface.raised, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 3 }}>
              <Ionicons name="share-outline" size={18} color={getTheme().ink.primary} />
            </TouchableOpacity>
          </View>
          {images.length > 1 && (
            <View style={{ position: 'absolute', bottom: 14, right: 12, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(11,30,61,0.7)' }}>
              <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#FFFFFF' }}>{imgIndex + 1}/{images.length}</Text>
            </View>
          )}
          {images.length > 1 && (
            <View style={s.dots}>
              {images.map((_, i) => (
                <View key={i} style={[s.dot, i === imgIndex && s.dotActive]} />
              ))}
            </View>
          )}
          {listing.status === 'sold' && (
            <View style={s.soldBanner}><Text style={s.soldTxt}>SOLD</Text></View>
          )}
        </View>

        <View style={s.body}>
          <Text style={s.price}>{priceLabel(listing)}</Text>
          <Text style={s.title}>{listing.title}</Text>
          <Text style={s.meta}>
            {[listing.category, listing.condition, listing.location_city].filter(Boolean).join(' · ')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10, padding: 11, borderRadius: 12, backgroundColor: (listing as any).delivery_available ? 'rgba(5,150,105,0.08)' : 'rgba(11,30,61,0.04)' }}>
            <Ionicons name={(listing as any).delivery_available ? 'bicycle' : 'location'} size={17} color={(listing as any).delivery_available ? getTheme().status.success : getTheme().ink.primary} />
            <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: getTheme().ink.primary }}>
              {(listing as any).delivery_available
                ? 'Delivery available' + ((listing as any).delivery_fee ? ' · ' + listing.currency + ' ' + (listing as any).delivery_fee : ' · free') + ((listing as any).delivery_note ? '. ' + (listing as any).delivery_note : '')
                : 'Collection · meet the seller'}
            </Text>
          </View>

          {listing.description ? <Text style={s.desc}>{listing.description}</Text> : null}

          <TouchableOpacity
            style={s.sellerRow}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('UserProfile', { userId: listing.seller_id })}
          >
            <Avatar name={listing.seller?.full_name || 'Seller'} url={listing.seller?.avatar_url} size={44} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TierName userId={(listing as any).seller?.id ?? (listing as any).seller_id} baseStyle={s.sellerName} text={listing.seller?.full_name || 'Seller'} />
                <VerifiedBadge userId={(listing as any).seller?.id ?? (listing as any).seller_id} size={15} />
              </View>
              {listing.seller?.username ? <Text style={s.sellerHandle}>@{listing.seller.username}</Text> : null}
              <SellerTrust sellerId={listing.seller_id} />
            </View>
            <Feather name="chevron-right" size={18} color="#C7C7CC" />
          </TouchableOpacity>
        </View>

        {!!listing && <MarketOrderPanel listing={listing} onMessage={order => navigation.navigate('Chat', { conversationId: order.conversation_id, otherUserId: order.buyer_id === userId ? order.seller_id : order.buyer_id })} />}

        {!!listing && <SellerReviews sellerId={listing.seller_id} listingId={listing.id} currentUserId={userId} />}

        {!!listing && !isOwner && (<>
          <TouchableOpacity style={{ alignSelf: 'center', marginTop: 22, marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 6 }} onPress={() => setReportOpen(true)} activeOpacity={0.7}>
            <Feather name="flag" size={13} color={getTheme().ink.secondary} />
            <Text style={{ fontSize: 13.5, color: getTheme().ink.secondary, fontWeight: '600' }}>Report listing</Text>
          </TouchableOpacity>

          <TouchableOpacity style={{ alignSelf: 'center', marginTop: 10, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }} onPress={blockSeller} activeOpacity={0.7}>
            <Feather name="slash" size={13} color={getTheme().ink.secondary} />
            <Text style={{ fontSize: 13.5, color: getTheme().ink.secondary, fontWeight: '600' }}>Block seller</Text>
          </TouchableOpacity>
          </>
        )}

        {!!listing && (
          <ReportListingSheet visible={reportOpen} onClose={() => setReportOpen(false)} listingId={listing.id} reporterId={userId} />
        )}

      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
          {/* saveInFooter */}
          {!!listing && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={savedListing ? 'Unsave listing' : 'Save listing'}
              onPress={toggleSaved}
              activeOpacity={0.8}
              style={{ width: 50, height: 50, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', borderColor: savedListing ? getTheme().ink.primary : getTheme().surface.hairline, backgroundColor: savedListing ? getTheme().brand.tintBg : getTheme().surface.canvas }}
            >
              <Feather name="bookmark" size={19} color={savedListing ? getTheme().ink.primary : getTheme().ink.secondary} />
            </TouchableOpacity>
          )}
        {isOwner ? (
          listing.status === 'available' ? (
            <TouchableOpacity style={[s.cta, { backgroundColor: RED }]} onPress={markSold} activeOpacity={0.85}>
              <Text style={s.ctaTxt}>Mark as sold</Text>
            </TouchableOpacity>
          ) : (
            <View style={[s.cta, { backgroundColor: getTheme().surface.raised }]}>
              <Text style={[s.ctaTxt, { color: getTheme().ink.secondary }]}>This listing is sold</Text>
            </View>
          )
        ) : (
          <View style={{ flexDirection: 'row', gap: 10, flex: 1 }}>
            <TouchableOpacity
              style={[s.cta, { flex: 1 }, busy && { opacity: 0.6 }]}
              onPress={messageSeller}
              disabled={busy || listing.status !== 'available'}
              activeOpacity={0.85}
            >
              {busy
                ? <ActivityIndicator color={getTheme().ink.inverse} size={16} />
                : <Text style={s.ctaTxt}>{listing.status === 'available' ? 'Message seller' : 'No longer available'}</Text>}
            </TouchableOpacity>
            {listing.status === 'available' && (
              <TouchableOpacity
                style={[s.cta, { flex: 1, backgroundColor: getTheme().surface.canvas, borderWidth: 1.5, borderColor: getTheme().ink.primary }]}
                onPress={() => { setOfferAmt(''); setOfferOpen(true); }}
                activeOpacity={0.85}
              >
                <Text style={[s.ctaTxt, { color: getTheme().ink.primary }]}>Make offer</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
      <Modal visible={offerOpen} transparent animationType="slide" onRequestClose={() => setOfferOpen(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(11,30,61,0.45)' }} activeOpacity={1} onPress={() => setOfferOpen(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={{ backgroundColor: getTheme().surface.canvas, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 40 }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: getTheme().ink.primary }}>Make an offer</Text>
          <Text style={{ fontSize: 13, color: getTheme().ink.secondary, marginTop: 3 }}>Asking {listing ? listing.currency + ' ' + listing.price : ''}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            {[0.9, 0.8, 0.7].map(f => {
              const v = listing ? Math.round(Number(listing.price) * f) : 0;
              return (
                <TouchableOpacity key={f} onPress={() => setOfferAmt(String(v))}
                  style={{ flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: getTheme().brand.tintBg, alignItems: 'center' }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '700', color: getTheme().ink.primary }}>{listing?.currency} {v}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TextInput value={offerAmt} onChangeText={setOfferAmt} keyboardType="numeric" placeholder="Your amount"
            placeholderTextColor={getTheme().ink.secondary}
            style={{ marginTop: 12, borderWidth: 1.5, borderColor: getTheme().surface.hairline, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, fontWeight: '700', color: getTheme().ink.primary }} />
          <TouchableOpacity onPress={submitOffer} disabled={offerBusy}
            style={{ marginTop: 12, backgroundColor: getTheme().brand.base, borderRadius: 14, paddingVertical: 14, alignItems: 'center', opacity: offerBusy ? 0.6 : 1 }}>
            {offerBusy ? <ActivityIndicator color={getTheme().ink.inverse} size={16} /> : <Text style={{ color: getTheme().ink.inverse, fontSize: 15.5, fontWeight: '800' }}>Send offer</Text>}
          </TouchableOpacity>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface.canvas },
  backBtn: { padding: 16 },
  backBtnFloat: {
    position: 'absolute', top: 12, left: 12, width: 36, height: 36, borderRadius: 18,
    backgroundColor: t.surface.canvas, alignItems: 'center', justifyContent: 'center',
  },
  heroImg: { width: SCREEN_W, height: SCREEN_W, backgroundColor: t.surface.raised },
  heroEmpty: { alignItems: 'center', justifyContent: 'center' },
  dots: {
    position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', gap: 5,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotActive: { backgroundColor: '#FFFFFF' },
  soldBanner: {
    position: 'absolute', top: 12, right: 12, backgroundColor: RED,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
  },
  soldTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: 12, letterSpacing: 1 },
  body: { padding: 16 },
  price: { fontSize: 24, fontWeight: '800', color: t.ink.primary },
  title: { fontSize: 17, color: t.ink.primary, marginTop: 2 },
  meta: { fontSize: 13, color: t.ink.secondary, marginTop: 4 },
  desc: { fontSize: 15, color: t.ink.primary, lineHeight: 22, marginTop: 14 },
  sellerRow: {
    flexDirection: 'row', alignItems: 'center', marginTop: 20,
    paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.surface.hairline,
  },
  sellerName: { fontSize: 15, fontWeight: '700', color: t.ink.primary },
  sellerHandle: { fontSize: 13, color: t.ink.secondary },
  footer: {
    paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.surface.hairline, backgroundColor: t.surface.canvas,
  },
  cta: {
    flex: 1, height: 50, borderRadius: 14, backgroundColor: t.brand.base,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaTxt: { color: t.ink.inverse, fontSize: 16, fontWeight: '700' },
  emptyTxt: { fontSize: 14, color: t.ink.secondary },
}));
