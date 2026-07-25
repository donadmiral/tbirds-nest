/**
 * BusinessProducts and BusinessReviews
 *
 * The two tabs a business profile has that a person's does not.
 *
 * Products is a catalogue view: every product card the business has ever posted,
 * gathered in one place instead of buried in whichever post carried it. That is
 * the thing X cannot do, because its cards only ever point off-platform.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image, Linking, Alert, TextInput,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../services/supabase';
import { light, typeSize, fontWeight, radius, space } from '../constants/tokens';

const HAIR = StyleSheet.hairlineWidth;

function money(price?: number | string | null, currency?: string | null) {
  if (price === null || price === undefined || price === '') return null;
  const n = typeof price === 'string' ? Number(price) : price;
  if (Number.isNaN(n)) return null;
  const body = n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
  return (currency || 'USD') === 'USD' ? `$${body}` : `ZWG ${body}`;
}

function initials(name?: string | null) {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

type Product = {
  product_id: string; post_id: string; title: string; subtitle: string | null;
  price: number | null; currency: string | null; image_url: string | null;
  listing_id: string | null; link_url: string | null; cta_label: string | null;
};

export function BusinessProducts({ businessId, navigation }: { businessId: string; navigation: any }) {
  const [rows, setRows] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase.rpc('get_business_products', { p_business_id: businessId });
    if (err) { setError(err.message); setLoading(false); return; }
    setRows((data ?? []) as Product[]);
    setLoading(false);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const open = (p: Product) => {
    if (p.listing_id) { navigation.navigate('Market', { screen: 'ListingDetail', params: { listingId: p.listing_id } }); return; }
    if (p.link_url) Linking.openURL(p.link_url).catch(() => {});
  };

  if (loading) return <View style={s.pad}><ActivityIndicator color={light.brand.base} /></View>;
  if (error) return (
    <View style={s.empty}>
      <Feather name="alert-circle" size={26} color={light.ink.faint} />
      <Text style={s.emptyTitle}>Could not load products</Text>
      <Text style={s.emptySub}>{error}</Text>
      <TouchableOpacity onPress={() => { setLoading(true); load(); }}><Text style={s.link}>Try again</Text></TouchableOpacity>
    </View>
  );
  if (rows.length === 0) return (
    <View style={s.empty}>
      <Feather name="package" size={26} color={light.ink.faint} />
      <Text style={s.emptyTitle}>No products yet</Text>
      <Text style={s.emptySub}>Products attached to this business's posts appear here.</Text>
    </View>
  );

  return (
    <View style={s.grid}>
      {rows.map(p => {
        const priceLabel = money(p.price, p.currency);
        return (
          <TouchableOpacity key={p.product_id} style={s.card} activeOpacity={0.85} onPress={() => open(p)}>
            {p.image_url ? (
              <Image source={{ uri: p.image_url }} style={s.thumb} resizeMode="cover" />
            ) : (
              <View style={[s.thumb, s.thumbEmpty]}><Feather name="package" size={22} color={light.ink.faint} /></View>
            )}
            <View style={s.cardBody}>
              <Text style={s.cardTitle} numberOfLines={2}>{p.title}</Text>
              <View style={s.cardFoot}>
                {priceLabel ? <Text style={s.price}>{priceLabel}</Text> : <View />}
                {!p.listing_id ? <Feather name="external-link" size={11} color={light.ink.faint} /> : null}
              </View>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

type Review = {
  review_id: string; rating: number; body: string | null; created_at: string;
  reviewer_id: string; reviewer_name: string | null; reviewer_username: string | null;
  reviewer_avatar: string | null; is_mine: boolean;
};

function Stars({ value, size = 13, onPick }: { value: number; size?: number; onPick?: (n: number) => void }) {
  return (
    <View style={s.stars}>
      {[1, 2, 3, 4, 5].map(n => (
        <TouchableOpacity key={n} disabled={!onPick} onPress={() => onPick?.(n)} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
          <Feather name="star" size={size} color={n <= value ? light.brand.warm : light.ink.faint} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function BusinessReviews({ businessId, canReview }: { businessId: string; canReview: boolean }) {
  const [rows, setRows] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase.rpc('get_business_reviews', { p_business_id: businessId });
    if (err) { setError(err.message); setLoading(false); return; }
    const list = (data ?? []) as Review[];
    setRows(list);
    const mine = list.find(r => r.is_mine);
    if (mine) { setRating(mine.rating); setBody(mine.body ?? ''); }
    setLoading(false);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (rating < 1) { Alert.alert('Pick a rating', 'Tap a star from one to five.'); return; }
    setSaving(true);
    const { error: err } = await supabase.rpc('set_business_review', {
      p_business_id: businessId, p_rating: rating, p_body: body || null,
    });
    setSaving(false);
    if (err) { Alert.alert('Could not save your review', err.message); return; }
    load();
  };

  if (loading) return <View style={s.pad}><ActivityIndicator color={light.brand.base} /></View>;

  return (
    <View style={s.pad}>
      {canReview ? (
        <View style={s.writeBox}>
          <Text style={s.writeLbl}>{rows.some(r => r.is_mine) ? 'Your review' : 'Leave a review'}</Text>
          <Stars value={rating} size={22} onPick={setRating} />
          <TextInput
            value={body} onChangeText={setBody}
            style={s.writeInput} placeholder="What was it like? (optional)"
            placeholderTextColor={light.ink.faint} multiline textAlignVertical="top" maxLength={400}
          />
          <TouchableOpacity style={[s.submit, (rating < 1 || saving) && s.submitOff]} onPress={submit} disabled={rating < 1 || saving}>
            {saving ? <ActivityIndicator size="small" color={light.ink.inverse} /> : <Text style={s.submitTxt}>Post review</Text>}
          </TouchableOpacity>
        </View>
      ) : null}

      {error ? <Text style={s.emptySub}>{error}</Text> : null}

      {rows.length === 0 ? (
        <View style={s.empty}>
          <Feather name="star" size={26} color={light.ink.faint} />
          <Text style={s.emptyTitle}>No reviews yet</Text>
          <Text style={s.emptySub}>Be the first to say what this business was like.</Text>
        </View>
      ) : rows.map(r => (
        <View key={r.review_id} style={s.review}>
          {r.reviewer_avatar ? (
            <Image source={{ uri: r.reviewer_avatar }} style={s.rAvatar} />
          ) : (
            <View style={[s.rAvatar, s.rAvatarFb]}><Text style={s.rAvatarTxt}>{initials(r.reviewer_name)}</Text></View>
          )}
          <View style={{ flex: 1 }}>
            <View style={s.rHead}>
              <Text style={s.rName} numberOfLines={1}>{r.reviewer_name || 'User'}{r.is_mine ? ' (you)' : ''}</Text>
              <Stars value={r.rating} />
            </View>
            {r.body ? <Text style={s.rBody}>{r.body}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

type SellerListing = {
  listing_id: string; title: string; price: number | null; currency: string | null;
  condition: string | null; location_city: string | null; images: string[] | null;
  status: string; delivery_available: boolean; delivery_fee: number | null;
};

/**
 * A seller's shop, on their profile. Applies to a person selling one fridge as
 * much as to a business with a catalogue, which is why it is not gated on
 * account_type. Sold items are hidden by default: a shop shows what you can buy.
 */
