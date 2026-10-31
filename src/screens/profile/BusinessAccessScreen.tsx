/** Business access uses current session/member RPCs. Raw code hashes and
 * direct member/device writes are intentionally unavailable to app clients. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StatusBar, TextInput, Alert, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { themedSheet, useTheme } from '../../theme/useTheme';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { StudioLoadError } from '../../components/StudioLoadError';
import { useStudioResource } from '../../hooks/useStudioResource';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

type Role = 'owner' | 'admin' | 'editor' | 'recruiter' | 'support';
type Member = { id: string; display_name: string; role: Role; active: boolean; last_sign_in_at: string | null };
type Device = { id: string; device_id: string; label: string | null; status: string };
type Signin = { id: string; member_name: string | null; created_at: string };
type AccessInfo = { profile: { id: string }; role: Role; members: Member[]; devices: Device[]; signins: Signin[] };
const ROLES: Role[] = ['owner', 'admin', 'editor', 'recruiter', 'support'];
const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', editor: 'Editor', recruiter: 'Recruiter', support: 'Support' };
const ROLE_DETAIL: Record<Role, string> = {
  owner: 'Manages the team, business settings and publishing.',
  admin: 'Manages publishing, reviews and approved devices.',
  editor: 'Prepares and publishes content within approval rules.',
  recruiter: 'Works with jobs and applications.',
  support: 'Handles customer conversations and reviews.',
};
function failureMessage(error: any) {
  const message = String(error?.message || '');
  if (message.includes('WORKFLOW_LAST_OWNER')) return 'Keep at least one active owner. Add another owner before changing this person.';
  if (/WORKFLOW_(ACTIVE_SESSION_REQUIRED|MEMBER_ACCESS_REQUIRED|PERMISSION_DENIED)/.test(message)) return 'Your current member access could not authorize this change. Open Studio to confirm your access, then refresh this screen.';
  return message || 'The change was not confirmed. Refresh the records before trying again.';
}

export default function BusinessAccessScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { t, isDark } = useTheme();
  const profile = useAuthStore(state => state.profile);
  const ownerId = useAuthStore(state => state.session?.user.id || '');
  const isBusiness = (profile as any)?.account_type === 'business' && profile?.id === ownerId;
  const scope = `${ownerId}:${profile?.id || ''}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  const mounted = useRef(true);
  const actionLock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<Role>('editor');
  const [issued, setIssued] = useState<{ scope: string; name: string; code: string } | null>(null);
  const current = useCallback(() => mounted.current && currentScope.current === scope && !!ownerId
    && useAuthStore.getState().session?.user.id === ownerId && useAuthStore.getState().profile?.id === ownerId, [scope, ownerId]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setNewName(''); setNewRole('editor'); setIssued(null); }, [scope]);

  const fetchRecords = useCallback(async () => {
    if (!isBusiness || !ownerId) return null;
    const { data, error } = await supabase.rpc('studio_get_business');
    if (error) throw error;
    if (!data || data.profile?.id !== ownerId || !ROLES.includes(data.role)
      || !Array.isArray(data.members) || !Array.isArray(data.devices) || !Array.isArray(data.signins)) throw new Error('Access records were not confirmed.');
    return data as AccessInfo;
  }, [isBusiness, ownerId]);
  const { data: info, error: loadError, loading, reload: load } = useStudioResource(fetchRecords, 'Business access could not be refreshed. Open Studio to confirm your member access, or try again.');
  const ready = !!info && !loadError && !loading;
  const isOwner = ready && info.role === 'owner';
  const canManageDevices = ready && (info.role === 'owner' || info.role === 'admin');
  const members = info?.members || [];
  const firstMember = !!info && members.length === 0 && info.role === 'owner';
  const selectedRole = firstMember ? 'owner' : newRole;
  const lastOwner = (member: Member) => member.active && member.role === 'owner' && members.filter(m => m.active && m.role === 'owner').length === 1;
  const openStudio = () => navigation.navigate('Main', { screen: 'Studio' });
  const goBack = () => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Settings');

  const runAction = async (operation: () => PromiseLike<{ data?: any; error: any }>, onSuccess?: (data: any) => void) => {
    if (actionLock.current || !ready || !current()) return;
    actionLock.current = true; setBusy(true);
    try {
      const session = await supabase.auth.getSession();
      if (session.error || session.data.session?.user.id !== ownerId || !current()) throw new Error('Your account changed. Refresh business access before continuing.');
      const { data, error } = await operation();
      if (error) throw error;
      if (!current()) return;
      onSuccess?.(data);
      await load();
    } catch (error: any) {
      if (current()) Alert.alert('Change not confirmed', failureMessage(error));
    } finally {
      actionLock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const addMember = () => {
    if (!isOwner || !newName.trim()) return;
    const name = newName.trim();
    return runAction(() => supabase.rpc('studio_create_member', { p_expected_user: ownerId, p_name: name, p_role: selectedRole }), data => {
      if (typeof data !== 'string' || !data.trim()) throw new Error('The access code was not returned. Refresh the team before trying again.');
      setIssued({ scope, name, code: data }); setNewName('');
    });
  };
  const setActive = (member: Member) => {
    if (!isOwner || busy || (member.active && lastOwner(member))) return;
    Alert.alert(`${member.active ? 'Revoke' : 'Restore'} ${member.display_name}?`, member.active
      ? 'Their access code and bound Studio access will be revoked. This does not sign the shared business account out of other app services.'
      : 'Their existing code can be used to bind Studio access again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: member.active ? 'Revoke access' : 'Restore access', style: member.active ? 'destructive' : 'default', onPress: () => {
        void runAction(() => supabase.rpc('studio_set_member_active', { p_member: member.id, p_active: !member.active }));
      } },
    ]);
  };
  const changeRole = (member: Member) => {
    if (!isOwner || busy || lastOwner(member)) return;
    Alert.alert(`Role for ${member.display_name}`, 'Choose what this person can do for the business.', [
      ...ROLES.filter(role => role !== member.role).map(role => ({ text: ROLE_LABEL[role], onPress: () => {
        void runAction(() => supabase.rpc('studio_set_member_role', { p_member: member.id, p_role: role }));
      } })), { text: 'Cancel', style: 'cancel' },
    ]);
  };
  const changeDevice = (device: Device, action: 'approve' | 'remove') => {
    if (!canManageDevices || busy) return;
    Alert.alert(action === 'approve' ? 'Approve this device?' : 'Remove device approval?', action === 'approve'
      ? 'A valid business member code will still be required.'
      : 'Future business sign-ins from this registration will require approval again. Existing Auth sessions are not signed out by this action.', [
      { text: 'Cancel', style: 'cancel' },
      { text: action === 'approve' ? 'Approve' : 'Remove approval', style: action === 'remove' ? 'destructive' : 'default', onPress: () => {
        void runAction(() => supabase.rpc('studio_set_device', { p_device: device.id, p_action: action }));
      } },
    ]);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={s.header}>
        <TouchableOpacity onPress={goBack} accessibilityRole="button" accessibilityLabel="Back to settings" style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={t.ink.primary} /><Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Business access</Text><View style={{ width: 64 }} />
      </View>
      {!isBusiness ? <View style={s.notice}><Text style={s.body}>Sign in as the business to manage its people and devices.</Text></View> : (
        <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom + 110, 130) }}>
          <Text style={s.title}>{profile?.full_name || 'Your business'}</Text>
          <Text style={s.body}>Manage individual Studio roles, access codes and registered devices.</Text>
          <StudioLoadError message={loadError} onRetry={load} busy={loading} />
          {!info && loading ? <ActivityIndicator accessibilityLabel="Loading business access" color={t.ink.primary} style={{ margin: 24 }} /> : null}
          <TouchableOpacity style={s.linkBtn} accessibilityRole="button" onPress={openStudio}><Feather name="grid" size={17} color={t.status.link} /><Text style={s.linkTxt}>Open Studio</Text></TouchableOpacity>
          {info ? <>
            <Text style={s.section}>People · {ROLE_LABEL[info.role]}</Text>
            {isOwner ? <View style={s.card}>
              <Text style={s.rowName}>{firstMember ? 'Create your owner code' : 'Add a teammate'}</Text>
              <Text style={s.body}>{firstMember ? 'The first member is the owner. Creating the code binds this signed-in session to that owner.' : 'Choose the role before creating a code. Owners can change it later.'}</Text>
              <TextInput value={newName} onChangeText={setNewName} accessibilityLabel="Member name" placeholder={firstMember ? 'Your name' : "Teammate's name"} placeholderTextColor={t.ink.muted} editable={!busy} maxLength={100} style={s.input} />
              <View style={s.roles}>{(firstMember ? ['owner'] as Role[] : ROLES).map(role => <TouchableOpacity key={role} accessibilityRole="radio" accessibilityState={{ selected: selectedRole === role, disabled: busy || firstMember }} disabled={busy || firstMember} onPress={() => setNewRole(role)} style={[s.roleBtn, selectedRole === role && s.roleSelected]}><Text style={[s.roleTxt, selectedRole === role && s.roleSelectedTxt]}>{ROLE_LABEL[role]}</Text></TouchableOpacity>)}</View>
              <Text style={s.body}>{ROLE_DETAIL[selectedRole]}</Text>
              <TouchableOpacity accessibilityRole="button" disabled={busy || !newName.trim()} onPress={addMember} style={[s.primaryBtn, (busy || !newName.trim()) && s.disabled]}>{busy ? <ActivityIndicator color={t.ink.inverse} /> : <Text style={s.primaryTxt}>Create access code</Text>}</TouchableOpacity>
            </View> : <Text style={s.body}>{info.role === 'admin' ? 'An owner can add members and change their roles.' : 'Team and device records are available to owners and admins.'}</Text>}
            {issued?.scope === scope ? <View style={s.codeCard}>
              <Text style={s.rowName}>Access code for {issued.name}</Text><Text style={s.body}>Shown once. Share it securely with this person.</Text>
              <Text selectable style={s.code}>{issued.code}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Dismiss access code" style={s.linkBtn} onPress={() => setIssued(null)}><Text style={s.linkTxt}>Done</Text></TouchableOpacity>
            </View> : null}
            {members.map(member => <View key={member.id} style={s.card}>
              <View style={s.row}><View style={{ flex: 1 }}><Text style={s.rowName}>{member.display_name}</Text><Text style={s.body}>{ROLE_LABEL[member.role]} · {member.active ? 'Active' : 'Revoked'}</Text><Text style={s.caption}>{member.last_sign_in_at ? `Last sign-in ${new Date(member.last_sign_in_at).toLocaleString()}` : 'No sign-ins recorded'}</Text></View>{lastOwner(member) ? <Text style={s.badge}>Last owner</Text> : null}</View>
              {isOwner ? <View style={s.actions}><TouchableOpacity accessibilityRole="button" disabled={busy || lastOwner(member)} onPress={() => changeRole(member)} style={[s.secondaryBtn, (busy || lastOwner(member)) && s.disabled]}><Text style={s.secondaryTxt}>Change role</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" disabled={busy || lastOwner(member)} onPress={() => setActive(member)} style={[s.secondaryBtn, (busy || lastOwner(member)) && s.disabled]}><Text style={member.active ? s.dangerTxt : s.secondaryTxt}>{member.active ? 'Revoke access' : 'Restore access'}</Text></TouchableOpacity></View> : null}
            </View>)}
            {info.role === 'owner' || info.role === 'admin' ? <>
              <Text style={s.section}>Registered devices</Text>
              {!info.devices.length ? <Text style={s.body}>No devices have been registered.</Text> : null}
              {info.devices.map(device => <View key={device.id} style={s.card}><View style={s.row}><Feather name="smartphone" size={21} color={t.ink.primary} /><View style={{ flex: 1 }}><Text style={s.rowName}>{device.label || 'Device'}</Text><Text style={s.body}>{device.status === 'approved' ? 'Approved' : 'Awaiting approval'}</Text><Text style={s.caption}>{device.device_id}</Text></View></View><TouchableOpacity accessibilityRole="button" disabled={busy || !canManageDevices} onPress={() => changeDevice(device, device.status === 'approved' ? 'remove' : 'approve')} style={[s.secondaryBtn, (busy || !canManageDevices) && s.disabled]}><Text style={s.secondaryTxt}>{device.status === 'approved' ? 'Remove approval' : 'Approve device'}</Text></TouchableOpacity></View>)}
              <Text style={s.section}>Recent sign-ins</Text>
              {!info.signins.length ? <Text style={s.body}>No business sign-ins have been recorded.</Text> : null}
              {info.signins.map(entry => <View key={entry.id || `${entry.created_at}:${entry.member_name}`} style={s.log}><Text style={s.rowName}>{entry.member_name || 'Member'}</Text><Text style={s.body}>{new Date(entry.created_at).toLocaleString()}</Text></View>)}
            </> : null}
          </> : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = themedSheet(t => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, minHeight: 56, borderBottomWidth: 1, borderBottomColor: t.surface.hairline },
  backBtn: { flexDirection: 'row', alignItems: 'center', minHeight: 44, width: 64 },
  backLbl: { color: t.ink.primary, fontSize: 15, fontWeight: '600' },
  headerTitle: { color: t.ink.primary, fontSize: 16, fontWeight: '700' },
  title: { color: t.ink.primary, fontSize: 25, fontWeight: '800', marginBottom: 5 },
  section: { color: t.ink.primary, fontSize: 18, fontWeight: '700', marginTop: 22, marginBottom: 12 },
  notice: { padding: 24 },
  body: { color: t.ink.secondary, fontSize: 14, lineHeight: 21, marginTop: 4 },
  caption: { color: t.ink.muted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  card: { backgroundColor: t.surface.raised, borderWidth: 1, borderColor: t.surface.hairline, borderRadius: 15, padding: 16, marginBottom: 10, gap: 8 },
  codeCard: { backgroundColor: t.brand.tintBg, borderWidth: 1, borderColor: t.brand.warm, borderRadius: 15, padding: 16, marginBottom: 12 },
  code: { color: t.ink.primary, fontSize: 19, lineHeight: 29, fontWeight: '800', marginTop: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowName: { color: t.ink.primary, fontSize: 15, fontWeight: '700' },
  input: { backgroundColor: t.surface.canvas, borderWidth: 1, borderColor: t.surface.hairline, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, minHeight: 46, color: t.ink.primary, fontSize: 15, marginTop: 8 },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 5 },
  roleBtn: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 12, borderWidth: 1, borderColor: t.surface.hairline, borderRadius: 10, justifyContent: 'center' },
  roleSelected: { backgroundColor: t.brand.base, borderColor: t.brand.base },
  roleTxt: { color: t.ink.primary, fontSize: 13, fontWeight: '600' },
  roleSelectedTxt: { color: t.ink.inverse },
  primaryBtn: { minHeight: 46, alignItems: 'center', justifyContent: 'center', backgroundColor: t.brand.base, borderRadius: 11, padding: 12, marginTop: 8 },
  primaryTxt: { color: t.ink.inverse, fontSize: 14, fontWeight: '700' },
  secondaryBtn: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 12, borderWidth: 1, borderColor: t.surface.hairline, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  secondaryTxt: { color: t.ink.primary, fontSize: 13, fontWeight: '600' },
  dangerTxt: { color: t.status.danger, fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingVertical: 12, alignSelf: 'flex-start' },
  linkTxt: { color: t.status.link, fontSize: 14, fontWeight: '600' },
  badge: { color: t.ink.secondary, backgroundColor: t.surface.sunken, fontSize: 11, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 7 },
  log: { borderBottomWidth: 1, borderBottomColor: t.surface.hairline, paddingVertical: 12 },
  disabled: { opacity: 0.45 },
}));
