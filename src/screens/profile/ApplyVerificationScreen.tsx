import KeyboardSafe from '../../components/KeyboardSafe';
/**
 * ApplyVerificationScreen - where the badge is earned, never bought.
 * Businesses apply for space grey. Public figures and renowned educators
 * apply for green with a category. Officials apply for platinum with their
 * office. Applications land in verification_applications for a human
 * decision in the admin; this screen also shows the live status.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import VerifiedBadge from '../../components/VerifiedBadge';

const NAVY = '#0B1E3D';

const CATEGORIES = [
  'Musician & Artist', 'Athlete & Sport', 'Media & Journalist', 'Creator & Entertainer',
  'Academic & Educator', 'Business Executive & Founder', 'Author & Public Voice', 'Other',
];

export default function ApplyVerificationScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const isBusiness = (profile as any)?.account_type === 'business';

  const [existing, setExisting] = useState<any | undefined>(undefined);
  const [tier, setTier] = useState<'public_figure' | 'official' | 'business'>(isBusiness ? 'business' : 'public_figure');
  const [category, setCategory] = useState<string | null>(null);
  const [links, setLinks] = useState('');
  const [statement, setStatement] = useState('');
  const [office, setOffice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const { data } = await supabase.from('verification_applications')
      .select('*').eq('applicant_id', profile.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    setExisting(data ?? null);
  }, [profile?.id]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!profile?.id || busy) return;
    if (tier === 'public_figure' && !category) { Alert.alert('Pick a category', 'Choose the category that fits you.'); return; }
    if (tier === 'official' && !office.trim()) { Alert.alert('Office required', 'State the office or position you hold.'); return; }
    if (!statement.trim()) { Alert.alert('Tell us why', 'Write a short statement making your case.'); return; }
    setBusy(true);
    try {
      const evidence = {
        links: links.split('\n').map(l => l.trim()).filter(Boolean),
        statement: statement.trim(),
        ...(tier === 'official' ? { office: office.trim() } : {}),
      };
      const { error } = await supabase.from('verification_applications').insert({
        applicant_id: profile.id,
        tier,
        category: tier === 'public_figure' ? category : (tier === 'official' ? 'Official' : 'Business'),
        evidence,
      });
      if (error) throw error;
      await load();
    } catch (e: any) {
      Alert.alert('Could not submit', e?.message || 'Try again.');
    } finally { setBusy(false); }
  };

  const Status = () => {
    if (!existing) return null;
    const st = existing.status;
    const verdictTier = existing.tier as any;
    return (
      <View style={s.statusCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <VerifiedBadge tier={verdictTier} size={20} />
          <Text style={s.statusTier}>{verdictTier === 'official' ? 'Platinum' : verdictTier === 'business' ? 'Space grey' : 'Green'} application</Text>
        </View>
        {st === 'approved' ? (
          <Text style={[s.statusLine, { color: '#059669' }]}>Approved. Your badge is live across Platinum Circles.</Text>
        ) : st === 'rejected' ? (
          <>
            <Text style={[s.statusLine, { color: '#B91C1C' }]}>Not approved this time.</Text>
            {existing.decision_reason ? <Text style={s.statusReason}>{existing.decision_reason}</Text> : null}
            <TouchableOpacity style={s.reapply} onPress={() => setExisting(null)} activeOpacity={0.85}>
              <Text style={s.reapplyTxt}>Apply again</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={s.statusLine}>Under review. Verification is decided by a person, not a machine - you will see the outcome here.</Text>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>{'\u2039'}</Text><Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Verification</Text>
        <View style={{ width: 60 }} />
      </View>
      <KeyboardSafe>
      <ScrollView automaticallyAdjustKeyboardInsets={true} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: Math.max(insets.bottom + 110, 130) }} keyboardShouldPersistTaps="handled">
        <Text style={s.lede}>The badge on Platinum Circles is earned, never bought. Applications are reviewed by a person against a high bar - most accounts will not qualify, and that is what makes it mean something.</Text>

        {existing === undefined ? <ActivityIndicator color={NAVY} style={{ marginTop: 24 }} /> : existing ? <Status /> : (
          <>
            {!isBusiness ? (
              <View style={s.tierRow}>
                {([['public_figure', 'Public figure or educator'], ['official', 'Public official']] as const).map(([t, label]) => (
                  <TouchableOpacity key={t} style={[s.tierChip, tier === t && s.tierChipOn]} onPress={() => setTier(t)} activeOpacity={0.85}>
                    <VerifiedBadge tier={t} size={15} />
                    <Text style={[s.tierTxt, tier === t && s.tierTxtOn]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={s.tierRow}>
                <View style={[s.tierChip, s.tierChipOn]}>
                  <VerifiedBadge tier="business" size={15} />
                  <Text style={[s.tierTxt, s.tierTxtOn]}>Registered business</Text>
                </View>
              </View>
            )}

            {tier === 'public_figure' ? (
              <>
                <Text style={s.fieldLabel}>Your category</Text>
                <View style={s.catWrap}>
                  {CATEGORIES.map(c => (
                    <TouchableOpacity key={c} style={[s.catChip, category === c && s.catChipOn]} onPress={() => setCategory(c)} activeOpacity={0.85}>
                      <Text style={[s.catTxt, category === c && s.catTxtOn]}>{c}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : null}

            {tier === 'official' ? (
              <>
                <Text style={s.fieldLabel}>Office or position you hold</Text>
                <TextInput value={office} onChangeText={setOffice} placeholder="e.g. Member of Parliament, Harare" placeholderTextColor="#9CA3AF" style={s.input} />
              </>
            ) : null}

            <Text style={s.fieldLabel}>{isBusiness ? 'Why this business qualifies' : 'Why you qualify'}</Text>
            <TextInput value={statement} onChangeText={setStatement} multiline placeholder={isBusiness ? 'Registration number, how long established, public footprint...' : 'Your reach, your work, why Zimbabweans know you...'} placeholderTextColor="#9CA3AF" style={[s.input, { minHeight: 110, textAlignVertical: 'top' }]} />

            <Text style={s.fieldLabel}>Evidence links (one per line)</Text>
            <TextInput value={links} onChangeText={setLinks} multiline autoCapitalize="none" placeholder={'Press coverage\nOfficial website\nOther profiles'} placeholderTextColor="#9CA3AF" style={[s.input, { minHeight: 90, textAlignVertical: 'top' }]} />

            {tier === 'official' ? <Text style={s.note}>Identity documents are requested privately during review - never post them here.</Text> : null}

            <TouchableOpacity style={[s.submit, busy && { opacity: 0.5 }]} onPress={submit} disabled={busy} activeOpacity={0.85}>
              {busy ? <ActivityIndicator color="#FFFFFF" size={16} /> : <Text style={s.submitTxt}>Submit for review</Text>}
            </TouchableOpacity>
          </>
        )}
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
  lede: { fontSize: 13, lineHeight: 19, color: 'rgba(11,30,61,0.6)', marginBottom: 16, marginTop: 4 },
  tierRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  tierChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 14, borderWidth: 1.2, borderColor: 'rgba(11,30,61,0.14)', backgroundColor: '#FFFFFF' },
  tierChipOn: { borderColor: NAVY, backgroundColor: 'rgba(11,30,61,0.05)' },
  tierTxt: { fontSize: 12.5, fontWeight: '700', color: 'rgba(11,30,61,0.6)', flexShrink: 1 },
  tierTxtOn: { color: NAVY },
  fieldLabel: { fontSize: 13, fontWeight: '800', color: NAVY, marginBottom: 8, marginTop: 6 },
  catWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  catChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1.2, borderColor: 'rgba(11,30,61,0.14)', backgroundColor: '#FFFFFF' },
  catChipOn: { borderColor: '#059669', backgroundColor: 'rgba(5,150,105,0.08)' },
  catTxt: { fontSize: 12.5, fontWeight: '600', color: 'rgba(11,30,61,0.65)' },
  catTxtOn: { color: '#059669', fontWeight: '800' },
  input: { borderWidth: 1.2, borderColor: 'rgba(11,30,61,0.14)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: NAVY, marginBottom: 10, backgroundColor: '#FFFFFF' },
  note: { fontSize: 11.5, color: 'rgba(11,30,61,0.5)', marginBottom: 10 },
  submit: { backgroundColor: NAVY, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  submitTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  statusCard: { borderWidth: 1.2, borderColor: 'rgba(11,30,61,0.12)', borderRadius: 16, padding: 16, marginTop: 8, backgroundColor: 'rgba(11,30,61,0.03)' },
  statusTier: { fontSize: 15, fontWeight: '800', color: NAVY, marginLeft: 4 },
  statusLine: { fontSize: 13.5, lineHeight: 20, color: 'rgba(11,30,61,0.75)', marginTop: 10 },
  statusReason: { fontSize: 13, color: 'rgba(11,30,61,0.6)', marginTop: 6, fontStyle: 'italic' },
  reapply: { marginTop: 12, alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 12, backgroundColor: NAVY },
  reapplyTxt: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
});