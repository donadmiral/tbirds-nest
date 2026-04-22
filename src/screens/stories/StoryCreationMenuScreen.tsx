import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';

export default function StoryCreationMenuScreen() {
  const navigation = useNavigation<any>();

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
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.closeBtn}>
          <Feather name="x" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={s.title}>New story</Text>
        <View style={{ width: 40 }} />
      </View>

      <Text style={s.sub}>Choose how to start</Text>

      <View style={s.grid}>
        <TouchableOpacity style={[s.card, s.photoCard]} activeOpacity={0.85} onPress={() => openGallery('image')}>
          <View style={s.cardIconWrap}>
            <Feather name="image" size={34} color="#FFF" />
          </View>
          <Text style={s.cardTitle}>Photo</Text>
          <Text style={s.cardDesc}>Pick up to 10 photos from your gallery</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[s.card, s.videoCard]} activeOpacity={0.85} onPress={() => openGallery('video')}>
          <View style={s.cardIconWrap}>
            <Feather name="video" size={32} color="#FFF" />
          </View>
          <Text style={s.cardTitle}>Video</Text>
          <Text style={s.cardDesc}>Share a clip up to 15 seconds long</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[s.card, s.textCard]} activeOpacity={0.85} onPress={openTextMode}>
          <View style={s.cardIconWrap}>
            <Feather name="type" size={32} color="#FFF" />
          </View>
          <Text style={s.cardTitle}>Text</Text>
          <Text style={s.cardDesc}>Write on a color or gradient background</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.footer}>Stories disappear after 24 hours.</Text>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0',
  },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: '#000' },
  sub: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 6, fontSize: 14, color: '#6B7280' },

  grid: { paddingHorizontal: 16, paddingTop: 14, gap: 14 },
  card: {
    borderRadius: 22, padding: 20, minHeight: 132,
    justifyContent: 'space-between',
  },
  photoCard: { backgroundColor: '#0B1E3D' },
  videoCard: { backgroundColor: '#7C3AED' },
  textCard: { backgroundColor: '#F59E0B' },
  cardIconWrap: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 20, fontWeight: '800', color: '#FFF', marginTop: 10 },
  cardDesc: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 },

  footer: { textAlign: 'center', fontSize: 12, color: '#9CA3AF', paddingVertical: 20 },
});