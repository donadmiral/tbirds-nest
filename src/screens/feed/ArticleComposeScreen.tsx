/**
 * ArticleComposeScreen - long-form publishing. Title, optional cover,
 * the piece itself; read minutes computed from the words. Publishes
 * through the posts spine so the article card and reader just work.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, TextInput, Alert, ActivityIndicator, Image, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { authorId as currentAuthorId } from '../../stores/actorStore';
import { feedService } from '../../services/feedService';

const NAVY = '#0B1E3D';

export default function ArticleComposeScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [cover, setCover] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const minutes = useMemo(() => {
    const words = body.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
  }, [body]);

  const pickCover = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Photos', 'Allow photo access to add a cover.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
    if (!res.canceled && res.assets?.[0]?.uri) setCover(res.assets[0].uri);
  };

  const publish = async () => {
    if (busy || !profile?.id) return;
    if (!title.trim() || body.trim().length < 100) {
      Alert.alert('Almost', 'An article needs a title and at least a real opening - write a little more.');
      return;
    }
    setBusy(true);
    try {
      const aid = currentAuthorId(profile.id) ?? profile.id;
      let imageUrl: string | null = null;
      if (cover) {
        try { imageUrl = await feedService.uploadPostImage(aid, cover); } catch {}
      }
      const { error } = await supabase.from('posts').insert({
        user_id: aid,
        body: body.trim(),
        article_title: title.trim(),
        read_minutes: minutes,
        image_url: imageUrl,
      });
      if (error) throw error;
      Alert.alert('Published', 'Your article is live in the feed.');
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Could not publish', e?.message || 'Try again.');
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
            <Text style={s.backChev}>{'\u2039'}</Text><Text style={s.backLbl}>Back</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>Article</Text>
          <TouchableOpacity onPress={publish} disabled={busy} activeOpacity={0.8} style={{ width: 70, alignItems: 'flex-end' }}>
            {busy ? <ActivityIndicator color={NAVY} size={14} /> : <Text style={s.publish}>Publish</Text>}
          </TouchableOpacity>
        </View>
        <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: Math.max(insets.bottom + 120, 140) }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <TextInput value={title} onChangeText={setTitle} placeholder="Title" placeholderTextColor="#9CA3AF" multiline style={s.title} />
          <TouchableOpacity onPress={pickCover} activeOpacity={0.85} style={s.coverBtn}>
            {cover ? <Image source={{ uri: cover }} style={s.cover} /> : <Text style={s.coverTxt}>Add a cover image (optional)</Text>}
          </TouchableOpacity>
          <Text style={s.meta}>{minutes} min read {'\u00b7'} publishing as {profile?.full_name || 'you'}</Text>
          <TextInput value={body} onChangeText={setBody} placeholder="Write the piece. Paragraphs are preserved exactly as you write them." placeholderTextColor="#9CA3AF" multiline style={s.body} textAlignVertical="top" />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  backBtn: { flexDirection: 'row', alignItems: 'center', width: 70 },
  backChev: { fontSize: 26, color: NAVY, marginRight: 2, marginTop: -3 },
  backLbl: { fontSize: 15, color: NAVY, fontWeight: '600' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: NAVY },
  publish: { fontSize: 15, fontWeight: '800', color: NAVY },
  title: { fontSize: 24, fontWeight: '800', color: NAVY, paddingVertical: 8, lineHeight: 30 },
  coverBtn: { borderWidth: 1.2, borderColor: 'rgba(11,30,61,0.12)', borderRadius: 14, minHeight: 54, alignItems: 'center', justifyContent: 'center', marginBottom: 10, overflow: 'hidden' },
  cover: { width: '100%', height: 180 },
  coverTxt: { fontSize: 13, color: 'rgba(11,30,61,0.45)', fontWeight: '600', paddingVertical: 16 },
  meta: { fontSize: 12, color: 'rgba(11,30,61,0.45)', fontWeight: '600', marginBottom: 10 },
  body: { fontSize: 16, lineHeight: 25, color: NAVY, minHeight: 320, paddingBottom: 40 },
});