import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';

const NAVY = '#0B1E3D';
const TEXT_PRIMARY = '#000000';
const TEXT_SECONDARY = '#8E8E93';
const HAIRLINE = '#E5E5EA';

export default function StoryCreationMenuScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const openGallery = async (mediaType: 'image' | 'video') => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') return;

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: mediaType === 'video'
        ? ImagePicker.MediaTypeOptions.Videos
        : ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: mediaType === 'image',
      selectionLimit: mediaType === 'image' ? 10 : 1,
      quality: 0.9,
      videoMaxDuration: 15,
    });
    if (res.canceled || !res.assets?.length) return;

    navigation.replace('StoryComposer', {
      mode: mediaType,
      assets: res.assets,
    });
  };

  const openTextMode = () => {
    navigation.replace('StoryComposer', { mode: 'text' });
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      <View style={s.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={s.closeBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.6}
        >
          <Feather name="x" size={22} color={NAVY} />
        </TouchableOpacity>
        <Text style={s.title}>New story</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={s.body}>
        <Text style={s.heading}>Share a moment</Text>
        <Text style={s.sub}>Stories disappear after 24 hours.</Text>

        <View style={s.list}>
          <TouchableOpacity
            style={s.card}
            activeOpacity={0.85}
            onPress={() => openGallery('image')}
          >
            <View style={s.cardIcon}>
              <Feather name="image" size={22} color={NAVY} />
            </View>
            <View style={s.cardText}>
              <Text style={s.cardTitle}>Photo</Text>
              <Text style={s.cardDesc}>Pick up to 10 photos from your gallery</Text>
            </View>
            <Feather name="chevron-right" size={20} color="#C7C7CC" />
          </TouchableOpacity>

          <TouchableOpacity
            style={s.card}
            activeOpacity={0.85}
            onPress={() => openGallery('video')}
          >
            <View style={s.cardIcon}>
              <Feather name="video" size={22} color={NAVY} />
            </View>
            <View style={s.cardText}>
              <Text style={s.cardTitle}>Video</Text>
              <Text style={s.cardDesc}>Share a clip up to 15 seconds</Text>
            </View>
            <Feather name="chevron-right" size={20} color="#C7C7CC" />
          </TouchableOpacity>

          <TouchableOpacity
            style={s.card}
            activeOpacity={0.85}
            onPress={openTextMode}
          >
            <View style={s.cardIcon}>
              <Feather name="type" size={22} color={NAVY} />
            </View>
            <View style={s.cardText}>
              <Text style={s.cardTitle}>Text</Text>
              <Text style={s.cardDesc}>Write on a color or gradient background</Text>
            </View>
            <Feather name="chevron-right" size={20} color="#C7C7CC" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={[s.footerWrap, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <View style={s.footerDivider} />
        <View style={s.footerRow}>
          <Feather name="clock" size={13} color={TEXT_SECONDARY} />
          <Text style={s.footerTxt}>Visible for 24 hours after posting</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingTop: 4, paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE,
    backgroundColor: '#FFFFFF',
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F2F2F7',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 16, fontWeight: '700', color: TEXT_PRIMARY, letterSpacing: -0.2 },

  body: { flex: 1, paddingHorizontal: 20, paddingTop: 32 },
  heading: { fontSize: 26, fontWeight: '700', color: TEXT_PRIMARY, letterSpacing: -0.4 },
  sub: { fontSize: 14, color: TEXT_SECONDARY, marginTop: 6, marginBottom: 28 },

  list: { gap: 10 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardIcon: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: 'rgba(11,30,61,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  cardText: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: TEXT_PRIMARY, letterSpacing: -0.1 },
  cardDesc: { fontSize: 13, color: TEXT_SECONDARY, marginTop: 3, lineHeight: 17 },

  footerWrap: { paddingTop: 10 },
  footerDivider: { height: StyleSheet.hairlineWidth, backgroundColor: HAIRLINE, marginBottom: 14 },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  footerTxt: { fontSize: 12, color: TEXT_SECONDARY, fontWeight: '500' },
});