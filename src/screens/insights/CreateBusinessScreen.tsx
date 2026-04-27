/**
 * CreateBusinessScreen.tsx
 * Form to create or edit a business profile.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  ActivityIndicator, Alert, StatusBar, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

const NAVY = '#0B1E3D';
const TEXT_PRIMARY = '#000000';
const TEXT_SECONDARY = '#8E8E93';
const HAIRLINE = '#E5E5EA';

const CATEGORIES = [
  'Consulting', 'Technology', 'Finance', 'Food & Beverage',
  'Education', 'Health & Wellness', 'Design & Creative',
  'Retail', 'Media', 'Non-profit', 'Events', 'Other',
];

export default function CreateBusinessScreen() {
  const navigation = useNavigation<any>();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [instagram, setInstagram] = useState('');
  const [twitter, setTwitter] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCategories, setShowCategories] = useState(false);

  const handleCreate = async () => {
    if (!userId) { Alert.alert('Not signed in'); return; }
    if (!name.trim()) { Alert.alert('Required', 'Business name is required.'); return; }
    if (!category) { Alert.alert('Required', 'Please select a category.'); return; }
    if (!bio.trim()) { Alert.alert('Required', 'Please add a description of your business.'); return; }

    setSaving(true);
    try {
      const socialLinks: Record<string, string> = {};
      if (instagram.trim()) socialLinks.instagram = instagram.trim();
      if (twitter.trim()) socialLinks.twitter = twitter.trim();

      const { data, error } = await supabase.from('business_profiles').insert({
        owner_id: userId,
        name: name.trim(),
        bio: bio.trim(),
        category,
        location: location.trim() || null,
        address: address.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        website: website.trim() || null,
        social_links: Object.keys(socialLinks).length > 0 ? socialLinks : null,
      }).select('id').single();

      if (error) {
        Alert.alert('Error', error.message);
        return;
      }

      Alert.alert('Business created', 'Your business profile is now live.');
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not create business.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />

      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={st.cancelTxt}>Cancel</Text>
        </TouchableOpacity>
        <Text style={st.headerTitle}>New Business</Text>
        <TouchableOpacity onPress={handleCreate} disabled={saving}>
          {saving ? <ActivityIndicator color={NAVY} size={16} /> : <Text style={st.saveTxt}>Create</Text>}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          <InputField label="Business Name *" value={name} onChangeText={setName} placeholder="Your business name" autoCapitalize="words" />

          <View style={st.field}>
            <Text style={st.fieldLabel}>Category *</Text>
            <TouchableOpacity style={st.picker} onPress={() => setShowCategories(p => !p)} activeOpacity={0.7}>
              <Text style={[st.pickerTxt, !category && { color: '#C7C7CC' }]}>{category || 'Select a category...'}</Text>
              <Feather name={showCategories ? 'chevron-up' : 'chevron-down'} size={16} color={TEXT_SECONDARY} />
            </TouchableOpacity>
            {showCategories && (
              <View style={st.dropList}>
                {CATEGORIES.map(c => (
                  <TouchableOpacity key={c} style={[st.dropItem, category === c && st.dropItemOn]} onPress={() => { setCategory(c); setShowCategories(false); }}>
                    <Text style={[st.dropTxt, category === c && { color: NAVY, fontWeight: '600' }]}>{c}</Text>
                    {category === c && <Feather name="check" size={14} color={NAVY} />}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          <View style={st.field}>
            <Text style={st.fieldLabel}>Description *</Text>
            <TextInput
              value={bio}
              onChangeText={setBio}
              placeholder="What does your business do? Why should people support it?"
              placeholderTextColor="#C7C7CC"
              style={[st.input, st.inputMulti]}
              multiline
              textAlignVertical="top"
              maxLength={2000}
            />
            {bio.length > 1800 && <Text style={st.charCount}>{2000 - bio.length} left</Text>}
          </View>

          <InputField label="Location" value={location} onChangeText={setLocation} placeholder="City, Country" autoCapitalize="words" />
          <InputField label="Address (optional)" value={address} onChangeText={setAddress} placeholder="Street address" autoCapitalize="words" />

          <Text style={st.sectionLabel}>Contact Information</Text>
          <InputField label="Phone" value={phone} onChangeText={setPhone} placeholder="+1 234 567 8900" keyboardType="phone-pad" />
          <InputField label="Email" value={email} onChangeText={setEmail} placeholder="business@example.com" keyboardType="email-address" autoCapitalize="none" />
          <InputField label="Website" value={website} onChangeText={setWebsite} placeholder="https://yourbusiness.com" autoCapitalize="none" keyboardType="url" />

          <Text style={st.sectionLabel}>Social Links</Text>
          <InputField label="Instagram" value={instagram} onChangeText={setInstagram} placeholder="@yourbusiness" autoCapitalize="none" />
          <InputField label="Twitter / X" value={twitter} onChangeText={setTwitter} placeholder="@yourbusiness" autoCapitalize="none" />

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function InputField({ label, value, onChangeText, placeholder, autoCapitalize, keyboardType }: {
  label: string; value: string; onChangeText: (t: string) => void; placeholder: string;
  autoCapitalize?: 'none' | 'words' | 'sentences'; keyboardType?: any;
}) {
  return (
    <View style={st.field}>
      <Text style={st.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#C7C7CC"
        style={st.input}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
      />
    </View>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE },
  cancelTxt: { fontSize: 17, color: TEXT_SECONDARY, minWidth: 60 },
  headerTitle: { fontSize: 17, fontWeight: '600', color: TEXT_PRIMARY },
  saveTxt: { fontSize: 17, fontWeight: '700', color: NAVY, textAlign: 'right', minWidth: 60 },
  scroll: { padding: 20, paddingBottom: 60 },
  field: { marginBottom: 20 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: TEXT_SECONDARY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  input: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, color: TEXT_PRIMARY },
  inputMulti: { minHeight: 110, paddingTop: 13, textAlignVertical: 'top' },
  charCount: { fontSize: 12, color: '#FF3B30', textAlign: 'right', marginTop: 4 },
  picker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13 },
  pickerTxt: { fontSize: 16, color: TEXT_PRIMARY, flex: 1 },
  dropList: { marginTop: 4, backgroundColor: '#FFF', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE, overflow: 'hidden' },
  dropItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  dropItemOn: { backgroundColor: '#F2F2F7' },
  dropTxt: { fontSize: 15, color: TEXT_PRIMARY },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: TEXT_PRIMARY, marginTop: 8, marginBottom: 14 },
});