export function SellerListings({ sellerId, navigation, isSelf }: { sellerId: string; navigation: any; isSelf: boolean }) {
  const [rows, setRows] = useState<SellerListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSold, setShowSold] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase.rpc('get_seller_listings', {
      p_seller_id: sellerId, p_cursor: null, p_limit: 40, p_include_sold: showSold,
    });
    if (err) { setError(err.message); setLoading(false); return; }
    setRows((data ?? []) as SellerListing[]);
    setLoading(false);
  }, [sellerId, showSold]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <View style={s.pad}><ActivityIndicator color={light.brand.base} /></View>;
  if (error) return (
    <View style={s.empty}>
      <Feather name="alert-circle" size={26} color={light.ink.faint} />
      <Text style={s.emptyTitle}>Could not load listings</Text>
      <Text style={s.emptySub}>{error}</Text>
      <TouchableOpacity onPress={() => { setLoading(true); load(); }}><Text style={s.link}>Try again</Text></TouchableOpacity>
    </View>
  );

  return (
    <View>
      {isSelf ? (
        <TouchableOpacity style={s.soldToggle} onPress={() => { setLoading(true); setShowSold(v => !v); }} activeOpacity={0.7}>
          <Feather name={showSold ? 'check-square' : 'square'} size={14} color={light.ink.muted} />
          <Text style={s.soldTxt}>Show sold items</Text>
        </TouchableOpacity>
      ) : null}

      {rows.length === 0 ? (
        <View style={s.empty}>
          <Feather name="shopping-bag" size={26} color={light.ink.faint} />
          <Text style={s.emptyTitle}>Nothing for sale</Text>
          <Text style={s.emptySub}>
            {isSelf ? 'Listings you post in Market appear here.' : 'This seller has nothing listed right now.'}
          </Text>
        </View>
      ) : (
        <View style={s.grid}>
          {rows.map(l => {
            const priceLabel = money(l.price, l.currency);
            const sold = l.status === 'sold';
            return (
              <TouchableOpacity
                key={l.listing_id}
                style={s.card}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('Market', { screen: 'ListingDetail', params: { listingId: l.listing_id } })}
              >
                {l.images?.[0] ? (
                  <Image source={{ uri: l.images[0] }} style={s.thumb} resizeMode="cover" />
                ) : (
                  <View style={[s.thumb, s.thumbEmpty]}><Feather name="image" size={22} color={light.ink.faint} /></View>
                )}
                {sold ? <View style={s.soldBadge}><Text style={s.soldBadgeTxt}>SOLD</Text></View> : null}
                <View style={s.cardBody}>
                  <Text style={s.cardTitle} numberOfLines={2}>{l.title}</Text>
                  <View style={s.cardFoot}>
                    {priceLabel ? <Text style={s.price}>{priceLabel}</Text> : <View />}
                    {l.delivery_available ? <Feather name="truck" size={11} color={light.ink.muted} /> : null}
                  </View>
                  {l.location_city ? <Text style={s.cardMeta} numberOfLines={1}>{l.location_city}</Text> : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  soldToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingTop: 12 },
  soldTxt: { fontSize: typeSize.caption, color: light.ink.muted },
  soldBadge: {
    position: 'absolute', top: 8, left: 8,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.sm,
    backgroundColor: light.surface.scrim,
  },
  soldBadgeTxt: { fontSize: 9, fontWeight: fontWeight.heavy, color: light.ink.inverse, letterSpacing: 0.6 },
  cardMeta: { fontSize: typeSize.micro, color: light.ink.muted },
  pad: { padding: 14 },
  empty: { alignItems: 'center', paddingVertical: 44, paddingHorizontal: 36, gap: 6 },
  emptyTitle: { fontSize: typeSize.emphasis, fontWeight: fontWeight.bold, color: light.ink.primary, marginTop: 4 },
  emptySub: { fontSize: typeSize.caption, color: light.ink.muted, textAlign: 'center', lineHeight: 18 },
  link: { fontSize: typeSize.caption, fontWeight: fontWeight.bold, color: light.brand.base, marginTop: 6 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, padding: 14 },
  card: {
    width: '48%', borderRadius: radius.md, overflow: 'hidden',
    borderWidth: HAIR, borderColor: light.surface.hairline, backgroundColor: light.surface.canvas,
  },
  thumb: { width: '100%', height: 124, backgroundColor: light.surface.sunken },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { paddingHorizontal: 9, paddingTop: 7, paddingBottom: 9, gap: 3 },
  cardTitle: { fontSize: typeSize.caption, fontWeight: fontWeight.semibold, color: light.ink.primary, lineHeight: 16 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  price: { fontSize: typeSize.body, fontWeight: fontWeight.heavy, color: light.ink.primary },

  stars: { flexDirection: 'row', gap: 3 },
  writeBox: {
    borderWidth: HAIR, borderColor: light.surface.hairline, borderRadius: radius.md,
    padding: space.sm, marginBottom: space.md, gap: space.xs, backgroundColor: light.surface.raised,
  },
  writeLbl: { fontSize: typeSize.micro, fontWeight: fontWeight.semibold, letterSpacing: 1.1, textTransform: 'uppercase', color: light.ink.muted },
  writeInput: {
    minHeight: 68, borderWidth: HAIR, borderColor: light.surface.hairline, borderRadius: radius.sm,
    paddingHorizontal: space.xs, paddingTop: 8, paddingBottom: 8,
    fontSize: typeSize.body, color: light.ink.primary, backgroundColor: light.surface.canvas,
  },
  submit: { alignSelf: 'flex-start', paddingHorizontal: space.md, paddingVertical: 8, borderRadius: radius.full, backgroundColor: light.brand.base },
  submitOff: { opacity: 0.4 },
  submitTxt: { color: light.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },

  review: { flexDirection: 'row', gap: space.sm, paddingVertical: space.sm, borderTopWidth: HAIR, borderTopColor: light.surface.divider },
  rAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: light.surface.sunken },
  rAvatarFb: { alignItems: 'center', justifyContent: 'center', backgroundColor: light.brand.base },
  rAvatarTxt: { color: light.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },
  rHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.xs },
  rName: { flex: 1, fontSize: typeSize.body, fontWeight: fontWeight.semibold, color: light.ink.primary },
  rBody: { fontSize: typeSize.caption, color: light.ink.secondary, lineHeight: 18, marginTop: 3 },
});