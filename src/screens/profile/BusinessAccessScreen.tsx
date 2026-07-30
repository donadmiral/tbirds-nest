/**
 * BusinessAccessScreen - inside the business session only. The company
 * manages who can speak as it (access members with revocable codes)
 * and which devices are permitted.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

const NAVY = '#0B1E3D';

export default function BusinessAccessScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const isBusiness = (profile as any)?.account_type === 'business';

  const [members, setMembers] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [signins, setSignins] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id || !isBusiness) return;
    const [m, d, l] = await Promise.all([
      supabase.from('business_access_members').select('*').eq('business_id', profile.id).order('created_at'),
      supabase.from('business_devices').select('*').eq('business_id', profile.id).order('created_at'),
      supabase.from('business_signin_log').select('*').eq('business_id', profile.id).order('created_at', { ascending: false }).limit(10),
    ]);
    setMembers(m.data ?? []); setDevices(d.data ?? []); setSignins(l.data ?? []);
  }, [profile?.id, isBusiness]);
  useEffect(() => { load(); }, [load]);

  const addMember = async () => {
    if (!newName.trim() || busy || !profile?.id) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('create_business_access_member', { p_name: newName.trim() });
      if (error) throw error;
      const code = (data as any)?.code;
      const who = newName.trim();
      setNewName('');
      await load();
      Alert.alert('Access created for ' + who, 'Their access code - shown only once, hand it over securely:\n\n' + code + '\n\nThey sign in with Business sign-in on a registered company device.');
    } catch (e: any) {
      Alert.alert('Could not create', e?.message || 'Try again.');
    } finally { setBusy(false); }
  };

  const revoke = (m: any) => {
    Alert.alert('Revoke ' + m.display_name + '?', 'Their code stops working immediately on every device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: async () => {
        await supabase.from('business_access_members').update({ active: false }).eq('id', m.id);
        load();
      } },
    ]);
  };

  const approveDevice = async (d: any) => {
    await supabase.from('business_devices').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', d.id);
    load();
  };
  const removeDevice = (d: any) => {
    Alert.alert('Remove this device?', 'Sign-ins from it will be refused.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        await supabase.from('business_devices').delete().eq('id', d.id);
        load();
      } },
    ]);
  };

  if (!isBusiness) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <View style={{ padding: 24 }}><Text style={{ color: NAVY, fontSize: 14 }}>This screen belongs to business accounts. Sign in as the business to manage its access.</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>{'\u2039'}</Text><Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Access</Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: Math.max(insets.bottom + 110, 130) }} showsVerticalScrollIndicator={false}>
        <Text style={s.section}>People who can speak as {profile?.full_name}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          <TextInput value={newName} onChangeText={setNewName} placeholder="Representative's name" placeholderTextColor="#9CA3AF" style={[s.input, { flex: 1, marginBottom: 0 }]} />
          <TouchableOpacity style={[s.smallBtn, busy && { opacity: 0.5 }]} onPress={addMember} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color="#FFFFFF" size={14} /> : <Text style={s.smallBtnTxt}>Create code</Text>}
          </TouchableOpacity>
        </View>
        {members.map(m => (
          <View key={m.id} style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowName}>{m.display_name}</Text>
              <Text style={s.rowSub}>{m.active ? 'Active' : 'Revoked'}{m.last_sign_in_at ? ' - last sign-in ' + new Date(m.last_sign_in_at).toLocaleDateString() : ' - never signed in'}</Text>
            </View>
            {m.active ? (
              <TouchableOpacity onPress={() => revoke(m)} style={s.dangerBtn} activeOpacity={0.8}><Text style={s.dangerTxt}>Revoke</Text></TouchableOpacity>
            ) : <Text style={s.mutedPill}>Revoked</Text>}
          </View>
        ))}

        <Text style={[s.section, { marginTop: 24 }]}>Registered devices</Text>
        {devices.length === 0 ? <Text style={s.rowSub}>None yet. The first device to sign in is trusted automatically.</Text> : null}
        {devices.map(d => (
          <View key={d.id} style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowName}>{d.label || 'Device'}</Text>
              <Text style={s.rowSub}>{d.status === 'approved' ? 'Approved' : 'AWAITING APPROVAL'} - {String(d.device_id).slice(0, 18)}...</Text>
            </View>
            {d.status !== 'approved' ? (
              <TouchableOpacity onPress={() => approveDevice(d)} style={s.okBtn} activeOpacity={0.8}><Text style={s.okTxt}>Approve</Text></TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={() => removeDevice(d)} style={[s.dangerBtn, { marginLeft: 8 }]} activeOpacity={0.8}><Text style={s.dangerTxt}>Remove</Text></TouchableOpacity>
          </View>
        ))}

        {signins.length ? <Text style={[s.section, { marginTop: 24 }]}>Recent sign-ins</Text> : null}
        {signins.map(l => (
          <Text key={l.id} style={s.logLine}>{l.member_name || 'Member'} - {new Date(l.created_at).toLocaleString()}</Text>
        ))}
      </ScrollView>
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
  section: { fontSize: 12, fontWeight: '800', color: 'rgba(11,30,61,0.45)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1.2, borderColor: 'rgba(11,30,61,0.14)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: NAVY, backgroundColor: '#FFFFFF' },
  smallBtn: { backgroundColor: NAVY, borderRadius: 12, paddingHorizontal: 14, justifyContent: 'center' },
  smallBtnTxt: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.2, borderColor: 'rgba(11,30,61,0.1)', borderRadius: 14, padding: 12, marginBottom: 8 },
  rowName: { fontSize: 14, fontWeight: '700', color: NAVY },
  rowSub: { fontSize: 11.5, color: 'rgba(11,30,61,0.5)', marginTop: 2 },
  dangerBtn: { borderWidth: 1, borderColor: 'rgba(220,38,38,0.3)', backgroundColor: 'rgba(220,38,38,0.06)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  dangerTxt: { color: '#DC2626', fontSize: 12, fontWeight: '800' },
  okBtn: { backgroundColor: NAVY, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  okTxt: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  mutedPill: { fontSize: 11, fontWeight: '800', color: 'rgba(11,30,61,0.35)' },
  logLine: { fontSize: 12.5, color: 'rgba(11,30,61,0.65)', marginBottom: 5 },
});
