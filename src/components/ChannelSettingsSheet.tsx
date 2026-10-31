import VerifiedBadge from './VerifiedBadge';
import TierName from './TierName';
import { themedSheet, useTheme } from '../theme/useTheme';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Modal, Alert, Switch, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from './SafeArea';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../services/supabase';
import { uploadMedia } from '../services/mediaService';
import { useAuthStore } from '../stores/authStore';
import { StudioLoadError } from './StudioLoadError';

const NAVY = '#0B1E3D';

type Member = { user_id: string; full_name: string | null; username: string | null; avatar_url: string | null; role: string; notification_level: string };
type Props = {
  visible: boolean;
  onClose: () => void;
  channelId: string;
  myRole: string | null;
  meId: string | null;
  onChannelUpdated?: (p: { name?: string; icon_url?: string | null; replies_enabled?: boolean }) => void;
};

export default function ChannelSettingsSheet({ visible, onClose, channelId, myRole, meId, onChannelUpdated }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useTheme();
  const isOwner = myRole === 'owner';
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [audience, setAudience] = useState<'everyone' | 'followers'>('everyone');
  const [replies, setReplies] = useState(true);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [iconBusy, setIconBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [myLevel, setMyLevel] = useState<string>('all');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [inviting, setInviting] = useState<string | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const updatedRef = useRef(onChannelUpdated); updatedRef.current = onChannelUpdated;
  const context = `${visible}:${channelId}:${meId}`;
  const contextRef = useRef(context); contextRef.current = context;
  const scope = useRef(0), loadRequest = useRef(0), mounted = useRef(false);
  const locks = useRef(new Set<string>());
  const current = (run: number) => mounted.current && run === scope.current && contextRef.current === context && visible && !!meId && useAuthStore.getState().session?.user.id === meId;

  const load = useCallback(async () => {
    const run = scope.current;
    if (!current(run)) return;
    const request = ++loadRequest.current;
    setLoading(true); setLoadError(null);
    try {
      const [st, mem] = await Promise.all([
        supabase.rpc('get_channel_detail', { p_channel: channelId }),
        supabase.rpc('get_channel_members', { p_channel: channelId, p_limit: 100 }),
      ]);
      if (st.error || mem.error) throw st.error || mem.error;
      const row = Array.isArray(st.data) ? st.data[0] : st.data;
      if (!row?.is_member) throw new Error('Channel membership is unavailable.');
      if (!current(run) || request !== loadRequest.current) return;
      setName(row.name || ''); setDesc(row.description || '');
      setAudience(row.audience === 'followers' ? 'followers' : 'everyone');
      setReplies(row.replies_enabled !== false); setIconUrl(row.icon_url || null);
      setMyLevel(row.my_notification_level || 'all');
      setMembers(mem.data || []);
      updatedRef.current?.({ replies_enabled: row.replies_enabled !== false });
    } catch { if (current(run) && request === loadRequest.current) setLoadError('Channel settings could not be loaded. Please try again.'); }
    finally { if (current(run) && request === loadRequest.current) setLoading(false); }
  }, [visible, channelId, meId]);

  useEffect(() => {
    mounted.current = true; ++scope.current; locks.current.clear();
    setMembers([]); setResults([]); setQ(''); setSearchError(null); setSaving(false); setIconBusy(false); setInviting(null);
    if (visible && meId) void load();
    return () => { mounted.current = false; ++scope.current; ++loadRequest.current; };
  }, [visible, meId, channelId, load]);

  useEffect(() => {
    const run = scope.current; let active = true;
    setResults([]); setSearchError(null);
    if (!visible || !isOwner || q.trim().length < 2) return;
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc('search_people_page', { p_q: q.trim(), p_limit: 8, p_offset: 0 });
        if (error) throw error;
        if (!active || !current(run)) return;
        const taken = new Set(members.map(member => member.user_id));
        setResults((data || []).filter((person: any) => !taken.has(person.id)));
      } catch { if (active && current(run)) setSearchError('People could not be loaded. Edit your search to retry.'); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [q, members, visible, isOwner, meId, channelId]);

  const runAction = async (key: string, work: () => PromiseLike<{ error: any; data?: any }>, apply: () => void, failure: string) => {
    const run = scope.current;
    if (!current(run) || locks.current.has(key)) return;
    locks.current.add(key);
    try { const { error } = await work(); if (error) throw error; if (current(run)) apply(); }
    catch (error: any) { if (current(run)) Alert.alert(failure, error?.message || 'Refresh channel settings and try again.'); }
    finally { if (current(run)) locks.current.delete(key); }
  };

  const pickIcon = async () => {
    const run = scope.current;
    if (!isOwner || !meId || !current(run) || locks.current.has('icon')) return;
    locks.current.add('icon'); setIconBusy(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!current(run)) return;
      if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access in your device settings.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({
        preferredAssetRepresentationMode: 'compatible' as ImagePicker.UIImagePickerPreferredAssetRepresentationMode,
        mediaTypes: ['images'] as ImagePicker.MediaType[], allowsEditing: true, aspect: [1, 1], quality: 1,
      });
      if (!current(run) || result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const ext = ((asset.fileName || asset.uri).split('.').pop()?.split('?')[0] || 'jpg').toLowerCase().replace('jpeg', 'jpg');
      const mime = asset.mimeType || (ext === 'png' ? 'image/png' : 'image/jpeg');
      const { url } = await uploadMedia('avatars', meId, { uri: asset.uri, kind: 'image', ext, mimeType: mime, width: asset.width, height: asset.height, base64: null } as any, { filename: 'channel_' + channelId + '_' + Date.now() + '.' + ext });
      if (!current(run)) return;
      const { error } = await supabase.rpc('update_channel_settings', { p_channel: channelId, p_icon_url: url });
      if (error) throw error;
      if (!current(run)) return;
      setIconUrl(url); updatedRef.current?.({ icon_url: url });
    } catch (error: any) { if (current(run)) Alert.alert('Upload failed', error?.message || 'Could not update the icon.'); }
    finally { if (current(run)) { locks.current.delete('icon'); setIconBusy(false); } }
  };

  const save = async () => {
    const run = scope.current;
    if (!isOwner || !current(run) || locks.current.has('save')) return;
    if (!name.trim()) { Alert.alert('Required', 'The channel needs a name.'); return; }
    setSaving(true);
    await runAction('save', () => supabase.rpc('update_channel_settings', { p_channel: channelId, p_name: name.trim(), p_description: desc.trim() || null, p_audience: audience, p_replies_enabled: replies }), () => {
      updatedRef.current?.({ name: name.trim(), replies_enabled: replies }); Alert.alert('Saved', 'Channel settings updated.');
    }, 'Could not save');
    if (current(run)) setSaving(false);
  };
  const setLevel = (level: 'all' | 'highlights' | 'mute') => runAction('level', () => supabase.rpc('set_channel_notifications', { p_channel: channelId, p_level: level }), () => setMyLevel(level), 'Could not save notification settings');
  const applyRole = (member: Member, role: string) => {
    if (!isOwner) return;
    return runAction('member:' + member.user_id, () => supabase.rpc('set_channel_role', { p_channel: channelId, p_user: member.user_id, p_role: role }), () => {
      setMembers(previous => role === 'remove' ? previous.filter(item => item.user_id !== member.user_id) : previous.map(item => item.user_id === member.user_id ? { ...item, role } : item));
    }, 'Could not update role');
  };
  const roleMenu = (member: Member) => {
    if (!isOwner || member.role === 'owner' || member.user_id === meId) return;
    Alert.alert(member.full_name || 'Member', 'Change what this member can do.', [
      { text: 'Make collaborator', onPress: () => applyRole(member, 'collaborator') },
      { text: 'Make moderator', onPress: () => applyRole(member, 'moderator') },
      { text: 'Make member', onPress: () => applyRole(member, 'member') },
      { text: 'Remove from channel', style: 'destructive', onPress: () => applyRole(member, 'remove') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };
  const invite = async (person: any) => {
    const run = scope.current;
    if (!isOwner || !current(run) || locks.current.has('invite')) return;
    setInviting(person.id);
    await runAction('invite', () => supabase.rpc('set_channel_role', { p_channel: channelId, p_user: person.id, p_role: 'collaborator' }), () => {
      setMembers(previous => [...previous.filter(item => item.user_id !== person.id), { user_id: person.id, full_name: person.full_name, username: person.username, avatar_url: person.avatar_url, role: 'collaborator', notification_level: 'all' }]);
      setQ(''); setResults([]);
    }, 'Could not invite');
    if (current(run)) setInviting(null);
  };

  const roleLabel = (r: string) => r === 'owner' ? 'Owner' : r === 'collaborator' ? 'Collaborator' : r === 'moderator' ? 'Moderator' : null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.surface.canvas }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={s.header}>
            <View style={{ width: 60 }} />
            <Text style={s.headerTitle}>Channel settings</Text>
            <TouchableOpacity onPress={onClose} style={{ width: 60, alignItems: 'flex-end' }}><Feather name="x" size={22} color={t.ink.primary} /></TouchableOpacity>
          </View>
          {loadError ? <StudioLoadError message={loadError} onRetry={load} busy={loading} /> : loading ? (
            <View style={s.center}><ActivityIndicator color={NAVY} /></View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 12) + 24 }} keyboardShouldPersistTaps="handled">
              {isOwner ? (
                <View>
                  <View style={{ alignItems: 'center', marginBottom: 14 }}>
                    <TouchableOpacity onPress={pickIcon} disabled={iconBusy} activeOpacity={0.85} style={s.iconWrap}>
                      {iconUrl ? (
                        <ExpoImage source={{ uri: iconUrl }} style={s.icon} contentFit="cover" />
                      ) : (
                        <View style={[s.icon, s.iconFb]}><Feather name="radio" size={26} color="#FFF" /></View>
                      )}
                      <View style={s.iconBadge}>{iconBusy ? <ActivityIndicator size="small" color="#FFF" /> : <Feather name="camera" size={13} color="#FFF" />}</View>
                    </TouchableOpacity>
                    <Text style={s.iconHint}>Tap to change the channel icon</Text>
                  </View>
                  <Text style={s.label}>Name</Text>
                  <TextInput style={s.input} value={name} editable={!saving} onChangeText={setName} maxLength={60} placeholder="Channel name" placeholderTextColor="#8E8E93" />
                  <Text style={s.label}>Description</Text>
                  <TextInput style={[s.input, { minHeight: 64 }]} value={desc} editable={!saving} onChangeText={setDesc} maxLength={160} multiline placeholder="What is it about?" placeholderTextColor="#8E8E93" />
                  <Text style={s.label}>Who can join</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                    {(['everyone', 'followers'] as const).map(k => (
                      <TouchableOpacity key={k} style={[s.audChip, audience === k && s.audChipOn]} disabled={saving} onPress={() => setAudience(k)} activeOpacity={0.85}>
                        <Text style={[s.audChipTxt, audience === k && s.audChipTxtOn]}>{k === 'everyone' ? 'Everyone' : 'My followers'}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={s.switchRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.switchTitle}>Member replies</Text>
                      <Text style={s.switchSub}>Members can reply in threads under each update.</Text>
                    </View>
                    <Switch disabled={saving} value={replies} onValueChange={setReplies} trackColor={{ true: NAVY }} />
                  </View>
                  <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.5 }]} onPress={save} disabled={saving} activeOpacity={0.85}>
                    {saving ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={s.saveBtnTxt}>Save changes</Text>}
                  </TouchableOpacity>
                  <View style={s.divider} />
                </View>
              ) : null}

              <Text style={s.section}>Notifications</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
                {(['all', 'highlights', 'mute'] as const).map(k => (
                  <TouchableOpacity key={k} style={[s.audChip, myLevel === k && s.audChipOn]} onPress={() => setLevel(k)} activeOpacity={0.85}>
                    <Text style={[s.audChipTxt, myLevel === k && s.audChipTxtOn]}>{k === 'all' ? 'All' : k === 'highlights' ? 'Highlights' : 'Mute'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={s.hint}>All notifies every update. Highlights keeps it occasional. Mute stays silent.</Text>
              <View style={s.divider} />

              {isOwner ? (
                <View>
                  <Text style={s.section}>Invite a collaborator</Text>
                  <TextInput style={s.input} value={q} onChangeText={setQ} placeholder="Search people" placeholderTextColor="#8E8E93" />
                  {searchError ? <Text accessibilityRole="alert" style={s.hint}>{searchError}</Text> : null}
                  {results.map(r => (
                    <View key={r.id} style={s.memberRow}>
                      {r.avatar_url ? <ExpoImage source={{ uri: r.avatar_url }} style={s.memberAvatar} contentFit="cover" /> : <View style={[s.memberAvatar, s.iconFb]}><Text style={s.memberAvatarTxt}>{(r.full_name || '?')[0]}</Text></View>}
                      <View style={{ flex: 1 }}>
                        <Text style={s.memberName} numberOfLines={1}><TierName userId={((r) as any)?.id ?? ((r) as any)?.user_id} baseStyle={s.memberName} text={r.full_name || 'Member' || ''} numberOfLines={1} /> <VerifiedBadge userId={((r) as any)?.id ?? ((r) as any)?.user_id} size={12} /></Text>
                        {r.username ? <Text style={s.memberSub}>@{r.username}</Text> : null}
                      </View>
                      <TouchableOpacity style={s.inviteBtn} onPress={() => invite(r)} disabled={!!inviting} activeOpacity={0.85}>
                        {inviting === r.id ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={s.inviteBtnTxt}>Invite</Text>}
                      </TouchableOpacity>
                    </View>
                  ))}
                  <View style={{ height: 8 }} />
                </View>
              ) : null}

              <Text style={s.section}>{members.length === 1 ? '1 member' : String(members.length) + ' members'}</Text>
              {members.map(m => (
                <TouchableOpacity key={m.user_id} style={s.memberRow} activeOpacity={isOwner && m.role !== 'owner' && m.user_id !== meId ? 0.7 : 1} onPress={() => roleMenu(m)}>
                  {m.avatar_url ? <ExpoImage source={{ uri: m.avatar_url }} style={s.memberAvatar} contentFit="cover" /> : <View style={[s.memberAvatar, s.iconFb]}><Text style={s.memberAvatarTxt}>{(m.full_name || '?')[0]}</Text></View>}
                  <View style={{ flex: 1 }}>
                    <Text style={s.memberName} numberOfLines={1}>{m.full_name || 'Member'}{m.user_id === meId ? ' (you)' : ''}</Text>
                    {m.username ? <Text style={s.memberSub}>@{m.username}</Text> : null}
                  </View>
                  {roleLabel(m.role) ? <View style={s.roleChip}><Text style={s.roleChipTxt}>{roleLabel(m.role)}</Text></View> : null}
                  {isOwner && m.role !== 'owner' && m.user_id !== meId ? <Feather name="chevron-right" size={16} color="#C7C7CC" /> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const s = themedSheet((t) => ({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA' },
  headerTitle: { fontSize: 16.5, fontWeight: '700', color: '#0F1419' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  iconWrap: { width: 78, height: 78 },
  icon: { width: 78, height: 78, borderRadius: 39 },
  iconFb: { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  iconBadge: { position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, borderRadius: 13, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: t.ink.inverse },
  iconHint: { fontSize: 12, color: '#8E8E93', marginTop: 8 },
  label: { fontSize: 12, fontWeight: '700', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: '#F2F2F7', borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10, fontSize: 15, color: '#0F1419', marginBottom: 12 },
  audChip: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: '#E5E5EA', paddingVertical: 10, alignItems: 'center' },
  audChipOn: { borderColor: NAVY, backgroundColor: t.brand.tintBg },
  audChipTxt: { fontSize: 13.5, fontWeight: '600', color: '#5B6B84' },
  audChipTxtOn: { color: NAVY, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  switchTitle: { fontSize: 14.5, fontWeight: '600', color: '#0F1419' },
  switchSub: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
  saveBtn: { backgroundColor: NAVY, borderRadius: 12, alignItems: 'center', paddingVertical: 12 },
  saveBtnTxt: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#E5E5EA', marginVertical: 16 },
  section: { fontSize: 13, fontWeight: '700', color: '#0F1419', marginBottom: 10 },
  hint: { fontSize: 12, color: '#8E8E93' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  memberAvatar: { width: 38, height: 38, borderRadius: 19 },
  memberAvatarTxt: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  memberName: { fontSize: 14.5, fontWeight: '600', color: '#0F1419' },
  memberSub: { fontSize: 12, color: '#8E8E93' },
  roleChip: { backgroundColor: t.surface.hairline, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  roleChipTxt: { fontSize: 10.5, fontWeight: '700', color: t.ink.primary },
  inviteBtn: { backgroundColor: NAVY, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, minWidth: 62, alignItems: 'center' },
  inviteBtnTxt: { fontSize: 12.5, fontWeight: '700', color: '#FFFFFF' },
}));
