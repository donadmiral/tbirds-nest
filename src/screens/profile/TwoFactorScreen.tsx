/**
 * Two-factor authentication with an authenticator app (TOTP), Instagram's
 * model: turn on, scan, confirm once with a code; every later sign-in asks
 * for the code after the password. Turning off asks for a fresh code first.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StatusBar, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { SvgXml } from 'react-native-svg';
import { supabase } from '../../services/supabase';
import { themedSheet, useTheme } from '../../theme/useTheme';

type Factor = { id: string; friendly_name?: string | null; status: string; factor_type: string };

export default function TwoFactorScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { t } = useTheme();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (!error) setFactors(((data?.totp as any[]) || []).filter((f) => f.status === 'verified') as Factor[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const start = async () => {
    setBusy(true);
    try {
      // Any unconfirmed leftover from an earlier attempt is cleared first.
      const { data: all } = await supabase.auth.mfa.listFactors();
      for (const f of ((all?.totp as any[]) || [])) { if (f.status !== 'verified') { await supabase.auth.mfa.unenroll({ factorId: f.id }); } }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Platinum Circles' });
      if (error || !data) throw error || new Error('Could not start');
      setEnrolling({ id: data.id, qr: (data as any).totp?.qr_code || '', secret: (data as any).totp?.secret || '' });
      setCode('');
    } catch (e: any) { Alert.alert('Could not start', e?.message || 'Try again.'); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!enrolling) return;
    if (code.trim().length < 6) { Alert.alert('Six digits', 'Enter the six-digit code from your authenticator app.'); return; }
    setBusy(true);
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: enrolling.id });
      if (chErr || !ch) throw chErr || new Error('Could not confirm');
      const { error } = await supabase.auth.mfa.verify({ factorId: enrolling.id, challengeId: ch.id, code: code.trim() });
      if (error) throw error;
      setEnrolling(null); setCode('');
      await load();
      Alert.alert('Two-factor is on', 'Every sign-in now asks for a code from your authenticator app after your password.');
    } catch (e: any) { Alert.alert('Wrong code', e?.message || 'Check the code and try again.'); }
    finally { setBusy(false); }
  };

  const turnOff = async (f: Factor) => {
    Alert.prompt('Turn off two-factor?', 'Enter the current code from your authenticator app to confirm.', async (entered) => {
      if (!entered) return;
      setBusy(true);
      try {
        const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: f.id });
        if (chErr || !ch) throw chErr || new Error('Could not verify');
        const { error: vErr } = await supabase.auth.mfa.verify({ factorId: f.id, challengeId: ch.id, code: entered.trim() });
        if (vErr) throw vErr;
        const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
        if (error) throw error;
        await load();
        Alert.alert('Two-factor is off', 'Sign-in asks for your password only.');
      } catch (e: any) { Alert.alert('Not turned off', e?.message || 'Check the code and try again.'); }
      finally { setBusy(false); }
    }, 'plain-text', '', 'number-pad');
  };

  const on = factors.length > 0;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="chevron-left" size={26} color={t.ink.primary} /></TouchableOpacity>
        <Text style={s.title}>Two-factor authentication</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {loading ? <ActivityIndicator color={t.ink.primary} style={{ marginTop: 30 }} /> : enrolling ? (
          <View>
            <Text style={s.lede}>Scan this with Google Authenticator, Authy or any authenticator app, then enter the six-digit code it shows.</Text>
            <View style={s.qrWrap}>{enrolling.qr ? <SvgXml xml={enrolling.qr} width={200} height={200} /> : null}</View>
            <Text style={s.secretLabel}>Can't scan? Enter this key by hand</Text>
            <Text selectable style={s.secret}>{enrolling.secret}</Text>
            <TextInput value={code} onChangeText={setCode} placeholder="6-digit code" placeholderTextColor={t.ink.faint} keyboardType="number-pad" maxLength={6} style={s.input} onSubmitEditing={confirm} returnKeyType="done" />
            <TouchableOpacity style={[s.btn, busy && { opacity: 0.5 }]} onPress={confirm} disabled={busy} activeOpacity={0.85}>{busy ? <ActivityIndicator color={t.ink.inverse} /> : <Text style={s.btnTxt}>Confirm and turn on</Text>}</TouchableOpacity>
            <TouchableOpacity onPress={async () => { try { await supabase.auth.mfa.unenroll({ factorId: enrolling.id }); } catch {} setEnrolling(null); }} style={{ alignSelf: 'center', marginTop: 14 }}><Text style={s.cancel}>Cancel</Text></TouchableOpacity>
          </View>
        ) : (
          <View>
            <View style={s.statusRow}>
              <Feather name={on ? 'shield' : 'shield-off'} size={22} color={on ? t.status.success : t.ink.muted} />
              <View style={{ flex: 1 }}>
                <Text style={s.statusTitle}>{on ? 'On' : 'Off'}</Text>
                <Text style={s.statusSub}>{on ? 'Every sign-in asks for a code from your authenticator app after your password.' : 'Add a second step to signing in: a code from an authenticator app on your phone.'}</Text>
              </View>
            </View>
            {on ? factors.map((f) => (
              <TouchableOpacity key={f.id} style={[s.btn, { backgroundColor: t.status.dangerBg }]} onPress={() => turnOff(f)} disabled={busy} activeOpacity={0.85}><Text style={[s.btnTxt, { color: t.status.danger }]}>Turn off</Text></TouchableOpacity>
            )) : (
              <TouchableOpacity style={[s.btn, busy && { opacity: 0.5 }]} onPress={start} disabled={busy} activeOpacity={0.85}>{busy ? <ActivityIndicator color={t.ink.inverse} /> : <Text style={s.btnTxt}>Turn on</Text>}</TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, height: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '800', color: t.ink.primary },
  lede: { fontSize: 13.5, lineHeight: 19, color: t.ink.muted, marginBottom: 14 },
  qrWrap: { alignSelf: 'center', padding: 12, backgroundColor: '#FFFFFF', borderRadius: 16, marginBottom: 14 },
  secretLabel: { fontSize: 12, fontWeight: '800', color: t.ink.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  secret: { fontSize: 14, color: t.ink.primary, fontWeight: '700', marginTop: 4, marginBottom: 16, letterSpacing: 1 },
  input: { borderWidth: 1, borderColor: t.surface.hairline, borderRadius: 12, paddingHorizontal: 12, height: 48, fontSize: 18, letterSpacing: 4, color: t.ink.primary, backgroundColor: t.surface.raised, textAlign: 'center' },
  btn: { backgroundColor: t.brand.base, borderRadius: 12, height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  btnTxt: { color: t.ink.inverse, fontSize: 15, fontWeight: '800' },
  cancel: { color: t.ink.muted, fontSize: 13.5, fontWeight: '600' },
  statusRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: 14, backgroundColor: t.surface.raised, borderWidth: 1, borderColor: t.surface.hairline },
  statusTitle: { fontSize: 15, fontWeight: '800', color: t.ink.primary },
  statusSub: { fontSize: 13, lineHeight: 18, color: t.ink.muted, marginTop: 2 },
}));