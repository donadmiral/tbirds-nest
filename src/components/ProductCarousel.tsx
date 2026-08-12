/**
 * ProductCarousel
 *
 * Horizontally swipeable product cards on a post. Structured like X's shopping
 * carousel, with one difference that matters: a card can point at an internal
 * marketplace listing instead of an external site, so the product opens inside
 * the app with the seller attached rather than dumping the buyer on a website.
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { light, typeSize, fontWeight, radius, space } from '../constants/tokens';

export type PostProduct = {
  id: string;
  title: string;
  subtitle?: string | null;
  price?: number | string | null;
  currency?: string | null;
  image_url?: string | null;
  listing_id?: string | null;
  listing_status?: string | null;
  link_url?: string | null;
  cta_label?: string | null;
  sort_order?: number | null;
};

type Props = {
  products: PostProduct[];
  onOpenListing?: (listingId: string) => void;
};

const CARD_W = 168;

function money(price?: number | string | null, currency?: string | null) {
  if (price === null || price === undefined || price === '') return null;
  const n = typeof price === 'string' ? Number(price) : price;
  if (Number.isNaN(n)) return null;
  const symbol = (currency || 'USD') === 'USD' ? '$' : 'ZWG ';
  const body = n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
  return symbol === '$' ? `$${body}` : `${symbol}${body}`;
}

export default function ProductCarousel({ products, onOpenListing }: Props) {
  if (!products?.length) return null;
  const ordered = [...products].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const open = (p: PostProduct) => {
    if (p.listing_id && onOpenListing) { onOpenListing(p.listing_id); return; }
    if (p.link_url) Linking.openURL(p.link_url).catch(() => {});
  };

  return (
    <View style={s.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.row}
        snapToInterval={CARD_W + space.xs}
        decelerationRate="fast"
      >
        {ordered.map(p => {
          const priceLabel = money(p.price, p.currency);
          const internal = !!p.listing_id;
          return (
            <TouchableOpacity
              key={p.id}
              style={s.card}
              activeOpacity={0.85}
              onPress={() => open(p)}
              accessibilityRole="button"
              accessibilityLabel={`${p.title}${priceLabel ? `, ${priceLabel}` : ''}`}
            >
              <View style={s.thumbWrap}>
                {p.image_url ? (
                  <Image source={{ uri: p.image_url }} style={s.thumb} resizeMode="cover" />
                ) : (
                  <View style={[s.thumb, s.thumbEmpty]}>
                    <Feather name="package" size={22} color={light.ink.faint} />
                  </View>
                )}
                {p.listing_status && p.listing_status !== 'available' && (
                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: '#FFF', letterSpacing: 1 }}>{p.listing_status === 'sold' ? 'SOLD' : 'UNAVAILABLE'}</Text>
                  </View>
                )}
                {!internal && (
                  <View style={s.extBadge}>
                    <Feather name="external-link" size={9} color={light.ink.inverse} />
                  </View>
                )}
              </View>

              <View style={s.body}>
                <Text style={s.title} numberOfLines={2}>{p.title}</Text>
                {p.subtitle ? <Text style={s.subtitle} numberOfLines={1}>{p.subtitle}</Text> : null}
                <View style={s.footer}>
                  {priceLabel ? <Text style={s.price}>{priceLabel}</Text> : <View />}
                  <Text style={s.cta} numberOfLines={1}>{p.cta_label || 'View'}</Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: space.xs },
  row: { paddingHorizontal: 14, gap: space.xs },
  card: {
    width: CARD_W,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: light.surface.hairline,
    backgroundColor: light.surface.canvas,
    overflow: 'hidden',
  },
  thumbWrap: { position: 'relative' },
  thumb: { width: '100%', height: 118, backgroundColor: light.surface.sunken },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  extBadge: {
    position: 'absolute', top: 6, right: 6,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: light.surface.scrim,
    alignItems: 'center', justifyContent: 'center',
  },
  body: { paddingHorizontal: 9, paddingTop: 7, paddingBottom: 9, gap: 2 },
  title: { fontSize: typeSize.caption, fontWeight: fontWeight.semibold, color: light.ink.primary, lineHeight: 16 },
  subtitle: { fontSize: typeSize.micro, color: light.ink.muted },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 3 },
  price: { fontSize: typeSize.body, fontWeight: fontWeight.heavy, color: light.ink.primary },
  cta: { fontSize: typeSize.micro, fontWeight: fontWeight.bold, color: light.status.link },
});