import { themedSheet } from '../../theme/useTheme';
import KeyboardSafe from '../../components/KeyboardSafe';
/**
 * BusinessApplyScreen - a company applies to exist on Platinum Circles.
 * The application lands on the operations desk; approval creates the
 * business account already wearing the space-grey seal. The applicant
 * becomes its first owner.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StatusBar, TextInput, Alert, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { BusinessSessionError, businessSessionMessage, businessSessionStep, confirmBusinessViewer, installBusinessSession, isBusinessSessionHandoff, prepareBusinessSession, type BusinessSessionHandoff } from '../../services/businessSessionService';

const NAVY = '#0B1E3D';
type Application = { id: string; company_name: string; status: string; decision_reason: string | null; created_at: string };
type OwnerConfirmation = { applicationId: string; owner: string; version: number };

export default function BusinessApplyScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [openingBusiness, setOpeningBusiness] = useState<string | null>(null);
  const [openingSession, setOpeningSession] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [ready, setReady] = useState(false), [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [regInfo, setRegInfo] = useState('');
  const [handle, setHandle] = useState('');
  const [handleState, setHandleState] = useState<'idle' | 'checking' | 'free' | 'taken' | 'invalid' | 'error'>('idle');
  const [busy, setBusy] = useState(false);
  const [apps, setApps] = useState<Application[]>([]);
  const live = useRef(false), account = useRef<string | null | undefined>(undefined);
  const accountVersion = useRef(0), actionVersion = useRef(0), readVersion = useRef(0), handleVersion = useRef(0);
  const pending = useRef(false), accessRequest = useRef<AbortController | null>(null), readRequest = useRef<AbortController | null>(null);
  const sessionHandoff = useRef<BusinessSessionHandoff | null>(null), bootstrap = useRef<OwnerConfirmation | null>(null);

  const resetForm = useCallback(() => {
    handleVersion.current++;
    setCompanyName(''); setCategory(''); setDescription(''); setEmail(''); setPhone(''); setWebsite(''); setRegInfo(''); setHandle(''); setHandleState('idle');
  }, []);

  const updateAccount = useCallback((next: string | null) => {
    if (next === account.current) return;
    account.current = next; accountVersion.current++; actionVersion.current++;
    accessRequest.current?.abort(); accessRequest.current = null; sessionHandoff.current = null; bootstrap.current = null;
    pending.current = false;
    setUid(next); setApps([]); setBusy(false); setOpeningBusiness(null); setOpeningSession(false); setNotice(null);
    resetForm();
  }, [resetForm]);

  const load = useCallback(async () => {
    if (!live.current) return;
    const request = ++readVersion.current, abort = new AbortController();
    readRequest.current?.abort(); readRequest.current = abort;
    const current = () => live.current && request === readVersion.current && !abort.signal.aborted;
    setLoading(true); setReadError(null);
    let confirmingAccount = true;
    try {
      const { data: auth, error: authError } = await businessSessionStep(supabase.auth.getUser(), abort.signal);
      if (!current()) return;
      if (authError && authError.name !== 'AuthSessionMissingError') throw authError;
      const me = auth.user?.id ?? null;
      updateAccount(me); setReady(true);
      if (!me) return;
      confirmingAccount = false;
      const { data, error } = await businessSessionStep(supabase.from('business_applications')
        .select('id, company_name, status, decision_reason, created_at')
        .eq('applicant_id', me).order('created_at', { ascending: false }).limit(5), abort.signal);
      if (!current()) return;
      if (error || !Array.isArray(data)) throw error || new Error('Application history unavailable');
      setApps(data);
    } catch {
      if (current()) setReadError(confirmingAccount ? 'Your account could not be confirmed. Try again.' : 'Applications could not be loaded. Try again.');
    } finally {
      if (current()) { setLoading(false); setReady(true); }
      if (readRequest.current === abort) readRequest.current = null;
      abort.abort();
    }
  }, [updateAccount]);

  useEffect(() => {
    live.current = true;
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active || !live.current || isBusinessSessionHandoff(sessionHandoff.current, session)) return;
      const next = session?.user.id ?? null;
      if (next === account.current) return;
      readVersion.current++; readRequest.current?.abort(); readRequest.current = null;
      updateAccount(next); setReadError(null); setReady(true); setLoading(!!next);
      const version = accountVersion.current;
      queueMicrotask(() => { if (active && live.current && version === accountVersion.current && next) void load(); });
    });
    queueMicrotask(() => { if (active && live.current) void load(); });
    return () => {
      active = false; live.current = false; actionVersion.current++; readVersion.current++; handleVersion.current++;
      accessRequest.current?.abort(); accessRequest.current = null; readRequest.current?.abort(); readRequest.current = null;
      sessionHandoff.current = null; bootstrap.current = null; subscription.unsubscribe();
    };
  }, [load, updateAccount]);

  const openBusiness = async (applicationId: string, confirmation?: OwnerConfirmation) => {
    const owner = account.current;
    if (!owner || !live.current || pending.current) return;
    if (confirmation && (confirmation !== bootstrap.current || confirmation.owner !== owner || confirmation.version !== accountVersion.current || confirmation.applicationId !== applicationId)) return;
    const request = ++actionVersion.current, version = accountVersion.current, abort = new AbortController();
    accessRequest.current = abort; pending.current = true; bootstrap.current = null;
    const current = () => live.current && request === actionVersion.current && version === accountVersion.current && accessRequest.current === abort && !abort.signal.aborted;
    setOpeningBusiness(applicationId); setNotice(null);
    try {
      const destination = await prepareBusinessSession(supabase, { kind: 'owner', applicationId, bootstrapOwner: !!confirmation }, owner, current, abort.signal, `${Platform.OS} app`);
      if (!current()) return;
      sessionHandoff.current = { businessId: destination.business_id, accessToken: destination.session.access_token }; setOpeningSession(true);
      await installBusinessSession(supabase, destination, current, abort.signal);
      // The global Auth observer opens the business account after installation.
      if (current()) { setNotice('Business access confirmed. Opening your account…'); resetForm(); setApps([]); }
    } catch (failure) {
      if (!current()) return;
      if (failure instanceof BusinessSessionError && failure.code === 'OWNER_BOOTSTRAP_REQUIRED') {
        const approval: OwnerConfirmation = { applicationId, owner, version };
        bootstrap.current = approval;
        const dismiss = () => { if (bootstrap.current === approval) bootstrap.current = null; };
        Alert.alert('Set up your owner access?', 'This creates your owner seat and registers this device as approved for your business. You can then add staff and review their devices in Studio → Team.', [
          { text: 'Cancel', style: 'cancel', onPress: dismiss },
          { text: 'Set up owner access', onPress: () => {
            if (live.current && account.current === owner && accountVersion.current === version && bootstrap.current === approval) void openBusiness(applicationId, approval);
          } },
        ], { cancelable: true, onDismiss: dismiss });
      } else { Alert.alert('Business access', businessSessionMessage(failure)); }
    } finally {
      if (accessRequest.current === abort) {
        accessRequest.current = null; sessionHandoff.current = null; abort.abort();
        if (live.current && request === actionVersion.current && version === accountVersion.current) { pending.current = false; setOpeningBusiness(null); setOpeningSession(false); }
      }
    }
  };

  const cancelBusinessAccess = () => {
    if (sessionHandoff.current || !accessRequest.current) return;
    actionVersion.current++; accessRequest.current.abort(); accessRequest.current = null; bootstrap.current = null; pending.current = false;
    setOpeningBusiness(null); setOpeningSession(false); setNotice('Business sign-in cancelled. Your personal account is unchanged.');
  };

  const checkHandle = async (v: string) => {
    if (!live.current || pending.current) return;
    const request = ++handleVersion.current, version = accountVersion.current;
    const current = () => live.current && request === handleVersion.current && version === accountVersion.current;
    const clean = v.trim().toLowerCase();
    setHandle(clean);
    if (!clean) { setHandleState('idle'); return; }
    if (!/^[a-z0-9_]{3,30}$/.test(clean)) { setHandleState('invalid'); return; }
    if (!account.current) { setHandleState('idle'); return; }
    setHandleState('checking');
    try {
      const { data, error } = await supabase.rpc('is_username_available', { p_username: clean });
      if (!current()) return;
      if (error || typeof data !== 'boolean') { setHandleState('error'); return; }
      setHandleState(data ? 'free' : 'taken');
    } catch { if (current()) setHandleState('error'); }
  };

  const submit = async () => {
    if (pending.current || !live.current) return;
    const owner = account.current;
    if (!owner) { Alert.alert('Sign in required', 'Sign in to your personal account before applying. It will become the verified owner of your business.'); return; }
    if (!companyName.trim() || !description.trim() || !email.trim() || !handle) {
      Alert.alert('Missing details', 'Company name, what you do, a contact email and a desired @ are required.');
      return;
    }
    if (!/^[a-z0-9_]{3,30}$/.test(handle) || handleState === 'taken') {
      Alert.alert('Handle', 'Pick an available handle: 3 to 30 characters, letters, numbers and underscores.');
      return;
    }
    const request = ++actionVersion.current, version = accountVersion.current, abort = new AbortController();
    accessRequest.current = abort;
    const current = () => live.current && request === actionVersion.current && version === accountVersion.current && accessRequest.current === abort && !abort.signal.aborted;
    pending.current = true; setBusy(true); setNotice(null);
    try {
      await confirmBusinessViewer(supabase, owner, current, abort.signal);
      if (!current()) return;
      const { error } = await supabase.from('business_applications').insert({
        applicant_id: owner,
        company_name: companyName.trim(),
        category: category.trim() || null,
        description: description.trim(),
        contact_email: email.trim(),
        contact_phone: phone.trim() || null,
        website: website.trim() || null,
        registration_info: regInfo.trim() || null,
        desired_username: handle,
      });
      if (!current()) return;
      if (error) throw error;
      resetForm(); void load();
      Alert.alert('Application sent', 'The Platinum Circles operations team reviews every business application. The outcome will appear here, and on approval your business account is created with its own @ and the space-grey seal.');
    } catch {
      if (current()) Alert.alert('Could not send', 'Your application could not be sent. Your details are still here. Confirm your personal account and try again.');
    } finally {
      if (accessRequest.current === abort) accessRequest.current = null;
      abort.abort();
      if (live.current && request === actionVersion.current && version === accountVersion.current) { pending.current = false; setBusy(false); }
    }
  };

  const handleHint = handleState === 'checking' ? 'Checking...' : handleState === 'free' ? '@' + handle + ' is available' : handleState === 'taken' ? 'That handle is taken' : handleState === 'invalid' ? '3-30 chars: a-z, 0-9, _' : handleState === 'error' ? 'Could not check availability. Try entering the handle again.' : '';
  const locked = busy || openingBusiness !== null || !ready;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => { if (sessionHandoff.current) return; if (openingBusiness) cancelBusinessAccess(); navigation.goBack(); }} disabled={openingSession} accessibilityRole="button" accessibilityLabel="Back" style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>{'\u2039'}</Text><Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Business account</Text>
        <View style={{ width: 60 }} />
      </View>
      <KeyboardSafe>
      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: Math.max(insets.bottom + 110, 130) }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={s.lede}>A business gets its own separate account with its own @ and the space-grey seal. Tell us who you are - a person on the operations team reviews every application. You will be the first owner and can add your team after approval.</Text>
        {!ready && <Text accessibilityLiveRegion="polite" style={s.lede}>Checking your current account…</Text>}
        {ready && !uid && !readError && <Text style={s.lede}>Sign in to your personal account before applying or opening a business.</Text>}
        <Text style={s.fieldLabel}>Company or business name</Text>
        <TextInput value={companyName} onChangeText={setCompanyName} editable={!locked} accessibilityLabel="Company or business name" placeholder="Company or business name" placeholderTextColor="#9CA3AF" style={s.input} />
        <Text style={s.fieldLabel}>Industry (optional)</Text>
        <TextInput value={category} onChangeText={setCategory} editable={!locked} accessibilityLabel="Industry" placeholder="For example, Fintech, Retail or Media" placeholderTextColor="#9CA3AF" style={s.input} />
        <Text style={s.fieldLabel}>About your business</Text>
        <TextInput value={description} onChangeText={setDescription} editable={!locked} accessibilityLabel="About your business" multiline placeholder="What the business does, who runs it, and why it belongs on Platinum Circles" placeholderTextColor="#9CA3AF" style={[s.input, { minHeight: 100, textAlignVertical: 'top' }]} />
        <Text style={s.fieldLabel}>Business contact email</Text>
        <TextInput value={email} onChangeText={setEmail} editable={!locked} accessibilityLabel="Business contact email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="Business contact email" placeholderTextColor="#9CA3AF" style={s.input} />
        <Text style={s.fieldLabel}>Business phone (optional)</Text>
        <TextInput value={phone} onChangeText={setPhone} editable={!locked} accessibilityLabel="Business phone" keyboardType="phone-pad" placeholder="Business phone (optional)" placeholderTextColor="#9CA3AF" style={s.input} />
        <Text style={s.fieldLabel}>Website (optional)</Text>
        <TextInput value={website} onChangeText={setWebsite} editable={!locked} accessibilityLabel="Website" autoCapitalize="none" autoCorrect={false} placeholder="Website (optional)" placeholderTextColor="#9CA3AF" style={s.input} />
        <Text style={s.fieldLabel}>Registration or license details (optional)</Text>
        <TextInput value={regInfo} onChangeText={setRegInfo} editable={!locked} accessibilityLabel="Registration or license details" placeholder="Registration or license details (optional)" placeholderTextColor="#9CA3AF" style={s.input} />
        <Text style={s.fieldLabel}>Desired business handle</Text>
        <TextInput value={handle} onChangeText={checkHandle} editable={!locked} accessibilityLabel="Desired business handle" maxLength={30} autoCapitalize="none" autoCorrect={false} placeholder="Desired @ for the business" placeholderTextColor="#9CA3AF" style={s.input} />
        {handleHint ? <Text style={[s.hint, handleState === 'free' ? { color: '#059669' } : handleState === 'checking' ? { color: 'rgba(11,30,61,0.5)' } : { color: '#FF3B30' }]}>{handleHint}</Text> : null}
        <TouchableOpacity style={[s.submit, locked && { opacity: 0.5 }]} onPress={submit} disabled={locked} accessibilityRole="button" accessibilityLabel="Send application" accessibilityState={{ disabled: locked, busy }} activeOpacity={0.85}>
          {busy ? <ActivityIndicator color="#FFFFFF" size={16} /> : <Text style={s.submitTxt}>Send application</Text>}
        </TouchableOpacity>

        {notice && <Text accessibilityLiveRegion="polite" style={s.reply}>{notice}</Text>}
        {openingBusiness && <View style={{ marginVertical: 12 }}><Text accessibilityLiveRegion="polite" style={s.lede}>{openingSession ? 'Opening your business account…' : 'Checking owner and device access…'}</Text>{!openingSession && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel business sign-in" onPress={cancelBusinessAccess} style={s.secondary}><Text style={s.fieldLabel}>Cancel business sign-in</Text></TouchableOpacity>}</View>}
        {readError && <View style={{ marginTop: 14 }}><Text accessibilityRole="alert" style={s.reply}>{readError}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry applications" onPress={() => void load()} disabled={loading || locked} style={s.secondary}><Text style={s.fieldLabel}>Retry applications</Text></TouchableOpacity></View>}
        {loading && ready && <Text accessibilityLiveRegion="polite" style={s.lede}>Loading applications…</Text>}

        {apps.length ? <Text style={s.histLabel}>Your applications</Text> : null}
        {apps.map(a => (
          <View key={a.id} style={s.ticket}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={s.ticketSubject} numberOfLines={1}>{a.company_name}</Text>
              <View style={[s.pill, a.status === 'approved' ? s.pillDone : a.status === 'rejected' ? s.pillBad : s.pillOpen]}>
                <Text style={[s.pillTxt, a.status === 'approved' ? s.pillTxtDone : a.status === 'rejected' ? s.pillTxtBad : s.pillTxtOpen]}>{a.status === 'approved' ? 'Approved' : a.status === 'rejected' ? 'Declined' : 'Under review'}</Text>
              </View>
            </View>
            {a.decision_reason ? <Text style={s.reply}>{a.status === 'approved' ? 'Approved. Open your business to manage access.' : a.decision_reason}</Text> : null}
            {a.status === 'approved' && <TouchableOpacity disabled={locked} accessibilityRole="button" accessibilityLabel={`Open ${a.company_name}`} onPress={() => void openBusiness(a.id)} style={s.secondary}><Text style={s.ticketSubject}>Open business</Text></TouchableOpacity>}
            <Text style={s.when}>{new Date(a.created_at).toLocaleDateString()}</Text>
          </View>
        ))}
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
  lede: { fontSize: 13, lineHeight: 19, color: 'rgba(11,30,61,0.6)', marginBottom: 14, marginTop: 4 },
  input: { borderWidth: 1.2, borderColor: t.surface.hairline, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: NAVY, marginBottom: 10, backgroundColor: t.surface.canvas },
  fieldLabel: { fontSize: 12, color: t.ink.primary, fontWeight: '600', marginBottom: 5 },
  secondary: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center', marginTop: 4 },
  hint: { fontSize: 12, fontWeight: '600', marginTop: -4, marginBottom: 10, marginLeft: 4 },
  submit: { backgroundColor: NAVY, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  submitTxt: { color: t.ink.inverse, fontSize: 15, fontWeight: '800' },
  histLabel: { fontSize: 12, fontWeight: '800', color: t.ink.muted, marginTop: 22, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  ticket: { borderWidth: 1.2, borderColor: 'rgba(11,30,61,0.1)', borderRadius: 14, padding: 12, marginBottom: 10 },
  ticketSubject: { flex: 1, fontSize: 13.5, fontWeight: '700', color: NAVY, marginRight: 8 },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillOpen: { backgroundColor: 'rgba(180,83,9,0.1)' },
  pillDone: { backgroundColor: 'rgba(5,150,105,0.1)' },
  pillBad: { backgroundColor: 'rgba(220,38,38,0.1)' },
  pillTxt: { fontSize: 10.5, fontWeight: '800' },
  pillTxtOpen: { color: '#D97706' },
  pillTxtDone: { color: '#059669' },
  pillTxtBad: { color: '#FF3B30' },
  reply: { fontSize: 13, lineHeight: 18, color: 'rgba(11,30,61,0.75)', marginTop: 8, backgroundColor: 'rgba(11,30,61,0.04)', borderRadius: 10, padding: 10 },
  when: { fontSize: 11, color: 'rgba(11,30,61,0.4)', marginTop: 8 },
}));
