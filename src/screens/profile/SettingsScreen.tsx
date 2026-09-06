import { showMessage } from 'react-native-flash-message';
import { themedSheet, getTheme } from '../../theme/useTheme';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { paymentsService } from '../../services/paymentsService';
import LinkIntoBankSheet from '../../components/LinkIntoBankSheet';
import * as LocalAuthentication from 'expo-local-authentication';
import { useAccountsStore } from '../../stores/accountsStore';
import { useThemeStore } from '../../stores/themeStore';
import { useLockStore } from '../../stores/lockStore';
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Alert,
  StatusBar, Linking, Modal, TextInput, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
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
  const tint = danger ? getTheme().status.danger : getTheme().ink.muted;
  return (
    <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={onPress ? 0.6 : 1} disabled={!onPress}>
      <Feather name={icon as any} size={18} color={tint} style={s.rowIcon} />
      <View style={s.rowContent}>
        <Text style={[s.rowLabel, danger && s.rowLabelDanger]}>{label}</Text>
        {sublabel ? <Text style={s.rowSublabel}>{sublabel}</Text> : null}
      </View>
      {right ?? (chevron && onPress ? <Feather name="chevron-right" size={16} color={getTheme().ink.faint} /> : null)}
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
  const [currentPw,   setCurrentPw]   = useState('');
  const [newPw,       setNewPw]       = useState('');
  const [confirmPw,   setConfirmPw]   = useState('');
  const [showNewPw,   setShowNewPw]   = useState(false);
  const [showConfPw,  setShowConfPw]  = useState(false);
  const [savingPw,    setSavingPw]    = useState(false);

  const [privacyModal, setPrivacyModal] = useState(false);
  // Account class: the four root classes; organization details live in Studio.
  const [classModal, setClassModal] = useState(false);
  const [savingClass, setSavingClass] = useState(false);
  // Instagram's three, and only three. Business is a switch, not an
  // application: it opens the Studio on this same login.
  const ACCOUNT_CLASSES: { value: 'personal' | 'creator' | 'business'; icon: string; title: string; desc: string }[] = [
    { value: 'personal', icon: 'user', title: 'Personal', desc: 'A person sharing with their circle.' },
    { value: 'creator', icon: 'star', title: 'Creator', desc: 'Public figure, artist, athlete, journalist, educator or influencer. Adds creator insights.' },
    { value: 'business', icon: 'briefcase', title: 'Business', desc: 'Opens the Studio on this account: catalogue, storefront, inbox, ads and team. Verification is applied for separately.' },
  ];
  const currentAccountType = (): 'personal' | 'creator' | 'business' => {
    const t = (pf as any)?.account_type; const cl = (pf as any)?.account_class;
    return t === 'business' ? 'business' : cl === 'creator' ? 'creator' : 'personal';
  };  const saveAccountClass = async (value: 'personal' | 'creator' | 'business') => {
    if (!profile?.id) return;
    setSavingClass(true);
    try {
      const patch = value === 'business'
        ? { account_type: 'business', account_class: 'organization' }
        : { account_type: 'personal', account_class: value };
      const { error } = await supabase.from('profiles').update(patch).eq('id', profile.id);
      if (error) throw error;
      if (value === 'business') {
        // The storefront reads a business profile row keyed to this account;
        // make sure one exists so the Studio opens complete on the next tap.
        const { data: bp } = await supabase.from('business_profiles').select('id').eq('profile_id', profile.id).limit(1).maybeSingle();
        if (!bp) { await supabase.from('business_profiles').insert({ owner_id: profile.id, profile_id: profile.id, name: (pf as any)?.full_name || 'My business' }).then(() => {}, () => {}); }
      }
      setLocalProfile((p: any) => ({ ...(p || {}), ...patch }));
      setClassModal(false);
    } catch (e: any) { Alert.alert('Not saved', e?.message || 'Try again.'); }
    finally { setSavingClass(false); }
  };
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
    <Switch value={value} onValueChange={onChange} trackColor={{ false: 'rgba(11,30,61,0.08)', true: '#059669' }} thumbColor="#FFF" disabled={disabled} />
  );
  const [ibLinked, setIbLinked] = React.useState<boolean | null>(null);
  const [showLinkSheet, setShowLinkSheet] = React.useState(false);
  const lockEnabled = useLockStore(st => st.enabled);
  const toggleAppLock = async () => {
    const st = useLockStore.getState();
    if (st.enabled === true) {
      await st.setEnabled(false);
      Alert.alert('Face ID lock off', 'Platinum Circles now opens without Face ID.');
      return;
    }
    try {
      const hw = await LocalAuthentication.hasHardwareAsync();
      const enrolled = hw && (await LocalAuthentication.isEnrolledAsync());
      if (!enrolled) { Alert.alert('Face ID unavailable', 'Set up Face ID or a device passcode in iPhone Settings first.'); return; }
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Confirm to require Face ID' });
      if (r.success) {
        await st.setEnabled(true);
        Alert.alert('Face ID lock on', 'Platinum Circles asks for Face ID at launch and after a minute away.');
      }
    } catch { Alert.alert('Could not enable', 'Please try again.'); }
  };
  React.useEffect(() => { paymentsService.getLinkStatus().then(r => setIbLinked(!!r.linked), () => setIbLinked(false)); }, []);
  const confirmUnlink = () => {
    Alert.alert('Unlink IntoBank?', 'Payments in chats stop until you link an account again, from Settings or from any pay sheet. Nothing about your IntoBank account itself changes.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unlink', style: 'destructive', onPress: async () => { try {
        // Disconnecting a bank is confirmed the same way sending money is.
        if (LocalAuthentication?.authenticateAsync) { const ok = await LocalAuthentication.authenticateAsync({ promptMessage: 'Confirm to unlink IntoBank', fallbackLabel: 'Use passcode' }); if (!ok?.success) return; }
        await paymentsService.unlink(); setIbLinked(false); Alert.alert('Done', 'Your IntoBank account is no longer connected.'); } catch (e: any) { Alert.alert('Could not deactivate', e?.message || 'Please try again.'); } } },
    ]);
  };

  const buildSections = (): { title: string; rows: SetRow[] }[] => [
    { title: 'Security', rows: [
      ...(lockEnabled ? [{ icon: 'clock', color: '#0B1E3D', label: 'Ask for Face ID', sub: (() => { const ms = useLockStore.getState().lockAfterMs; return ms <= 0 ? 'Immediately when I return' : ms >= 900000 ? 'After 15 minutes away' : ms >= 300000 ? 'After 5 minutes away' : 'After 1 minute away'; })(), onPress: () => {
        Alert.alert('Ask for Face ID', 'When you come back to the app after being away', [
          { text: 'Immediately', onPress: () => useLockStore.getState().setLockAfterMs(0) },
          { text: 'After 1 minute', onPress: () => useLockStore.getState().setLockAfterMs(60000) },
          { text: 'After 5 minutes', onPress: () => useLockStore.getState().setLockAfterMs(300000) },
          { text: 'After 15 minutes', onPress: () => useLockStore.getState().setLockAfterMs(900000) },
          { text: 'Cancel', style: 'cancel' },
        ]);
      } }] : []),
            { icon: 'bell-off', color: '#0B1E3D', label: 'Quiet mode', sub: ((): string => { const q = (pf as any)?.quiet_from; const r = (pf as any)?.quiet_to; return (q != null && r != null) ? ('No notifications ' + q + ':00 to ' + r + ':00') : 'Pause notifications for the hours you choose'; })(), onPress: () => {
        const set = async (from: number | null, to: number | null) => {
          if (!profile?.id) return;
          const off = -new Date().getTimezoneOffset();
          const { error } = await supabase.from('profiles').update({ quiet_from: from, quiet_to: to, quiet_tz_offset_min: off }).eq('id', profile.id);
          if (error) { Alert.alert('Not saved', error.message); return; }
          setLocalProfile((p: any) => ({ ...(p || {}), quiet_from: from, quiet_to: to }));
        };
        Alert.alert('Quiet mode', 'No push notifications during these hours. They wait in the app.', [
          { text: '10 pm to 7 am', onPress: () => set(22, 7) },
          { text: '11 pm to 8 am', onPress: () => set(23, 8) },
          { text: 'Midnight to 9 am', onPress: () => set(0, 9) },
          { text: 'Off', onPress: () => set(null, null) },
          { text: 'Cancel', style: 'cancel' },
        ]);
      } },
      { icon: 'moon', color: '#0B1E3D', label: 'Appearance', sub: (() => { const m = useThemeStore.getState().mode; return m === 'dark' ? 'Dark' : m === 'light' ? 'Light' : 'Follows your phone'; })(), onPress: () => {
        Alert.alert('Appearance', 'Light, dark, or whatever your phone is set to', [
          { text: 'Follow my phone', onPress: () => useThemeStore.getState().setMode('system') },
          { text: 'Light', onPress: () => useThemeStore.getState().setMode('light') },
          { text: 'Dark', onPress: () => useThemeStore.getState().setMode('dark') },
          { text: 'Cancel', style: 'cancel' },
        ]);
      } },
      { icon: 'lock', color: '#0B1E3D', label: 'Unlock with Face ID', sub: 'Face ID at launch and when you return after being away', onPress: toggleAppLock, chevron: false, right: sw(lockEnabled === true, toggleAppLock) },
    ] },
    { title: 'IntoBank', rows: [
      { icon: 'credit-card', color: '#0B1E3D', label: ibLinked === null ? 'Checking connection...' : ibLinked ? 'IntoBank connected' : 'IntoBank not connected', sub: ibLinked === false ? 'Tap to link your account' : ibLinked ? 'Chat payments ride your IntoBank wallet' : 'One moment', onPress: () => { if (ibLinked === false) setShowLinkSheet(true); } },
      ...(ibLinked ? [{ icon: 'x-circle', color: '#FF3B30', label: 'Unlink IntoBank', sub: 'Disconnect this bank account, or unlink to connect a different one', onPress: confirmUnlink }] : []),
      ...(ibLinked === false ? [{ icon: 'link', color: '#0B1E3D', label: 'Link IntoBank', sub: 'Email plus a 6-digit code, done in a minute', onPress: () => setShowLinkSheet(true) }] : []),
    ] },
    { title: 'Account', rows: [
      { icon: 'user', color: '#0B1E3D', label: 'Edit Profile', sub: 'Name, bio, photo', onPress: goToEditProfile },
      { icon: 'award', color: '#0B1E3D', label: 'Account type', sub: ((): string => { const t = currentAccountType(); return t === 'business' ? 'Business' : t === 'creator' ? 'Creator' : 'Personal'; })(), onPress: () => setClassModal(true) },
            { icon: 'shield', color: '#0B1E3D', label: 'Two-factor authentication', sub: 'A code from an authenticator app at every sign-in', onPress: () => (navigation as any).navigate('TwoFactor') },
      { icon: 'smartphone', color: '#0B1E3D', label: 'Login activity', sub: 'Devices signed in, and log the others out', onPress: () => (navigation as any).navigate('LoginActivity') },
      { icon: 'eye', color: '#0B1E3D', label: 'Privacy', sub: 'Public, or private with approved followers', onPress: () => setPrivacyModal(true) },
      { icon: 'user-check', color: '#0B1E3D', label: 'Follow Requests', sub: 'Approve who can follow you', onPress: () => navigation.navigate('FollowRequests') },
                  { icon: 'volume-x', color: '#0B1E3D', label: 'Muted words', sub: 'Keep posts with certain words out of your feed', onPress: () => (navigation as any).navigate('MutedWords') },
      { icon: 'alert-triangle', color: '#0B1E3D', label: 'Sensitive content', sub: ((): string => { const v = (pf as any)?.sensitive_content || 'blur'; return v === 'show' ? 'Shown' : v === 'hide' ? 'Hidden' : 'Blurred until you tap'; })(), onPress: () => {
        const set = async (v: 'show' | 'blur' | 'hide') => { if (!profile?.id) return; const { error } = await supabase.from('profiles').update({ sensitive_content: v }).eq('id', profile.id); if (error) { Alert.alert('Not saved', error.message); return; } setLocalProfile((p: any) => ({ ...(p || {}), sensitive_content: v })); };
        Alert.alert('Sensitive content', 'Photos and videos a poster marked as sensitive', [
          { text: 'Show', onPress: () => set('show') },
          { text: 'Blur until I tap', onPress: () => set('blur') },
          { text: 'Hide', onPress: () => set('hide') },
          { text: 'Cancel', style: 'cancel' },
        ]);
      } },
      { icon: 'bookmark', color: '#0B1E3D', label: 'Saved posts', sub: 'Posts you bookmarked', onPress: () => navigation.navigate('SavedPosts') },
      { icon: 'archive', color: '#0B1E3D', label: 'Archive', sub: 'Posts you hid without deleting', onPress: () => (navigation as any).navigate('Archive') },
      { icon: 'activity', color: '#0B1E3D', label: 'Your activity', sub: 'Likes, comments, reposts and saves', onPress: () => (navigation as any).navigate('YourActivity') },
      { icon: 'download', color: '#0B1E3D', label: 'Download your data', sub: 'Everything on your account, as one file', onPress: async () => {
        try {
          showMessage({ message: 'Preparing your data', description: 'This takes a few seconds.', type: 'info', duration: 2500 });
          const { data, error } = await supabase.functions.invoke('export-my-data', { body: {} });
          if (error) throw error;
          const FileSystem = require('expo-file-system/legacy');
          const path = (FileSystem.cacheDirectory || '') + 'platinum-circles-data-' + new Date().toISOString().slice(0, 10) + '.json';
          await FileSystem.writeAsStringAsync(path, JSON.stringify(data, null, 2));
          let shared = false;
          try { const Sharing = require('expo-sharing'); if (Sharing?.isAvailableAsync && await Sharing.isAvailableAsync()) { await Sharing.shareAsync(path, { mimeType: 'application/json', dialogTitle: 'Your Platinum Circles data' }); shared = true; } } catch {}
          if (!shared) { const { Share } = require('react-native'); await Share.share({ url: path, title: 'Your Platinum Circles data' } as any); }
        } catch (e: any) { Alert.alert('Could not export', e?.message || 'Try again.'); }
      } },
      { icon: 'slash', color: '#FF3B30', label: 'Blocked accounts', sub: 'See and undo who you blocked', onPress: () => navigation.navigate('BlockedAccounts') },
      { icon: 'briefcase', color: '#0B1E3D', label: 'Businesses', sub: 'Pages you run, and your team', onPress: () => navigation.navigate('Businesses') }, // visible to everyone — a person creates business pages
      { icon: 'mail', color: '#0B1E3D', label: 'Message requests', sub: 'Messages from people you do not follow', onPress: () => (navigation as any).navigate('MessageRequests') },
      { icon: 'award', color: '#0B1E3D', label: 'Verification', sub: 'Apply for the badge - earned, never bought', onPress: () => (navigation as any).navigate('ApplyVerification') },
      { icon: 'life-buoy', color: '#0B1E3D', label: 'Contact support', sub: 'Write to the operations team', onPress: () => (navigation as any).navigate('ContactSupport') },
      { icon: 'briefcase', color: 'rgba(11,30,61,0.42)', label: 'Apply for a business account', sub: 'Companies get their own @ and the space-grey seal', onPress: () => (navigation as any).navigate('BusinessApply') },
      { icon: 'at-sign', color: '#0B1E3D', label: 'Change username', sub: 'Pick a new @ if it is available', onPress: () => (navigation as any).navigate('ChangeUsername') },
      { icon: 'key', color: '#0B1E3D', label: 'Business access', sub: 'For business accounts - the people and devices that may speak as it', onPress: () => (navigation as any).navigate('BusinessAccess') },
      { icon: 'shield', color: '#0B1E3D', label: 'Account standing', sub: 'Your record and any active restriction', onPress: () => (navigation as any).navigate('AccountStanding') },
      { icon: 'trending-up', color: 'rgba(11,30,61,0.42)', label: 'Promotions and campaigns', sub: 'Promote your posts as sponsored placements', onPress: () => (navigation as any).navigate('Campaigns') },
      { icon: 'edit-3', color: '#0B1E3D', label: 'Write an article', sub: 'Long-form publishing with a cover and read time', onPress: () => (navigation as any).navigate('ArticleCompose') },
    ]},
    { title: 'Notifications', rows: [
      { icon: 'bell', color: '#FF3B30', label: 'Push Notifications', sub: 'Master toggle for all alerts', chevron: false, right: sw(pushEnabled, togglePush) },
      ...NOTIF_TYPES.map(t => ({ icon: 'bell' as const, color: '#0B1E3D', label: t.label, sub: t.sub, chevron: false,
        right: sw(notifPrefs[t.key] !== false && pushEnabled, (v: boolean) => setTypePref(t.key, v), !pushEnabled) })),
    ]},
    { title: 'Data & appearance', rows: [
      { icon: 'play-circle', color: '#0B1E3D', label: 'Autoplay videos', sub: 'Turn off to save mobile data', chevron: false,
        right: sw(appSet.autoplayVideos, v => appSet.set({ autoplayVideos: v })) },
      { icon: 'upload-cloud', color: '#0B1E3D', label: 'Upload quality', sub: appSet.uploadQuality === 'high' ? 'High — best quality' : 'Data saver — smaller uploads', chevron: false,
        right: sw(appSet.uploadQuality === 'high', v => appSet.set({ uploadQuality: v ? 'high' : 'data-saver' })) },
    ]},
    { title: 'Support', rows: [
      { icon: 'help-circle', color: '#0B1E3D', label: 'Help & Support', sub: 'FAQs, submit a ticket', onPress: () => navigation.navigate('HelpSupport') },
      { icon: 'mail', color: '#0B1E3D', label: 'Contact Us', sub: 'support@platinumcircles.app', onPress: () => Linking.openURL('mailto:support@platinumcircles.app?subject=PlatinumCircles%20Inquiry').catch(() => Alert.alert('No mail app', 'Email us at support@platinumcircles.app')) },
      { icon: 'star', color: '#0B1E3D', label: 'Rate the App', sub: 'Share your feedback', onPress: () => Alert.alert('Thank you!', 'App Store rating coming soon.') },
    ]},
    { title: 'Legal', rows: [
      { icon: 'file-text', color: 'rgba(11,30,61,0.42)', label: 'Terms of Service', onPress: () => navigation.navigate('Terms') },
      { icon: 'shield', color: 'rgba(11,30,61,0.42)', label: 'Privacy Policy', onPress: () => navigation.navigate('PrivacyPolicy') },
    ]},
    { title: 'Account Actions', rows: [
      { icon: 'refresh-cw', color: '#0B1E3D', label: 'Switch Account', sub: 'Up to five accounts on this phone; long-press the Profile tab any time', onPress: () => useAccountsStore.getState().openSwitcher() },
      { icon: 'log-out', color: '#0B1E3D', label: 'Sign Out', onPress: handleSignOut },
      { icon: 'moon', color: 'rgba(11,30,61,0.42)', label: 'Deactivate Account', sub: 'Hide your profile temporarily', onPress: handleDeactivate },
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
    if (!currentPw) { Alert.alert('Current password', 'Enter your current password first.'); return; }
    if (!newPw.trim()) { Alert.alert('Required', 'Enter a new password.'); return; }
    if (newPw.length < 8 || !/[A-Za-z]/.test(newPw) || !/[0-9]/.test(newPw)) { Alert.alert('Stronger password', 'At least 8 characters, with a letter and a number.'); return; }
    if (newPw !== confirmPw) { Alert.alert('Mismatch', 'Passwords do not match.'); return; }
    setSavingPw(true);
    try {
      // Instagram's rule: prove you know the current password before changing it.
      const email = (await supabase.auth.getUser()).data.user?.email || '';
      const check = await supabase.auth.signInWithPassword({ email, password: currentPw });
      if (check.error) { Alert.alert('Current password', 'That is not your current password.'); return; }
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) { Alert.alert('Error', error.message); return; }
      setCurrentPw('');
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
                color={isASU ? (isVerifiedInstitution ? MAROON : '#D97706') : '#0B1E3D'}
              />
              <Text style={[
                s.accountTypeTxt,
                isASU
                  ? { color: isVerifiedInstitution ? MAROON : '#D97706' }
                  : { color: '#0B1E3D' }
              ]}>
                {isASU
                  ? (isVerifiedInstitution ? 'ASU Verified' : 'ASU Pending Verification')
                  : 'Public Network'}
              </Text>
            </View>
          </View>
          <Feather name="chevron-right" size={20} color="rgba(11,30,61,0.24)" />
        </TouchableOpacity>

        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(11,30,61,0.05)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 }}>
            <Feather name="search" size={15} color="rgba(11,30,61,0.42)" />
            <TextInput value={settingsQuery} onChangeText={setSettingsQuery} placeholder="Search settings"
              placeholderTextColor="rgba(11,30,61,0.42)" style={{ flex: 1, fontSize: 15, color: '#0B1E3D', padding: 0 }} />
            {settingsQuery ? <TouchableOpacity onPress={() => setSettingsQuery('')}><Feather name="x" size={15} color="rgba(11,30,61,0.42)" /></TouchableOpacity> : null}
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
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF', paddingTop: insets.top }} edges={['left', 'right']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => { setPwModal(false); setNewPw(''); setConfirmPw(''); }}><Text style={s.modalCancel}>Cancel</Text></TouchableOpacity>
            <Text style={s.modalTitle}>Change Password</Text>
            <TouchableOpacity onPress={changePassword} disabled={savingPw}>
              {savingPw ? <ActivityIndicator color="#0B1E3D" size={16} /> : <Text style={s.modalSave}>Update</Text>}
            </TouchableOpacity>
          </View>
          <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={s.modalBody} keyboardShouldPersistTaps="handled">
            <View style={s.pwInfo}>
              <Feather name="lock" size={18} color="#0B1E3D" />
              <Text style={s.pwInfoTxt}>Your new password must be at least 8 characters. You will remain signed in after changing it.</Text>
            </View>
            <Text style={s.modalFieldLabel}>New Password</Text>
            <View style={s.pwInputRow}>
              <TextInput value={currentPw} onChangeText={setCurrentPw} placeholder="Current password" placeholderTextColor="rgba(11,30,61,0.24)" style={s.pwInput} secureTextEntry={!showNewPw} autoCapitalize="none" autoCorrect={false} />
<TextInput value={newPw} onChangeText={setNewPw} placeholder="Enter new password" placeholderTextColor="rgba(11,30,61,0.24)" style={s.pwInput} secureTextEntry={!showNewPw} autoCapitalize="none" autoCorrect={false} />
              <TouchableOpacity onPress={() => setShowNewPw(p => !p)} style={s.pwEye}><Feather name={showNewPw ? 'eye-off' : 'eye'} size={18} color="rgba(11,30,61,0.42)" /></TouchableOpacity>
            </View>
            {newPw.length > 0 && (
              <View style={s.pwStrength}>
                {['Length (8+)', 'Uppercase', 'Number', 'Symbol'].map((c, i) => {
                  const checks = [newPw.length >= 8, /[A-Z]/.test(newPw), /\d/.test(newPw), /[^A-Za-z0-9]/.test(newPw)];
                  return (
                    <View key={c} style={s.pwCheck}>
                      <Feather name={checks[i] ? 'check-circle' : 'circle'} size={13} color={checks[i] ? '#059669' : 'rgba(11,30,61,0.24)'} />
                      <Text style={[s.pwCheckTxt, checks[i] && { color: '#059669' }]}>{c}</Text>
                    </View>
                  );
                })}
              </View>
            )}
            <Text style={[s.modalFieldLabel, { marginTop: 20 }]}>Confirm New Password</Text>
            <View style={s.pwInputRow}>
              <TextInput value={confirmPw} onChangeText={setConfirmPw} placeholder="Confirm new password" placeholderTextColor="rgba(11,30,61,0.24)" style={s.pwInput} secureTextEntry={!showConfPw} autoCapitalize="none" autoCorrect={false} />
              <TouchableOpacity onPress={() => setShowConfPw(p => !p)} style={s.pwEye}><Feather name={showConfPw ? 'eye-off' : 'eye'} size={18} color="rgba(11,30,61,0.42)" /></TouchableOpacity>
            </View>
            {confirmPw.length > 0 && newPw !== confirmPw && <Text style={s.pwMismatch}>Passwords do not match</Text>}
            <TouchableOpacity
              style={[s.pwSubmitBtn, (savingPw || newPw.length < 8 || newPw !== confirmPw) && s.pwSubmitBtnOff]}
              onPress={changePassword} disabled={savingPw || newPw.length < 8 || newPw !== confirmPw} activeOpacity={0.85}
            >
              {savingPw ? <ActivityIndicator color="#FFF" /> : <Text style={s.pwSubmitBtnTxt}>Update Password</Text>}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* Privacy Modal */}
      <Modal visible={classModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setClassModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF', paddingTop: insets.top }} edges={['left', 'right']}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setClassModal(false)}><Text style={s.modalCancel}>Cancel</Text></TouchableOpacity>
            <Text style={s.modalTitle}>Account type</Text>
            <View style={{ width: 52 }}>{savingClass ? <ActivityIndicator color="#0B1E3D" size={16} /> : null}</View>
          </View>
          <ScrollView contentContainerStyle={s.modalBody}>
            <Text style={s.privDesc}>Switch any time; nothing is deleted. Business opens the Studio on this account. Verification is applied for separately, under Verification.</Text>
            {ACCOUNT_CLASSES.map(opt => { const on = currentAccountType() === opt.value; return (
              <TouchableOpacity key={opt.value} onPress={() => saveAccountClass(opt.value)} disabled={savingClass} activeOpacity={0.8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, marginTop: 10, borderWidth: 1.5, borderColor: on ? '#0B1E3D' : 'rgba(11,30,61,0.12)', backgroundColor: on ? 'rgba(201,191,176,0.22)' : '#FFF' }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: on ? '#0B1E3D' : 'rgba(11,30,61,0.06)', alignItems: 'center', justifyContent: 'center' }}><Feather name={opt.icon as any} size={18} color={on ? '#FFF' : '#0B1E3D'} /></View>
                <View style={{ flex: 1 }}><Text style={{ fontSize: 15, fontWeight: '800', color: '#0B1E3D' }}>{opt.title}</Text><Text style={{ fontSize: 12.5, color: 'rgba(11,30,61,0.6)', marginTop: 2, lineHeight: 17 }}>{opt.desc}</Text></View>
                {on ? <Feather name="check-circle" size={20} color="#0B1E3D" /> : null}
              </TouchableOpacity>
            ); })}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={privacyModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPrivacyModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF', paddingTop: insets.top }} edges={['left', 'right']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setPrivacyModal(false)}><Text style={s.modalCancel}>Cancel</Text></TouchableOpacity>
            <Text style={s.modalTitle}>Privacy</Text>
            <TouchableOpacity onPress={savePrivacy} disabled={savingPriv}>
              {savingPriv ? <ActivityIndicator color="#0B1E3D" size={16} /> : <Text style={s.modalSave}>Save</Text>}
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
                  <Feather name={opt.icon as any} size={20} color={visibility === opt.value ? '#0B1E3D' : 'rgba(11,30,61,0.42)'} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.privOptionTitle, visibility === opt.value && { color: '#0B1E3D' }]}>{opt.title}</Text>
                  <Text style={s.privOptionDesc}>{opt.desc}</Text>
                </View>
                {visibility === opt.value && <Feather name="check-circle" size={20} color="#0B1E3D" />}
              </TouchableOpacity>
            ))}
            <View style={s.privNote}>
              <Feather name="info" size={14} color="rgba(11,30,61,0.42)" />
              <Text style={s.privNoteTxt}>
                {isASU
                  ? 'Your privacy setting only affects profile visibility within the ASU network.'
                  : 'Your privacy setting only affects profile visibility. Your posts in the feed are always visible to signed-in members.'}
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* Delete Account Modal */}
      <Modal visible={deleteModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDeleteModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF', paddingTop: insets.top }} edges={['left', 'right']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
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
            <TextInput value={deleteConfirmTxt} onChangeText={setDeleteConfirmTxt} placeholder="DELETE" placeholderTextColor="rgba(11,30,61,0.24)" style={s.deleteInput} autoCapitalize="characters" autoCorrect={false} />
            <TouchableOpacity
              style={[s.deleteBtn, (deleting || deleteConfirmTxt !== 'DELETE') && s.deleteBtnOff]}
              onPress={handleDeleteAccount} disabled={deleting || deleteConfirmTxt !== 'DELETE'} activeOpacity={0.85}
            >
              {deleting ? <ActivityIndicator color="#FFF" /> : <Text style={s.deleteBtnTxt}>Delete My Account</Text>}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
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
const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: space.sm, backgroundColor: t.surface.canvas, borderBottomWidth: HAIR, borderBottomColor: t.surface.hairline },
  backBtn: { flexDirection: 'row', alignItems: 'center', minWidth: 60 },
  backChev: { fontSize: 28, color: t.ink.primary, lineHeight: 32, marginRight: 2 },
  backLbl: { fontSize: typeSize.body, color: t.ink.primary },
  headerTitle: { fontSize: typeSize.subhead, fontWeight: fontWeight.heavy, color: t.ink.primary },
  scroll: { paddingHorizontal: 14, paddingTop: space.md },

  profileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface.raised, borderRadius: radius.lg, padding: space.sm, marginBottom: space.xl, gap: space.sm, borderWidth: HAIR, borderColor: t.surface.hairline },
  profileCardAvatar: { width: 52, height: 52, borderRadius: 26 },
  profileCardAvatarFb: { width: 52, height: 52, borderRadius: 26, backgroundColor: t.brand.warm, alignItems: 'center', justifyContent: 'center' },
  profileCardAvatarTxt: { fontSize: typeSize.title, fontWeight: fontWeight.heavy, color: t.brand.base },
  profileCardInfo: { flex: 1 },
  profileCardName: { fontSize: typeSize.subhead, fontWeight: fontWeight.heavy, color: t.ink.primary, letterSpacing: -0.3 },
  profileCardEmail: { fontSize: typeSize.caption, color: t.ink.muted, marginTop: 2 },
  accountTypeBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm, marginTop: 6, backgroundColor: 'rgba(201,191,176,0.30)' },
  accountTypeBadgeASU: { backgroundColor: 'rgba(201,191,176,0.30)' },
  accountTypeBadgePending: { backgroundColor: t.status.innovationBg },
  accountTypeBadgePublic: { backgroundColor: t.brand.tintBg },
  accountTypeTxt: { fontSize: typeSize.micro, fontWeight: fontWeight.heavy, letterSpacing: 0.4 },

  section: { marginBottom: space.xl },
  sectionTitle: { fontSize: typeSize.micro, fontWeight: fontWeight.semibold, color: t.ink.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: space.xs, paddingLeft: 2 },
  sectionCard: { backgroundColor: t.surface.canvas, borderRadius: radius.md, borderWidth: HAIR, borderColor: t.surface.hairline, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingVertical: 13, gap: space.sm },
  rowIcon: { width: 22, textAlign: 'center' },
  rowContent: { flex: 1 },
  rowLabel: { fontSize: typeSize.emphasis, color: t.ink.primary, fontWeight: fontWeight.medium },
  rowLabelDanger: { color: t.status.danger },
  rowSublabel: { fontSize: typeSize.micro, color: t.ink.muted, marginTop: 2, lineHeight: 15 },
  divider: { height: HAIR, backgroundColor: t.surface.divider, marginLeft: 46 },

  versionChip: { fontSize: typeSize.caption, color: t.ink.muted, backgroundColor: t.surface.raised, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm },
  footerTxt: { textAlign: 'center', fontSize: typeSize.caption, color: t.ink.faint, marginBottom: space.xs },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: t.status.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeTxt: { fontSize: typeSize.micro, fontWeight: fontWeight.heavy, color: t.ink.inverse },

  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: space.sm, borderBottomWidth: HAIR, borderBottomColor: t.surface.hairline },
  modalCancel: { fontSize: typeSize.body, color: t.ink.muted, minWidth: 60 },
  modalTitle: { fontSize: typeSize.subhead, fontWeight: fontWeight.heavy, color: t.ink.primary },
  modalSave: { fontSize: typeSize.body, fontWeight: fontWeight.bold, color: t.brand.base, textAlign: 'right', minWidth: 60 },
  modalBody: { padding: space.edge },
  modalFieldLabel: { fontSize: typeSize.micro, fontWeight: fontWeight.semibold, color: t.ink.muted, textTransform: 'uppercase', letterSpacing: 1.1, marginBottom: space.xs },

  pwInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: t.brand.tintBg, borderRadius: radius.md, padding: space.sm, marginBottom: space.edge },
  pwInfoTxt: { flex: 1, fontSize: typeSize.body, color: t.ink.secondary, lineHeight: 20 },
  pwInputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface.raised, borderRadius: radius.md, borderWidth: HAIR, borderColor: t.surface.hairline, paddingHorizontal: space.sm, marginBottom: space.xs },
  pwInput: { flex: 1, fontSize: typeSize.body, color: t.ink.primary, paddingVertical: 12 },
  pwEye: { padding: 6 },
  pwStrength: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: space.xs },
  pwCheck: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pwCheckTxt: { fontSize: typeSize.micro, color: t.ink.faint },
  pwMismatch: { fontSize: typeSize.caption, color: t.status.danger, marginBottom: space.xs },
  pwSubmitBtn: { backgroundColor: t.brand.base, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center', marginTop: space.md },
  pwSubmitBtnOff: { opacity: 0.35 },
  pwSubmitBtnTxt: { color: t.ink.inverse, fontSize: typeSize.subhead, fontWeight: fontWeight.bold },

  privLabel: { fontSize: typeSize.heading, fontWeight: fontWeight.heavy, color: t.ink.primary, marginBottom: 6 },
  privDesc: { fontSize: typeSize.body, color: t.ink.secondary, lineHeight: 20, marginBottom: space.md },
  privOption: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: t.surface.hairline, marginBottom: space.sm },
  privOptionActive: { borderColor: t.brand.base, backgroundColor: t.brand.tintBg },
  privOptionIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: t.surface.raised, alignItems: 'center', justifyContent: 'center' },
  privOptionIconActive: { backgroundColor: 'rgba(201,191,176,0.30)' },
  privOptionTitle: { fontSize: typeSize.subhead, fontWeight: fontWeight.bold, color: t.ink.primary, marginBottom: 3 },
  privOptionDesc: { fontSize: typeSize.caption, color: t.ink.muted, lineHeight: 18 },
  privNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: t.surface.raised, borderRadius: radius.md, padding: space.sm, marginTop: space.xs },
  privNoteTxt: { flex: 1, fontSize: typeSize.caption, color: t.ink.muted, lineHeight: 18 },

  deleteWarning: { alignItems: 'center', backgroundColor: t.status.dangerBg, borderRadius: radius.md, padding: space.lg, marginBottom: space.lg, gap: space.xs },
  deleteWarningTitle: { fontSize: typeSize.heading, fontWeight: fontWeight.heavy, color: t.status.danger },
  deleteWarningTxt: { fontSize: typeSize.body, color: t.status.danger, textAlign: 'center', lineHeight: 20 },
  deleteInput: { backgroundColor: t.surface.raised, borderRadius: radius.md, borderWidth: HAIR, borderColor: t.surface.hairline, paddingHorizontal: space.sm, paddingVertical: 13, fontSize: typeSize.subhead, color: t.ink.primary, textAlign: 'center', letterSpacing: 2, marginBottom: space.md },
  deleteBtn: { backgroundColor: t.status.danger, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center' },
  deleteBtnOff: { opacity: 0.35 },
  deleteBtnTxt: { color: t.ink.inverse, fontSize: typeSize.subhead, fontWeight: fontWeight.bold },
}));
