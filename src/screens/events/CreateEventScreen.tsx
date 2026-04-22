import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, Image, StatusBar,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { pickFromLibrary, uploadMedia } from '../../services/mediaService';

const CATEGORIES = [
  'Social', 'Sports', 'Volunteering', 'Study', 'Food',
  'Networking', 'Travel', 'Games', 'Other',
];

export default function CreateEventScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Social');
  const [location, setLocation] = useState('');
  const [eventTime, setEventTime] = useState('');
  const [description, setDescription] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageExt, setImageExt] = useState<string>('jpg');
  const [submitting, setSubmitting] = useState(false);

  const pickImage = async () => {
    try {
      const picked = await pickFromLibrary({ allowVideos: false, multiple: false, quality: 0.85 });
      if (!picked.length) return;
      setImageUri(picked[0].uri);
      setImageExt(picked[0].ext);
    } catch (e: any) {
      Alert.alert('Could not open photos', e?.message ?? 'Unknown error');
    }
  };

  const submit = async () => {
    if (!userId) { Alert.alert('Not signed in', 'Please sign in and try again.'); return; }
    if (!title.trim()) { Alert.alert('Title required'); return; }
    if (!location.trim()) { Alert.alert('Location required'); return; }
    if (!eventTime.trim()) { Alert.alert('Date and time required', 'Enter when the event takes place.'); return; }

    setSubmitting(true);
    try {
      let imageUrl: string | null = null;
      if (imageUri) {
        const { url } = await uploadMedia(
          'mingle-media',
          userId,
          {
            uri: imageUri,
            kind: 'image',
            ext: imageExt,
            mimeType: imageExt === 'png' ? 'image/png' : 'image/jpeg',
            base64: null,
          }
        );
        imageUrl = url;
      }

      const { error } = await supabase.from('mingle_posts').insert({
        host_id: userId,
        title: title.trim(),
        category,
        location: location.trim(),
        event_time: eventTime.trim(),
        description: description.trim() || null,
        image_url: imageUrl,
      });

      if (error) {
        console.log('[CREATE_EVENT]', error.message);
        Alert.alert('Could not create event', error.message);
        return;
      }

      navigation.goBack();
    } catch (e: any) {
      console.log('[CREATE_EVENT_CATCH]', e);
      Alert.alert('Error', e?.message ?? 'Could not create event.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.cancelBtn}>
          <Text style={s.cancelTxt}>Cancel</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Host an event</Text>
        <TouchableOpacity onPress={submit} disabled={submitting} style={s.publishBtn}>
          {submitting
            ? <ActivityIndicator size={14} color="#007AFF" />
            : <Text style={s.publishTxt}>Publish</Text>}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 60 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity style={s.imagePicker} onPress={pickImage} activeOpacity={0.85}>
            {imageUri
              ? <Image source={{ uri: imageUri }} style={s.imagePreview} />
              : (
                <View style={s.imagePlaceholder}>
                  <Feather name="camera" size={28} color="#9CA3AF" />
                  <Text style={s.imagePlaceholderTxt}>Add a cover photo</Text>
                </View>
              )}
          </TouchableOpacity>

          <View style={s.field}>
            <Text style={s.label}>Title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Thursday pub night"
              placeholderTextColor="#9CA3AF"
              style={s.input}
              maxLength={80}
            />
          </View>

          <View style={s.field}>
            <Text style={s.label}>Category</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.chipRow}
            >
              {CATEGORIES.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[s.chip, category === c && s.chipActive]}
                  onPress={() => setCategory(c)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.chipTxt, category === c && s.chipTxtActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View style={s.field}>
            <Text style={s.label}>Where</Text>
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder="Place, address, or virtual"
              placeholderTextColor="#9CA3AF"
              style={s.input}
            />
          </View>

          <View style={s.field}>
            <Text style={s.label}>When</Text>
            <TextInput
              value={eventTime}
              onChangeText={setEventTime}
              placeholder="Thursday 7:00 PM"
              placeholderTextColor="#9CA3AF"
              style={s.input}
            />
            <Text style={s.hint}>Free-form for now. Include date and time.</Text>
          </View>

          <View style={s.field}>
            <Text style={s.label}>Description</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="What is this event about? What should people expect?"
              placeholderTextColor="#9CA3AF"
              style={[s.input, s.inputMulti]}
              multiline
              textAlignVertical="top"
              maxLength={500}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0',
  },
  cancelBtn: { minWidth: 70 },
  cancelTxt: { fontSize: 15, color: '#6B7280', fontWeight: '500' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#000' },
  publishBtn: { minWidth: 70, alignItems: 'flex-end' },
  publishTxt: { fontSize: 15, fontWeight: '700', color: '#007AFF' },
  content: { padding: 16 },
  imagePicker: {
    height: 180, borderRadius: 14, backgroundColor: '#F5F5F5',
    overflow: 'hidden', marginBottom: 20,
  },
  imagePreview: { width: '100%', height: '100%' },
  imagePlaceholder: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  imagePlaceholderTxt: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  field: { marginBottom: 18 },
  label: {
    fontSize: 13, fontWeight: '700', color: '#6B7280',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
  },
  input: {
    backgroundColor: '#F5F5F5', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#000',
  },
  inputMulti: { minHeight: 100, paddingTop: 12 },
  hint: { fontSize: 12, color: '#9CA3AF', marginTop: 6 },
  chipRow: { gap: 8, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, backgroundColor: '#F5F5F5',
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  chipActive: { backgroundColor: '#000', borderColor: '#000' },
  chipTxt: { fontSize: 13, fontWeight: '600', color: '#3C3C43' },
  chipTxtActive: { color: '#FFF' },
});
