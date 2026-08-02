import { paymentsService } from '../../services/paymentsService';
import LinkIntoBankSheet from '../../components/LinkIntoBankSheet';
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Alert,
  StatusBar, Linking, Modal, TextInput, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { light, typeSize, fontWeight, radius, space } from '../../constants/tokens';
import { supabase } from '../../services/supabase';

const MAROON = '#8C1D40';
const GOLD = '#FFC627';

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
function Row({ icon, label, sublabel, onPress, danger, right, chevron = true }: RowProps) {
  // iconColor and iconBg are accepted for call-site compatibility and
  // deliberately ignored. A different pastel tile per row is what made this
  // screen read as generated. One weight, colour only where it means something.
  const tint = danger ? light.status.danger : light.ink.muted;
  return (
    <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={onPress ? 0.6 : 1} disabled={!onPress}>
      <Feather name={icon as any} size={18} color={tint} style={s.rowIcon} />
      <View style={s.rowContent}>
        <Text style={[s.rowLabel, danger && s.rowLabelDanger]}>{label}</Text>
        {sublabel ? <Text style={s.rowSublabel}>{sublabel}</Text> : null}
      </View>
      {right ?? (chevron && onPress ? <Feather name="chevron-right" size={16} color={light.ink.faint} /> : null)}
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

  const [deleteModal,      setDeleteModal]      = useState(false);
  const [deleteConfirmTxt, setDeleteConfirmTxt] = useState('');
  const [deleting,         setDeleting]         = useState(false);

  const [deactivating, setDeactivating] = useState(false);

  const [followRequestCount, setFollowRequestCount] = useState(0);

  useFocusEffect(useCallback(() => {
    if (!profile?.id) return;
    supabase.from('profiles').select('*').eq('id', profile.id).single().then(({ data }) => {
      if (data) {
        setLocalProfile({ ...profile, ...data });
        setNotifMessages(data.notif_messages ?? true);
        setNotifPrefs((data as any).notif_prefs || {});
        setNotifConnections(data.notif_connections ?? true);
        setNotifJobs(data.notif_jobs ?? true);
        setVisibility(data.profile_visibility ?? 'public');
      }
    });
    supabase.from('follow_requests')
      .select('id', { count: 'exact', head: true })
      .eq('target_id', profile.id)
      .eq('status', 'pending')
      .then(({ count }) => {
        setFollowRequestCount(count ?? 0);
      });
  }, [profile?.id]));

const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({});
  const [settingsQuery, setSettingsQuery] = useState('');
  const appSet = useSettingsStore();
  const NOTIF_TYPES: { key: string; label: string; sub: string }[] = [
    { key: 'message', label: 'Messages', sub: 'New messages' },
    { key: 'message_reaction', label: 'Message reactions', sub: 'Reactions to your messages' },
    { key: 'mention', label: 'Mentions', sub: 'When someone @mentions you' },
    { key: 'incoming_call', label: 'Calls', sub: 'Voice and video calls' },
    { key: 'like', label: 'Likes', sub: 'Likes on your posts' },
    { key: 'comment', label: 'Comments', sub: 'Comments on your posts' },
    { key: 'reply', label: 'Replies', sub: 'Replies to your comments' },
    { key: 'comment_like', label: 'Comment likes', sub: 'Likes on your comments' },
    { key: 'repost', label: 'Reposts', sub: 'When your post is reshared' },
    { key: 'story_reaction', label: 'Story reactions', sub: 'Reactions to your stories' },
    { key: 'follow', label: 'Follows', sub: 'New followers' },
    { key: 'connection_request', label: 'Follow requests', sub: 'Requests on a private account' },
    { key: 'job_application', label: 'Job applications', sub: 'Applicants to your job posts' },
  ];
  const setTypePref = async (key: string, enabled: boolean) => {
    if (!profile?.id) return;
    const prev = notifPrefs;
    const next = { ...notifPrefs };
    if (enabled) delete next[key]; else next[key] = false;
    setNotifPrefs(next);
    const { error } = await supabase.from('profiles').update({ notif_prefs: next }).eq('id', profile.id);
    if (error) {
      setNotifPrefs(prev); // the write was rejected — the switch tells the truth
      Alert.alert('Not saved', 'That change could not be saved. Try again.');
    }
  };

type SetRow = { icon: string; color?: string; label: string; sub?: string; onPress?: () => void; right?: React.ReactNode; danger?: boolean; chevron?: boolean; visible?: boolean };
  const sw = (value: boolean, onChange: (v: boolean) => void, disabled = false) => (
    <Switch value={value} onValueChange={onChange} trackColor={{ false: '#E5E5EA', true: '#34C759' }} thumbColor="#FFF" disabled={disabled} />
  );
  const [ibLinked, setIbLinked] = React.useState<boolean | null>(null);
  const [showLinkSheet, setShowLinkSheet] = React.useState(false);
  React.useEffect(() => { paymentsService.getLinkStatus().then(r => setIbLinked(!!r.linked), () => setIbLinked(false)); }, []);
  const confirmUnlink = () => {
    Alert.alert('Deactivate IntoBank?', 'Payments in chats will stop working until you link an account again from any payment sheet.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Deactivate', style: 'destructive', onPress: async () => { try { await paymentsService.unlink(); setIbLinked(false); Alert.alert('Done', 'Your IntoBank account is no longer connected.'); } catch (e: any) { Alert.alert('Could not deactivate', e?.message || 'Please try again.'); } } },
    ]);
  };

  const buildSections = (): { title: string; rows: SetRow[] }[] => [
    { title: 'IntoBank', rows: [
      { icon: 'credit-card', color: '#0A3D2E', label: ibLinked === null ? 'Checking connection...' : ibLinked ? 'IntoBank connected' : 'IntoBank not connected', sub: ibLinked === false ? 'Tap to link your account' : ibLinked ? 'Chat payments ride your IntoBank wallet' : 'One moment', onPress: () => { if (ibLinked === false) setShowLinkSheet(true); } },
      ...(ibLinked ? [{ icon: 'x-circle', color: '#A32D2D', label: 'Deactivate IntoBank', sub: 'Unlink this account, or unlink to add a different one', onPress: confirmUnlink }] : []),
      ...(ibLinked === false ? [{ icon: 'link', color: '#0A3D2E', label: 'Link IntoBank', sub: 'Email plus a 6-digit code, done in a minute', onPress: () => setShowLinkSheet(true) }] : []),
    ] },
    { title: 'Account', rows: [
      { icon: 'user', color: '#007AFF', label: 'Edit Profile', sub: 'Name, bio, photo', onPress: goToEditProfile },
      { icon: 'lock', color: '#FF9500', label: 'Change Password', sub: 'Update your account password', onPress: () => setPwModal(true) },
      { icon: 'eye', color: '#5856D6', label: 'Privacy', sub: 'Private account and visibility', onPress: () => navigation.navigate('FollowRequests') },
      { icon: 'user-check', color: '#34C759', label: 'Follow Requests', sub: 'Approve who can follow you', onPress: () => navigation.navigate('FollowRequests') },
      { icon: 'volume-x', color: '#8E8E93', label: 'Muted stories', sub: 'People whose stories you hide', onPress: () => navigation.navigate('MutedStories') },
      { icon: 'bookmark', color: '#0B1E3D', label: 'Saved posts', sub: 'Posts you bookmarked', onPress: () => navigation.navigate('SavedPosts') },
      { icon: 'slash', color: '#FF3B30', label: 'Blocked accounts', sub: 'See and undo who you blocked', onPress: () => navigation.navigate('BlockedAccounts') },
      { icon: 'briefcase', color: '#B08D3F', label: 'Businesses', sub: 'Pages you run, and your team', onPress: () => navigation.navigate('Businesses') }, // visible to everyone — a person creates business pages
      { icon: 'mail', color: '#5856D6', label: 'Message requests', sub: 'Messages from people you do not follow', onPress: () => (navigation as any).navigate('MessageRequests') },
      { icon: 'award', color: '#B08D3F', label: 'Verification', sub: 'Apply for the badge - earned, never bought', onPress: () => (navigation as any).navigate('ApplyVerification') },
      { icon: 'life-buoy', color: '#0E7490', label: 'Contact support', sub: 'Write to the operations team', onPress: () => (navigation as any).navigate('ContactSupport') },
      { icon: 'briefcase', color: '#5B6470', label: 'Apply for a business account', sub: 'Companies get their own @ and the space-grey seal', onPress: () => (navigation as any).navigate('BusinessApply') },
      { icon: 'at-sign', color: '#0B1E3D', label: 'Change username', sub: 'Pick a new @ if it is available', onPress: () => (navigation as any).navigate('ChangeUsername') },
      { icon: 'key', color: '#B08D3F', label: 'Business access', sub: 'For business accounts - the people and devices that may speak as it', onPress: () => (navigation as any).navigate('BusinessAccess') },
      { icon: 'shield', color: '#1D7A38', label: 'Account standing', sub: 'Your record and any active restriction', onPress: () => (navigation as any).navigate('AccountStanding') },
      { icon: 'trending-up', color: '#5B6470', label: 'Promotions and campaigns', sub: 'Promote your posts as sponsored placements', onPress: () => (navigation as any).navigate('Campaigns') },
      { icon: 'edit-3', color: '#0E7490', label: 'Write an article', sub: 'Long-form publishing with a cover and read time', onPress: () => (navigation as any).navigate('ArticleCompose') },
    ]},
    { title: 'Notifications', rows: [
      { icon: 'bell', color: '#FF3B30', label: 'Push Notifications', sub: 'Master toggle for all alerts', chevron: false, right: sw(pushEnabled, togglePush) },
      ...NOTIF_TYPES.map(t => ({ icon: 'bell' as const, color: '#5856D6', label: t.label, sub: t.sub, chevron: false,
        right: sw(notifPrefs[t.key] !== false && pushEnabled, (v: boolean) => setTypePref(t.key, v), !pushEnabled) })),
    ]},
    { title: 'Data & appearance', rows: [
      { icon: 'play-circle', color: '#34C759', label: 'Autoplay videos', sub: 'Turn off to save mobile data', chevron: false,
        right: sw(appSet.autoplayVideos, v => appSet.set({ autoplayVideos: v })) },
      { icon: 'upload-cloud', color: '#007AFF', label: 'Upload quality', sub: appSet.uploadQuality === 'high' ? 'High — best quality' : 'Data saver — smaller uploads', chevron: false,
        right: sw(appSet.uploadQuality === 'high', v => appSet.set({ uploadQuality: v ? 'high' : 'data-saver' })) },
      { icon: 'moon', color: '#8E8E93', label: 'Dark mode', sub: 'Coming soon', chevron: false,
        right: sw(appSet.darkMode, v => appSet.set({ darkMode: v })) },
    ]},
    { title: 'Support', rows: [
      { icon: 'help-circle', color: '#34C759', label: 'Help & Support', sub: 'FAQs, submit a ticket', onPress: () => navigation.navigate('HelpSupport') },
      { icon: 'mail', color: '#007AFF', label: 'Contact Us', sub: 'support@platinumcircles.app', onPress: () => Linking.openURL('mailto:support@platinumcircles.app?subject=PlatinumCircles%20Inquiry').catch(() => Alert.alert('No mail app', 'Email us at support@platinumcircles.app')) },
      { icon: 'star', color: '#FFD60A', label: 'Rate the App', sub: 'Share your feedback', onPress: () => Alert.alert('Thank you!', 'App Store rating coming soon.') },
    ]},
    { title: 'Legal', rows: [
      { icon: 'file-text', color: '#8E8E93', label: 'Terms of Service', onPress: () => navigation.navigate('Terms') },
      { icon: 'shield', color: '#8E8E93', label: 'Privacy Policy', onPress: () => navigation.navigate('PrivacyPolicy') },
    ]},
    { title: 'Account Actions', rows: [
      { icon: 'refresh-cw', color: '#007AFF', label: 'Switch Account', sub: 'Sign out and use a different account', onPress: handleSwitchAccount },
      { icon: 'log-out', color: '#FF9500', label: 'Sign Out', onPress: handleSignOut },
      { icon: 'moon', color: '#8E8E93', label: 'Deactivate Account', sub: 'Hide your profile temporarily', onPress: handleDeactivate },
      { icon: 'trash-2', color: '#FF3B30', label: 'Delete Account', sub: 'Permanently remove all your data', danger: true, onPress: () => { setDeleteConfirmTxt(''); setDeleteModal(true); } },
    ]},
  ];

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
        { text: 'Sign Out', style: 'destructive', onPress: async () => { await signOut(); } },
      ]
    );
  };

  const handleSwitchAccount = () => {
    Alert.alert(
      'Switch account?',
      'You will be signed out and can sign in with a different account.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Switch Account', onPress: async () => { await signOut(); } },
      ]
    );
  };

  const handleDeactivate = () => {
    Alert.alert(
      'Deactivate account?',
      'Your profile and content will be hidden from other users. You can reactivate by signing back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: async () => {
            if (!profile?.id) return;
            setDeactivating(true);
            try {
              const { error } = await supabase
                .from('profiles')
                .update({ deactivated_at: new Date().toISOString() })
                .eq('id', profile.id);
              if (error) { Alert.alert('Error', error.message); return; }
              await signOut();
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Could not deactivate account.');
            } finally { setDeactivating(false); }
          },
        },
      ]
    );
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmTxt !== 'DELETE') return;
    if (!profile?.id) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('delete_user_account', { p_user_id: profile.id });
      if (error) { Alert.alert('Error', error.message); setDeleting(false); return; }
      setDeleteModal(false);
      await signOut();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not delete account.');
      setDeleting(false);
    }
  };

  const goToEditProfile = () => {
    navigation.navigate('Profile', { screen: 'ProfileMain', params: { edit: true } });
  };

  const pf = localProfile ?? profile;
  const accountType = (pf as any)?.account_type;
  const isASU = accountType === 'asu';
  const isVerifiedInstitution = !!(pf as any)?.is_verified_institution;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>{'\u2039'}</Text>
          <Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView automaticallyAdjustKeyboardInsets={true} showsVerticalScrollIndicator={false} contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom + TAB_BAR_CLEARANCE + 24, TAB_BAR_CLEARANCE + 40) }]}>

        {/* Profile card with account type */}
        <TouchableOpacity style={s.profileCard} onPress={goToEditProfile} activeOpacity={0.8}>
          {pf?.avatar_url
            ? <Image source={{ uri: pf.avatar_url }} style={s.profileCardAvatar} />
            : <View style={[s.profileCardAvatarFb, isASU && { backgroundColor: MAROON }]}>
                <Text style={s.profileCardAvatarTxt}>{initials(pf?.full_name)}</Text>
              </View>}
          <View style={s.profileCardInfo}>
            <Text style={s.profileCardName}>{pf?.full_name || 'Your Name'}</Text>
            <Text style={s.profileCardEmail}>{pf?.email || 'Edit your profile'}</Text>
            <View style={[
              s.accountTypeBadge,
              isASU
                ? (isVerifiedInstitution ? s.accountTypeBadgeASU : s.accountTypeBadgePending)
                : s.accountTypeBadgePublic
            ]}>
              <Feather
                name={isASU ? (isVerifiedInstitution ? 'shield' : 'clock') : 'globe'}
                size={10}
                color={isASU ? (isVerifiedInstitution ? MAROON : '#D97706') : '#007AFF'}
              />
              <Text style={[
                s.accountTypeTxt,
                isASU
                  ? { color: isVerifiedInstitution ? MAROON : '#D97706' }
                  : { color: '#007AFF' }
              ]}>
                {isASU
                  ? (isVerifiedInstitution ? 'ASU Verified' : 'ASU Pending Verification')
                  : 'Public Network'}
              </Text>
            </View>
          </View>
          <Feather name="chevron-right" size={20} color="#C7C7CC" />
        </TouchableOpacity>

        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(11,30,61,0.05)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 }}>
            <Feather name="search" size={15} color="#8E8E93" />
            <TextInput value={settingsQuery} onChangeText={setSettingsQuery} placeholder="Search settings"
              placeholderTextColor="#8E8E93" style={{ flex: 1, fontSize: 15, color: '#0B1E3D', padding: 0 }} />
            {settingsQuery ? <TouchableOpacity onPress={() => setSettingsQuery('')}><Feather name="x" size={15} color="#8E8E93" /></TouchableOpacity> : null}
          </View>
        </View>
        {buildSections().map(sec => {
          const q = settingsQuery.trim().toLowerCase();
          const rows = sec.rows.filter(r => r.visible !== false && (!q || (r.label + ' ' + (r.sub || '')).toLowerCase().includes(q)));
          if (!rows.length) return null;
          return (
            <Section key={sec.title} title={sec.title}>
              {rows.map((r, i) => (
                <React.Fragment key={r.label}>
                  {i > 0 && <View style={s.divider} />}
                  <Row icon={r.icon as any} iconColor={r.color} label={r.label} sublabel={r.sub}
                    danger={r.danger} chevron={r.chevron !== false && !r.right} onPress={r.onPress} right={r.right} />
                </React.Fragment>
              ))}
            </Section>
          );
        })}

        <Text style={s.footerTxt}>PlatinumCircles</Text>
      </ScrollView>

      {/* Change Password Modal */}
      <Modal visible={pwModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setPwModal(false); setNewPw(''); setConfirmPw(''); }}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }} edges={['top', 'left', 'right']}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => { setPwModal(false); setNewPw(''); setConfirmPw(''); }}><Text style={s.modalCancel}>Cancel</Text></TouchableOpacity>
            <Text style={s.modalTitle}>Change Password</Text>
            <TouchableOpacity onPress={changePassword} disabled={savingPw}>
              {savingPw ? <ActivityIndicator color="#007AFF" size={16} /> : <Text style={s.modalSave}>Update</Text>}
            </TouchableOpacity>
          </View>
          <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={s.modalBody} keyboardShouldPersistTaps="handled">
            <View style={s.pwInfo}>
              <Feather name="lock" size={18} color="#007AFF" />
              <Text style={s.pwInfoTxt}>Your new password must be at least 8 characters. You will remain signed in after changing it.</Text>
            </View>
            <Text style={s.modalFieldLabel}>New Password</Text>
            <View style={s.pwInputRow}>
              <TextInput value={newPw} onChangeText={setNewPw} placeholder="Enter new password" placeholderTextColor="#C7C7CC" style={s.pwInput} secureTextEntry={!showNewPw} autoCapitalize="none" autoCorrect={false} />
              <TouchableOpacity onPress={() => setShowNewPw(p => !p)} style={s.pwEye}><Feather name={showNewPw ? 'eye-off' : 'eye'} size={18} color="#8E8E93" /></TouchableOpacity>
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
              <TextInput value={confirmPw} onChangeText={setConfirmPw} placeholder="Confirm new password" placeholderTextColor="#C7C7CC" style={s.pwInput} secureTextEntry={!showConfPw} autoCapitalize="none" autoCorrect={false} />
              <TouchableOpacity onPress={() => setShowConfPw(p => !p)} style={s.pwEye}><Feather name={showConfPw ? 'eye-off' : 'eye'} size={18} color="#8E8E93" /></TouchableOpacity>
            </View>
            {confirmPw.length > 0 && newPw !== confirmPw && <Text style={s.pwMismatch}>Passwords do not match</Text>}
            <TouchableOpacity
              style={[s.pwSubmitBtn, (savingPw || newPw.length < 8 || newPw !== confirmPw) && s.pwSubmitBtnOff]}
              onPress={changePassword} disabled={savingPw || newPw.length < 8 || newPw !== confirmPw} activeOpacity={0.85}
            >
              {savingPw ? <ActivityIndicator color="#FFF" /> : <Text style={s.pwSubmitBtnTxt}>Update Password</Text>}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Privacy Modal */}
      <Modal visible={privacyModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPrivacyModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }} edges={['top', 'left', 'right']}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setPrivacyModal(false)}><Text style={s.modalCancel}>Cancel</Text></TouchableOpacity>
            <Text style={s.modalTitle}>Privacy</Text>
            <TouchableOpacity onPress={savePrivacy} disabled={savingPriv}>
              {savingPriv ? <ActivityIndicator color="#007AFF" size={16} /> : <Text style={s.modalSave}>Save</Text>}
            </TouchableOpacity>
          </View>
          <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={s.modalBody}>
            <Text style={s.privLabel}>Profile Visibility</Text>
            <Text style={s.privDesc}>Control who can see your profile information on PlatinumCircles.</Text>
            {[
              { value: 'public' as const, icon: 'globe', title: 'Public', desc: isASU ? 'Any ASU member can view your full profile, posts, and connections.' : 'Anyone signed in to PlatinumCircles can view your full profile, posts, and connections.' },
              { value: 'private' as const, icon: 'lock', title: 'Private', desc: 'Only your accepted connections can view your profile. Others will see only your name and avatar.' },
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
              <Text style={s.privNoteTxt}>
                {isASU
                  ? 'Your privacy setting only affects profile visibility within the ASU network.'
                  : 'Your privacy setting only affects profile visibility. Your posts in the feed are always visible to signed-in members.'}
              </Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Delete Account Modal */}
      <Modal visible={deleteModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDeleteModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }} edges={['top', 'left', 'right']}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setDeleteModal(false)}><Text style={s.modalCancel}>Cancel</Text></TouchableOpacity>
            <Text style={s.modalTitle}>Delete Account</Text>
            <View style={{ minWidth: 60 }} />
          </View>
          <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={s.modalBody} keyboardShouldPersistTaps="handled">
            <View style={s.deleteWarning}>
              <Feather name="alert-triangle" size={24} color="#FF3B30" />
              <Text style={s.deleteWarningTitle}>This action is permanent</Text>
              <Text style={s.deleteWarningTxt}>
                All your data will be permanently deleted, including your profile, posts, messages, connections, and all other content. This cannot be undone.
              </Text>
            </View>
            <Text style={s.modalFieldLabel}>Type DELETE to confirm</Text>
            <TextInput value={deleteConfirmTxt} onChangeText={setDeleteConfirmTxt} placeholder="DELETE" placeholderTextColor="#C7C7CC" style={s.deleteInput} autoCapitalize="characters" autoCorrect={false} />
            <TouchableOpacity
              style={[s.deleteBtn, (deleting || deleteConfirmTxt !== 'DELETE') && s.deleteBtnOff]}
              onPress={handleDeleteAccount} disabled={deleting || deleteConfirmTxt !== 'DELETE'} activeOpacity={0.85}
            >
              {deleting ? <ActivityIndicator color="#FFF" /> : <Text style={s.deleteBtnTxt}>Delete My Account</Text>}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <LinkIntoBankSheet visible={showLinkSheet} onClose={() => setShowLinkSheet(false)} onLinked={() => setIbLinked(true)} />
    </SafeAreaView>
  );
}

