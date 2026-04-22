import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  ActivityIndicator, Alert, StatusBar, Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../services/supabase';

const FAQ = [
  { q: 'Account issues', a: 'Try signing out and back in. If the problem continues, submit a support ticket.' },
  { q: 'Messaging not working', a: 'Make sure both users are signed in and on the latest app version. Check your internet connection.' },
  { q: 'Profile not loading', a: 'Pull down to refresh. If the issue persists, sign out and back in.' },
  { q: 'Feature requests', a: 'Use the support form below and describe the feature you want. We read every submission.' },
  { q: 'Report a user', a: 'Open the three-dot menu on any post or profile and tap Report.' },
];

export default function HelpSupportScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile, session } = useAuthStore();
  const myId = profile?.id ?? session?.user?.id ?? null;

  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  const openEmail = () => {
    Linking.openURL('mailto:support@tbirdsnest.app?subject=TBirds%20Nest%20Support').catch(() =>
      Alert.alert('No email app', 'Set up an email app on your device to contact us this way.')
    );
  };

  const submitTicket = async () => {
    if (!subject.trim() || !message.trim()) { Alert.alert('Required', 'Please enter a subject and message.'); return; }
    if (!myId) { Alert.alert('Error', 'You must be signed in.'); return; }
    setSending(true);
    try {
      const { error } = await supabase.from('support_tickets').insert([{ user_id: myId, subject: subject.trim(), message: message.trim(), status: 'open' }]);
      if (error) { Alert.alert('Error', error.message); return; }
      setSubject(''); setMessage('');
      Alert.alert('Submitted!', 'We received your request and will follow up within 24 hours.');
    } catch { Alert.alert('Error', 'Could not submit. Please try again.'); }
    finally { setSending(false); }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>‹</Text><Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Help & Support</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom + 40, 60) }]} keyboardShouldPersistTaps="handled">

        {/* Quick contact */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Get Help Fast</Text>
          <Text style={s.sectionDesc}>Submit a support request below or contact us directly by email. We respond within 24 hours.</Text>
          <TouchableOpacity style={s.emailBtn} onPress={openEmail} activeOpacity={0.8}>
            <Feather name="mail" size={16} color="#007AFF" />
            <Text style={s.emailBtnTxt}>Email support@tbirdsnest.app</Text>
          </TouchableOpacity>
        </View>

        {/* FAQ */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Quick Answers</Text>
          {FAQ.map((item, i) => (
            <TouchableOpacity key={i} style={[s.faqItem, i < FAQ.length - 1 && s.faqItemBorder]} onPress={() => setExpandedFaq(expandedFaq === i ? null : i)} activeOpacity={0.75}>
              <View style={s.faqRow}>
                <Text style={s.faqQ}>{item.q}</Text>
                <Feather name={expandedFaq === i ? 'chevron-up' : 'chevron-down'} size={16} color="#8E8E93" />
              </View>
              {expandedFaq === i && <Text style={s.faqA}>{item.a}</Text>}
            </TouchableOpacity>
          ))}
        </View>

        {/* Submit ticket */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Submit a Request</Text>
          <View style={s.field}>
            <Text style={s.fieldLabel}>Subject</Text>
            <TextInput value={subject} onChangeText={setSubject} placeholder="Login issue, bug report, feature idea..." placeholderTextColor="#C7C7CC" style={s.input} />
          </View>
          <View style={s.field}>
            <Text style={s.fieldLabel}>Message</Text>
            <TextInput value={message} onChangeText={setMessage} placeholder="Describe the problem in detail. Include what you expected vs what happened." placeholderTextColor="#C7C7CC" style={[s.input, s.inputMulti]} multiline textAlignVertical="top" />
          </View>
          <TouchableOpacity style={[s.submitBtn, sending && s.submitBtnDisabled]} onPress={submitTicket} disabled={sending} activeOpacity={0.85}>
            {sending ? <ActivityIndicator color="#FFF" /> : <Text style={s.submitBtnTxt}>Submit Request</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F2F2F7' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#F2F2F7' },
  backBtn: { flexDirection: 'row', alignItems: 'center', minWidth: 60 },
  backChev: { fontSize: 30, color: '#007AFF', lineHeight: 34, marginRight: 1 },
  backLbl: { fontSize: 17, color: '#007AFF' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#000' },
  scroll: { paddingHorizontal: 16, paddingTop: 8 },
  section: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 20 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#000', marginBottom: 8 },
  sectionDesc: { fontSize: 14, color: '#3C3C43', lineHeight: 20, marginBottom: 14 },
  emailBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#EFF6FF', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  emailBtnTxt: { fontSize: 15, fontWeight: '600', color: '#007AFF' },
  faqItem: { paddingVertical: 14 },
  faqItemBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  faqRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  faqQ: { fontSize: 15, fontWeight: '600', color: '#000', flex: 1, paddingRight: 8 },
  faqA: { fontSize: 14, color: '#3C3C43', lineHeight: 20, marginTop: 8 },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 },
  input: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#000' },
  inputMulti: { minHeight: 120, paddingTop: 12 },
  submitBtn: { backgroundColor: '#000', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnTxt: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});