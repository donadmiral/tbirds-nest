/**
 * ProductPickerSheet
 *
 * Turns what a seller already has into product cards. Their marketplace
 * listings arrive with image, title, condition, price and currency, so
 * attaching one is a single tap with nothing to re-enter. That is the whole
 * advantage over X, where a business must configure a catalogue first.
 *
 * A manual card with an external link stays available for anything not listed.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, TextInput,
  ActivityIndicator, Image, Pressable, Platform, Keyboard,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../services/supabase';
import { light, typeSize, fontWeight, radius, space } from '../constants/tokens';
import type { PostProduct } from './ProductCarousel';

type Listing = {
  id: string;
  title: string;
  price: number | null;
  currency: string | null;
  condition: string | null;
  images: string[] | null;
};

type Props = {
  visible: boolean;
  sellerId: string | null;
  selected: PostProduct[];
  onClose: () => void;
  onSave: (products: PostProduct[]) => void;
};

const MAX_CARDS = 8;

export default function ProductPickerSheet({ visible, sellerId, selected, onClose, onSave }: Props) {
  const insets = useSafeAreaInsets();
  const [listings, setListings] = useState<Listing[]>([]);
  // The sheet lives in a modal, where a keyboard-avoiding wrapper fails on
  // iOS. Track the keyboard and lift the sheet by its height instead.
  const [kb, setKb] = useState(0);
  useEffect(() => {
    const showEv = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEv = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(showEv, (e: any) => setKb(e?.endCoordinates?.height || 0));
    const b = Keyboard.addListener(hideEv, () => setKb(0));
    return () => { a.remove(); b.remove(); };
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<PostProduct[]>(selected);

  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkPrice, setLinkPrice] = useState('');
  const [showLinkForm, setShowLinkForm] = useState(false);

  const load = useCallback(async () => {
    if (!sellerId) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('marketplace_listings')
      .select('id, title, price, currency, condition, images')
      .eq('seller_id', sellerId)
      .eq('status', 'available')
      .order('created_at', { ascending: false })
      .limit(50);
    if (err) setError(err.message);
    else setListings((data ?? []) as Listing[]);
    setLoading(false);
  }, [sellerId]);

  useEffect(() => {
    if (visible) { setDraft(selected); load(); }
  }, [visible, load]);

  const isPicked = (listingId: string) => draft.some(d => d.listing_id === listingId);

  const toggleListing = (l: Listing) => {
    if (isPicked(l.id)) {
      setDraft(d => d.filter(x => x.listing_id !== l.id));
      return;
    }
    if (draft.length >= MAX_CARDS) return;
    setDraft(d => [...d, {
      id: `listing-${l.id}`,
      title: l.title,
      subtitle: l.condition,
      price: l.price,
      currency: l.currency || 'USD',
      image_url: l.images?.[0] ?? null,
      listing_id: l.id,
      link_url: null,
      cta_label: 'View listing',
      sort_order: d.length,
    }]);
  };

  const addLinkCard = () => {
    const url = linkUrl.trim();
    const title = linkTitle.trim();
    if (!url || !title || draft.length >= MAX_CARDS) return;
    const normalised = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    setDraft(d => [...d, {
      id: `link-${Date.now()}`,
      title,
      subtitle: null,
      price: linkPrice.trim() ? Number(linkPrice.trim()) : null,
      currency: 'USD',
      image_url: null,
      listing_id: null,
      link_url: normalised,
      cta_label: 'Visit',
      sort_order: d.length,
    }]);
    setLinkTitle(''); setLinkUrl(''); setLinkPrice(''); setShowLinkForm(false);
  };

  const removeCard = (id: string) => setDraft(d => d.filter(x => x.id !== id));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={[s.sheet, { paddingBottom: kb > 0 ? kb + space.sm : insets.bottom + space.md }]} onPress={() => {}}>
          <View>
            <View style={s.handle} />

            <View style={s.headerRow}>
              <View>
                <Text style={s.title}>Add products</Text>
                <Text style={s.subtitle}>{draft.length} of {MAX_CARDS} selected. They show as a product card under the post.</Text>
              </View>
              <TouchableOpacity
                onPress={() => { onSave(draft.map((d, i) => ({ ...d, sort_order: i }))); onClose(); }}
                style={s.doneBtn}
                accessibilityRole="button"
              >
                <Text style={s.doneTxt}>Done</Text>
              </TouchableOpacity>
            </View>

            {draft.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
                {draft.map(d => (
                  <View key={d.id} style={s.chip}>
                    <Text style={s.chipTxt} numberOfLines={1}>{d.title}</Text>
                    <TouchableOpacity onPress={() => removeCard(d.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Feather name="x" size={12} color={light.ink.muted} />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}

            <ScrollView style={[s.body, kb > 0 && { maxHeight: 220 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={s.sectionLbl}>From your Market listings</Text>

              {loading ? (
                <View style={s.centered}><ActivityIndicator color={light.brand.base} /></View>
              ) : error ? (
                <View style={s.centered}>
                  <Text style={s.errTxt}>{error}</Text>
                  <TouchableOpacity onPress={load}><Text style={s.retryTxt}>Try again</Text></TouchableOpacity>
                </View>
              ) : listings.length === 0 ? (
                <View style={s.centered}>
                  <Feather name="package" size={26} color={light.ink.faint} />
                  <Text style={s.emptyTxt}>No listings on Market yet. Add a product with its link below.</Text>
                </View>
              ) : (
                listings.map(l => {
                  const picked = isPicked(l.id);
                  return (
                    <TouchableOpacity
                      key={l.id}
                      style={[s.row, picked && s.rowPicked]}
                      activeOpacity={0.75}
                      onPress={() => toggleListing(l)}
                    >
                      {l.images?.[0] ? (
                        <Image source={{ uri: l.images[0] }} style={s.thumb} />
                      ) : (
                        <View style={[s.thumb, s.thumbEmpty]}>
                          <Feather name="image" size={16} color={light.ink.faint} />
                        </View>
                      )}
                      <View style={s.rowText}>
                        <Text style={s.rowTitle} numberOfLines={1}>{l.title}</Text>
                        <Text style={s.rowMeta}>
                          {l.price != null ? `${(l.currency || 'USD') === 'USD' ? '$' : 'ZWG '}${l.price}` : 'No price'}
                          {l.condition ? ` · ${l.condition}` : ''}
                        </Text>
                      </View>
                      <Feather
                        name={picked ? 'check-circle' : 'circle'}
                        size={20}
                        color={picked ? light.brand.base : light.ink.faint}
                      />
                    </TouchableOpacity>
                  );
                })
              )}

              <TouchableOpacity style={s.linkToggle} onPress={() => setShowLinkForm(v => !v)} activeOpacity={0.7}>
                <Feather name={showLinkForm ? 'minus' : 'plus'} size={14} color={light.status.link} />
                <Text style={s.linkToggleTxt}>Add a product by link, from your shop or any site</Text>
              </TouchableOpacity>

              {showLinkForm && (
                <View style={s.linkForm}>
                  <TextInput
                    value={linkTitle} onChangeText={setLinkTitle}
                    placeholder="Product name" placeholderTextColor={light.ink.faint}
                    style={s.input}
                  />
                  <TextInput
                    value={linkUrl} onChangeText={setLinkUrl}
                    placeholder="yourshop.co.zw/product" placeholderTextColor={light.ink.faint}
                    style={s.input} autoCapitalize="none" keyboardType="url"
                  />
                  <TextInput
                    value={linkPrice} onChangeText={setLinkPrice}
                    placeholder="Price (optional)" placeholderTextColor={light.ink.faint}
                    style={s.input} keyboardType="decimal-pad"
                  />
                  <TouchableOpacity
                    style={[s.addBtn, (!linkTitle.trim() || !linkUrl.trim()) && s.addBtnOff]}
                    onPress={addLinkCard}
                    disabled={!linkTitle.trim() || !linkUrl.trim()}
                  >
                    <Text style={s.addBtnTxt}>Add product</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: light.surface.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: light.surface.canvas,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: space.md, paddingTop: space.sm, maxHeight: '88%',
  },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: light.surface.hairline, marginBottom: space.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  title: { fontSize: typeSize.title, fontWeight: fontWeight.heavy, color: light.ink.primary, letterSpacing: -0.4 },
  subtitle: { fontSize: typeSize.caption, color: light.ink.muted, marginTop: 1 },
  doneBtn: { paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.full, backgroundColor: light.brand.base },
  doneTxt: { color: light.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },

  chipRow: { gap: space.xs, paddingBottom: space.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 160,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full,
    backgroundColor: light.brand.tintBg,
  },
  chipTxt: { flex: 1, fontSize: typeSize.micro, fontWeight: fontWeight.semibold, color: light.ink.primary },

  body: { maxHeight: 420 },
  sectionLbl: {
    fontSize: typeSize.micro, fontWeight: fontWeight.semibold, letterSpacing: 1.2,
    textTransform: 'uppercase', color: light.ink.muted, marginBottom: space.xs,
  },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 28, gap: 6 },
  errTxt: { fontSize: typeSize.caption, color: light.status.danger, textAlign: 'center' },
  retryTxt: { fontSize: typeSize.caption, fontWeight: fontWeight.bold, color: light.brand.base },
  emptyTxt: { fontSize: typeSize.caption, color: light.ink.muted, textAlign: 'center', paddingHorizontal: space.lg },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingVertical: space.xs, paddingHorizontal: space.xs,
    borderRadius: radius.md, marginBottom: 2,
  },
  rowPicked: { backgroundColor: light.brand.tintBg },
  thumb: { width: 42, height: 42, borderRadius: radius.sm, backgroundColor: light.surface.sunken },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: typeSize.body, fontWeight: fontWeight.semibold, color: light.ink.primary },
  rowMeta: { fontSize: typeSize.micro, color: light.ink.muted, marginTop: 1 },

  linkToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: space.sm },
  linkToggleTxt: { fontSize: typeSize.caption, fontWeight: fontWeight.semibold, color: light.status.link },
  linkForm: { gap: space.xs, paddingBottom: space.sm },
  input: {
    borderWidth: StyleSheet.hairlineWidth, borderColor: light.surface.hairline,
    borderRadius: radius.md, paddingHorizontal: space.sm, paddingVertical: 10,
    fontSize: typeSize.body, color: light.ink.primary, backgroundColor: light.surface.raised,
  },
  addBtn: { alignSelf: 'flex-start', paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.full, backgroundColor: light.brand.base },
  addBtnOff: { opacity: 0.4 },
  addBtnTxt: { color: light.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },
});