const HAIR = StyleSheet.hairlineWidth;

/**
 * Settings visual language, matched to EditProfileScreen.
 *
 * White canvas rather than Apple's grey page with floating cards. Sections
 * separated by space and hairlines. Uppercase micro labels with letter-spacing.
 * Navy ink throughout, platinum for the account chip, red only for destructive.
 */
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: light.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: space.sm, backgroundColor: light.surface.canvas, borderBottomWidth: HAIR, borderBottomColor: light.surface.hairline },
  backBtn: { flexDirection: 'row', alignItems: 'center', minWidth: 60 },
  backChev: { fontSize: 28, color: light.ink.primary, lineHeight: 32, marginRight: 2 },
  backLbl: { fontSize: typeSize.body, color: light.ink.primary },
  headerTitle: { fontSize: typeSize.subhead, fontWeight: fontWeight.heavy, color: light.ink.primary },
  scroll: { paddingHorizontal: 14, paddingTop: space.md },

  profileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: light.surface.raised, borderRadius: radius.lg, padding: space.sm, marginBottom: space.xl, gap: space.sm, borderWidth: HAIR, borderColor: light.surface.hairline },
  profileCardAvatar: { width: 52, height: 52, borderRadius: 26 },
  profileCardAvatarFb: { width: 52, height: 52, borderRadius: 26, backgroundColor: light.brand.warm, alignItems: 'center', justifyContent: 'center' },
  profileCardAvatarTxt: { fontSize: typeSize.title, fontWeight: fontWeight.heavy, color: light.brand.base },
  profileCardInfo: { flex: 1 },
  profileCardName: { fontSize: typeSize.subhead, fontWeight: fontWeight.heavy, color: light.ink.primary, letterSpacing: -0.3 },
  profileCardEmail: { fontSize: typeSize.caption, color: light.ink.muted, marginTop: 2 },
  accountTypeBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm, marginTop: 6, backgroundColor: 'rgba(201,191,176,0.30)' },
  accountTypeBadgeASU: { backgroundColor: 'rgba(201,191,176,0.30)' },
  accountTypeBadgePending: { backgroundColor: light.status.innovationBg },
  accountTypeBadgePublic: { backgroundColor: light.brand.tintBg },
  accountTypeTxt: { fontSize: typeSize.micro, fontWeight: fontWeight.heavy, letterSpacing: 0.4 },

  section: { marginBottom: space.xl },
  sectionTitle: { fontSize: typeSize.micro, fontWeight: fontWeight.semibold, color: light.ink.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: space.xs, paddingLeft: 2 },
  sectionCard: { backgroundColor: light.surface.canvas, borderRadius: radius.md, borderWidth: HAIR, borderColor: light.surface.hairline, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingVertical: 13, gap: space.sm },
  rowIcon: { width: 22, textAlign: 'center' },
  rowContent: { flex: 1 },
  rowLabel: { fontSize: typeSize.emphasis, color: light.ink.primary, fontWeight: fontWeight.medium },
  rowLabelDanger: { color: light.status.danger },
  rowSublabel: { fontSize: typeSize.micro, color: light.ink.muted, marginTop: 2, lineHeight: 15 },
  divider: { height: HAIR, backgroundColor: light.surface.divider, marginLeft: 46 },

  versionChip: { fontSize: typeSize.caption, color: light.ink.muted, backgroundColor: light.surface.raised, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm },
  footerTxt: { textAlign: 'center', fontSize: typeSize.caption, color: light.ink.faint, marginBottom: space.xs },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: light.status.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeTxt: { fontSize: typeSize.micro, fontWeight: fontWeight.heavy, color: light.ink.inverse },

  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: space.sm, borderBottomWidth: HAIR, borderBottomColor: light.surface.hairline },
  modalCancel: { fontSize: typeSize.body, color: light.ink.muted, minWidth: 60 },
  modalTitle: { fontSize: typeSize.subhead, fontWeight: fontWeight.heavy, color: light.ink.primary },
  modalSave: { fontSize: typeSize.body, fontWeight: fontWeight.bold, color: light.brand.base, textAlign: 'right', minWidth: 60 },
  modalBody: { padding: space.edge },
  modalFieldLabel: { fontSize: typeSize.micro, fontWeight: fontWeight.semibold, color: light.ink.muted, textTransform: 'uppercase', letterSpacing: 1.1, marginBottom: space.xs },

  pwInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: light.brand.tintBg, borderRadius: radius.md, padding: space.sm, marginBottom: space.edge },
  pwInfoTxt: { flex: 1, fontSize: typeSize.body, color: light.ink.secondary, lineHeight: 20 },
  pwInputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: light.surface.raised, borderRadius: radius.md, borderWidth: HAIR, borderColor: light.surface.hairline, paddingHorizontal: space.sm, marginBottom: space.xs },
  pwInput: { flex: 1, fontSize: typeSize.body, color: light.ink.primary, paddingVertical: 12 },
  pwEye: { padding: 6 },
  pwStrength: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: space.xs },
  pwCheck: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pwCheckTxt: { fontSize: typeSize.micro, color: light.ink.faint },
  pwMismatch: { fontSize: typeSize.caption, color: light.status.danger, marginBottom: space.xs },
  pwSubmitBtn: { backgroundColor: light.brand.base, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center', marginTop: space.md },
  pwSubmitBtnOff: { opacity: 0.35 },
  pwSubmitBtnTxt: { color: light.ink.inverse, fontSize: typeSize.subhead, fontWeight: fontWeight.bold },

  privLabel: { fontSize: typeSize.heading, fontWeight: fontWeight.heavy, color: light.ink.primary, marginBottom: 6 },
  privDesc: { fontSize: typeSize.body, color: light.ink.secondary, lineHeight: 20, marginBottom: space.md },
  privOption: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: light.surface.hairline, marginBottom: space.sm },
  privOptionActive: { borderColor: light.brand.base, backgroundColor: light.brand.tintBg },
  privOptionIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: light.surface.raised, alignItems: 'center', justifyContent: 'center' },
  privOptionIconActive: { backgroundColor: 'rgba(201,191,176,0.30)' },
  privOptionTitle: { fontSize: typeSize.subhead, fontWeight: fontWeight.bold, color: light.ink.primary, marginBottom: 3 },
  privOptionDesc: { fontSize: typeSize.caption, color: light.ink.muted, lineHeight: 18 },
  privNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: light.surface.raised, borderRadius: radius.md, padding: space.sm, marginTop: space.xs },
  privNoteTxt: { flex: 1, fontSize: typeSize.caption, color: light.ink.muted, lineHeight: 18 },

  deleteWarning: { alignItems: 'center', backgroundColor: light.status.dangerBg, borderRadius: radius.md, padding: space.lg, marginBottom: space.lg, gap: space.xs },
  deleteWarningTitle: { fontSize: typeSize.heading, fontWeight: fontWeight.heavy, color: light.status.danger },
  deleteWarningTxt: { fontSize: typeSize.body, color: light.status.danger, textAlign: 'center', lineHeight: 20 },
  deleteInput: { backgroundColor: light.surface.raised, borderRadius: radius.md, borderWidth: HAIR, borderColor: light.surface.hairline, paddingHorizontal: space.sm, paddingVertical: 13, fontSize: typeSize.subhead, color: light.ink.primary, textAlign: 'center', letterSpacing: 2, marginBottom: space.md },
  deleteBtn: { backgroundColor: light.status.danger, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center' },
  deleteBtnOff: { opacity: 0.35 },
  deleteBtnTxt: { color: light.ink.inverse, fontSize: typeSize.subhead, fontWeight: fontWeight.bold },
});
