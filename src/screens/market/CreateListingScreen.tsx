/**
 * CreateListingScreen - Facebook Marketplace style wizard.
 * Photos -> Details -> Meetup -> Preview, with per-step validation.
 */
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { authorId as currentAuthorId } from '../../stores/actorStore';
import { Feather, Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';

import { marketService, MARKET_CATEGORIES, MARKET_CONDITIONS, ListingCurrency } from '../../services/marketService';
import { pickFromLibrary, uploadBatch, PickedMedia } from '../../services/mediaService';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../services/supabase';

const NAVY = '#0B1E3D';
const BG = '#FFFFFF';
const GRAY_100 = '#F3F4F6';
const GRAY_400 = '#9CA3AF';
const GRAY_500 = '#6B7280';
const GRAY_900 = '#111827';
const RED = '#DC2626';

const MAX_IMAGES = 10;
const STEPS = ['Photos', 'Details', 'Meetup', 'Preview'];

export default function CreateListingScreen({ navigation }: any) {
  const { profile } = useAuthStore();
  const userId: string | undefined = profile?.id;

  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [media, setMedia] = useState<PickedMedia[]>([]);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<ListingCurrency>('USD');
  const [category, setCategory] = useState<string>('Other');
  const [condition, setCondition] = useState<string | null>(null);
  const [deliveryOn, setDeliveryOn] = useState(false);
  const [shareToFeed, setShareToFeed] = useState(true);
  const [deliveryFee, setDeliveryFee] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [city, setCity] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const priceNumber = Number(price.replace(/,/g, ''));
  const priceOk = price.trim().length > 0 && Number.isFinite(priceNumber) && priceNumber >= 0;
  const titleOk = title.trim().length >= 3;
  const cityOk = city.trim().length >= 2;

  const stepValid = useMemo(() => {
    if (step === 0) return media.length > 0;
    if (step === 1) return titleOk && priceOk && !!condition;
    if (step === 2) return cityOk;
    return true;
  }, [step, media.length, titleOk, priceOk, condition, cityOk]);

  const addPhotos = async () => {
    const picked = await pickFromLibrary({ multiple: true, selectionLimit: MAX_IMAGES - media.length });
    if (picked?.length) setMedia(prev => [...prev, ...picked].slice(0, MAX_IMAGES));
  };

  const next = () => {
    setTouched(true);
    if (!stepValid) return;
    setTouched(false);
    setStep(s => Math.min(s + 1, STEPS.length - 1));
  };

  const back = () => {
    if (step === 0) {
      if (media.length || title || price) {
        Alert.alert('Discard listing?', 'Your progress will be lost.', [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.goBack() },
        ]);
      } else navigation.goBack();
      return;
    }
    setTouched(false);
    setStep(s => s - 1);
  };

  const submit = async () => {
    if (!userId || saving) return;
    setSaving(true);
    try {
      const { uploaded, failed } = await uploadBatch('market-media', userId, media, { pathPrefix: 'listings' });
      if (!uploaded.length) throw new Error('Image upload failed. Check your connection and try again.');
      if (failed.length) console.log('[CreateListing] some images failed:', failed.length);

      const createdListing = await marketService.createListing({
        seller_id: currentAuthorId(userId) ?? userId,
        title: title.trim(),
        description: description.trim(),
        price: priceNumber,
        currency,
        category,
        condition,
        location_city: city.trim(),
        images: uploaded.map((u: any) => u.url),
        delivery_available: deliveryOn,
        delivery_fee: deliveryOn && deliveryFee.trim() ? Number(deliveryFee.replace(/,/g, '')) : null,
        delivery_note: deliveryOn && deliveryNote.trim() ? deliveryNote.trim() : null,
      });
      if (shareToFeed && createdListing?.id) {
        try {
          const { data: newPost } = await supabase
            .from('posts')
            .insert({ user_id: currentAuthorId(userId) ?? userId, body: title.trim() })
            .select()
            .single();
          if (newPost?.id) {
            await supabase.rpc('set_post_products', {
              p_post_id: newPost.id,
              p_products: [{
                id: 'listing-' + createdListing.id,
                title: title.trim(),
                subtitle: null,
                price: priceNumber,
                currency,
                image_url: (createdListing.images && createdListing.images[0]) || null,
                listing_id: createdListing.id,
                link_url: null,
                cta_label: 'View listing',
                sort_order: 0,
              }],
            });
          }
        } catch (shareErr: any) {
          console.log('[CreateListing] share to feed failed:', shareErr?.message);
        }
      }
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Could not publish', e?.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const Err = ({ show, text }: any) => show ? <Text style={s.err}>{text}</Text> : null;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={back} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name={step === 0 ? 'x' : 'chevron-left'} size={24} color={GRAY_900} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{STEPS[step]}</Text>
        <Text style={s.stepCount}>{step + 1} of {STEPS.length}</Text>
      </View>

      <View style={s.progressTrack}>
        <View style={[s.progressFill, { width: (((step + 1) / STEPS.length) * 100) + '%' } as any]} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">

          {step === 0 && (
            <>
              <Text style={s.lead}>Add up to {MAX_IMAGES} photos. The first one is your cover.</Text>
              <View style={s.grid}>
                {media.map((m, i) => (
                  <View key={m.uri + i} style={s.tile}>
                    <ExpoImage source={{ uri: m.uri }} style={s.tileImg} contentFit="cover" />
                    {i === 0 && <View style={s.coverTag}><Text style={s.coverTxt}>Cover</Text></View>}
                    <TouchableOpacity style={s.remove} onPress={() => setMedia(prev => prev.filter((_, x) => x !== i))}>
                      <Feather name="x" size={13} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                ))}
                {media.length < MAX_IMAGES && (
                  <TouchableOpacity style={[s.tile, s.tileAdd]} onPress={addPhotos} activeOpacity={0.7}>
                    <Feather name="plus" size={26} color={GRAY_400} />
                  </TouchableOpacity>
                )}
              </View>
              <Err show={touched && media.length === 0} text="Add at least one photo." />
            </>
          )}

          {step === 1 && (
            <>
              <Text style={s.label}>Title</Text>
              <TextInput
                style={[s.input, touched && !titleOk && s.inputErr]}
                value={title} onChangeText={setTitle}
                placeholder="What are you selling?" placeholderTextColor={GRAY_400} maxLength={100}
              />
              <Err show={touched && !titleOk} text="Give it a title of at least 3 characters." />

              <Text style={s.label}>Price</Text>
              <View style={s.priceRow}>
                <TouchableOpacity style={s.currBtn} onPress={() => setCurrency(currency === 'USD' ? 'ZWG' : 'USD')}>
                  <Text style={s.currTxt}>{currency}</Text>
                </TouchableOpacity>
                <TextInput
                  style={[s.input, { flex: 1 }, touched && !priceOk && s.inputErr]}
                  value={price} onChangeText={t => setPrice(t.replace(/[^0-9.]/g, ''))}
                  placeholder="0" placeholderTextColor={GRAY_400} keyboardType="decimal-pad"
                />
              </View>
              <Err show={touched && !priceOk} text="Enter a price. Use 0 for free." />

              <Text style={s.label}>Category</Text>
              <View style={s.chips}>
                {MARKET_CATEGORIES.map((c: string) => (
                  <TouchableOpacity key={c} style={[s.chip, category === c && s.chipActive]} onPress={() => setCategory(c)}>
                    <Text style={[s.chipTxt, category === c && s.chipTxtActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={s.label}>Condition</Text>
              <View style={s.chips}>
                {MARKET_CONDITIONS.map((c: string) => (
                  <TouchableOpacity key={c} style={[s.chip, condition === c && s.chipActive]} onPress={() => setCondition(condition === c ? null : c)}>
                    <Text style={[s.chipTxt, condition === c && s.chipTxtActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Err show={touched && !condition} text="Pick a condition." />

              <Text style={s.label}>Description</Text>
              <TextInput
                style={[s.input, s.textarea]} value={description} onChangeText={setDescription}
                placeholder="Describe your item (optional)" placeholderTextColor={GRAY_400}
                multiline textAlignVertical="top"
              />
            </>
          )}

          {step === 2 && (
            <>
              <Text style={s.lead}>Where will buyers meet you? Give an area, not your exact address.</Text>
              <Text style={s.label}>Meetup area</Text>
              <TextInput
                style={[s.input, touched && !cityOk && s.inputErr]}
                value={city} onChangeText={setCity}
                placeholder="e.g. Avondale, Harare" placeholderTextColor={GRAY_400}
              />
              <Err show={touched && !cityOk} text="Enter a meetup area." />

              <TouchableOpacity onPress={() => setShareToFeed(v => !v)} activeOpacity={0.8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18, padding: 14, borderRadius: 14, backgroundColor: shareToFeed ? 'rgba(5,150,105,0.08)' : 'rgba(11,30,61,0.04)', borderWidth: 1, borderColor: shareToFeed ? 'rgba(5,150,105,0.35)' : 'rgba(11,30,61,0.08)' }}>
                <Ionicons name={shareToFeed ? 'checkbox' : 'square-outline'} size={21} color={shareToFeed ? '#059669' : '#8E8E93'} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14.5, fontWeight: '700', color: '#0B1E3D' }}>Share to feed</Text>
                  <Text style={{ fontSize: 12, color: 'rgba(11,30,61,0.5)', marginTop: 1 }}>Post this listing so your followers see it in their feed.</Text>
                </View>
              </TouchableOpacity>              <TouchableOpacity onPress={() => setDeliveryOn(v => !v)} activeOpacity={0.8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18, padding: 14, borderRadius: 14, backgroundColor: deliveryOn ? 'rgba(5,150,105,0.08)' : 'rgba(11,30,61,0.04)', borderWidth: 1, borderColor: deliveryOn ? 'rgba(5,150,105,0.35)' : 'rgba(11,30,61,0.08)' }}>
                <Ionicons name={deliveryOn ? 'checkbox' : 'square-outline'} size={21} color={deliveryOn ? '#059669' : '#8E8E93'} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14.5, fontWeight: '700', color: '#0B1E3D' }}>Offer delivery</Text>
                  <Text style={{ fontSize: 12, color: 'rgba(11,30,61,0.5)', marginTop: 1 }}>Buyers collect by default. Turn this on if you can deliver.</Text>
                </View>
              </TouchableOpacity>
              {deliveryOn && (
                <View style={{ marginTop: 10, gap: 8 }}>
                  <TextInput value={deliveryFee} onChangeText={setDeliveryFee} keyboardType="numeric"
                    placeholder="Delivery fee (0 for free)" placeholderTextColor={GRAY_400}
                    style={{ borderWidth: 1, borderColor: 'rgba(11,30,61,0.12)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: '#0B1E3D', backgroundColor: '#FFF' }} />
                  <TextInput value={deliveryNote} onChangeText={setDeliveryNote}
                    placeholder="Delivery note, e.g. Harare CBD only" placeholderTextColor={GRAY_400}
                    style={{ borderWidth: 1, borderColor: 'rgba(11,30,61,0.12)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: '#0B1E3D', backgroundColor: '#FFF' }} />
                </View>
              )}

              <View style={s.safety}>
                <Text style={s.safetyTitle}>Stay safe</Text>
                <Text style={s.safetyTxt}>Meet in a busy public place during the day.</Text>
                <Text style={s.safetyTxt}>Inspect the item before you pay.</Text>
                <Text style={s.safetyTxt}>Keep conversations inside Platinum Circles.</Text>
                <Text style={s.safetyTxt}>Never send money before seeing the item.</Text>
              </View>
            </>
          )}

          {step === 3 && (
            <>
              <Text style={s.lead}>This is how buyers will see it.</Text>
              <View style={s.preview}>
                {media[0] ? <ExpoImage source={{ uri: media[0].uri }} style={s.previewImg} contentFit="cover" /> : null}
                <View style={{ padding: 12 }}>
                  <Text style={s.previewPrice}>{currency} {priceNumber.toFixed(2)}</Text>
                  <Text style={s.previewTitle} numberOfLines={2}>{title}</Text>
                  <Text style={s.previewMeta}>{[condition, city].filter(Boolean).join('  ·  ')}</Text>
                </View>
              </View>
              {!!description && <Text style={s.previewDesc}>{description}</Text>}
              <Text style={s.previewNote}>{media.length} {media.length === 1 ? 'photo' : 'photos'}  ·  {category}</Text>
            </>
          )}

        </ScrollView>

        <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) + TAB_BAR_CLEARANCE }]}>
          {step < STEPS.length - 1 ? (
            <TouchableOpacity style={[s.cta, !stepValid && s.ctaOff]} onPress={next} activeOpacity={0.85}>
              <Text style={s.ctaTxt}>Next</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[s.cta, saving && s.ctaOff]} onPress={submit} disabled={saving} activeOpacity={0.85}>
              {saving ? <ActivityIndicator color={BG} /> : <Text style={s.ctaTxt}>Publish</Text>}
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: GRAY_900, letterSpacing: -0.4 },
  stepCount: { fontSize: 13, color: GRAY_500, fontWeight: '600' },
  progressTrack: { height: 3, backgroundColor: GRAY_100 },
  progressFill: { height: 3, backgroundColor: NAVY },
  body: { padding: 16, paddingBottom: 40 },
  lead: { fontSize: 14, color: GRAY_500, marginBottom: 14, lineHeight: 19 },
  label: { fontSize: 13, fontWeight: '700', color: GRAY_900, marginTop: 16, marginBottom: 7 },
  input: { backgroundColor: GRAY_100, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15.5, color: GRAY_900, borderWidth: 1, borderColor: 'transparent' },
  inputErr: { borderColor: RED },
  textarea: { minHeight: 96 },
  err: { fontSize: 12.5, color: RED, marginTop: 6, fontWeight: '500' },
  priceRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  currBtn: { backgroundColor: NAVY, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13 },
  currTxt: { color: BG, fontWeight: '800', fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: GRAY_100, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: NAVY },
  chipTxt: { fontSize: 13.5, fontWeight: '600', color: GRAY_900 },
  chipTxtActive: { color: BG },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '31.5%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: GRAY_100 },
  tileImg: { width: '100%', height: '100%' },
  tileAdd: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#E5E7EB', borderStyle: 'dashed' },
  coverTag: { position: 'absolute', left: 5, bottom: 5, backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  coverTxt: { color: '#FFF', fontSize: 10, fontWeight: '700' },
  remove: { position: 'absolute', right: 4, top: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  safety: { marginTop: 22, backgroundColor: '#F7F8FA', borderRadius: 14, padding: 14, gap: 6 },
  safetyTitle: { fontSize: 14, fontWeight: '800', color: GRAY_900, marginBottom: 2 },
  safetyTxt: { fontSize: 13.5, color: GRAY_500, lineHeight: 19 },
  preview: { borderRadius: 14, overflow: 'hidden', backgroundColor: BG, borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E7EB' },
  previewImg: { width: '100%', aspectRatio: 1.15 },
  previewPrice: { fontSize: 18, fontWeight: '800', color: GRAY_900, letterSpacing: -0.4 },
  previewTitle: { fontSize: 14.5, color: GRAY_900, marginTop: 2 },
  previewMeta: { fontSize: 12.5, color: GRAY_500, marginTop: 3 },
  previewDesc: { fontSize: 14, color: GRAY_900, lineHeight: 20, marginTop: 14 },
  previewNote: { fontSize: 12.5, color: GRAY_500, marginTop: 12 },
  footer: { paddingHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E7EB', backgroundColor: BG },
  cta: { height: 50, borderRadius: 14, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  ctaOff: { opacity: 0.45 },
  ctaTxt: { color: BG, fontSize: 16, fontWeight: '700' },
});