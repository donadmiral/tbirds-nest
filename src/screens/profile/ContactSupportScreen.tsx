import KeyboardSafe from '../../components/KeyboardSafe';
/**
 * ContactSupportScreen - the member's line to operations. A normal
 * account sends a support ticket; a suspended account sends an appeal.
 * Replies land as ticket resolutions visible right here.
 *
 * Laid out like the Messages list: a topic row so the team can route
 * it, a labelled subject and a proper writing box, one line about who
 * reads it, and past messages as hairline rows with a status pill.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

const NAVY = '#0B1E3D';
const TOPICS = ['Account', 'Payments', 'Orders', 'Something broke', 'Safety', 'Other'];

function ago(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000); if (m < 1) return 'Just now'; if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
  const days = Math.floor(h / 24); if (days < 7) return days + 'd ago';
  return new Date(iso).toLocaleDateString();
}

export default function ContactSupportScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const isAppeal = !!(profile as any)?.deactivated_at;

  const [topic, setTopic] = useState<string | null>(isAppeal ? 'Account' : null);
  const [subject, setSubject] = useState(isAppeal ? 'Appeal my suspension' : '');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [tickets, setTickets] = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const { data } = await supabase.from('support_tickets')
      .select('id, kind, subject, status, created_at, updated_at')
      .eq('user_id', profile.id).order('created_at', { ascending: false }).limit(10);
    setTickets(data ?? []);
  }, [profile?.id]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!profile?.id || busy) return;
    if (!isAppeal && !topic) { Alert.alert('Pick a topic', 'It sends your message to the right person.'); return; }
    if (!subject.trim() || !body.trim()) { Alert.alert('Both fields', 'A subject and a message are required.'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from('support_tickets').insert({
        user_id: profile.id, kind: isAppeal ? 'appeal' : 'support',
        subject: (topic && !isAppeal ? topic + ': ' : '') + subject.trim(), body: body.trim(),
      });
      if (error) throw error;
      setSubject(isAppeal ? 'Appeal my suspension' : ''); setBody(''); if (!isAppeal) setTopic(null);
      await load();
      Alert.alert('Sent', isAppeal ? 'Your appeal is with the operations team. The outcome appears here.' : 'Your message is with the operations team. The reply appears here and as a notification.');
    } catch (e: any) {
      Alert.alert('Could not send', e?.message || 'Try again.');
    } finally { setBusy(false); }
  };

  const statusOf = (t: any) => t.status === 'solved' ? { label: 'Solved', bg: 'rgba(5,150,105,0.1)', fg: '#059669' } : t.status === 'pending' ? { label: 'Replied', bg: 'rgba(11,30,61,0.08)', fg: NAVY } : { label: 'With the team', bg: 'rgba(217,119,6,0.12)', fg: '#D97706' };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="chevron-left" size={26} color={NAVY} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{isAppeal ? 'Appeal' : 'Contact support'}</Text>
        <View style={{ width: 40 }} />
      </View>
      <KeyboardSafe>
      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 110, 130) }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={s.lede}>{isAppeal
          ? 'Your account is suspended. Tell the operations team why it should be restored. A person reads every appeal.'
          : 'A person on the operations team reads every message. The reply appears on this screen and as a notification.'}</Text>

        {!isAppeal ? (
          <View style={s.section}>
            <Text style={s.label}>Topic</Text>
            <View style={s.chips}>
              {TOPICS.map(t => { const on = topic === t; return (
                <TouchableOpacity key={t} onPress={() => setTopic(t)} activeOpacity={0.8} style={[s.chip, on && s.chipOn]}>
                  <Text style={[s.chipTxt, on && s.chipTxtOn]}>{t}</Text>
                </TouchableOpacity>
              ); })}
            </View>
          </View>
        ) : null}

        <View style={s.section}>
          <Text style={s.label}>Subject</Text>
          <TextInput value={subject} onChangeText={setSubject} placeholder={isAppeal ? 'Appeal my suspension' : 'In a few words'} placeholderTextColor="rgba(11,30,61,0.35)" style={s.input} maxLength={120} returnKeyType="next" />
        </View>

        <View style={s.section}>
          <Text style={s.label}>Message</Text>
          <TextInput value={body} onChangeText={setBody} multiline placeholder={isAppeal ? 'Your case for restoration' : 'What happened, and what you expected'} placeholderTextColor="rgba(11,30,61,0.35)" style={[s.input, s.box]} maxLength={2000} textAlignVertical="top" />
          <Text style={s.count}>{body.length} / 2000</Text>
        </View>

        <View style={s.section}>
          <TouchableOpacity style={[s.submit, busy && { opacity: 0.5 }]} onPress={submit} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color="#FFFFFF" size={16} /> : <Text style={s.submitTxt}>{isAppeal ? 'Send appeal' : 'Send'}</Text>}
          </TouchableOpacity>
        </View>

        {tickets.length ? (
          <View style={{ marginTop: 22 }}>
            <Text style={[s.label, { paddingHorizontal: 16 }]}>Your messages</Text>
            {tickets.map((t, i) => { const st = statusOf(t); return (
              <TouchableOpacity key={t.id} style={[s.row, i === 0 && s.rowFirst]} activeOpacity={0.75} onPress={() => (navigation as any).navigate('Ticket', { ticketId: t.id, ticket: t })}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.rowSubject} numberOfLines={1}>{t.subject}</Text>
                  <Text style={s.rowWhen}>{ago(t.updated_at || t.created_at)}</Text>
                </View>
                <View style={[s.pill, { backgroundColor: st.bg }]}><Text style={[s.pillTxt, { color: st.fg }]}>{st.label}</Text></View>
                <Feather name="chevron-right" size={18} color="rgba(11,30,61,0.3)" />
              </TouchableOpacity>
            ); })}
          </View>
        ) : null}
      </ScrollView>
      </KeyboardSafe>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, height: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(11,30,61,0.08)' },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: NAVY },
  lede: { fontSize: 13.5, lineHeight: 19, color: 'rgba(11,30,61,0.6)', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  section: { paddingHorizontal: 16, marginTop: 14 },
  label: { fontSize: 12, fontWeight: '800', color: 'rgba(11,30,61,0.45)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(11,30,61,0.14)', backgroundColor: '#FFFFFF' },
  chipOn: { backgroundColor: NAVY, borderColor: NAVY },
  chipTxt: { fontSize: 13, fontWeight: '600', color: NAVY },
  chipTxtOn: { color: '#FFFFFF' },
  input: { borderWidth: 1, borderColor: 'rgba(11,30,61,0.14)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: NAVY, backgroundColor: '#FFFFFF' },
  box: { minHeight: 150, lineHeight: 21, paddingTop: 11 },
  count: { fontSize: 11.5, color: 'rgba(11,30,61,0.4)', marginTop: 6, textAlign: 'right' },
  submit: { backgroundColor: NAVY, borderRadius: 12, height: 48, alignItems: 'center', justifyContent: 'center' },
  submitTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(11,30,61,0.08)' },
  rowFirst: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(11,30,61,0.08)' },
  rowSubject: { fontSize: 14.5, fontWeight: '700', color: NAVY },
  rowWhen: { fontSize: 12, color: 'rgba(11,30,61,0.45)', marginTop: 2 },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  pillTxt: { fontSize: 11, fontWeight: '800' },
});