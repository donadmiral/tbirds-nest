import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from '../../components/SafeArea';
import LinkIntoBankSheet from '../../components/LinkIntoBankSheet';
import CreatorPayoutForm from '../../components/CreatorPayoutForm';
import CreatorCommercePanel from '../../components/CreatorCommercePanel';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../services/supabase';
import { paymentsService } from '../../services/paymentsService';
import { readCreatorSnapshot, registerCreatorInterest, applyToCreatorProgram, ENROLLMENT_LABELS, BALANCE_LABELS, PAYOUT_LABELS, formatMinor, payoutBlockReason, earningActivityLabel, withFinanceDeadline, type CreatorSnapshot } from '../../services/monetizationService';
import { themedSheet, useTheme } from '../../theme/useTheme';

export default function MonetizationScreen() {
  const navigation = useNavigation<any>();
  const uid = useAuthStore(state => state.session?.user.id || null);
  const { t } = useTheme();
  const [snapshot, setSnapshot] = useState<CreatorSnapshot | null>(null);
  const [linked, setLinked] = useState<boolean | null>(null);
  const [linkOwner, setLinkOwner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const generation = useRef(0), requests = useRef(0), mutation = useRef(false);
  const current = useRef(uid); current.current = uid;
  const load = useCallback(async (owner: string, identity: number) => {
    const request = ++requests.current;
    const valid = () => generation.current === identity && requests.current === request && current.current === owner;
    setLoading(true); setError(null); setLinkError(null);
    await Promise.all([
      readCreatorSnapshot(supabase, owner).then(value => { if (valid()) { setSnapshot(value); setAccepted(false); } }, reason => { if (valid()) { setSnapshot(null); setError(reason instanceof Error ? reason.message : 'Could not load monetization.'); } }),
      withFinanceDeadline(paymentsService.getLinkStatus(owner), 'Could not confirm your IntoBank connection.').then(value => { if (valid()) { setLinked(value.linked); setLinkOwner(owner); } }, () => { if (valid()) { setLinked(null); setLinkError('Could not confirm your IntoBank connection. Refresh to try again.'); } }),
    ]);
    if (valid()) setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => {
    const identity = ++generation.current;
    requests.current++; mutation.current = false;
    setSnapshot(null); setLinked(null); setError(null); setLinkError(null); setBusy(false); setAccepted(false); setShowLink(false);
    if (uid) void load(uid, identity); else setLoading(false);
    return () => { generation.current++; requests.current++; };
  }, [uid, load]));
  async function enroll(apply: boolean) {
    if (!uid || !snapshot || mutation.current || (apply && (!accepted || !snapshot.program.terms_version))) return;
    const owner = uid, identity = generation.current;
    mutation.current = true; setBusy(true); setError(null);
    try {
      if (apply) await applyToCreatorProgram(supabase, owner, snapshot.program.terms_version!); else await registerCreatorInterest(supabase, owner);
      if (identity === generation.current && current.current === owner) await load(owner, identity);
    } catch (reason) { if (identity === generation.current && current.current === owner) setError(reason instanceof Error ? reason.message : 'Could not confirm this change. Refresh before trying again.'); }
    finally { if (identity === generation.current && current.current === owner) { mutation.current = false; setBusy(false); } }
  }
  const visible = snapshot?.user_id === uid ? snapshot : null;
  const currentLink = linkOwner === uid ? linked : null;
  return <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
    <View style={s.header}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" style={s.headerButton} onPress={() => navigation.goBack()}><Text style={s.link}>Back</Text></TouchableOpacity><Text style={s.title}>Monetization</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh monetization" accessibilityState={{ disabled: !uid || loading || busy }} disabled={!uid || loading || busy} style={s.headerButton} onPress={() => uid && void load(uid, generation.current)}><Text style={s.link}>Refresh</Text></TouchableOpacity></View>
    <ScrollView contentContainerStyle={s.content}>
      <Text style={s.subtitle}>Your program status, earnings and payouts.</Text>{snapshot?.environment === 'test' && <Text style={s.note}>Sandbox account: these are test earnings and payments.</Text>}
      {!uid && <Text style={s.body}>Sign in to view your creator account.</Text>}
      {error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      {uid && <View style={s.card}><Text style={s.heading}>IntoBank connection</Text><Text style={s.body}>{currentLink === true ? 'Your IntoBank account is linked.' : currentLink === false ? 'Your IntoBank account is not linked.' : loading ? 'Checking your connection…' : 'Connection status unavailable.'}</Text>{linkError && <Text accessibilityRole="alert" style={s.error}>{linkError}</Text>}<Text style={s.note}>IntoBank is the primary payment provider. A linked wallet does not yet mean your account is approved to receive creator payouts.</Text>{currentLink === false && <TouchableOpacity accessibilityRole="button" style={s.button} onPress={() => setShowLink(true)}><Text style={s.buttonText}>Link IntoBank</Text></TouchableOpacity>}</View>}
      {loading && !visible && <ActivityIndicator color={t.ink.primary} accessibilityLabel="Loading creator account" />}
      {visible && <>
        <View style={s.card}><Text style={s.heading}>{ENROLLMENT_LABELS[visible.enrollment.status]}</Text>{visible.enrollment.reason && <Text style={s.body}>{visible.enrollment.reason}</Text>}<Text style={s.note}>{visible.program.enrollment_open ? 'Applications are open. Approval is required before earning through the creator program.' : 'Program enrollment is not open yet. Registering interest does not enroll you or promise earnings.'}</Text>{visible.enrollment.status === 'not_enrolled' && <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} style={s.button} onPress={() => void enroll(false)}><Text style={s.buttonText}>{busy ? 'Saving…' : 'Register interest'}</Text></TouchableOpacity>}{visible.enrollment.status === 'interested' && visible.program.enrollment_open && visible.program.terms_url && <><TouchableOpacity accessibilityRole="link" style={s.headerButton} onPress={() => { void Linking.openURL(visible.program.terms_url!).catch(() => setError('Could not open the program terms. Try again.')); }}><Text style={s.link}>Read the creator program terms</Text></TouchableOpacity><TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} style={s.headerButton} onPress={() => setAccepted(value => !value)}><Text style={s.body}>{accepted ? '☑' : '☐'} I accept the current creator program terms.</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: busy || !accepted }} disabled={busy || !accepted} style={[s.button, (busy || !accepted) && { opacity: 0.5 }]} onPress={() => void enroll(true)}><Text style={s.buttonText}>Submit application</Text></TouchableOpacity></>}</View>
        <View style={s.card}><Text style={s.heading}>Earnings</Text><Text style={s.note}>Recorded creator earnings only. Your IntoBank wallet balance is separate.</Text>{visible.balances.length === 0 ? <Text style={s.body}>No creator earnings have been recorded.</Text> : visible.balances.map(balance => <View key={balance.currency + balance.bucket} style={s.row}><Text style={s.note}>{BALANCE_LABELS[balance.bucket]}</Text><Text style={s.amount}>{formatMinor(balance.amount_minor, balance.currency)}</Text></View>)}<Text style={s.note}>Pending earnings are not available for payout. Amounts on hold and reversals remain visible here.</Text></View>
        <View style={s.card}><Text style={s.heading}>Payouts</Text><Text style={s.body}>{payoutBlockReason(visible) || 'Your payout account is ready.'}</Text><CreatorPayoutForm key={visible.user_id} snapshot={visible} onChanged={() => load(visible.user_id, generation.current)} /><Text style={s.note}>Payout account: {visible.payout_account.status.replace(/_/g, ' ')}. A payout is shown as paid only after provider confirmation.</Text>{visible.recent_payouts.length === 0 ? <Text style={s.body}>No payout requests recorded.</Text> : visible.recent_payouts.map(p => <View key={p.id} style={s.row}><Text style={s.amount}>{formatMinor(p.amount_minor, p.currency)} · {PAYOUT_LABELS[p.status]}</Text><Text style={s.note}>{new Date(p.created_at).toLocaleString()} · {p.provider_id}</Text>{p.provider_reference && <Text selectable style={s.note}>Reference {p.provider_reference}</Text>}</View>)}</View>
        {visible.recent_earnings.length > 0 && <View style={s.card}><Text style={s.heading}>Recent activity</Text><Text style={s.note}>Latest {visible.recent_earnings.length} transactions.</Text>{visible.recent_earnings.map(e => <View key={e.id} style={s.row}><Text style={s.amount}>{formatMinor(e.amount_minor, e.currency)} · {earningActivityLabel(e.from, e.to)}</Text><Text style={s.note}>{new Date(e.created_at).toLocaleString()}</Text></View>)}</View>}
        <CreatorCommercePanel key={visible.user_id} owner={visible.user_id} approved={visible.enrollment.status === 'approved'} />
        <Text style={s.note}>Updated {new Date(visible.as_of).toLocaleString()}.</Text>
      </>}
      <TouchableOpacity accessibilityRole="button" style={s.headerButton} onPress={() => navigation.navigate('ContactSupport')}><Text style={s.link}>Get help with monetization</Text></TouchableOpacity>
    </ScrollView>
    <LinkIntoBankSheet visible={showLink && !!uid} onClose={() => setShowLink(false)} onLinked={() => uid && void load(uid, generation.current)} />
  </SafeAreaView>;
}
const s = themedSheet(t => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  headerButton: { minHeight: 44, justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 4 },
  title: { fontSize: 18, fontWeight: '800', color: t.ink.primary },
  content: { padding: 16, paddingBottom: 100, gap: 16 },
  subtitle: { color: t.ink.muted, fontSize: 14, lineHeight: 20 },
  card: { padding: 18, gap: 10, borderWidth: 1, borderColor: t.surface.hairline, borderRadius: 16, backgroundColor: t.surface.raised },
  heading: { fontSize: 18, fontWeight: '800', color: t.ink.primary },
  body: { fontSize: 15, lineHeight: 22, color: t.ink.primary },
  note: { fontSize: 13, lineHeight: 20, color: t.ink.muted },
  link: { fontSize: 14, fontWeight: '600', textDecorationLine: 'underline', color: t.ink.primary },
  button: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', padding: 12, backgroundColor: t.brand.base },
  buttonText: { color: t.ink.inverse, fontSize: 15, fontWeight: '800' },
  error: { color: t.status.danger, fontSize: 14, lineHeight: 21 },
  row: { paddingVertical: 8, gap: 5 },
  amount: { fontSize: 16, fontWeight: '700', color: t.ink.primary },
}));
