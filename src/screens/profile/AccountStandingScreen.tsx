/**
 * AccountStandingScreen - the member's honest view of their record.
 * Shows every strike issued against the account and any active
 * restriction, or a clean bill when there is nothing.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

const NAVY = '#0B1E3D';
const KIND_META: Record<string, { label: string; color: string; bg: string }> = {
  warn: { label: 'Warning', color: '#B45309', bg: 'rgba(180,83,9,0.08)' },
  restrict: { label: 'Restriction', color: '#B45309', bg: 'rgba(180,83,9,0.08)' },
  suspend: { label: 'Suspension', color: '#DC2626', bg: 'rgba(220,38,38,0.07)' },
  ban: { label: 'Ban', color: '#DC2626', bg: 'rgba(220,38,38,0.07)' },
};

export default function AccountStandingScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const [rows, setRows] = useState<any[] | null>(null);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const { data } = await supabase.from('member_strikes').select('*')
      .order('created_at', { ascending: false }).limit(20);
    setRows(data ?? []);
  }, [profile?.id]);
  useEffect(() => { load(); }, [load]);

  const restrictedUntil = (profile as any)?.restricted_until ? new Date((profile as any).restricted_until) : null;
  const restrictionActive = restrictedUntil && restrictedUntil.getTime() > Date.now();

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>{'\u2039'}</Text><Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Account standing</Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: Math.max(insets.bottom + 110, 130) }} showsVerticalScrollIndicator={false}>
        {rows === null ? (
          <View style={{ paddingTop: 60, alignItems: 'center' }}><ActivityIndicator color={NAVY} /></View>
        ) : (
          <>
            {restrictionActive ? (
              <View style={[s.banner, { backgroundColor: 'rgba(180,83,9,0.08)', borderColor: 'rgba(180,83,9,0.25)' }]}>
                <Feather name="alert-triangle" size={16} color="#B45309" />
                <Text style={[s.bannerTxt, { color: '#B45309' }]}>Posting and listing are restricted until {restrictedUntil!.toLocaleString()}. The limit lifts automatically.</Text>
              </View>
            ) : (
              <View style={[s.banner, { backgroundColor: 'rgba(29,122,56,0.07)', borderColor: 'rgba(29,122,56,0.25)' }]}>
                <Feather name="check-circle" size={16} color="#1D7A38" />
                <Text style={[s.bannerTxt, { color: '#1D7A38' }]}>{rows.length ? 'No active restriction on the account.' : 'Good standing. No strikes on this account.'}</Text>
              </View>
            )}
            {rows.length ? <Text style={s.section}>Record</Text> : null}
            {rows.map(r => {
              const meta = KIND_META[r.level] || KIND_META.warn;
              return (
                <View key={r.id} style={s.row}>
                  <View style={[s.pill, { backgroundColor: meta.bg }]}>
                    <Text style={[s.pillTxt, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    {r.reason ? <Text style={s.reason}>{r.reason}</Text> : <Text style={s.reason}>No reason recorded</Text>}
                    <Text style={s.when}>{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</Text>
                  </View>
                </View>
              );
            })}
            <Text style={s.foot}>Strikes are issued by Platinum Circles operations when the rules are broken. If you believe one is wrong, write to the team from Settings, Contact support.</Text>
          </>
        )}
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
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.2, borderRadius: 12, padding: 12, marginTop: 4, marginBottom: 16 },
  bannerTxt: { flex: 1, fontSize: 12.5, fontWeight: '600', lineHeight: 18 },
  section: { fontSize: 12, fontWeight: '800', color: 'rgba(11,30,61,0.45)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1.2, borderColor: 'rgba(11,30,61,0.1)', borderRadius: 14, padding: 12, marginBottom: 8 },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  pillTxt: { fontSize: 10.5, fontWeight: '800' },
  reason: { fontSize: 13, color: NAVY, lineHeight: 18 },
  when: { fontSize: 11, color: 'rgba(11,30,61,0.4)', marginTop: 4 },
  foot: { fontSize: 11.5, lineHeight: 17, color: 'rgba(11,30,61,0.4)', marginTop: 14 },
});