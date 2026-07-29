import VerifiedBadge from '../../components/VerifiedBadge';
/**
 * GroupManagementScreen.tsx
 * Design C — Group Info Layout, Clean Premium.
 * Members list with admin/officer badges, shared media grid, group settings.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Image, Pressable,
  ActivityIndicator, Alert, ScrollView, StatusBar, Dimensions,
  Modal, Linking, Share, Platform, ActionSheetIOS, FlatList,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { uploadMedia } from '../../services/mediaService';
import MediaViewer, { MediaViewerItem } from '../../components/messages/MediaViewer';

const { width: SCREEN_W } = Dimensions.get('window');
const GALLERY_GAP = 2;
const GALLERY_TILE = Math.floor((SCREEN_W - GALLERY_GAP * 3) / 4);
const PREVIEW_GAP = 3;
const PREVIEW_TILE = Math.floor((SCREEN_W - 32 - PREVIEW_GAP * 2) / 3);

const NAVY = '#0B1E3D';
const NAVY_SOFT = '#1A3560';
const BG_GREY = '#F7F7F9';
const TEXT_PRIMARY = '#000000';
const TEXT_SECONDARY = '#8E8E93';
const HAIRLINE = '#E5E5EA';

function initials(n?: string | null) {
  if (!n) return '?';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}
const AVATAR_BG = [NAVY, NAVY_SOFT, '#065F46', '#7C2D12', '#5856D6', '#C2410C', '#0F766E', '#7C3AED'];
function avatarBg(id: string) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % AVATAR_BG.length;
  return AVATAR_BG[Math.abs(h) % AVATAR_BG.length];
}
function fmtDate(d?: string | null) {
  if (!d) return '';
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function fmtMuteUntil(d?: string | null) {
  if (!d) return null;
  const ms = new Date(d).getTime() - Date.now();
  if (ms <= 0) return null;
  const until = new Date(d);
  if (until.getFullYear() >= 2099) return 'Always';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  return `${days}d`;
}
function fileNameFromUrl(url?: string | null) {
  if (!url) return 'File';
  try {
    const raw = decodeURIComponent(url.split('?')[0].split('/').pop() || 'File');
    return raw.replace(/^\d+_/, '');
  } catch { return 'File'; }
}
function safeLocalName(name: string) {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 120) || `file_${Date.now()}`;
}

type Member = {
  user_id: string;
  role: 'admin' | 'member';
  joined_at: string;
  profile: { id: string; full_name?: string; username?: string; avatar_url?: string } | null;
};

type MediaMsg = {
  id: string;
  media_url: string;
  media_type: 'image' | 'video' | 'gif';
  created_at: string;
  text?: string | null;
};

type FileMsg = {
  id: string;
  media_url: string;
  media_type: 'document';
  text: string | null;
  created_at: string;
};

const MUTE_PRESETS: { label: string; ms: number | null }[] = [
  { label: '1 hour',  ms: 60 * 60 * 1000 },
  { label: '8 hours', ms: 8 * 60 * 60 * 1000 },
  { label: '1 day',   ms: 24 * 60 * 60 * 1000 },
  { label: '1 week',  ms: 7 * 24 * 60 * 60 * 1000 },
  { label: 'Always',  ms: null },
];

type GalleryTab = 'media' | 'docs';

export default function GroupManagementScreen({ route, navigation }: any) {
  const { conversationId, groupName: initName, groupEmoji } = route.params ?? {};
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const myId = profile?.id ?? null;

  const [members, setMembers] = useState<Member[]>([]);
  const [groupName, setGroupName] = useState(initName || 'Group');
  const [description, setDescription] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [adminOnlyEdit, setAdminOnlyEdit] = useState(false);
  const [adminOnlyInvite, setAdminOnlyInvite] = useState(false);

  const [editingName, setEditingName] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [savingDesc, setSavingDesc] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<any[]>([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [mutedUntil, setMutedUntil] = useState<string | null>(null);
  const [muteSheetOpen, setMuteSheetOpen] = useState(false);

  const [media, setMedia] = useState<MediaMsg[]>([]);
  const [files, setFiles] = useState<FileMsg[]>([]);
  const [starredCount, setStarredCount] = useState(0);

  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryTab, setGalleryTab] = useState<GalleryTab>('media');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const canEditInfo = isAdmin || !adminOnlyEdit;
  const canAddMembers = isAdmin || !adminOnlyInvite;
  const muteLabel = useMemo(() => fmtMuteUntil(mutedUntil), [mutedUntil]);

  const viewerItems: MediaViewerItem[] = useMemo(
    () => media.map(m => ({
      id: m.id,
      url: m.media_url,
      kind: (m.media_type === 'gif' ? 'gif' : m.media_type === 'video' ? 'video' : 'image') as 'image'|'video'|'gif',
    })),
    [media]
  );

  const mediaCount = media.length;
  const videoCount = media.filter(m => m.media_type === 'video').length;
  const photoCount = mediaCount - videoCount;

  const loadAll = useCallback(async () => {
    if (!conversationId || !myId) return;
    setLoading(true);
    try {
      const [convRes, memberRes, settingsRes, starRes] = await Promise.all([
        supabase.from('conversations')
          .select('id, group_name, group_avatar_url, description, admin_only_edit, admin_only_invite')
          .eq('id', conversationId)
          .single(),
        supabase.from('conversation_members')
          .select('user_id, role, joined_at, profile:profiles!user_id(id, full_name, username, avatar_url)')
          .eq('conversation_id', conversationId)
          .order('role', { ascending: true }),
        supabase.from('conversation_settings')
          .select('muted_until')
          .eq('conversation_id', conversationId)
          .eq('user_id', myId)
          .maybeSingle(),
        supabase.from('starred_messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', conversationId),
      ]);

      const conv = convRes.data;
      if (conv) {
        setGroupName(conv.group_name || initName || 'Group');
        setAvatarUrl(conv.group_avatar_url || null);
        setDescription(conv.description || '');
        setDescDraft(conv.description || '');
        setAdminOnlyEdit(!!conv.admin_only_edit);
        setAdminOnlyInvite(!!conv.admin_only_invite);
      }

      const loadedMembers = (memberRes.data || []) as unknown as Member[];
      setMembers(loadedMembers);
      const me = loadedMembers.find(m => m.user_id === myId);
      setIsAdmin(me?.role === 'admin');

      setMutedUntil(settingsRes.data?.muted_until || null);
      setStarredCount((starRes as any)?.count || 0);
    } catch (e) {
      console.log('[GROUP_LOAD_ERR]', e);
    } finally {
      setLoading(false);
    }
  }, [conversationId, myId, initName]);

  const loadMediaAndFiles = useCallback(async () => {
    if (!conversationId) return;
    try {
      const { data } = await supabase
        .from('messages')
        .select('id, media_url, media_type, text, created_at')
        .eq('conversation_id', conversationId)
        .not('media_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(200);
      const rows = data || [];
      setMedia(rows.filter(r => r.media_type === 'image' || r.media_type === 'video' || r.media_type === 'gif') as MediaMsg[]);
      setFiles(rows.filter(r => r.media_type === 'document') as FileMsg[]);
    } catch (e) {
      console.log('[GROUP_MEDIA_LOAD_ERR]', e);
    }
  }, [conversationId]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadMediaAndFiles(); }, [loadMediaAndFiles]);

  const saveMediaDirectly = useCallback(async (m: MediaMsg) => {
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission required', 'Allow photo library access to save.');
        return;
      }
      const ext = m.media_type === 'video' ? 'mp4' : m.media_type === 'gif' ? 'gif' : 'jpg';
      const localPath = `${FileSystem.cacheDirectory}save_${Date.now()}.${ext}`;
      const { uri } = await FileSystem.downloadAsync(m.media_url, localPath);
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('Saved', 'Saved to your library.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not save');
    }
  }, []);

  const saveFileToDevice = useCallback(async (url: string, displayName: string) => {
    if (!url) return;
    try {
      const safeName = safeLocalName(displayName);
      const localPath = `${FileSystem.cacheDirectory}${Date.now()}_${safeName}`;
      const { uri } = await FileSystem.downloadAsync(url, localPath);
      await Share.share({ url: uri, message: safeName });
    } catch (e: any) {
      Alert.alert('Error', 'Could not save: ' + (e?.message || 'Unknown error'));
    }
  }, []);

  const showMediaLongPress = (idx: number) => {
    const m = media[idx];
    if (!m) return;
    const options = ['Save to device', 'Share link', 'Cancel'];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 2 },
        (choice) => {
          if (choice === 0) saveMediaDirectly(m);
          if (choice === 1) Share.share({ message: m.media_url });
        }
      );
    } else {
      Alert.alert('Media', undefined, [
        { text: 'Save to device', onPress: () => saveMediaDirectly(m) },
        { text: 'Share link', onPress: () => Share.share({ message: m.media_url }) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const showFileLongPress = (f: FileMsg) => {
    const name = f.text?.replace(/^📄\s*/, '') || fileNameFromUrl(f.media_url);
    const options = ['Save to device', 'Open', 'Share link', 'Cancel'];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 3 },
        (idx) => {
          if (idx === 0) saveFileToDevice(f.media_url, name);
          if (idx === 1 && f.media_url) Linking.openURL(f.media_url);
          if (idx === 2) Share.share({ message: f.media_url });
        }
      );
    } else {
      Alert.alert(name, undefined, [
        { text: 'Save to device', onPress: () => saveFileToDevice(f.media_url, name) },
        { text: 'Open', onPress: () => f.media_url && Linking.openURL(f.media_url) },
        { text: 'Share link', onPress: () => Share.share({ message: f.media_url }) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const openViewerAt = (idx: number) => {
    setViewerIndex(idx);
    setViewerOpen(true);
  };

  const pickGroupAvatar = async () => {
    if (!canEditInfo) { Alert.alert('Admins only', 'Only admins can change the group photo.'); return; }
    if (!myId) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission required', 'Allow photo access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as ImagePicker.MediaType[],
      quality: 0.9,
      allowsEditing: true,
      aspect: [1, 1],
      base64: false,
    });
    if (result.canceled || !result.assets?.[0]) return;

    setUploadingAvatar(true);
    try {
      const asset = result.assets[0];
      const { url } = await uploadMedia(
        'chat-media', myId,
        { uri: asset.uri, kind: 'image', ext: 'jpg', mimeType: 'image/jpeg', width: asset.width, height: asset.height, base64: null },
        { filename: `group_avatar_${conversationId}_${Date.now()}.jpg` }
      );
      const { error } = await supabase.from('conversations').update({ group_avatar_url: url }).eq('id', conversationId);
      if (error) throw error;
      setAvatarUrl(url);
    } catch (e: any) {
      Alert.alert('Error', 'Could not update group photo: ' + (e?.message || ''));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const saveGroupName = async () => {
    const trimmed = groupName.trim();
    if (!trimmed) return;
    if (!canEditInfo) { Alert.alert('Admins only', 'Only admins can rename.'); return; }
    setSavingName(true);
    try {
      const { error } = await supabase.from('conversations').update({
        group_name: trimmed,
        last_message: `Group renamed to "${trimmed}"`,
        last_message_time: new Date().toISOString(),
      }).eq('id', conversationId);
      if (error) throw error;
      setEditingName(false);
    } catch (e: any) { Alert.alert('Error', e?.message || ''); }
    finally { setSavingName(false); }
  };

  const saveDescription = async () => {
    if (!canEditInfo) { Alert.alert('Admins only', 'Only admins can edit.'); return; }
    const trimmed = descDraft.trim();
    setSavingDesc(true);
    try {
      const { error } = await supabase.from('conversations').update({ description: trimmed || null }).eq('id', conversationId);
      if (error) throw error;
      setDescription(trimmed);
      setEditingDesc(false);
    } catch (e: any) { Alert.alert('Error', e?.message || ''); }
    finally { setSavingDesc(false); }
  };

  const setPermission = async (field: 'admin_only_edit' | 'admin_only_invite', value: boolean) => {
    if (!isAdmin) return;
    const prev = field === 'admin_only_edit' ? adminOnlyEdit : adminOnlyInvite;
    if (field === 'admin_only_edit') setAdminOnlyEdit(value); else setAdminOnlyInvite(value);
    const { error } = await supabase.from('conversations').update({ [field]: value }).eq('id', conversationId);
    if (error) {
      if (field === 'admin_only_edit') setAdminOnlyEdit(prev); else setAdminOnlyInvite(prev);
      Alert.alert('Error', error.message);
    }
  };

  const applyMute = async (ms: number | null) => {
    if (!myId) return;
    setMuteSheetOpen(false);
    const until = ms === null
      ? new Date('2099-01-01T00:00:00Z').toISOString()
      : new Date(Date.now() + ms).toISOString();
    setMutedUntil(until);
    const { error } = await supabase.from('conversation_settings')
      .upsert({ conversation_id: conversationId, user_id: myId, is_muted: true, muted_until: until, updated_at: new Date().toISOString() },
        { onConflict: 'conversation_id,user_id' });
    if (error) { setMutedUntil(null); Alert.alert('Error', error.message); }
  };

  const unmute = async () => {
    if (!myId) return;
    setMuteSheetOpen(false);
    setMutedUntil(null);
    await supabase.from('conversation_settings').upsert(
      { conversation_id: conversationId, user_id: myId, is_muted: false, muted_until: null, updated_at: new Date().toISOString() },
      { onConflict: 'conversation_id,user_id' }
    );
  };

  const toggleAdmin = async (member: Member) => {
    if (!isAdmin || member.user_id === myId) return;
    const newRole = member.role === 'admin' ? 'member' : 'admin';
    const { error } = await supabase.from('conversation_members').update({ role: newRole })
      .eq('conversation_id', conversationId).eq('user_id', member.user_id);
    if (!error) setMembers(prev => prev.map(m => m.user_id === member.user_id ? { ...m, role: newRole } : m));
    else Alert.alert('Error', error.message);
  };

  const removeMember = (member: Member) => {
    if (!isAdmin || member.user_id === myId) return;
    Alert.alert('Remove member?', `Remove ${member.profile?.full_name || 'this user'}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('conversation_members').delete().eq('conversation_id', conversationId).eq('user_id', member.user_id);
        if (error) { Alert.alert('Could not remove', error.message); return; }
        setMembers(prev => prev.filter(m => m.user_id !== member.user_id));
      }},
    ]);
  };

  const leaveGroup = () => {
    Alert.alert('Leave group?', 'You will stop receiving messages.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
        await supabase.from('conversation_members').delete().eq('conversation_id', conversationId).eq('user_id', myId);
        navigation.popToTop();
      }},
    ]);
  };

  const searchForAdd = async (q: string) => {
    setSearchQuery(q);
    if (q.length < 2) { setSearchResult([]); return; }
    const existingIds = members.map(m => m.user_id);
    const excludeClause = existingIds.length
      ? `(${existingIds.join(',')})`
      : '(00000000-0000-0000-0000-000000000000)';
    const { data } = await supabase.from('profiles')
      .select('id, full_name, username, avatar_url')
      .or(`full_name.ilike.%${q}%,username.ilike.%${q}%`)
      .not('id', 'in', excludeClause)
      .limit(8);
    setSearchResult(data || []);
  };

  const addMember = async (user: any) => {
    if (!canAddMembers) { Alert.alert('Admins only', 'Only admins can add members.'); return; }
    const { error } = await supabase.from('conversation_members').insert({ conversation_id: conversationId, user_id: user.id, role: 'member' });
    if (error) { Alert.alert('Error', error.message); return; }
    setMembers(prev => [...prev, { user_id: user.id, role: 'member', joined_at: new Date().toISOString(), profile: user }]);
    setSearchQuery(''); setSearchResult([]); setShowAddMember(false);
  };

  const previewThumbs = media.slice(0, 6);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="chevron-left" size={26} color={NAVY} />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>Group Info</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.hero}>
          <TouchableOpacity onPress={pickGroupAvatar} disabled={!canEditInfo || uploadingAvatar} activeOpacity={0.85}>
            <View style={s.heroAvatarWrap}>
              {uploadingAvatar ? (
                <View style={s.heroAvatar}><ActivityIndicator color="#FFF" /></View>
              ) : avatarUrl ? (
                <ExpoImage source={{ uri: avatarUrl }} style={s.heroAvatar} contentFit="cover" />
              ) : (
                <View style={[s.heroAvatar, { backgroundColor: NAVY }]}>
                  <Text style={{ fontSize: 44, color: '#FFF' }}>{groupEmoji || '💬'}</Text>
                </View>
              )}
              {canEditInfo && (
                <View style={s.cameraOverlay}>
                  <Feather name="camera" size={15} color="#FFF" />
                </View>
              )}
            </View>
          </TouchableOpacity>

          {editingName && canEditInfo ? (
            <View style={s.nameEdit}>
              <TextInput
                value={groupName} onChangeText={setGroupName}
                style={s.nameInput} autoFocus selectTextOnFocus
                returnKeyType="done" onSubmitEditing={saveGroupName}
                maxLength={60}
              />
              <TouchableOpacity onPress={saveGroupName} disabled={savingName} style={s.saveNameBtn}>
                {savingName ? <ActivityIndicator color="#FFF" size={14} /> : <Text style={s.saveNameTxt}>Save</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setEditingName(false); setGroupName(initName || 'Group'); }}>
                <Text style={s.cancelNameTxt}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => canEditInfo && setEditingName(true)}
              style={s.nameRow}
              activeOpacity={canEditInfo ? 0.7 : 1}
            >
              <Text style={s.heroName} numberOfLines={2}>{groupName}</Text>
              {canEditInfo && <Feather name="edit-2" size={14} color={TEXT_SECONDARY} style={{ marginLeft: 8 }} />}
            </TouchableOpacity>
          )}
          <Text style={s.heroSub}>{members.length} {members.length === 1 ? 'member' : 'members'}</Text>

          <View style={s.heroActions}>
            <TouchableOpacity style={s.heroAction} activeOpacity={0.7}
              onPress={() => navigation.goBack()}>
              <View style={s.heroActionInner}><Feather name="message-circle" size={20} color={NAVY} /></View>
              <Text style={s.heroActionLbl}>Message</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.heroAction} activeOpacity={0.7}
              onPress={() => setShowAddMember(p => !p)}>
              <View style={s.heroActionInner}><Feather name="user-plus" size={20} color={NAVY} /></View>
              <Text style={s.heroActionLbl}>Invite</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.heroAction} activeOpacity={0.7}
              onPress={() => setMuteSheetOpen(true)}>
              <View style={s.heroActionInner}><Feather name={muteLabel ? 'bell-off' : 'bell'} size={20} color={NAVY} /></View>
              <Text style={s.heroActionLbl}>{muteLabel ? 'Muted' : 'Mute'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {(description || canEditInfo) && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Description</Text>
            {editingDesc ? (
              <View>
                <TextInput
                  value={descDraft}
                  onChangeText={setDescDraft}
                  style={s.descInput}
                  placeholder="What is this group about?"
                  placeholderTextColor="#9CA3AF"
                  multiline
                  maxLength={500}
                  autoFocus
                  textAlignVertical="top"
                />
                <View style={s.descActions}>
                  <TouchableOpacity style={s.descCancel} onPress={() => { setEditingDesc(false); setDescDraft(description); }}>
                    <Text style={s.descCancelTxt}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.descSave} onPress={saveDescription} disabled={savingDesc}>
                    {savingDesc ? <ActivityIndicator size={14} color="#FFF" /> : <Text style={s.descSaveTxt}>Save</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                disabled={!canEditInfo}
                onPress={() => { setDescDraft(description); setEditingDesc(true); }}
                activeOpacity={canEditInfo ? 0.7 : 1}
              >
                {description
                  ? <Text style={s.descText}>{description}</Text>
                  : <Text style={s.descEmpty}>Add a description</Text>}
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={s.section}>
          <View style={s.sectionHeaderRow}>
            <Text style={s.sectionTitle}>Members · {members.length}</Text>
            {canAddMembers && (
              <TouchableOpacity onPress={() => setShowAddMember(p => !p)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={s.sectionAction}>{showAddMember ? 'Done' : 'Add'}</Text>
              </TouchableOpacity>
            )}
          </View>

          {showAddMember && canAddMembers && (
            <View style={{ paddingBottom: 8 }}>
              <View style={s.addSearchWrap}>
                <Feather name="search" size={14} color={TEXT_SECONDARY} />
                <TextInput
                  value={searchQuery}
                  onChangeText={searchForAdd}
                  placeholder="Search by name or username..."
                  placeholderTextColor="#9CA3AF"
                  style={s.addSearchInput}
                  autoFocus
                />
              </View>
              {searchResult.map(u => (
                <TouchableOpacity key={u.id} style={s.memberRow} onPress={() => addMember(u)} activeOpacity={0.7}>
                  {u.avatar_url
                    ? <Image source={{ uri: u.avatar_url }} style={s.memberAvatar} />
                    : <View style={[s.memberAvatar, { backgroundColor: avatarBg(u.id), alignItems: 'center', justifyContent: 'center' }]}>
                        <Text style={s.memberAvatarTxt}>{initials(u.full_name)}</Text>
                      </View>}
                  <View style={s.memberInfo}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={[s.memberName, { flexShrink: 1 }]}>{u.full_name || u.username}</Text>
                      <VerifiedBadge userId={u.id} size={12} />
                    </View>
                    {u.username && <Text style={s.memberHandle}>@{u.username}</Text>}
                  </View>
                  <View style={s.addBtnSmall}>
                    <Feather name="plus" size={16} color="#FFF" />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {loading ? <ActivityIndicator color={NAVY} style={{ marginVertical: 16 }} /> : (
            <View>
              {members.slice(0, 8).map((m) => (
                <View key={m.user_id} style={s.memberRow}>
                  {m.profile?.avatar_url
                    ? <Image source={{ uri: m.profile.avatar_url }} style={s.memberAvatar} />
                    : <View style={[s.memberAvatar, { backgroundColor: avatarBg(m.user_id), alignItems: 'center', justifyContent: 'center' }]}>
                        <Text style={s.memberAvatarTxt}>{initials(m.profile?.full_name)}</Text>
                      </View>}
                  <View style={s.memberInfo}>
                    <Text style={s.memberName} numberOfLines={1}>
                      {m.profile?.full_name || 'Member'}{m.user_id === myId ? ' (you)' : ''}
                    </Text>
                    {m.profile?.username ? <Text style={s.memberHandle}>@{m.profile.username}</Text> : null}
                  </View>
                  {m.role === 'admin' && <View style={s.adminBadge}><Text style={s.adminBadgeTxt}>Admin</Text></View>}
                  {isAdmin && m.user_id !== myId && (
                    <TouchableOpacity
                      style={s.memberMenuBtn}
                      onPress={() => {
                        const options = [
                          m.role === 'admin' ? 'Demote to member' : 'Make admin',
                          'Remove from group',
                          'Cancel',
                        ];
                        if (Platform.OS === 'ios') {
                          ActionSheetIOS.showActionSheetWithOptions(
                            { options, cancelButtonIndex: 2, destructiveButtonIndex: 1 },
                            (i) => {
                              if (i === 0) toggleAdmin(m);
                              if (i === 1) removeMember(m);
                            }
                          );
                        } else {
                          Alert.alert(m.profile?.full_name || 'Member', undefined, [
                            { text: m.role === 'admin' ? 'Demote' : 'Make admin', onPress: () => toggleAdmin(m) },
                            { text: 'Remove', style: 'destructive', onPress: () => removeMember(m) },
                            { text: 'Cancel', style: 'cancel' },
                          ]);
                        }
                      }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Feather name="more-horizontal" size={18} color={TEXT_SECONDARY} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {members.length > 8 && (
                <TouchableOpacity style={s.seeAllBtn} onPress={() => { /* stay on screen, already showing */ }}>
                  <Text style={s.seeAllTxt}>See all {members.length} members</Text>
                  <Feather name="chevron-right" size={16} color={NAVY} />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {previewThumbs.length > 0 && (
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <Text style={s.sectionTitle}>Shared Media</Text>
              <TouchableOpacity onPress={() => { setGalleryTab('media'); setGalleryOpen(true); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={s.sectionAction}>See all</Text>
              </TouchableOpacity>
            </View>
            <View style={s.previewStrip}>
              {previewThumbs.map((m, i) => (
                <Pressable
                  key={m.id}
                  style={s.previewTile}
                  onPress={() => openViewerAt(i)}
                >
                  <ExpoImage source={{ uri: m.media_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                  {m.media_type === 'video' && (
                    <View style={s.videoPlayBadge} pointerEvents="none">
                      <Feather name="play" size={10} color="#FFF" />
                    </View>
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {files.length > 0 && (
          <TouchableOpacity style={s.section} activeOpacity={0.7}
            onPress={() => { setGalleryTab('docs'); setGalleryOpen(true); }}>
            <View style={s.listRow}>
              <View style={s.listIconBg}>
                <Feather name="file-text" size={18} color={NAVY} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.listLabel}>Shared Files</Text>
                <Text style={s.listMeta}>{files.length} {files.length === 1 ? 'document' : 'documents'}</Text>
              </View>
              <Feather name="chevron-right" size={18} color="#C6C6C8" />
            </View>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={s.section} activeOpacity={0.7}
          onPress={() => navigation.navigate('StarredMessages', { conversationId })}>
          <View style={s.listRow}>
            <View style={s.listIconBg}>
              <Feather name="star" size={18} color={NAVY} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.listLabel}>Starred Messages</Text>
              <Text style={s.listMeta}>{starredCount > 0 ? `${starredCount} starred` : 'None yet'}</Text>
            </View>
            <Feather name="chevron-right" size={18} color="#C6C6C8" />
          </View>
        </TouchableOpacity>

        {isAdmin && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Group Permissions</Text>
            <ToggleRow
              label="Only admins can edit group info"
              sub="Name, photo, description"
              value={adminOnlyEdit}
              onChange={(v) => setPermission('admin_only_edit', v)}
            />
            <View style={s.divider} />
            <ToggleRow
              label="Only admins can add members"
              sub="Restricts who can invite others"
              value={adminOnlyInvite}
              onChange={(v) => setPermission('admin_only_invite', v)}
            />
          </View>
        )}

        <TouchableOpacity style={s.leaveBtn} onPress={leaveGroup} activeOpacity={0.85}>
          <Feather name="log-out" size={17} color="#DC2626" />
          <Text style={s.leaveBtnTxt}>Leave group</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={muteSheetOpen} transparent animationType="slide" onRequestClose={() => setMuteSheetOpen(false)}>
        <TouchableOpacity style={s.sheetBackdrop} activeOpacity={1} onPress={() => setMuteSheetOpen(false)} />
        <View style={s.sheet}>
          <View style={s.sheetHandle} />
          <Text style={s.sheetTitle}>
            {mutedUntil ? 'Change mute duration' : 'Mute notifications'}
          </Text>
          {MUTE_PRESETS.map(p => (
            <TouchableOpacity key={p.label} style={s.sheetRow} onPress={() => applyMute(p.ms)}>
              <Text style={s.sheetRowTxt}>{p.label}</Text>
            </TouchableOpacity>
          ))}
          {mutedUntil && (
            <TouchableOpacity style={[s.sheetRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIRLINE }]} onPress={unmute}>
              <Text style={[s.sheetRowTxt, { color: '#DC2626', fontWeight: '700' }]}>Unmute</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.sheetClose} onPress={() => setMuteSheetOpen(false)}>
            <Text style={s.sheetCloseTxt}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal visible={galleryOpen} animationType="slide" onRequestClose={() => setGalleryOpen(false)}>
        <SafeAreaView style={s.gallerySafe} edges={['top']}>
          <View style={s.galleryHeader}>
            <TouchableOpacity onPress={() => setGalleryOpen(false)} style={s.backBtn} activeOpacity={0.7}>
              <Feather name="chevron-left" size={26} color={NAVY} />
            </TouchableOpacity>
            <View style={s.galleryTabs}>
              <Pressable
                onPress={() => setGalleryTab('media')}
                style={[s.galleryTab, galleryTab === 'media' && s.galleryTabActive]}
              >
                <Text style={[s.galleryTabTxt, galleryTab === 'media' && s.galleryTabTxtActive]}>Media</Text>
              </Pressable>
              <Pressable
                onPress={() => setGalleryTab('docs')}
                style={[s.galleryTab, galleryTab === 'docs' && s.galleryTabActive]}
              >
                <Text style={[s.galleryTabTxt, galleryTab === 'docs' && s.galleryTabTxtActive]}>Docs</Text>
              </Pressable>
            </View>
            <View style={{ width: 40 }} />
          </View>

          {galleryTab === 'media' ? (
            media.length === 0 ? (
              <View style={s.galleryEmpty}>
                <Feather name="image" size={44} color="#D1D5DB" />
                <Text style={s.galleryEmptyTxt}>No shared photos or videos</Text>
              </View>
            ) : (
              <FlatList
                data={media}
                keyExtractor={(it) => it.id}
                numColumns={4}
                columnWrapperStyle={{ gap: GALLERY_GAP, marginBottom: GALLERY_GAP }}
                contentContainerStyle={{ paddingBottom: 24 }}
                renderItem={({ item, index: idx }) => (
                  <Pressable
                    style={s.galleryTile}
                    onPress={() => openViewerAt(idx)}
                    onLongPress={() => showMediaLongPress(idx)}
                    delayLongPress={280}
                  >
                    <ExpoImage source={{ uri: item.media_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                    {item.media_type === 'video' && (
                      <View style={s.galleryVideoBadge} pointerEvents="none">
                        <Feather name="video" size={12} color="#FFF" />
                      </View>
                    )}
                    {item.media_type === 'gif' && (
                      <View style={s.galleryGifBadge} pointerEvents="none">
                        <Text style={s.galleryGifTxt}>GIF</Text>
                      </View>
                    )}
                  </Pressable>
                )}
                ListFooterComponent={
                  <Text style={s.galleryFooter}>
                    {photoCount} {photoCount === 1 ? 'Photo' : 'Photos'}
                    {videoCount > 0 ? `, ${videoCount} ${videoCount === 1 ? 'Video' : 'Videos'}` : ''}
                  </Text>
                }
              />
            )
          ) : (
            files.length === 0 ? (
              <View style={s.galleryEmpty}>
                <Feather name="file" size={44} color="#D1D5DB" />
                <Text style={s.galleryEmptyTxt}>No shared documents</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ paddingHorizontal: 16 }}>
                {files.map(f => {
                  const name = f.text?.replace(/^📄\s*/, '') || fileNameFromUrl(f.media_url);
                  return (
                    <Pressable
                      key={f.id}
                      style={s.fileRow}
                      onPress={() => f.media_url && Linking.openURL(f.media_url)}
                      onLongPress={() => showFileLongPress(f)}
                      delayLongPress={280}
                    >
                      <View style={s.fileIcon}>
                        <Feather name="file-text" size={20} color={NAVY} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.fileName} numberOfLines={1}>{name}</Text>
                        <Text style={s.fileMeta}>{fmtDate(f.created_at)}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => saveFileToDevice(f.media_url, name)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Feather name="download" size={18} color={NAVY} />
                      </TouchableOpacity>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )
          )}
        </SafeAreaView>
      </Modal>

      <MediaViewer
        visible={viewerOpen}
        items={viewerItems}
        initialIndex={viewerIndex}
        onClose={() => setViewerOpen(false)}
      />
    </SafeAreaView>
  );
}

function ToggleRow({ label, sub, value, onChange }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <TouchableOpacity style={s.toggleRow} onPress={() => onChange(!value)} activeOpacity={0.75}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={s.toggleLabel}>{label}</Text>
        {sub ? <Text style={s.toggleSub}>{sub}</Text> : null}
      </View>
      <View style={[s.switch, value && s.switchOn]}>
        <View style={[s.switchThumb, value && s.switchThumbOn]} />
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG_GREY },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE,
  },
  headerTitle: { fontSize: 16, fontWeight: '600', color: TEXT_PRIMARY, flex: 1, textAlign: 'center' },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  hero: {
    alignItems: 'center',
    paddingTop: 28, paddingHorizontal: 20, paddingBottom: 24,
    gap: 8, backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE,
  },
  heroAvatarWrap: { position: 'relative' },
  heroAvatar: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cameraOverlay: { position: 'absolute', bottom: 0, right: 0, width: 32, height: 32, borderRadius: 16, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#FFFFFF' },
  nameRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 10 },
  heroName: { fontSize: 24, fontWeight: '700', color: TEXT_PRIMARY, textAlign: 'center', letterSpacing: -0.4 },
  heroSub: { fontSize: 13, color: TEXT_SECONDARY, marginTop: 2 },
  nameEdit: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, alignSelf: 'stretch', marginTop: 8 },
  nameInput: { flex: 1, fontSize: 20, fontWeight: '700', color: TEXT_PRIMARY, borderBottomWidth: 2, borderBottomColor: NAVY, paddingVertical: 4, textAlign: 'center' },
  saveNameBtn: { backgroundColor: NAVY, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  saveNameTxt: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  cancelNameTxt: { color: TEXT_SECONDARY, fontWeight: '600', fontSize: 13, paddingHorizontal: 4 },

  heroActions: { flexDirection: 'row', gap: 20, marginTop: 20 },
  heroAction: { alignItems: 'center', gap: 6, minWidth: 64 },
  heroActionInner: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  heroActionLbl: { fontSize: 11, fontWeight: '500', color: TEXT_PRIMARY },

  section: {
    backgroundColor: '#FFFFFF',
    marginTop: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE, borderBottomColor: HAIRLINE,
  },
  sectionTitle: { fontSize: 11, fontWeight: '600', color: TEXT_SECONDARY, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  sectionAction: { fontSize: 13, fontWeight: '600', color: NAVY },

  descInput: { minHeight: 80, maxHeight: 180, padding: 12, fontSize: 15, color: TEXT_PRIMARY, lineHeight: 21, backgroundColor: BG_GREY, borderRadius: 10 },
  descActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 },
  descCancel: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#F3F4F6' },
  descCancelTxt: { color: '#374151', fontWeight: '600', fontSize: 13 },
  descSave: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: NAVY, minWidth: 70, alignItems: 'center' },
  descSaveTxt: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  descText: { fontSize: 14, color: '#3C3C43', lineHeight: 21 },
  descEmpty: { fontSize: 14, color: NAVY, fontWeight: '500' },

  addSearchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: BG_GREY, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 8 },
  addSearchInput: { flex: 1, fontSize: 14, color: TEXT_PRIMARY, padding: 0 },
  addBtnSmall: { width: 30, height: 30, borderRadius: 15, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },

  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  memberAvatar: { width: 40, height: 40, borderRadius: 20 },
  memberAvatarTxt: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 14, fontWeight: '500', color: TEXT_PRIMARY },
  memberHandle: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 1 },
  adminBadge: { backgroundColor: NAVY, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginRight: 4 },
  adminBadgeTxt: { fontSize: 10, color: '#FFF', fontWeight: '700', letterSpacing: 0.3 },
  memberMenuBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },

  seeAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F0F0F0' },
  seeAllTxt: { fontSize: 13, fontWeight: '600', color: NAVY },

  previewStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: PREVIEW_GAP },
  previewTile: { width: PREVIEW_TILE, height: PREVIEW_TILE, borderRadius: 8, overflow: 'hidden', backgroundColor: '#F3F4F6' },
  videoPlayBadge: { position: 'absolute', bottom: 4, left: 4, width: 16, height: 16, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },

  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 2 },
  listIconBg: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(11,30,61,0.08)', alignItems: 'center', justifyContent: 'center' },
  listLabel: { fontSize: 14, fontWeight: '500', color: TEXT_PRIMARY },
  listMeta: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 2 },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#F0F0F0', marginVertical: 4 },

  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  toggleLabel: { fontSize: 14, fontWeight: '500', color: TEXT_PRIMARY },
  toggleSub: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 2 },
  switch: { width: 46, height: 28, borderRadius: 14, backgroundColor: '#E5E7EB', padding: 2, justifyContent: 'center' },
  switchOn: { backgroundColor: '#34C759' },
  switchThumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFF' },
  switchThumbOn: { transform: [{ translateX: 18 }] },

  leaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginHorizontal: 16, marginTop: 18, backgroundColor: '#FFF', borderRadius: 14, paddingVertical: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE },
  leaveBtnTxt: { fontSize: 15, fontWeight: '600', color: '#DC2626' },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#FFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: 34 },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D1D5DB', marginTop: 10, marginBottom: 8 },
  sheetTitle: { fontSize: 15, fontWeight: '700', color: TEXT_PRIMARY, textAlign: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F3F4F6' },
  sheetRow: { paddingVertical: 16, paddingHorizontal: 24 },
  sheetRowTxt: { fontSize: 15, color: TEXT_PRIMARY },
  sheetClose: { marginTop: 6, marginHorizontal: 16, paddingVertical: 14, backgroundColor: BG_GREY, borderRadius: 12, alignItems: 'center' },
  sheetCloseTxt: { color: '#374151', fontWeight: '700', fontSize: 14 },

  gallerySafe: { flex: 1, backgroundColor: '#FFF' },
  galleryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE },
  galleryTabs: { flexDirection: 'row', gap: 4, backgroundColor: BG_GREY, borderRadius: 10, padding: 3 },
  galleryTab: { paddingHorizontal: 18, paddingVertical: 7, borderRadius: 8 },
  galleryTabActive: { backgroundColor: '#FFF' },
  galleryTabTxt: { fontSize: 13, fontWeight: '600', color: TEXT_SECONDARY },
  galleryTabTxtActive: { color: NAVY },
  galleryTile: { width: GALLERY_TILE, height: GALLERY_TILE, backgroundColor: '#F3F4F6', overflow: 'hidden' },
  galleryVideoBadge: { position: 'absolute', bottom: 4, left: 4, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  galleryGifBadge: { position: 'absolute', bottom: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  galleryGifTxt: { color: '#FFF', fontSize: 10, fontWeight: '700' },
  galleryEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  galleryEmptyTxt: { fontSize: 15, color: '#9CA3AF' },
  galleryFooter: { textAlign: 'center', fontSize: 13, color: TEXT_SECONDARY, paddingVertical: 18 },

  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F3F4F6' },
  fileIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(11,30,61,0.08)', alignItems: 'center', justifyContent: 'center' },
  fileName: { fontSize: 14, fontWeight: '600', color: TEXT_PRIMARY },
  fileMeta: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 2 },
});