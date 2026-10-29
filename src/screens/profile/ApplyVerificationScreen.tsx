import SettingsExit from '../../components/SettingsExit';
import { settingsBack } from '../../navigation/settingsNavigation';
import { themedSheet } from '../../theme/useTheme';
import KeyboardSafe from '../../components/KeyboardSafe';
/**
 * ApplyVerificationScreen - where the badge is earned, never bought.
 * Businesses apply for space grey. Public figures and renowned educators
 * apply for green with a category. Officials apply for platinum with their
 * office. Applications land in verification_applications for a human
 * decision in the admin; this screen also shows the live status.
 */
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import VerifiedBadge from '../../components/VerifiedBadge';

import { currentVerificationStatus, prepareVerificationEvidence, verificationError, type VerificationApplication, type VerificationProfile } from '../../../shared/verification';

const NAVY = '#0B1E3D';

const CATEGORIES = [
  'Musician & Artist', 'Athlete & Sport', 'Media & Journalist', 'Creator & Entertainer',
  'Academic & Educator', 'Business Executive & Founder', 'Author & Public Voice', 'Other',
];

export default function ApplyVerificationScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const [currentProfile, setCurrentProfile] = useState<VerificationProfile | null>(null);
  const isBusiness = currentProfile?.account_type === 'business';
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadGeneration = useRef(0);

  const [existing, setExisting] = useState<VerificationApplication | null | undefined>(undefined);
  const [tier, setTier] = useState<'public_figure' | 'official' | 'business'>(isBusiness ? 'business' : 'public_figure');
  const [category, setCategory] = useState<string | null>(null);
  const [links, setLinks] = useState('');
  const [statement, setStatement] = useState('');
  const [office, setOffice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoadError(null);
    if (!profile?.id) { setExisting(null); setCurrentProfile(null); return; }
    try {
      const [appResult, profileResult] = await Promise.all([
        supabase.from('verification_applications').select('status,tier,decision_reason,created_at').eq('applicant_id', profile.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('profiles').select('account_type,is_verified,verified_tier').eq('id', profile.id).single(),
      ]);
      if (appResult.error) throw appResult.error;
      if (profileResult.error) throw profileResult.error;
      if (generation !== loadGeneration.current) return;
      setExisting(appResult.data ?? null);
      setCurrentProfile(profileResult.data);
      setTier(value => profileResult.data.account_type === 'business' ? 'business' : value === 'business' ? 'public_figure' : value);
    } catch (failure) {
      if (generation === loadGeneration.current) setLoadError(verificationError(failure));
    }
  }, [profile?.id]);
  useFocusEffect(useCallback(() => { void load(); return () => { ++loadGeneration.current; }; }, [load]));

  const submit = async () => {
    if (!profile?.id || busy) return;
    setBusy(true);
    try {
      const evidence = prepareVerificationEvidence(tier, category, statement, links, office);
      const { error } = await supabase.from('verification_applications').insert({
        applicant_id: profile.id,
        tier,
        category: tier === 'public_figure' ? category : (tier === 'official' ? 'Official' : 'Business'),
        evidence,
      });
      if (error) throw error;
      await load();
    } catch (e: any) {
      Alert.alert('Could not submit', verificationError(e));
    } finally { setBusy(false); }
  };

  const status = currentVerificationStatus(existing ?? null, currentProfile);
  const renderStatus = () => {
    const st = status;
    const verdictTier = (currentProfile?.is_verified ? currentProfile.verified_tier : existing?.tier) as any;
    return (
      <View style={s.statusCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <VerifiedBadge tier={verdictTier} size={20} />
          <Text style={s.statusTier}>{verdictTier === 'official' ? 'Platinum' : verdictTier === 'business' ? 'Space grey' : 'Green'} application</Text>
        </View>
        {st === 'approved' ? (
          <Text style={[s.statusLine, { color: '#059669' }]}>Approved. Your badge is live across Platinum Circles.</Text>
        ) : st === 'rejected' || st === 'revoked' ? (
          <>
            <Text style={[s.statusLine, { color: '#FF3B30' }]}>{st === 'revoked' ? 'Verification is no longer active.' : 'Not approved this time.'}</Text>
            {st === 'rejected' && existing?.decision_reason ? <Text style={s.statusReason}>{existing.decision_reason}</Text> : null}
            <Text style={s.statusReason}>Submit updated evidence, or contact support in Settings for a review.</Text>
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
        <TouchableOpacity onPress={() => settingsBack(navigation, 'Settings')} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>{'\u2039'}</Text><Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Verification</Text>
        <SettingsExit navigation={navigation} />
      </View>
      <KeyboardSafe>
      <ScrollView automaticallyAdjustKeyboardInsets={true} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: Math.max(insets.bottom + 110, 130) }} keyboardShouldPersistTaps="handled">
        <Text style={s.lede}>A verified seal identifies an account reviewed for authenticity. Supply public evidence of your identity and authority. Verification is not an endorsement.</Text>

        {loadError ? <View style={s.statusCard}><Text accessibilityRole="alert" style={s.statusLine}>{loadError}</Text><TouchableOpacity style={s.reapply} onPress={() => void load()}><Text style={s.reapplyTxt}>Retry</Text></TouchableOpacity></View> : !profile?.id ? <Text style={s.statusLine}>Sign in to apply for verification.</Text> : existing === undefined ? <ActivityIndicator color={NAVY} style={{ marginTop: 24 }} /> : status ? renderStatus() : (
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
                <TextInput value={office} maxLength={200} onChangeText={setOffice} placeholder="e.g. Member of Parliament, Harare" placeholderTextColor="#9CA3AF" style={s.input} />
              </>
            ) : null}

            <Text style={s.fieldLabel}>{isBusiness ? 'Why this business qualifies' : 'Why you qualify'}</Text>
            <TextInput value={statement} maxLength={2000} onChangeText={setStatement} multiline placeholder={isBusiness ? 'Registration number, how long established, public footprint...' : 'Your reach, your work, why Zimbabweans know you...'} placeholderTextColor="#9CA3AF" style={[s.input, { minHeight: 110, textAlignVertical: 'top' }]} />

            <Text style={s.fieldLabel}>Evidence links (1–8, one per line)</Text>
            <TextInput value={links} onChangeText={setLinks} multiline autoCapitalize="none" placeholder={'https://example.com/official-profile\nhttps://example.com/press-coverage'} placeholderTextColor="#9CA3AF" style={[s.input, { minHeight: 90, textAlignVertical: 'top' }]} />

            <Text style={s.note}>Link to public evidence. Do not include identity documents or private credentials.</Text>

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

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  backBtn: { flexDirection: 'row', alignItems: 'center', width: 60 },
  backChev: { fontSize: 26, color: NAVY, marginRight: 2, marginTop: -3 },
  backLbl: { fontSize: 15, color: NAVY, fontWeight: '600' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: NAVY },
  lede: { fontSize: 13, lineHeight: 19, color: 'rgba(11,30,61,0.6)', marginBottom: 16, marginTop: 4 },
  tierRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  tierChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 14, borderWidth: 1.2, borderColor: t.surface.hairline, backgroundColor: t.surface.canvas },
  tierChipOn: { borderColor: NAVY, backgroundColor: t.brand.tintBg },
  tierTxt: { fontSize: 12.5, fontWeight: '700', color: 'rgba(11,30,61,0.6)', flexShrink: 1 },
  tierTxtOn: { color: NAVY },
  fieldLabel: { fontSize: 13, fontWeight: '800', color: NAVY, marginBottom: 8, marginTop: 6 },
  catWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  catChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1.2, borderColor: t.surface.hairline, backgroundColor: t.surface.canvas },
  catChipOn: { borderColor: '#059669', backgroundColor: 'rgba(5,150,105,0.08)' },
  catTxt: { fontSize: 12.5, fontWeight: '600', color: 'rgba(11,30,61,0.65)' },
  catTxtOn: { color: '#059669', fontWeight: '800' },
  input: { borderWidth: 1.2, borderColor: t.surface.hairline, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: NAVY, marginBottom: 10, backgroundColor: t.surface.canvas },
  note: { fontSize: 11.5, color: 'rgba(11,30,61,0.5)', marginBottom: 10 },
  submit: { backgroundColor: NAVY, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  submitTxt: { color: t.ink.inverse, fontSize: 15, fontWeight: '800' },
  statusCard: { borderWidth: 1.2, borderColor: t.surface.hairline, borderRadius: 16, padding: 16, marginTop: 8, backgroundColor: 'rgba(11,30,61,0.03)' },
  statusTier: { fontSize: 15, fontWeight: '800', color: NAVY, marginLeft: 4 },
  statusLine: { fontSize: 13.5, lineHeight: 20, color: 'rgba(11,30,61,0.75)', marginTop: 10 },
  statusReason: { fontSize: 13, color: 'rgba(11,30,61,0.6)', marginTop: 6, fontStyle: 'italic' },
  reapply: { marginTop: 12, alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 12, backgroundColor: NAVY },
  reapplyTxt: { color: t.ink.inverse, fontSize: 13, fontWeight: '700' },
}));