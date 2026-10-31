import { settingsBack } from '../../navigation/settingsNavigation';
import { themedSheet, useTheme } from '../../theme/useTheme';
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StatusBar, TextInput, Alert, ActivityIndicator, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { replyToMemberSupport } from '../../services/memberSupportService';
import { readSupportConversation, supportError, type SupportTicket, type SupportMessage } from '../../../shared/memberSupport';

const STATUS_LABEL: Record<string, string> = { open: 'Open', pending: 'Replied - your turn', solved: 'Solved' };

export default function TicketScreen() {
  const navigation = useNavigation<any>();
  const { t, isDark } = useTheme();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  // eslint-disable-next-line react-hooks/rules-of-hooks -- screen can also open outside the tabs; hook order stays constant.
  let tabH = 0; try { tabH = useBottomTabBarHeight(); } catch {}
  const { profile } = useAuthStore();
  const ticketId: string | undefined = route.params?.ticketId;
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [msgs, setMsgs] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const generation = useRef(0), submitting = useRef(false);
  const readRevision = useRef(0), mutation = useRef(0);
  const draftIdentity = useRef(`${profile?.id ?? ''}:${ticketId ?? ''}`);

  const load = useCallback(async (visit = generation.current) => {
    if (visit !== generation.current) return;
    const read = ++readRevision.current;
    const current = () => visit === generation.current && read === readRevision.current;
    setLoading(true);
    setError(null);
    setHistoryError(null);
    if (!profile?.id || !ticketId) { setTicket(null); setMsgs([]); setLoading(false); return; }
    try {
      const result = await readSupportConversation(supabase, profile.id, ticketId);
      if (!current()) return;
      setTicket(result.ticket); setMsgs(result.messages); setHistoryError(result.historyError);
    } catch {
      if (current()) setError('This ticket could not be loaded. Please try again.');
    } finally {
      if (current()) setLoading(false);
    }
  }, [profile?.id, ticketId]);
  useFocusEffect(useCallback(() => {
    const visit = ++generation.current;
    ++readRevision.current; ++mutation.current;
    submitting.current = false; setBusy(false);
    const identity = `${profile?.id ?? ''}:${ticketId ?? ''}`;
    if (identity !== draftIdentity.current) { draftIdentity.current = identity; setDraft(''); }
    setTicket(null); setMsgs([]);
    void load(visit);
    return () => { ++generation.current; ++readRevision.current; ++mutation.current; };
  }, [load, profile?.id, ticketId]));

  const send = async () => {
    if (!draft.trim() || submitting.current || !profile?.id || !ticketId || !ticket) return;
    submitting.current = true;
    setBusy(true);
    const visit = generation.current, sentBody = draft;
    const attempt = ++mutation.current;
    ++readRevision.current; setLoading(false);
    try {
      const confirmation = await replyToMemberSupport(profile.id, ticketId, sentBody,
        () => visit === generation.current && attempt === mutation.current);
      const accepted = await confirmation.accept(() => {
        ++readRevision.current;
        setDraft(value => value === sentBody ? '' : value);
      });
      if (!accepted || visit !== generation.current || attempt !== mutation.current) return;
      await load(visit);
    } catch (failure) {
      if (visit === generation.current && attempt === mutation.current) Alert.alert('Reply not confirmed', supportError(failure, 'Your draft is kept. Try again to check the same request.'));
    } finally {
      if (attempt === mutation.current) { submitting.current = false; setBusy(false); }
    }
  };

  const retry = (message: string) => <View style={s.notice}>
    <Text accessibilityRole="alert" style={s.noticeText}>{message}</Text>
    <TouchableOpacity accessibilityRole="button" onPress={() => void load()} disabled={loading} style={s.retry}><Text style={s.sendTxt}>Try again</Text></TouchableOpacity>
  </View>;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={s.header}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to support" onPress={() => settingsBack(navigation, 'ContactSupport')} style={s.backBtn} activeOpacity={0.7}>
            <Text style={s.backChev}>{'\u2039'}</Text><Text style={s.backLbl}>Back</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle} numberOfLines={1}>{ticket?.subject || 'Ticket'}</Text>
          <View style={{ maxWidth: 105, alignItems: 'flex-end' }}>
            {ticket ? <View style={s.pill}><Text style={s.pillTxt}>{STATUS_LABEL[ticket.status] || 'Open'}</Text></View> : null}
          </View>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
          {loading && !ticket ? <ActivityIndicator accessibilityLabel="Loading support ticket" color={t.ink.primary} style={{ marginTop: 40 }} />
            : error ? retry(error)
            : !profile?.id ? <Text style={s.noticeText}>Sign in to view this support ticket.</Text>
            : !ticket ? <Text accessibilityRole="text" style={s.noticeText}>This ticket is not available to this account.</Text>
            : <>
              <View style={[s.bubble, s.original]}>
                <Text style={s.originalLabel}>Your original message</Text>
                <Text style={s.bubbleTxt}>{ticket.body}</Text>
                <Text style={s.bubbleWhen}>{new Date(ticket.created_at).toLocaleString()}</Text>
              </View>
              {historyError ? retry(historyError) : null}
              {loading ? <ActivityIndicator accessibilityLabel="Refreshing conversation" color={t.ink.primary} /> : null}
              {msgs.map(message => <View key={message.id} style={[s.bubble, message.sender === 'member' ? s.mine : s.theirs]}>
                <Text style={[s.bubbleTxt, message.sender === 'member' && s.mineText]}>{message.body}</Text>
                <Text style={[s.bubbleWhen, message.sender === 'member' && s.mineText]}>
                  {message.sender === 'member' ? 'You' : 'Platinum Circles'} {'\u00b7'} {new Date(message.created_at).toLocaleString()}
                </Text>
              </View>)}
            </>}
        </ScrollView>
        {ticket && !error ? <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, 10) + tabH + 8 }]}>
          <TextInput accessibilityLabel="Reply" value={draft} onChangeText={setDraft} maxLength={2000} placeholder={ticket.status === 'solved' ? 'Write to reopen this ticket' : 'Write a reply'} placeholderTextColor={t.ink.muted} keyboardAppearance={isDark ? 'dark' : 'light'} multiline style={s.input} />
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={busy ? 'Sending reply' : 'Send'} style={[s.send, (busy || !draft.trim()) && { opacity: 0.4 }]} onPress={() => void send()} disabled={busy || !draft.trim()} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color={t.ink.inverse} size={14} /> : <Text style={s.sendTxt}>Send</Text>}
          </TouchableOpacity>
        </View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  backBtn: { flexDirection: 'row', alignItems: 'center', width: 60, minHeight: 44 },
  backChev: { fontSize: 26, color: t.ink.primary, marginRight: 2, marginTop: -3 },
  backLbl: { fontSize: 15, color: t.ink.primary, fontWeight: '600' },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: t.ink.primary, textAlign: 'center', marginHorizontal: 6 },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: t.surface.sunken },
  pillTxt: { fontSize: 10, fontWeight: '800', color: t.ink.primary },
  bubble: { maxWidth: '82%', borderRadius: 14, padding: 11, marginBottom: 8 },
  original: { maxWidth: '100%', backgroundColor: t.surface.raised },
  originalLabel: { fontSize: 11, fontWeight: '700', color: t.ink.muted, marginBottom: 6 },
  mine: { alignSelf: 'flex-end', backgroundColor: t.brand.base },
  theirs: { alignSelf: 'flex-start', backgroundColor: t.surface.sunken },
  bubbleTxt: { fontSize: 13.5, lineHeight: 19, color: t.ink.primary },
  bubbleWhen: { fontSize: 10, color: t.ink.muted, marginTop: 5 },
  mineText: { color: t.ink.inverse },
  notice: { backgroundColor: t.surface.raised, borderWidth: 1, borderColor: t.surface.hairline, borderRadius: 12, padding: 14, marginBottom: 12 },
  noticeText: { fontSize: 14, lineHeight: 21, color: t.ink.primary },
  retry: { alignSelf: 'flex-start', backgroundColor: t.brand.base, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11, marginTop: 10 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.surface.hairline },
  input: { flex: 1, borderWidth: 1.2, borderColor: t.surface.hairline, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: t.ink.primary, maxHeight: 110 },
  send: { backgroundColor: t.brand.base, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 11 },
  sendTxt: { color: t.ink.inverse, fontSize: 13.5, fontWeight: '800' },
}));
