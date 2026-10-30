/**
 * BusinessSignInScreen - the completely separate door. A company
 * representative enters the business @, their own access code, on a
 * registered company device. The session that opens IS the business.
 */
import { themedSheet } from '../../theme/useTheme';
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StatusBar, TextInput, ActivityIndicator, Platform, KeyboardAvoidingView, ScrollView } from 'react-native';
import { SafeAreaView } from '../../components/SafeArea';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { businessSessionMessage, businessSessionStep, installBusinessSession, isBusinessSessionHandoff, prepareBusinessSession, type BusinessSessionHandoff } from '../../services/businessSessionService';

const NAVY = '#0B1E3D';

export default function BusinessSignInScreen() {
  const navigation = useNavigation<any>();
  const [handle, setHandle] = useState('');
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'opening'>('idle');
  const [ready, setReady] = useState(false), [authAttempt, setAuthAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const live = useRef(false), account = useRef<string | null | undefined>(undefined), generation = useRef(0);
  const pending = useRef<AbortController | null>(null), handoff = useRef<BusinessSessionHandoff | null>(null);

  useEffect(() => {
    live.current = true;
    let active = true, authVersion = 0;
    const initial = new AbortController();
    const apply = (next: string | null) => {
      if (!active || !live.current) return;
      if (account.current !== next) {
        const changed = account.current !== undefined;
        generation.current++; pending.current?.abort(); pending.current = null; handoff.current = null;
        account.current = next; setCode(''); setPhase('idle'); setError(null);
        setNotice(changed ? 'Your account changed. Review your business sign-in details before continuing.' : null);
      }
      setReady(true);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active || !live.current || isBusinessSessionHandoff(handoff.current, session)) return;
      authVersion++; apply(session?.user.id ?? null);
    });
    const version = authVersion;
    void businessSessionStep(supabase.auth.getSession(), initial.signal).then(({ data, error: failure }) => {
      if (!active || !live.current || version !== authVersion) return;
      if (failure) throw failure;
      apply(data.session?.user.id ?? null);
    }).catch(() => {
      if (active && live.current && version === authVersion) { setReady(false); setError('Your current account could not be checked. Try again before signing in to a business.'); }
    });
    return () => {
      active = false; live.current = false; generation.current++;
      initial.abort(); pending.current?.abort(); pending.current = null; handoff.current = null; subscription.unsubscribe();
    };
  }, [authAttempt]);

  const cancel = () => {
    if (handoff.current || !pending.current) return;
    generation.current++; pending.current.abort(); pending.current = null;
    setPhase('idle'); setError(null); setNotice('Business sign-in cancelled. Your selected account is unchanged.');
  };

  const signIn = async () => {
    if (!ready || pending.current || !live.current || account.current === undefined) return;
    const business = handle.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(business) || !code.trim()) { setError('Enter a valid business handle and your personal access code.'); return; }
    const owner = account.current, version = generation.current, abort = new AbortController(); pending.current = abort;
    const current = () => live.current && version === generation.current && pending.current === abort && !abort.signal.aborted;
    setPhase('preparing'); setError(null); setNotice(null);
    try {
      const destination = await prepareBusinessSession(supabase, { kind: 'team', handle: business, code: code.trim() }, owner, current, abort.signal, `${Platform.OS} app`);
      if (!current()) return;
      handoff.current = { businessId: destination.business_id, accessToken: destination.session.access_token };
      setPhase('opening');
      await installBusinessSession(supabase, destination, current, abort.signal);
      // The global Auth observer opens the business account. No stale route is
      // dispatched from this screen after the account switch.
      if (current()) { account.current = destination.business_id; setCode(''); setNotice('Business access confirmed. Opening your account…'); }
    } catch (failure) { if (current()) setError(businessSessionMessage(failure)); }
    finally {
      if (pending.current === abort) {
        pending.current = null; handoff.current = null; abort.abort();
        if (live.current && version === generation.current) setPhase('idle');
      }
    }
  };

  const busy = phase !== 'idle';
  const leave = (apply = false) => {
    if (handoff.current) return;
    cancel();
    if (apply) navigation.navigate('BusinessApply'); else navigation.goBack();
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => leave()} disabled={phase === 'opening'} accessibilityRole="button" accessibilityLabel="Back" style={s.backBtn} activeOpacity={0.7}>
            <Text style={s.backChev}>{'\u2039'}</Text><Text style={s.backLbl}>Back</Text>
          </TouchableOpacity>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 8, paddingBottom: 30 }}>
          <Text style={s.title}>Business sign-in</Text>
          <Text style={s.lede}>Use your business handle and your personal team access code. A business owner must approve this device before you can open the account.</Text>
          <Text style={s.label}>Business handle</Text>
          <TextInput value={handle} onChangeText={setHandle} editable={ready && !busy} accessibilityLabel="Business handle" autoCapitalize="none" autoCorrect={false} autoComplete="username" maxLength={31} placeholder="@business" placeholderTextColor="rgba(255,255,255,0.55)" style={s.input} />
          <Text style={s.label}>Personal access code</Text>
          <TextInput value={code} onChangeText={setCode} editable={ready && !busy} accessibilityLabel="Personal access code" secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="password" maxLength={256} returnKeyType="go" onSubmitEditing={signIn} placeholder="Access code" placeholderTextColor="rgba(255,255,255,0.55)" style={s.input} />
          <TouchableOpacity style={[s.submit, (busy || !ready) && { opacity: 0.5 }]} onPress={signIn} disabled={busy || !ready} accessibilityRole="button" accessibilityLabel="Enter as the business" accessibilityState={{ disabled: busy || !ready, busy }} activeOpacity={0.85}>
            {busy ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ActivityIndicator color={NAVY} size={16} /><Text style={s.submitTxt}>{phase === 'opening' ? 'Opening business…' : 'Checking access…'}</Text></View> : <Text style={s.submitTxt}>Enter as the business</Text>}
          </TouchableOpacity>
          {error && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={s.feedback}>{error}</Text>}
          {notice && <Text accessibilityLiveRegion="polite" style={s.feedback}>{notice}</Text>}
          {!ready && !error && <Text accessibilityLiveRegion="polite" style={s.feedback}>Checking your current account…</Text>}
          {!ready && error && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry account check" onPress={() => { setError(null); setAuthAttempt(value => value + 1); }} style={s.secondary}><Text style={s.label}>Retry account check</Text></TouchableOpacity>}
          {busy && phase !== 'opening' && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel sign-in" onPress={cancel} style={s.secondary}><Text style={s.label}>Cancel sign-in</Text></TouchableOpacity>}
          <Text style={s.foot}>Your access uses your active team role and this device’s registration. Your business can revoke both.</Text>
          <TouchableOpacity onPress={() => leave(true)} disabled={phase === 'opening'} accessibilityRole="button" activeOpacity={0.7} style={s.secondary}>
            <Text style={{ color: '#E8E2D6', fontSize: 13.5, fontWeight: '700', textAlign: 'center' }}>Business owner? Open or apply from your personal account</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: NAVY },
  header: { paddingHorizontal: 14, paddingVertical: 10 },
  backBtn: { flexDirection: 'row', alignItems: 'center', width: 60 },
  backChev: { fontSize: 26, color: t.ink.inverse, marginRight: 2, marginTop: -3 },
  backLbl: { fontSize: 15, color: t.ink.inverse, fontWeight: '600' },
  title: { fontSize: 24, fontWeight: '800', color: t.ink.inverse, marginBottom: 8 },
  lede: { fontSize: 13, lineHeight: 19, color: 'rgba(255,255,255,0.6)', marginBottom: 18 },
  label: { color: t.ink.inverse, fontSize: 13, fontWeight: '600', marginBottom: 7 },
  feedback: { color: '#E8E2D6', fontSize: 13, lineHeight: 19, marginTop: 14 },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 12, paddingHorizontal: 8 },
  input: { borderWidth: 1.2, borderColor: 'rgba(255,255,255,0.22)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: t.ink.inverse, marginBottom: 10, backgroundColor: 'rgba(255,255,255,0.06)' },
  submit: { backgroundColor: '#E8E2D6', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  submitTxt: { color: NAVY, fontSize: 15, fontWeight: '800' },
  foot: { fontSize: 11.5, lineHeight: 17, color: 'rgba(255,255,255,0.4)', marginTop: 14 },
}));
