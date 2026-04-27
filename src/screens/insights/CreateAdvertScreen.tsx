/**
 * CreateAdvertScreen.tsx
 * Form to create a business advert/post.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  ActivityIndicator, Alert, StatusBar, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

const NAVY = '#0B1E3D';
const TEXT_PRIMARY = '#000000';
const TEXT_SECONDARY = '#8E8E93';
const HAIRLINE = '#E5E5EA';

const CTA_OPTIONS = ['Learn More', 'Visit Site', 'Contact Us', 'Book Now', 'Download', 'Sign Up', 'Get Quote', 'Shop Now'];

export default function CreateAdvertScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const businessId = route.params?.businessId ?? null;
  const businessName = route.params?.businessName ?? 'Your Business';

  const [body, setBody] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [ctaLabel, setCtaLabel] = useState('Learn More');
  const [saving, setSaving] = useState(false);
  const [showCta, setShowCta] = useState(false);

  const handleCreate = async () => {
    if (!userId || !businessId) { Alert.alert('Error', 'Missing business context.'); return; }
    if (!body.trim()) { Alert.alert('Required', 'Please write your advert content.'); return; }

    setSaving(true);
    try {
      const { error } = await supabase.from('business_posts').insert({
        business_id: businessId,
        owner_id: userId,
        body: body.trim(),
        link_url: linkUrl.trim() || null,
        link_title: linkTitle.trim() || null,
        cta_label: linkUrl.trim() ? ctaLabel : null,
      });

      if (error) {
        Alert.alert('Error', error.message);
        return;
      }

      Alert.alert('Advert posted', 'Your advert is now live.');
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not create advert.');
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
        <Text style={st.headerTitle}>New Advert</Text>
        <TouchableOpacity onPress={handleCreate} disabled={saving}>
          {saving ? <ActivityIndicator color={NAVY} size={16} /> : <Text style={st.saveTxt}>Post</Text>}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          <View style={st.bizBanner}>
            <View style={st.bizLogo}><Text style={{ fontSize: 14, fontWeight: '700', color: NAVY }}>
              {businessName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
            </Text></View>
            <View>
              <Text style={st.bizName}>{businessName}</Text>
              <Text style={st.bizSub}>Posting as this business</Text>
            </View>
          </View>

          <View style={st.field}>
            <Text style={st.fieldLabel}>Advert Content *</Text>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="What are you promoting? Be clear and compelling..."
              placeholderTextColor="#C7C7CC"
              style={[st.input, st.inputMulti]}
              multiline
              textAlignVertical="top"
              maxLength={2000}
              autoFocus
            />
            {body.length > 1800 && <Text style={st.charCount}>{2000 - body.length} left</Text>}
          </View>

          <View style={st.field}>
            <Text style={st.fieldLabel}>Link (optional)</Text>
            <TextInput
              value={linkUrl}
              onChangeText={setLinkUrl}
              placeholder="https://yourbusiness.com/offer"
              placeholderTextColor="#C7C7CC"
              style={st.input}
              autoCapitalize="none"
              keyboardType="url"
            />
          </View>

          {linkUrl.trim().length > 0 && (
            <>
              <View style={st.field}>
                <Text style={st.fieldLabel}>Link Preview Title</Text>
                <TextInput
                  value={linkTitle}
                  onChangeText={setLinkTitle}
                  placeholder="e.g. Free Consultation, Download Report"
                  placeholderTextColor="#C7C7CC"
                  style={st.input}
                />
              </View>

              <View style={st.field}>
                <Text style={st.fieldLabel}>Call to Action</Text>
                <TouchableOpacity style={st.picker} onPress={() => setShowCta(p => !p)} activeOpacity={0.7}>
                  <Text style={st.pickerTxt}>{ctaLabel}</Text>
                  <Feather name={showCta ? 'chevron-up' : 'chevron-down'} size={16} color={TEXT_SECONDARY} />
                </TouchableOpacity>
                {showCta && (
                  <View style={st.dropList}>
                    {CTA_OPTIONS.map(c => (
                      <TouchableOpacity key={c} style={[st.dropItem, ctaLabel === c && st.dropItemOn]} onPress={() => { setCtaLabel(c); setShowCta(false); }}>
                        <Text style={[st.dropTxt, ctaLabel === c && { color: NAVY, fontWeight: '600' }]}>{c}</Text>
                        {ctaLabel === c && <Feather name="check" size={14} color={NAVY} />}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            </>
          )}

          {/* Preview */}
          {body.trim().length > 0 && (
            <View style={st.preview}>
              <Text style={st.previewLabel}>Preview</Text>
              <View style={st.previewCard}>
                <View style={st.previewTop}>
                  <View style={st.previewLogo}><Text style={{ fontSize: 10, fontWeight: '700', color: NAVY }}>
                    {businessName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                  </Text></View>
                  <Text style={st.previewBizName}>{businessName}</Text>
                  <View style={st.previewBadge}><Text style={st.previewBadgeTxt}>Advert</Text></View>
                </View>
                <Text style={st.previewBody} numberOfLines={4}>{body}</Text>
                {linkUrl.trim() && (
                  <View style={st.previewLink}>
                    <Feather name="link" size={12} color={NAVY} />
                    <Text style={st.previewLinkTxt} numberOfLines={1}>{linkTitle || linkUrl}</Text>
                  </View>
                )}
                {linkUrl.trim() && ctaLabel && (
                  <View style={st.previewCta}><Text style={st.previewCtaTxt}>{ctaLabel}</Text></View>
                )}
              </View>
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE },
  cancelTxt: { fontSize: 17, color: TEXT_SECONDARY, minWidth: 60 },
  headerTitle: { fontSize: 17, fontWeight: '600', color: TEXT_PRIMARY },
  saveTxt: { fontSize: 17, fontWeight: '700', color: NAVY, textAlign: 'right', minWidth: 60 },
  scroll: { padding: 20, paddingBottom: 60 },
  bizBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F9F9F9', borderRadius: 14, padding: 12, marginBottom: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE },
  bizLogo: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  bizName: { fontSize: 15, fontWeight: '600', color: TEXT_PRIMARY },
  bizSub: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 1 },
  field: { marginBottom: 20 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: TEXT_SECONDARY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  input: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, color: TEXT_PRIMARY },
  inputMulti: { minHeight: 120, paddingTop: 13 },
  charCount: { fontSize: 12, color: '#FF3B30', textAlign: 'right', marginTop: 4 },
  picker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13 },
  pickerTxt: { fontSize: 16, color: TEXT_PRIMARY },
  dropList: { marginTop: 4, backgroundColor: '#FFF', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE, overflow: 'hidden' },
  dropItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  dropItemOn: { backgroundColor: '#F2F2F7' },
  dropTxt: { fontSize: 15, color: TEXT_PRIMARY },
  preview: { marginTop: 10 },
  previewLabel: { fontSize: 12, fontWeight: '700', color: TEXT_SECONDARY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  previewCard: { padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: '#F0F0F0', backgroundColor: '#FFF' },
  previewTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  previewLogo: { width: 26, height: 26, borderRadius: 7, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  previewBizName: { fontSize: 13, fontWeight: '600', color: TEXT_PRIMARY, flex: 1 },
  previewBadge: { backgroundColor: '#F2F2F7', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  previewBadgeTxt: { fontSize: 10, fontWeight: '600', color: TEXT_SECONDARY },
  previewBody: { fontSize: 14, color: '#1A1A1A', lineHeight: 20, marginBottom: 8 },
  previewLink: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F2F2F7', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8 },
  previewLinkTxt: { fontSize: 13, color: NAVY, fontWeight: '500', flex: 1 },
  previewCta: { alignSelf: 'flex-start', backgroundColor: NAVY, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  previewCtaTxt: { fontSize: 13, fontWeight: '600', color: '#FFF' },
});