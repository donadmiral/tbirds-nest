/**
 * BusinessApplyScreen - a company applies to exist on Platinum Circles.
 * The application lands on the operations desk; approval creates the
 * business account already wearing the space-grey seal. The applicant
 * becomes its first owner.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

const NAVY = '#0B1E3D';

export default function BusinessApplyScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();

  const [companyName, setCompanyName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [regInfo, setRegInfo] = useState('');
  const [handle, setHandle] = useState('');
  const [handleState, setHandleState] = useState<'idle' | 'checking' | 'free' | 'taken' | 'invalid'>('idle');
  const [busy, setBusy] = useState(false);
  const [apps, setApps] = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const { data } = await supabase.from('business_applications')
      .select('id, company_name, status, decision_reason, created_at')
      .eq('applicant_id', profile.id).order('created_at', { ascending: false }).limit(5);
    setApps(data ?? []);
  }, [profile?.id]);
  useEffect(() => { load(); }, [load]);

  const checkHandle = async (v: string) => {
    const clean = v.trim().toLowerCase();
    setHandle(clean);
    if (!clean) { setHandleState('idle'); return; }
    if (!/^[a-z0-9_]{3,30}$/.test(clean)) { setHandleState('invalid'); return; }
    if (!profile?.id) { setHandleState('idle'); return; } // availability checked at review when applying logged out
    setHandleState('checking');
    try {
      const { data, error } = await supabase.rpc('is_username_available', { p_username: clean });
      if (error) { setHandleState('idle'); return; }
      setHandleState(data ? 'free' : 'taken');
    } catch { setHandleState('idle'); }
  };

  const submit = async () => {
    if (!profile?.id || busy) return;
    if (!companyName.trim() || !description.trim() || !email.trim() || !handle) {
      Alert.alert('Missing details', 'Company name, what you do, a contact email and a desired @ are required.');
      return;
    }
    if (handleState === 'taken' || handleState === 'invalid') {
      Alert.alert('Handle', 'Pick an available handle: 3 to 30 characters, letters, numbers and underscores.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.from('business_applications').insert({
        applicant_id: profile.id,
        company_name: companyName.trim(),
        category: category.trim() || null,
        description: description.trim(),
        contact_email: email.trim(),
        contact_phone: phone.trim() || null,
        website: website.trim() || null,
        registration_info: regInfo.trim() || null,
        desired_username: handle,
      });
      if (error) throw error;
      setCompanyName(''); setCategory(''); setDescription(''); setEmail(''); setPhone(''); setWebsite(''); setRegInfo(''); setHandle(''); setHandleState('idle');
      await load();
      Alert.alert('Application sent', 'The Platinum Circles operations team reviews every business application. The outcome will appear here, and on approval your business account is created with its own @ and the space-grey seal.');
    } catch (e: any) {
      Alert.alert('Could not send', e?.message || 'Try again.');
    } finally { setBusy(false); }
  };

  const handleHint = handleState === 'checking' ? 'Checking...' : handleState === 'free' ? '@' + handle + ' is available' : handleState === 'taken' ? 'That handle is taken' : handleState === 'invalid' ? '3-30 chars: a-z, 0-9, _' : '';

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>{'\u2039'}</Text><Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Business account</Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: Math.max(insets.bottom + 110, 130) }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={s.lede}>A business gets its own separate account with its own @ and the space-grey seal. Tell us who you are - a person on the operations team reviews every application. You will be the first owner and can add your team after approval.</Text>
        <TextInput value={companyName} onChangeText={setCompanyName} placeholder="Company or business name" placeholderTextColor="#9CA3AF" style={s.input} />
        <TextInput value={category} onChangeText={setCategory} placeholder="What industry (e.g. Fintech, Retail, Media)" placeholderTextColor="#9CA3AF" style={s.input} />
        <TextInput value={description} onChangeText={setDescription} multiline placeholder="What the business does, who runs it, and why it belongs on Platinum Circles" placeholderTextColor="#9CA3AF" style={[s.input, { minHeight: 100, textAlignVertical: 'top' }]} />
        <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Business contact email" placeholderTextColor="#9CA3AF" style={s.input} />
        <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Business phone (optional)" placeholderTextColor="#9CA3AF" style={s.input} />
        <TextInput value={website} onChangeText={setWebsite} autoCapitalize="none" placeholder="Website (optional)" placeholderTextColor="#9CA3AF" style={s.input} />
        <TextInput value={regInfo} onChangeText={setRegInfo} placeholder="Registration or license details (optional)" placeholderTextColor="#9CA3AF" style={s.input} />
        <TextInput value={handle} onChangeText={checkHandle} autoCapitalize="none" placeholder="Desired @ for the business" placeholderTextColor="#9CA3AF" style={s.input} />
        {handleHint ? <Text style={[s.hint, handleState === 'free' ? { color: '#059669' } : handleState === 'checking' ? { color: 'rgba(11,30,61,0.5)' } : { color: '#DC2626' }]}>{handleHint}</Text> : null}
        <TouchableOpacity style={[s.submit, busy && { opacity: 0.5 }]} onPress={submit} disabled={busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator color="#FFFFFF" size={16} /> : <Text style={s.submitTxt}>Send application</Text>}
        </TouchableOpacity>

        {apps.length ? <Text style={s.histLabel}>Your applications</Text> : null}
        {apps.map(a => (
          <View key={a.id} style={s.ticket}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={s.ticketSubject} numberOfLines={1}>{a.company_name}</Text>
              <View style={[s.pill, a.status === 'approved' ? s.pillDone : a.status === 'rejected' ? s.pillBad : s.pillOpen]}>
                <Text style={[s.pillTxt, a.status === 'approved' ? s.pillTxtDone : a.status === 'rejected' ? s.pillTxtBad : s.pillTxtOpen]}>{a.status === 'approved' ? 'Approved' : a.status === 'rejected' ? 'Declined' : 'Under review'}</Text>
              </View>
            </View>
            {a.decision_reason ? <Text style={s.reply}>{a.decision_reason}</Text> : null}
            <Text style={s.when}>{new Date(a.created_at).toLocaleDateString()}</Text>
          </View>
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
  lede: { fontSize: 13, lineHeight: 19, color: 'rgba(11,30,61,0.6)', marginBottom: 14, marginTop: 4 },
  input: { borderWidth: 1.2, borderColor: 'rgba(11,30,61,0.14)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: NAVY, marginBottom: 10, backgroundColor: '#FFFFFF' },
  hint: { fontSize: 12, fontWeight: '600', marginTop: -4, marginBottom: 10, marginLeft: 4 },
  submit: { backgroundColor: NAVY, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  submitTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  histLabel: { fontSize: 12, fontWeight: '800', color: 'rgba(11,30,61,0.45)', marginTop: 22, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  ticket: { borderWidth: 1.2, borderColor: 'rgba(11,30,61,0.1)', borderRadius: 14, padding: 12, marginBottom: 10 },
  ticketSubject: { flex: 1, fontSize: 13.5, fontWeight: '700', color: NAVY, marginRight: 8 },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillOpen: { backgroundColor: 'rgba(180,83,9,0.1)' },
  pillDone: { backgroundColor: 'rgba(5,150,105,0.1)' },
  pillBad: { backgroundColor: 'rgba(220,38,38,0.1)' },
  pillTxt: { fontSize: 10.5, fontWeight: '800' },
  pillTxtOpen: { color: '#B45309' },
  pillTxtDone: { color: '#059669' },
  pillTxtBad: { color: '#DC2626' },
  reply: { fontSize: 13, lineHeight: 18, color: 'rgba(11,30,61,0.75)', marginTop: 8, backgroundColor: 'rgba(11,30,61,0.04)', borderRadius: 10, padding: 10 },
  when: { fontSize: 11, color: 'rgba(11,30,61,0.4)', marginTop: 8 },
});
