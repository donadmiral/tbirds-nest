/**
 * TicketScreen - one ticket, the whole conversation. The member reads
 * the operations replies and writes back; writing reopens the ticket.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, TextInput, Alert, ActivityIndicator, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

const NAVY = '#0B1E3D';
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: 'Open', color: '#B03A3A', bg: 'rgba(176,58,58,0.08)' },
  pending: { label: 'Replied - your turn', color: '#B08D3F', bg: 'rgba(176,141,63,0.1)' },
  solved: { label: 'Solved', color: '#1D7A38', bg: 'rgba(29,122,56,0.08)' },
};

export default function TicketScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  let tabH = 0; try { tabH = useBottomTabBarHeight(); } catch {}
  const { profile } = useAuthStore();
  const ticketId: string = route.params?.ticketId;
  const [ticket, setTicket] = useState<any>(route.params?.ticket ?? null);
  const [msgs, setMsgs] = useState<any[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ticketId) return;
    const [t, m] = await Promise.all([
      supabase.from('support_tickets').select('*').eq('id', ticketId).maybeSingle(),
      supabase.from('support_messages').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true }),
    ]);
    if (t.data) setTicket(t.data);
    setMsgs(m.data ?? []);
  }, [ticketId]);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!draft.trim() || busy || !profile?.id || !ticketId) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('support_messages').insert({
        ticket_id: ticketId, sender: 'member', sender_id: profile.id, body: draft.trim(),
      });
      if (error) throw error;
      await supabase.from('support_tickets').update({ status: 'open', updated_at: new Date().toISOString() }).eq('id', ticketId);
      setDraft('');
      await load();
    } catch (e: any) {
      Alert.alert('Could not send', e?.message || 'Try again.');
    } finally { setBusy(false); }
  };

  const meta = STATUS_META[ticket?.status] || STATUS_META.open;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
            <Text style={s.backChev}>{'\u2039'}</Text><Text style={s.backLbl}>Back</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle} numberOfLines={1}>{ticket?.subject || 'Ticket'}</Text>
          <View style={{ width: 60, alignItems: 'flex-end' }}>
            <View style={[s.pill, { backgroundColor: meta.bg }]}><Text style={[s.pillTxt, { color: meta.color }]}>{meta.label}</Text></View>
          </View>
        </View>
        <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
          {msgs === null ? (
            <View style={{ paddingTop: 50, alignItems: 'center' }}><ActivityIndicator color={NAVY} /></View>
          ) : msgs.map(m => (
            <View key={m.id} style={[s.bubble, m.sender === 'member' ? s.mine : s.theirs]}>
              <Text style={[s.bubbleTxt, m.sender === 'member' && { color: '#FFFFFF' }]}>{m.body}</Text>
              <Text style={[s.bubbleWhen, m.sender === 'member' && { color: 'rgba(255,255,255,0.6)' }]}>
                {m.sender === 'member' ? 'You' : 'Platinum Circles'} {'\u00b7'} {new Date(m.created_at).toLocaleString()}
              </Text>
            </View>
          ))}
        </ScrollView>
        <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, 10) + tabH + 8 }]}>
          <TextInput value={draft} onChangeText={setDraft} placeholder={ticket?.status === 'solved' ? 'Write to reopen this ticket' : 'Write a reply'} placeholderTextColor="#9CA3AF" multiline style={s.input} />
          <TouchableOpacity style={[s.send, (busy || !draft.trim()) && { opacity: 0.4 }]} onPress={send} disabled={busy || !draft.trim()} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color="#FFFFFF" size={14} /> : <Text style={s.sendTxt}>Send</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  backBtn: { flexDirection: 'row', alignItems: 'center', width: 60 },
  backChev: { fontSize: 26, color: NAVY, marginRight: 2, marginTop: -3 },
  backLbl: { fontSize: 15, color: NAVY, fontWeight: '600' },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: NAVY, textAlign: 'center', marginHorizontal: 6 },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillTxt: { fontSize: 9.5, fontWeight: '800' },
  bubble: { maxWidth: '82%', borderRadius: 14, padding: 11, marginBottom: 8 },
  mine: { alignSelf: 'flex-end', backgroundColor: NAVY },
  theirs: { alignSelf: 'flex-start', backgroundColor: '#F4F5F7' },
  bubbleTxt: { fontSize: 13.5, lineHeight: 19, color: NAVY },
  bubbleWhen: { fontSize: 10, color: 'rgba(11,30,61,0.4)', marginTop: 5 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(11,30,61,0.08)' },
  input: { flex: 1, borderWidth: 1.2, borderColor: 'rgba(11,30,61,0.14)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: NAVY, maxHeight: 110 },
  send: { backgroundColor: NAVY, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 11 },
  sendTxt: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '800' },
});
