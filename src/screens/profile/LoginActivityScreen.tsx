/**
 * Login activity: every device signed in to the account, with its last
 * active time, and one action that logs every other device out.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StatusBar, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import * as Device from 'expo-device';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { themedSheet, useTheme } from '../../theme/useTheme';

type Row = { id: string; device_name: string | null; platform: string | null; updated_at: string | null; created_at: string | null };

function ago(iso: string | null): string {
  if (!iso) return '';
  const d = Date.now() - new Date(iso).getTime(); const m = Math.floor(d / 60000);
  if (m < 2) return 'Active now'; if (m < 60) return m + ' min ago'; const h = Math.floor(m / 60); if (h < 24) return h + ' h ago';
  const days = Math.floor(h / 24); if (days < 7) return days + ' d ago'; return new Date(iso).toLocaleDateString();
}

export default function LoginActivityScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { t } = useTheme();
  const { profile } = useAuthStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const thisDevice = (Device.deviceName || '').trim();

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    const { data } = await supabase.from('user_push_tokens').select('id, device_name, platform, updated_at, created_at').eq('user_id', profile.id).order('updated_at', { ascending: false });
    setRows((data as Row[]) || []);
    setLoading(false);
  }, [profile?.id]);
  useEffect(() => { load(); }, [load]);

  const logOutOthers = () => {
    Alert.alert('Log out of all other devices?', 'Every other phone, tablet and browser signed in to this account is signed out. This device stays.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out others', style: 'destructive', onPress: async () => {
        const { error } = await supabase.auth.signOut({ scope: 'others' });
        if (error) { Alert.alert('Not done', error.message); return; }
        if (profile?.id) { await supabase.from('user_push_tokens').delete().eq('user_id', profile.id).neq('device_name', thisDevice); }
        await load();
        Alert.alert('Done', 'Other devices have been signed out.');
      } },
    ]);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="chevron-left" size={26} color={t.ink.primary} /></TouchableOpacity>
        <Text style={s.title}>Login activity</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        <Text style={s.lede}>Devices signed in to your account. If one isn't yours, log the others out and change your password.</Text>
        {loading ? <ActivityIndicator color={t.ink.primary} style={{ marginTop: 20 }} /> : rows.map((r) => {
          const mine = !!thisDevice && r.device_name === thisDevice;
          return (
            <View key={r.id} style={s.row}>
              <Feather name={r.platform === 'android' ? 'smartphone' : r.platform === 'ios' ? 'smartphone' : 'monitor'} size={20} color={t.ink.primary} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.name} numberOfLines={1}>{r.device_name || (r.platform === 'ios' ? 'iPhone' : r.platform === 'android' ? 'Android' : 'Device')}{mine ? '  ·  This device' : ''}</Text>
                <Text style={s.when}>{ago(r.updated_at || r.created_at)}</Text>
              </View>
            </View>
          );
        })}
        {!loading && rows.length === 0 ? <Text style={[s.lede, { marginTop: 10 }]}>No devices recorded yet.</Text> : null}
        <TouchableOpacity style={s.btn} onPress={logOutOthers} activeOpacity={0.85}><Text style={s.btnTxt}>Log out of all other devices</Text></TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, height: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '800', color: t.ink.primary },
  lede: { fontSize: 13.5, lineHeight: 19, color: t.ink.muted, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline },
  name: { fontSize: 14.5, fontWeight: '700', color: t.ink.primary },
  when: { fontSize: 12, color: t.ink.muted, marginTop: 2 },
  btn: { marginHorizontal: 16, marginTop: 20, backgroundColor: t.status.dangerBg, borderRadius: 12, height: 48, alignItems: 'center', justifyContent: 'center' },
  btnTxt: { color: t.status.danger, fontSize: 15, fontWeight: '800' },
}));