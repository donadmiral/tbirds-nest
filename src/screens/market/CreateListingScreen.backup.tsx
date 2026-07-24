import React, { useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';

import { marketService, MARKET_CATEGORIES, MARKET_CONDITIONS, ListingCurrency } from '../../services/marketService';
import { pickFromLibrary, uploadBatch, PickedMedia } from '../../services/mediaService';
import { useAuthStore } from '../../stores/authStore';

const NAVY = '#0B1E3D';
const BG = '#FFFFFF';
const GRAY_100 = '#F3F4F6';
const GRAY_400 = '#9CA3AF';
const GRAY_500 = '#6B7280';
const GRAY_900 = '#111827';

const MAX_IMAGES = 6;

export default function CreateListingScreen({ navigation }: any) {
  const { profile } = useAuthStore();
  const userId: string | undefined = profile?.id;

  const [media, setMedia] = useState<PickedMedia[]>([]);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<ListingCurrency>('USD');
  const [category, setCategory] = useState<string>('Other');
  const [condition, setCondition] = useState<string | null>(null);
  const [city, setCity] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const addPhotos = async () => {
    try {
      const picked = await pickFromLibrary({
        allowVideos: false,
        multiple: true,
        selectionLimit: MAX_IMAGES - media.length,
        quality: 0.8,
      });
      if (picked.length) setMedia((prev) => [...prev, ...picked].slice(0, MAX_IMAGES));
    } catch (e: any) {
      Alert.alert('Photos', e?.message || 'Could not open photo library');
    }
  };

  const removePhoto = (index: number) => {
    setMedia((prev) => prev.filter((_, i) => i !== index));
  };

  const priceNumber = Number(price.replace(/,/g, ''));
  const formValid =
    title.trim().length >= 3 &&
    price.trim().length > 0 &&
    Number.isFinite(priceNumber) &&
    priceNumber >= 0 &&
    media.length > 0;

  const submit = async () => {
    if (!userId || !formValid || saving) return;
    setSaving(true);
    try {
      const { uploaded, failed } = await uploadBatch('market-media', userId, media, {
        pathPrefix: 'listings',
      });
      if (!uploaded.length) throw new Error('Image upload failed. Check your connection and try again.');
      if (failed.length) console.log('[CreateListing] some images failed:', failed.length);

      await marketService.createListing({
        seller_id: userId,
        title: title.trim(),
        description: description.trim(),
        price: priceNumber,
        currency,
        category,
        condition,
        location_city: city.trim(),
        images: uploaded.map((u: any) => u.url),
      });
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Could not publish', e?.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="x" size={24} color={GRAY_900} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>New listing</Text>
        <TouchableOpacity
          onPress={submit}
          disabled={!formValid || saving}
          style={[s.publishBtn, (!formValid || saving) && { opacity: 0.4 }]}
          activeOpacity={0.85}
        >
          {saving ? <ActivityIndicator color={BG} size={14} /> : <Text style={s.publishTxt}>Publish</Text>}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {media.map((m, i) => (
              <View key={`${m.uri}-${i}`}>
                <ExpoImage source={{ uri: m.uri }} style={s.photo} contentFit="cover" />
                <TouchableOpacity style={s.photoRemove} onPress={() => removePhoto(i)}>
                  <Feather name="x" size={12} color={BG} />
                </TouchableOpacity>
              </View>
            ))}
            {media.length < MAX_IMAGES && (
              <TouchableOpacity style={s.photoAdd} onPress={addPhotos} activeOpacity={0.8}>
                <Feather name="camera" size={22} color={GRAY_500} />
                <Text style={s.photoAddTxt}>{media.length === 0 ? 'Add photos' : 'Add more'}</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          <Text style={s.label}>Title</Text>
          <TextInput
            style={s.input}
            value={title}
            onChangeText={setTitle}
            placeholder="What are you selling?"
            placeholderTextColor={GRAY_400}
            maxLength={80}
          />

          <Text style={s.label}>Price</Text>
          <View style={s.priceRow}>
            <View style={s.currencyToggle}>
              {(['USD', 'ZWG'] as ListingCurrency[]).map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[s.currencyChip, currency === c && s.currencyChipActive]}
                  onPress={() => setCurrency(c)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.currencyTxt, currency === c && s.currencyTxtActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[s.input, { flex: 1, marginTop: 0 }]}
              value={price}
              onChangeText={setPrice}
              placeholder="0.00"
              placeholderTextColor={GRAY_400}
              keyboardType="decimal-pad"
            />
          </View>

          <Text style={s.label}>Category</Text>
          <View style={s.chipWrap}>
            {MARKET_CATEGORIES.map((c) => (
              <TouchableOpacity
                key={c}
                style={[s.chip, category === c && s.chipActive]}
                onPress={() => setCategory(c)}
                activeOpacity={0.8}
              >
                <Text style={[s.chipTxt, category === c && s.chipTxtActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.label}>Condition</Text>
          <View style={s.chipWrap}>
            {MARKET_CONDITIONS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[s.chip, condition === c && s.chipActive]}
                onPress={() => setCondition(condition === c ? null : c)}
                activeOpacity={0.8}
              >
                <Text style={[s.chipTxt, condition === c && s.chipTxtActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.label}>City</Text>
          <TextInput
            style={s.input}
            value={city}
            onChangeText={setCity}
            placeholder="Harare, Bulawayo, Mutare..."
            placeholderTextColor={GRAY_400}
            maxLength={40}
          />

          <Text style={s.label}>Description</Text>
          <TextInput
            style={[s.input, s.inputMulti]}
            value={description}
            onChangeText={setDescription}
            placeholder="Details buyers should know"
            placeholderTextColor={GRAY_400}
            multiline
            maxLength={1500}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: GRAY_900 },
  publishBtn: {
    backgroundColor: NAVY, paddingHorizontal: 14, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', minWidth: 74,
  },
  publishTxt: { color: BG, fontSize: 14, fontWeight: '700' },
  photo: { width: 92, height: 92, borderRadius: 12, backgroundColor: GRAY_100 },
  photoRemove: {
    position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10,
    backgroundColor: GRAY_900, alignItems: 'center', justifyContent: 'center',
  },
  photoAdd: {
    width: 92, height: 92, borderRadius: 12, backgroundColor: GRAY_100,
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  photoAddTxt: { fontSize: 11, fontWeight: '600', color: GRAY_500 },
  label: { fontSize: 13, fontWeight: '700', color: GRAY_500, marginTop: 18, marginBottom: 6 },
  input: {
    backgroundColor: GRAY_100, borderRadius: 12, paddingHorizontal: 14,
    height: 46, fontSize: 15, color: GRAY_900,
  },
  inputMulti: { height: 110, paddingTop: 12, textAlignVertical: 'top' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  currencyToggle: { flexDirection: 'row', backgroundColor: GRAY_100, borderRadius: 12, padding: 3 },
  currencyChip: { paddingHorizontal: 12, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  currencyChipActive: { backgroundColor: NAVY },
  currencyTxt: { fontSize: 13, fontWeight: '700', color: GRAY_500 },
  currencyTxtActive: { color: BG },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: GRAY_100,
    alignItems: 'center', justifyContent: 'center',
  },
  chipActive: { backgroundColor: NAVY },
  chipTxt: { fontSize: 13, fontWeight: '600', color: GRAY_500 },
  chipTxtActive: { color: BG },
});