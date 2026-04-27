import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Alert,
  StatusBar, Linking, Modal, TextInput, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../services/supabase';

function initials(n?: string | null) {
  if (!n) return 'U';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.sectionCard}>{children}</View>
    </View>
  );
}

type RowProps = {
  icon: string; iconBg?: string; iconColor?: string;
  label: string; sublabel?: string;
  onPress?: () => void; danger?: boolean;
  right?: React.ReactNode; chevron?: boolean;
};
function Row({ icon, iconBg, iconColor = '#007AFF', label, sublabel, onPress, danger, right, chevron = true }: RowProps) {
  const bg = iconBg ?? (iconColor + '18');
  return (
    <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={onPress ? 0.7 : 1} disabled={!onPress}>
      <View style={[s.rowIcon, { backgroundColor: bg }]}>
        <Feather name={icon as any} size={17} color={iconColor} />
      </View>
      <View style={s.rowContent}>
        <Text style={[s.rowLabel, danger && s.rowLabelDanger]}>{label}</Text>
        {sublabel ? <Text style={s.rowSublabel}>{sublabel}</Text> : null}
      </View>
      {right ?? (chevron && onPress ? <Feather name="chevron-right" size={16} color="#C7C7CC" /> : null)}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile, signOut } = useAuthStore();

  const [notifMessages,    setNotifMessages]    = useState(true);
  const [notifConnections, setNotifConnections] = useState(true);
  const [notifJobs,        setNotifJobs]        = useState(true);
  const [pushEnabled,      setPushEnabled]      = useState(true);
  const [savingNotifs,     setSavingNotifs]     = useState(false);
  const [localProfile,     setLocalProfile]     = useState(profile);

  const [pwModal,     setPwModal]     = useState(false);
  const [newPw,       setNewPw]       = useState('');
  const [confirmPw,   setConfirmPw]   = useState('');
  const [showNewPw,   setShowNewPw]   = useState(false);
  const [showConfPw,  setShowConfPw]  = useState(false);
  const [savingPw,    setSavingPw]    = useState(false);

  const [privacyModal, setPrivacyModal] = useState(false);
  const [visibility,   setVisibility]  = useState<'public' | 'private'>('public');
  const [savingPriv,   setSavingPriv]  = useState(false);

  useFocusEffect(useCallback(() => {
    if (!profile?.id) return;
    supabase.from('profiles').select('*').eq('id', profile.id).single().then(({ data }) => {
      if (data) {
        setLocalProfile({ ...profile, ...data });
        setNotifMessages(data.notif_messages ?? true);
        setNotifConnections(data.notif_connections ?? true);
        setNotifJobs(data.notif_jobs ?? true);
        setVisibility(data.profile_visibility ?? 'public');
      }
    });
  }, [profile?.id]));

  const saveNotifPref = async (field: string, value: boolean) => {
    if (!profile?.id || savingNotifs) return;
    setSavingNotifs(true);
    try {
      await supabase.from('profiles').update({ [field]: value }).eq('id', profile.id);
    } catch {}
    finally { setSavingNotifs(false); }
  };

  const togglePush = (val: boolean) => {
    setPushEnabled(val);
    if (!val) {
      setNotifMessages(false); setNotifConnections(false); setNotifJobs(false);
      saveNotifPref('notif_messages', false);
      saveNotifPref('notif_connections', false);
      saveNotifPref('notif_jobs', false);
    }
  };

  const changePassword = async () => {
    if (!newPw.trim()) { Alert.alert('Required', 'Enter a new password.'); return; }
    if (newPw.length < 8)  { Alert.alert('Too short', 'Password must be at least 8 characters.'); return; }
    if (newPw !== confirmPw) { Alert.alert('Mismatch', 'Passwords do not match.'); return; }
    setSavingPw(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) { Alert.alert('Error', error.message); return; }
      setPwModal(false); setNewPw(''); setConfirmPw('');
      Alert.alert('Password updated', 'Your password has been changed successfully. You will remain signed in.');
    } catch (e: any) { Alert.alert('Error', e?.message || 'Could not update password.'); }
    finally { setSavingPw(false); }
  };

  const savePrivacy = async () => {
    if (!profile?.id) return;
    setSavingPriv(true);
    try {
      await supabase.from('profiles').update({ profile_visibility: visibility }).eq('id', profile.id);
      setPrivacyModal(false);
      Alert.alert('Saved', visibility === 'public' ? 'Your profile is now public.' : 'Your profile is now private. Only connections can see it.');
    } catch {}
    finally { setSavingPriv(false); }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign out?',
      'You will need to sign in again to access PlatinumCircles.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await supabase.auth.signOut();
            if (signOut) signOut();
          },
        },
      ]
    );
  };

  // Navigates to the Profile tab and opens the inline editor via `edit: true` param.
  const goToEditProfile = () => {
    navigation.navigate('Profile', {
      screen: 'ProfileMain',
      params: { edit: true },
    });
  };

  const pf = localProfile ?? profile;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>‹</Text>
          <Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom + 40, 60) }]}>

        <TouchableOpacity style={s.profileCard} onPress={goToEditProfile} activeOpacity={0.8}>
          {pf?.avatar_url
            ? <Image source={{ uri: pf.avatar_url }} style={s.profileCardAvatar} />
            : <View style={s.profileCardAvatarFb}><Text style={s.profileCardAvatarTxt}>{initials(pf?.full_name)}</Text></View>}
          <View style={s.profileCardInfo}>
            <Text style={s.profileCardName}>{pf?.full_name || 'Your Name'}</Text>
            <Text style={s.profileCardEmail}>{pf?.email || 'Edit your profile'}</Text>
          </View>
          <Feather name="chevron-right" size={20} color="#C7C7CC" />
        </TouchableOpacity>

        <Section title="Account">
          <Row
            icon="user" iconColor="#007AFF"
            label="Edit Profile"
            sublabel="Name, bio, degree, photo"
            onPress={goToEditProfile}
          />
          <View style={s.divider} />
          <Row
            icon="lock" iconColor="#FF9500"
            label="Change Password"
            sublabel="Update your account password"
            onPress={() => setPwModal(true)}
          />
          <View style={s.divider} />
          <Row
            icon={visibility === 'private' ? 'eye-off' : 'globe'} iconColor="#34C759"
            label="Privacy"
            sublabel={visibility === 'private' ? 'Profile is private' : 'Profile is public'}
            onPress={() => setPrivacyModal(true)}
          />
        </Section>

        <Section title="Notifications">
          <Row
            icon="bell" iconColor="#FF3B30"
            label="Push Notifications"
            sublabel="Master toggle for all alerts"
            chevron={false}
            right={
              <Switch
                value={pushEnabled}
                onValueChange={togglePush}
                trackColor={{ false: '#E5E5EA', true: '#34C759' }}
                thumbColor="#FFF"
              />
            }
          />
          <View style={s.divider} />
          <Row
            icon="message-circle" iconColor="#5856D6"
            label="Messages"
            sublabel="New messages and replies"
            chevron={false}
            right={
              <Switch
                value={notifMessages && pushEnabled}
                onValueChange={v => { setNotifMessages(v); saveNotifPref('notif_messages', v); }}
                trackColor={{ false: '#E5E5EA', true: '#34C759' }}
                thumbColor="#FFF"
                disabled={!pushEnabled}
              />
            }
          />
          <View style={s.divider} />
          <Row
            icon="users" iconColor="#FF9500"
            label="Connections"
            sublabel="Connection requests and accepts"
            chevron={false}
            right={
              <Switch
                value={notifConnections && pushEnabled}
                onValueChange={v => { setNotifConnections(v); saveNotifPref('notif_connections', v); }}
                trackColor={{ false: '#E5E5EA', true: '#34C759' }}
                thumbColor="#FFF"
                disabled={!pushEnabled}
              />
            }
          />
          <View style={s.divider} />
          <Row
            icon="briefcase" iconColor="#007AFF"
            label="Jobs & Referrals"
            sublabel="New job alerts and referral requests"
            chevron={false}
            right={
              <Switch
                value={notifJobs && pushEnabled}
                onValueChange={v => { setNotifJobs(v); saveNotifPref('notif_jobs', v); }}
                trackColor={{ false: '#E5E5EA', true: '#34C759' }}
                thumbColor="#FFF"
                disabled={!pushEnabled}
              />
            }
          />
        </Section>

        <Section title="Support">
          <Row icon="help-circle" iconColor="#34C759" label="Help & Support" sublabel="FAQs, submit a ticket" onPress={() => navigation.navigate('HelpSupport')} />
          <View style={s.divider} />
          <Row icon="mail" iconColor="#007AFF" label="Contact Us" sublabel="support@PlatinumCirclesnest.app" onPress={() => Linking.openURL('mailto:support@PlatinumCirclesnest.app?subject=PlatinumCircles%20Nest%20Inquiry').catch(() => Alert.alert('No mail app', 'Set up an email app on your device or email us directly at support@PlatinumCirclesnest.app'))} />
          <View style={s.divider} />
          <Row icon="star" iconColor="#FFD60A" label="Rate the App" sublabel="Share your feedback" onPress={() => Alert.alert('Thank you!', 'App Store rating coming soon. In the meantime, send us feedback via Help & Support.')} />
        </Section>

        <Section title="Legal">
          <Row icon="file-text" iconColor="#8E8E93" label="Terms of Service" onPress={() => navigation.navigate('Terms')} />
          <View style={s.divider} />
          <Row icon="shield" iconColor="#8E8E93"    label="Privacy Policy"   onPress={() => navigation.navigate('PrivacyPolicy')} />
          <View style={s.divider} />
          <Row icon="info" iconColor="#8E8E93"      label="About PlatinumCircles" onPress={() => navigation.navigate('About')} chevron={false}
            right={<Text style={s.versionChip}>v1.0</Text>} />
        </Section>

        <Section title="Account Actions">
          <Row icon="log-out" iconColor="#FF3B30" label="Sign Out" danger onPress={handleSignOut} />
        </Section>

        <Text style={s.footerTxt}>PlatinumCircles · Thunderbird School of Global Management</Text>
      </ScrollView>

      <Modal visible={pwModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setPwModal(false); setNewPw(''); setConfirmPw(''); }}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }} edges={['top', 'left', 'right']}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => { setPwModal(false); setNewPw(''); setConfirmPw(''); }}><Text style={s.modalCancel}>Cancel</Text></TouchableOpacity>
            <Text style={s.modalTitle}>Change Password</Text>
            <TouchableOpacity onPress={changePassword} disabled={savingPw}>
              {savingPw ? <ActivityIndicator color="#007AFF" size={16} /> : <Text style={s.modalSave}>Update</Text>}
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={s.modalBody} keyboardShouldPersistTaps="handled">
            <View style={s.pwInfo}>
              <Feather name="lock" size={18} color="#007AFF" />
              <Text style={s.pwInfoTxt}>Your new password must be at least 8 characters. You will remain signed in after changing it.</Text>
            </View>
            <Text style={s.modalFieldLabel}>New Password</Text>
            <View style={s.pwInputRow}>
              <TextInput
                value={newPw} onChangeText={setNewPw}
                placeholder="Enter new password"
                placeholderTextColor="#C7C7CC"
                style={s.pwInput}
                secureTextEntry={!showNewPw}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity onPress={() => setShowNewPw(p => !p)} style={s.pwEye}>
                <Feather name={showNewPw ? 'eye-off' : 'eye'} size={18} color="#8E8E93" />
              </TouchableOpacity>
            </View>
            {newPw.length > 0 && (
              <View style={s.pwStrength}>
                {['Length (8+)', 'Uppercase', 'Number', 'Symbol'].map((c, i) => {
                  const checks = [newPw.length >= 8, /[A-Z]/.test(newPw), /\d/.test(newPw), /[^A-Za-z0-9]/.test(newPw)];
                  return (
                    <View key={c} style={s.pwCheck}>
                      <Feather name={checks[i] ? 'check-circle' : 'circle'} size={13} color={checks[i] ? '#34C759' : '#C7C7CC'} />
                      <Text style={[s.pwCheckTxt, checks[i] && { color: '#34C759' }]}>{c}</Text>
                    </View>
                  );
                })}
              </View>
            )}
            <Text style={[s.modalFieldLabel, { marginTop: 20 }]}>Confirm New Password</Text>
            <View style={s.pwInputRow}>
              <TextInput
                value={confirmPw} onChangeText={setConfirmPw}
                placeholder="Confirm new password"
                placeholderTextColor="#C7C7CC"
                style={s.pwInput}
                secureTextEntry={!showConfPw}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity onPress={() => setShowConfPw(p => !p)} style={s.pwEye}>
                <Feather name={showConfPw ? 'eye-off' : 'eye'} size={18} color="#8E8E93" />
              </TouchableOpacity>
            </View>
            {confirmPw.length > 0 && newPw !== confirmPw && (
              <Text style={s.pwMismatch}>Passwords do not match</Text>
            )}
            <TouchableOpacity
              style={[s.pwSubmitBtn, (savingPw || newPw.length < 8 || newPw !== confirmPw) && s.pwSubmitBtnOff]}
              onPress={changePassword} disabled={savingPw || newPw.length < 8 || newPw !== confirmPw}
              activeOpacity={0.85}
            >
              {savingPw ? <ActivityIndicator color="#FFF" /> : <Text style={s.pwSubmitBtnTxt}>Update Password</Text>}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={privacyModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPrivacyModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }} edges={['top', 'left', 'right']}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setPrivacyModal(false)}><Text style={s.modalCancel}>Cancel</Text></TouchableOpacity>
            <Text style={s.modalTitle}>Privacy</Text>
            <TouchableOpacity onPress={savePrivacy} disabled={savingPriv}>
              {savingPriv ? <ActivityIndicator color="#007AFF" size={16} /> : <Text style={s.modalSave}>Save</Text>}
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={s.modalBody}>
            <Text style={s.privLabel}>Profile Visibility</Text>
            <Text style={s.privDesc}>Control who can see your profile information on PlatinumCircles.</Text>
            {[
              { value: 'public'  as const, icon: 'globe',    title: 'Public',  desc: 'Anyone signed in to PlatinumCircles can view your full profile, posts, and connections.' },
              { value: 'private' as const, icon: 'lock',     title: 'Private', desc: 'Only your accepted connections can view your profile. Others will see only your name and avatar.' },
            ].map(opt => (
              <TouchableOpacity key={opt.value} style={[s.privOption, visibility === opt.value && s.privOptionActive]} onPress={() => setVisibility(opt.value)} activeOpacity={0.8}>
                <View style={[s.privOptionIcon, visibility === opt.value && s.privOptionIconActive]}>
                  <Feather name={opt.icon as any} size={20} color={visibility === opt.value ? '#007AFF' : '#8E8E93'} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.privOptionTitle, visibility === opt.value && { color: '#007AFF' }]}>{opt.title}</Text>
                  <Text style={s.privOptionDesc}>{opt.desc}</Text>
                </View>
                {visibility === opt.value && <Feather name="check-circle" size={20} color="#007AFF" />}
              </TouchableOpacity>
            ))}
            <View style={s.privNote}>
              <Feather name="info" size={14} color="#8E8E93" />
              <Text style={s.privNoteTxt}>Your privacy setting only affects profile visibility. Your posts in the feed are always visible to signed-in members.</Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F2F2F7' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#F2F2F7' },
  backBtn: { flexDirection: 'row', alignItems: 'center', minWidth: 60 },
  backChev: { fontSize: 30, color: '#007AFF', lineHeight: 34, marginRight: 1 },
  backLbl: { fontSize: 17, color: '#007AFF' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#000' },
  scroll: { paddingHorizontal: 16, paddingTop: 12 },
  profileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 16, padding: 14, marginBottom: 28, gap: 12 },
  profileCardAvatar: { width: 52, height: 52, borderRadius: 26 },
  profileCardAvatarFb: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center' },
  profileCardAvatarTxt: { fontSize: 22, fontWeight: '700', color: '#FFF' },
  profileCardInfo: { flex: 1 },
  profileCardName: { fontSize: 16, fontWeight: '700', color: '#000' },
  profileCardEmail: { fontSize: 13, color: '#8E8E93', marginTop: 2 },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, paddingLeft: 4 },
  sectionCard: { backgroundColor: '#FFF', borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13, gap: 12 },
  rowIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rowContent: { flex: 1 },
  rowLabel: { fontSize: 16, color: '#000' },
  rowLabelDanger: { color: '#FF3B30' },
  rowSublabel: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#F0F0F0', marginLeft: 58 },
  versionChip: { fontSize: 13, color: '#8E8E93', backgroundColor: '#F2F2F7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  footerTxt: { textAlign: 'center', fontSize: 13, color: '#C7C7CC', marginBottom: 8 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  modalCancel: { fontSize: 17, color: '#8E8E93', minWidth: 60 },
  modalTitle: { fontSize: 17, fontWeight: '600', color: '#000' },
  modalSave: { fontSize: 17, fontWeight: '700', color: '#007AFF', textAlign: 'right', minWidth: 60 },
  modalBody: { padding: 20 },
  modalFieldLabel: { fontSize: 13, fontWeight: '600', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  pwInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#EFF6FF', borderRadius: 12, padding: 14, marginBottom: 20 },
  pwInfoTxt: { flex: 1, fontSize: 14, color: '#007AFF', lineHeight: 20 },
  pwInputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, marginBottom: 8 },
  pwInput: { flex: 1, fontSize: 16, color: '#000', paddingVertical: 13 },
  pwEye: { padding: 6 },
  pwStrength: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  pwCheck: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pwCheckTxt: { fontSize: 12, color: '#C7C7CC' },
  pwMismatch: { fontSize: 13, color: '#FF3B30', marginBottom: 8 },
  pwSubmitBtn: { backgroundColor: '#000', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  pwSubmitBtnOff: { opacity: 0.35 },
  pwSubmitBtnTxt: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  privLabel: { fontSize: 18, fontWeight: '700', color: '#000', marginBottom: 6 },
  privDesc: { fontSize: 14, color: '#3C3C43', lineHeight: 20, marginBottom: 18 },
  privOption: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 14, borderWidth: 1.5, borderColor: '#E5E5EA', marginBottom: 12 },
  privOptionActive: { borderColor: '#007AFF', backgroundColor: '#F0F7FF' },
  privOptionIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  privOptionIconActive: { backgroundColor: '#EFF6FF' },
  privOptionTitle: { fontSize: 16, fontWeight: '700', color: '#000', marginBottom: 4 },
  privOptionDesc: { fontSize: 13, color: '#8E8E93', lineHeight: 18 },
  privNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#F5F5F5', borderRadius: 12, padding: 14, marginTop: 8 },
  privNoteTxt: { flex: 1, fontSize: 13, color: '#8E8E93', lineHeight: 18 },
});