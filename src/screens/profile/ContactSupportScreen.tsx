import SettingsExit from '../../components/SettingsExit';
import { settingsBack } from '../../navigation/settingsNavigation';
import { themedSheet, getTheme, useTheme } from '../../theme/useTheme';
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
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { createMemberSupportRequest } from '../../services/memberSupportService';
import { readSupportTickets, supportError, type SupportTicket } from '../../../shared/memberSupport';

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
  const { t, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const isAppeal = !!(profile as any)?.deactivated_at;

  const [topic, setTopic] = useState<string | null>(isAppeal ? 'Account' : null);
  const [subject, setSubject] = useState(isAppeal ? 'Appeal my suspension' : '');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0), submitting = useRef(false);
  const readRevision = useRef(0), mutation = useRef(0);
  const draftOwner = useRef(profile?.id);

  const load = useCallback(async (visit = generation.current) => {
    if (visit !== generation.current) return;
    const read = ++readRevision.current;
    const current = () => visit === generation.current && read === readRevision.current;
    if (!profile?.id) { setTickets([]); setLoading(false); return; }
    setLoading(true);
    setListError(null);
    try {
      const rows = await readSupportTickets(supabase, profile.id);
      if (current()) setTickets(rows);
    } catch {
      if (current()) setListError('Your messages could not be loaded. Please try again.');
    } finally {
      if (current()) setLoading(false);
    }
  }, [profile?.id]);
  useFocusEffect(useCallback(() => {
    const visit = ++generation.current;
    ++readRevision.current; ++mutation.current;
    submitting.current = false; setBusy(false);
    if (draftOwner.current !== profile?.id) {
      draftOwner.current = profile?.id;
      setTickets([]); setBody(''); setSubject(isAppeal ? 'Appeal my suspension' : ''); setTopic(isAppeal ? 'Account' : null);
    }
    void load(visit);
    return () => { ++generation.current; ++readRevision.current; ++mutation.current; };
  }, [load, profile?.id, isAppeal]));

  const submit = async () => {
    if (!profile?.id || submitting.current) return;
    if (!isAppeal && !topic) { Alert.alert('Pick a topic', 'It sends your message to the right person.'); return; }
    if (!subject.trim() || !body.trim()) { Alert.alert('Both fields', 'A subject and a message are required.'); return; }
    submitting.current = true;
    setBusy(true);
    const visit = generation.current, sentSubject = subject, sentBody = body, sentTopic = topic;
    const attempt = ++mutation.current;
    ++readRevision.current; setLoading(false);
    try {
      const confirmation = await createMemberSupportRequest(profile.id, {
        kind: isAppeal ? 'appeal' : 'support',
        subject: (sentTopic && !isAppeal ? sentTopic + ': ' : '') + sentSubject.trim(), body: sentBody.trim(),
      }, () => visit === generation.current && attempt === mutation.current);
      const accepted = await confirmation.accept(() => {
        ++readRevision.current;
        setSubject(value => value === sentSubject ? (isAppeal ? 'Appeal my suspension' : '') : value);
        setBody(value => value === sentBody ? '' : value);
        if (!isAppeal) setTopic(value => value === sentTopic ? null : value);
      });
      if (!accepted || visit !== generation.current || attempt !== mutation.current) return;
      await load(visit);
      if (visit === generation.current) Alert.alert('Sent', isAppeal ? 'Your appeal is with the operations team. The outcome appears here.' : 'Your message is with the operations team. The reply appears here.');
    } catch (error) {
      if (visit === generation.current && attempt === mutation.current) Alert.alert('Sending not confirmed', supportError(error, 'Your draft is kept. Try again to check the same request.'));
    } finally {
      if (attempt === mutation.current) { submitting.current = false; setBusy(false); }
    }
  };

  const statusOf = (ticket: SupportTicket) => ticket.status === 'solved' ? { label: 'Solved', bg: t.surface.sunken, fg: t.ink.primary } : ticket.status === 'pending' ? { label: 'Replied', bg: t.brand.tintBg, fg: t.ink.primary } : { label: 'With the team', bg: t.surface.sunken, fg: t.ink.primary };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => settingsBack(navigation, 'Settings')} style={s.backBtn} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="chevron-left" size={26} color={getTheme().ink.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{isAppeal ? 'Appeal' : 'Contact support'}</Text>
        <SettingsExit navigation={navigation} />
      </View>
      <KeyboardSafe>
      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 110, 130) }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={s.lede}>{isAppeal
          ? 'Your account is suspended. Tell the operations team why it should be restored. A person reads every appeal.'
          : 'A person on the operations team reads every message. The reply appears on this screen and as a notification.'}</Text>

        {!profile?.id ? <Text accessibilityRole="alert" style={s.lede}>Sign in to contact support.</Text> : null}
        {!isAppeal && profile?.id ? (
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
          <TextInput accessibilityLabel="Subject" editable={!!profile?.id} value={subject} onChangeText={setSubject} placeholder={isAppeal ? 'Appeal my suspension' : 'In a few words'} placeholderTextColor={getTheme().ink.muted} style={s.input} maxLength={120} returnKeyType="next" />
        </View>

        <View style={s.section}>
          <Text style={s.label}>Message</Text>
          <TextInput accessibilityLabel="Message" editable={!!profile?.id} value={body} onChangeText={setBody} multiline placeholder={isAppeal ? 'Your case for restoration' : 'What happened, and what you expected'} placeholderTextColor={getTheme().ink.muted} style={[s.input, s.box]} maxLength={2000} textAlignVertical="top" />
          <Text style={s.count}>{body.length} / 2000</Text>
        </View>

        <View style={s.section}>
          <TouchableOpacity style={[s.submit, (busy || !profile?.id) && { opacity: 0.5 }]} onPress={submit} disabled={busy || !profile?.id} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color={t.ink.inverse} size={16} /> : <Text style={s.submitTxt}>{isAppeal ? 'Send appeal' : 'Send'}</Text>}
          </TouchableOpacity>
        </View>

        {listError ? <View style={s.notice}>
          <Text accessibilityRole="alert" style={s.noticeText}>{listError}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => void load()} disabled={loading} style={s.retry}>
            <Text style={s.retryText}>Try again</Text>
          </TouchableOpacity>
        </View> : null}
        {loading ? <ActivityIndicator accessibilityLabel="Loading support messages" color={t.ink.primary} style={{ marginTop: 20 }} /> : null}
        {!loading && !listError && profile?.id && !tickets.length ? <Text style={s.lede}>You have no support messages yet.</Text> : null}

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
                <Feather name="chevron-right" size={18} color={getTheme().ink.muted} />
              </TouchableOpacity>
            ); })}
          </View>
        ) : null}
      </ScrollView>
      </KeyboardSafe>
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, height: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: t.ink.primary },
  lede: { fontSize: 13.5, lineHeight: 19, color: t.ink.muted, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  section: { paddingHorizontal: 16, marginTop: 14 },
  label: { fontSize: 12, fontWeight: '800', color: t.ink.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: t.surface.hairline, backgroundColor: t.surface.canvas },
  chipOn: { backgroundColor: t.brand.base, borderColor: t.brand.base },
  chipTxt: { fontSize: 13, fontWeight: '600', color: t.ink.primary },
  chipTxtOn: { color: t.ink.inverse },
  input: { borderWidth: 1, borderColor: t.surface.hairline, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: t.ink.primary, backgroundColor: t.surface.canvas },
  box: { minHeight: 150, lineHeight: 21, paddingTop: 11 },
  count: { fontSize: 11.5, color: t.ink.muted, marginTop: 6, textAlign: 'right' },
  submit: { backgroundColor: t.brand.base, borderRadius: 12, height: 48, alignItems: 'center', justifyContent: 'center' },
  submitTxt: { color: t.ink.inverse, fontSize: 15, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline },
  rowFirst: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.surface.hairline },
  rowSubject: { fontSize: 14.5, fontWeight: '700', color: t.ink.primary },
  rowWhen: { fontSize: 12, color: t.ink.muted, marginTop: 2 },
  notice: { marginHorizontal: 16, marginTop: 20, padding: 14, borderWidth: 1, borderColor: t.surface.hairline, borderRadius: 12, backgroundColor: t.surface.raised },
  noticeText: { color: t.ink.primary, fontSize: 14, lineHeight: 20 },
  retry: { alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: t.brand.base, borderRadius: 10 },
  retryText: { color: t.ink.inverse, fontWeight: '700' },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  pillTxt: { fontSize: 11, fontWeight: '800' },
}));
