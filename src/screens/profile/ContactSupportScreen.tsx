import KeyboardSafe from '../../components/KeyboardSafe';
/**
 * ContactSupportScreen - the member's line to operations. A normal
 * account sends a support ticket; a suspended account sends an appeal.
 * Replies land as ticket resolutions visible right here.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

const NAVY = '#0B1E3D';

export default function ContactSupportScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const isAppeal = !!(profile as any)?.deactivated_at;

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
    if (!subject.trim() || !body.trim()) { Alert.alert('Both fields', 'A subject and a message are required.'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from('support_tickets').insert({
        user_id: profile.id, kind: isAppeal ? 'appeal' : 'support',
        subject: subject.trim(), body: body.trim(),
      });
      if (error) throw error;
      setSubject(isAppeal ? 'Appeal my suspension' : ''); setBody('');
      await load();
      Alert.alert('Sent', isAppeal ? 'Your appeal is with the operations team. The outcome will appear here.' : 'Your message is with the operations team. The reply will appear here.');
    } catch (e: any) {
      Alert.alert('Could not send', e?.message || 'Try again.');
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>{'\u2039'}</Text><Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{isAppeal ? 'Appeal' : 'Support'}</Text>
        <View style={{ width: 60 }} />
      </View>
      <KeyboardSafe>
      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: Math.max(insets.bottom + 110, 130) }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={s.lede}>{isAppeal
          ? 'Your account is suspended. Tell the operations team why it should be restored - a person reads every appeal.'
          : 'Write to the Platinum Circles operations team. A person reads every message and the reply appears on this screen.'}</Text>
        <TextInput value={subject} onChangeText={setSubject} placeholder="Subject" placeholderTextColor="#9CA3AF" style={s.input} />
        <TextInput value={body} onChangeText={setBody} multiline placeholder={isAppeal ? 'Your case for restoration...' : 'What do you need help with?'} placeholderTextColor="#9CA3AF" style={[s.input, { minHeight: 120, textAlignVertical: 'top' }]} />
        <TouchableOpacity style={[s.submit, busy && { opacity: 0.5 }]} onPress={submit} disabled={busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator color="#FFFFFF" size={16} /> : <Text style={s.submitTxt}>{isAppeal ? 'Send appeal' : 'Send to operations'}</Text>}
        </TouchableOpacity>

        {tickets.length ? <Text style={s.histLabel}>Your messages</Text> : null}
        {tickets.map(t => (
          <TouchableOpacity key={t.id} style={s.ticket} activeOpacity={0.75} onPress={() => (navigation as any).navigate('Ticket', { ticketId: t.id, ticket: t })}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={s.ticketSubject} numberOfLines={1}>{t.subject}</Text>
              <View style={[s.pill, t.status === 'solved' ? s.pillDone : t.status === 'pending' ? s.pillPend : s.pillOpen]}>
                <Text style={[s.pillTxt, t.status === 'solved' ? s.pillTxtDone : t.status === 'pending' ? s.pillTxtPend : s.pillTxtOpen]}>{t.status === 'solved' ? 'Solved' : t.status === 'pending' ? 'Replied - open it' : 'With the team'}</Text>
              </View>
              <Text style={{ fontSize: 18, color: 'rgba(11,30,61,0.3)', marginLeft: 8 }}>{'\u203a'}</Text>
            </View>
            <Text style={s.when}>{new Date(t.updated_at || t.created_at).toLocaleString()}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      </KeyboardSafe>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  backBtn: { flexDirection: 'row', alignItems: 'center', width: 60 },
  backChev: { fontSize: 26, color: NAVY, marginRight: 2, marginTop: -3 },
  backLbl: { fontSize: 15, color: NAVY, fontWeight: '600' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: NAVY },
  lede: { fontSize: 13, lineHeight: 19, color: 'rgba(11,30,61,0.6)', marginBottom: 14, marginTop: 4 },
  input: { borderWidth: 1.2, borderColor: 'rgba(11,30,61,0.14)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: NAVY, marginBottom: 10, backgroundColor: '#FFFFFF' },
  submit: { backgroundColor: NAVY, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  submitTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  histLabel: { fontSize: 12, fontWeight: '800', color: 'rgba(11,30,61,0.45)', marginTop: 22, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  ticket: { borderWidth: 1.2, borderColor: 'rgba(11,30,61,0.1)', borderRadius: 14, padding: 12, marginBottom: 10 },
  ticketSubject: { flex: 1, fontSize: 13.5, fontWeight: '700', color: NAVY, marginRight: 8 },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillOpen: { backgroundColor: 'rgba(180,83,9,0.1)' },
  pillDone: { backgroundColor: 'rgba(5,150,105,0.1)' },
  pillPend: { backgroundColor: 'rgba(176,141,63,0.12)' },
  pillTxt: { fontSize: 10.5, fontWeight: '800' },
  pillTxtOpen: { color: '#B45309' },
  pillTxtDone: { color: '#059669' },
  pillTxtPend: { color: '#B08D3F' },
  reply: { fontSize: 13, lineHeight: 18, color: 'rgba(11,30,61,0.75)', marginTop: 8, backgroundColor: 'rgba(11,30,61,0.04)', borderRadius: 10, padding: 10 },
  when: { fontSize: 11, color: 'rgba(11,30,61,0.4)', marginTop: 8 },
});
