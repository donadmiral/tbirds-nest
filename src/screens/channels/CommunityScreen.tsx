import VerifiedBadge from '../../components/VerifiedBadge';
import TierName from '../../components/TierName';
import { themedSheet } from '../../theme/useTheme';
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, ActivityIndicator, Modal, Alert, KeyboardAvoidingView, Platform, ScrollView, Share } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { uploadMedia } from '../../services/mediaService';
import { CATEGORIES } from '../../constants/categories';
import { COMM_COLORS } from './ChannelsScreen';
import PeoplePickerSheet from '../../components/PeoplePickerSheet';

const NAVY = '#0B1E3D';

function relTime(iso?: string) {
  if (!iso) return '';
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return 'now';
  if (m < 60) return String(m) + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return String(h) + 'h';
  return String(Math.floor(h / 24)) + 'd';
}

export default function CommunityScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { communityId, name: name0, coverColor: color0, iconUrl: icon0, memberCount: mc0, myRole: role0, isMember: mem0 } = (route.params || {}) as any;
  const me = useAuthStore(st => st.profile) as any;
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<any>({ name: name0 || 'Community', cover_color: color0 || 'sky', icon_url: icon0 || null, member_count: mc0 || 0, my_role: role0 || null, is_member: !!mem0, has_pending: false, join_mode: 'open', rules: null, description: null, category: null });
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [attach, setAttach] = useState<{ uri: string; ext: string; mime: string; width?: number; height?: number } | null>(null);
  const [posting, setPosting] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [requests, setRequests] = useState<any[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [eName, setEName] = useState('');
  const [eDesc, setEDesc] = useState('');
  const [eRules, setERules] = useState('');
  const [eMode, setEMode] = useState<'open' | 'approval' | 'invite'>('open');
  const [eColor, setEColor] = useState('sky');
  const [eCat, setECat] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [iconBusy, setIconBusy] = useState(false);
  // Membership machine: invitations, announcements, sub-groups, limited and removed members.
  const [inviteOpen, setInviteOpen] = useState(false);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [annOpen, setAnnOpen] = useState(false);
  const [annDraft, setAnnDraft] = useState('');
  const [subs, setSubs] = useState<any[]>([]);
  const [subOpen, setSubOpen] = useState(false);
  const [subName, setSubName] = useState('');
  const [subDesc, setSubDesc] = useState('');
  const [subMode, setSubMode] = useState<'open' | 'approval' | 'invite'>('open');
  const [subBusy, setSubBusy] = useState(false);
  const [bansOpen, setBansOpen] = useState(false);
  const [bans, setBans] = useState<any[]>([]);
  const [invitesOpen, setInvitesOpen] = useState(false);
  const [invites, setInvites] = useState<any[]>([]);

  const isMember = !!info.is_member;
  const myRole = info.my_role as string | null;
  const isMod = myRole === 'owner' || myRole === 'moderator';
  const band = COMM_COLORS[info.cover_color] || COMM_COLORS.sky;

  const loadInfo = useCallback(async () => {
    const { data } = await supabase.rpc('get_community', { p_community: communityId });
    const row = Array.isArray(data) ? data[0] : data;
    if (row) {
      setInfo(row);
      setEName(row.name || ''); setEDesc(row.description || ''); setERules(row.rules || '');
      setEMode(row.join_mode || 'open'); setEColor(row.cover_color || 'sky'); setECat(row.category || null);
    }
  }, [communityId]);

  const loadPosts = useCallback(async (cursor?: string | null) => {
    const { data, error } = await supabase.rpc('get_community_posts', { p_community: communityId, p_cursor: cursor ?? null, p_limit: 25 });
    if (error) { setPosts([]); return; }
    const rows = data || [];
    if (cursor) {
      setPosts(prev => {
        const seen = new Set(prev.map((p: any) => p.post_id));
        return [...prev, ...rows.filter((r: any) => !seen.has(r.post_id))];
      });
    } else setPosts(rows);
  }, [communityId]);

  useEffect(() => {
    (async () => {
      await loadInfo();
      setLoading(false);
    })();
  }, [loadInfo]);

  useEffect(() => { if (isMember) void loadPosts(null); }, [isMember, loadPosts]);

  const loadExtras = useCallback(async () => {
    const [{ data: an }, { data: sb }] = await Promise.all([
      supabase.rpc('get_community_announcements', { p_community: communityId, p_limit: 20 }),
      supabase.rpc('get_sub_communities', { p_community: communityId, p_limit: 30 }),
    ]);
    setAnnouncements(an || []); setSubs(sb || []);
  }, [communityId]);
  useEffect(() => { if (isMember) void loadExtras(); }, [isMember, loadExtras]);

  const respondInvite = async (accept: boolean) => {
    try {
      const { data, error } = await supabase.rpc('respond_community_invite', { p_community: communityId, p_accept: accept });
      if (error) throw error;
      if (data === 'joined') setInfo((p: any) => ({ ...p, is_member: true, my_role: p.my_role || 'member', my_status: 'active', has_invite: false, member_count: (p.member_count || 0) + 1 }));
      else setInfo((p: any) => ({ ...p, has_invite: false }));
    } catch (e: any) { Alert.alert('Could not respond', e?.message || 'Please try again.'); }
  };
  const invitePerson = async (p: { id: string; full_name: string | null; username: string | null }) => {
    const { error } = await supabase.rpc('invite_to_community', { p_community: communityId, p_user: p.id });
    if (error) { Alert.alert('Could not invite', error.message); return; }
    Alert.alert('Invitation sent', (p.full_name || p.username || 'They') + ' will see it in their notifications.');
  };
  const shareInviteLink = async (fresh = false) => {
    try {
      let token: string | null = null;
      if (!fresh) {
        const { data } = await supabase.rpc('get_community_invite_link', { p_community: communityId });
        const row = Array.isArray(data) ? data[0] : data;
        token = row?.token || null;
      }
      if (!token) {
        const { data, error } = await supabase.rpc('create_community_invite_link', { p_community: communityId, p_expires_days: 7, p_max_uses: null });
        if (error) throw error;
        token = String(data);
      }
      const url = 'https://platinumcircles.app/communities/join/' + token;
      await Share.share({ message: 'Join ' + (info.name || 'my community') + ' on Platinum Circles: ' + url, url });
    } catch (e: any) { Alert.alert('Could not make a link', e?.message || 'Please try again.'); }
  };
  const openInvites = async () => {
    setInvitesOpen(true);
    const { data } = await supabase.rpc('get_community_invites', { p_community: communityId, p_limit: 60 });
    setInvites(data || []);
  };
  const inviteMenu = () => {
    Alert.alert('Invite people', 'An invitation always admits, even when the community is invite only.', [
      { text: 'Pick people', onPress: () => setInviteOpen(true) },
      { text: 'Share invite link', onPress: () => void shareInviteLink(false) },
      { text: 'New invite link (the old one stops working)', onPress: () => void shareInviteLink(true) },
      { text: 'Pending invitations', onPress: () => void openInvites() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };
  const revokeInvite = async (r: any) => {
    const { error } = await supabase.rpc('revoke_community_invite', { p_community: communityId, p_user: r.user_id });
    if (error) { Alert.alert('Failed', error.message); return; }
    setInvites(prev => prev.filter(x => x.user_id !== r.user_id));
  };
  const postAnnouncement = async () => {
    const body = annDraft.trim(); if (!body) return;
    const { error } = await supabase.rpc('post_community_announcement', { p_community: communityId, p_body: body });
    if (error) { Alert.alert('Could not post', error.message); return; }
    setAnnDraft(''); setAnnOpen(false); void loadExtras();
  };
  const deleteAnnouncement = (a: any) => {
    Alert.alert('Remove this announcement?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { await supabase.rpc('delete_community_announcement', { p_id: a.id }); setAnnouncements(prev => prev.filter(x => x.id !== a.id)); } },
    ]);
  };
  const createSub = async () => {
    const nm = subName.trim(); if (nm.length < 3 || subBusy) return;
    setSubBusy(true);
    try {
      const { data, error } = await supabase.rpc('create_sub_community', { p_parent: communityId, p_name: nm, p_description: subDesc.trim() || null, p_join_mode: subMode, p_cover_color: info.cover_color || 'sky' });
      if (error) throw error;
      setSubOpen(false); setSubName(''); setSubDesc(''); setSubMode('open');
      await loadExtras();
      navigation.navigate('Community', { communityId: data, name: nm, coverColor: info.cover_color, isMember: true, myRole: 'owner' });
    } catch (e: any) { Alert.alert('Could not create', e?.message || 'Please try again.'); }
    finally { setSubBusy(false); }
  };
  const openBans = async () => {
    setBansOpen(true);
    const { data } = await supabase.rpc('get_community_bans', { p_community: communityId, p_limit: 60 });
    setBans(data || []);
  };
  const unban = async (b: any) => {
    const { error } = await supabase.rpc('unban_community_member', { p_community: communityId, p_user: b.user_id });
    if (error) { Alert.alert('Failed', error.message); return; }
    setBans(prev => prev.filter(x => x.user_id !== b.user_id));
  };
  const applyStatus = async (m: any, status: 'active' | 'limited') => {
    const { error } = await supabase.rpc('set_community_member_status', { p_community: communityId, p_user: m.user_id, p_status: status });
    if (error) { Alert.alert('Could not update', error.message); return; }
    setMembers(prev => prev.map(x => x.user_id === m.user_id ? { ...x, status } : x));
  };
  const removeMember = async (m: any, ban: boolean) => {
    const { error } = await supabase.rpc('remove_community_member', { p_community: communityId, p_user: m.user_id, p_ban: ban, p_reason: null });
    if (error) { Alert.alert('Could not remove', error.message); return; }
    setMembers(prev => prev.filter(x => x.user_id !== m.user_id));
    setInfo((p: any) => ({ ...p, member_count: Math.max((p.member_count || 1) - 1, 0) }));
  };
  // Every community keeps one group chat in Messages; this opens it from the community itself.
  const openChat = async () => {
    const { data, error } = await supabase.rpc('get_community_conversation', { p_community: communityId });
    if (error || !data) { Alert.alert('Could not open the chat', error?.message || 'Please try again.'); return; }
    navigation.navigate('Chat', { conversationId: data, isGroup: true, groupName: info.name, groupAvatarUrl: info.icon_url || null, groupType: 'community', groupRefId: communityId });
  };
  const deleteCommunity = () => {
    Alert.alert('Delete this community?', 'Members lose access, the posts stop showing and the chat closes. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const { error } = await supabase.rpc('delete_community', { p_community: communityId });
        if (error) { Alert.alert('Could not delete', error.message); return; }
        setSettingsOpen(false);
        navigation.goBack();
      } },
    ]);
  };

  const join = async () => {
    try {
      const { data, error } = await supabase.rpc('join_community', { p_community: communityId });
      if (error) throw error;
      if (data === 'joined') setInfo((p: any) => ({ ...p, is_member: true, my_role: p.my_role || 'member', member_count: (p.member_count || 0) + 1 }));
      else setInfo((p: any) => ({ ...p, has_pending: true }));
    } catch (e: any) { Alert.alert('Could not join', e?.message || 'Please try again.'); }
  };

  const cancelRequest = async () => {
    await supabase.rpc('cancel_join_request', { p_community: communityId });
    setInfo((p: any) => ({ ...p, has_pending: false }));
  };

  const leave = () => {
    Alert.alert('Leave community', 'You can rejoin any time the gates allow.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
        const { error } = await supabase.rpc('leave_community', { p_community: communityId });
        if (error) { Alert.alert('Could not leave', error.message); return; }
        setInfo((p: any) => ({ ...p, is_member: false, my_role: null, member_count: Math.max((p.member_count || 1) - 1, 0) }));
        setPosts([]);
      } },
    ]);
  };

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access in your device settings.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      preferredAssetRepresentationMode: 'compatible' as ImagePicker.UIImagePickerPreferredAssetRepresentationMode,
      mediaTypes: ['images'] as ImagePicker.MediaType[], allowsEditing: false, quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const ext = (a.uri.split('.').pop() || 'jpg').toLowerCase().replace('jpeg', 'jpg');
    setAttach({ uri: a.uri, ext, mime: ext === 'png' ? 'image/png' : 'image/jpeg', width: a.width, height: a.height });
  };

  const submitPost = async () => {
    const body = draft.trim();
    if ((!body && !attach) || posting || !me?.id) return;
    setPosting(true);
    try {
      let mediaUrl: string | null = null;
      if (attach) {
        const { url } = await uploadMedia('post-media', me.id, { uri: attach.uri, kind: 'image', ext: attach.ext, mimeType: attach.mime, width: attach.width, height: attach.height, base64: null } as any, {});
        mediaUrl = url;
      }
      const { data, error } = await supabase.from('posts')
        .insert({ user_id: me.id, content: body || null, media_url: mediaUrl, community_id: communityId })
        .select('id, created_at').single();
      if (error) throw error;
      const mine = {
        post_id: data.id, author_id: me.id, content: body || null, body: null, media_url: mediaUrl,
        media: [], products: [], link: null, created_at: data.created_at,
        likes_count: 0, comments_count: 0, reposts_count: 0,
        author_name: me.full_name || 'You', author_username: me.username || '', author_avatar: me.avatar_url || null,
        viewer_liked: false, is_pinned: false, has_poll: false,
      };
      setPosts(prev => [mine, ...prev]);
      setDraft(''); setAttach(null);
    } catch (e: any) { Alert.alert('Could not post', e?.message || 'Please try again.'); }
    finally { setPosting(false); }
  };

  const toggleLike = (p: any) => {
    setPosts(prev => prev.map(x => x.post_id === p.post_id ? { ...x, viewer_liked: !x.viewer_liked, likes_count: (x.likes_count || 0) + (x.viewer_liked ? -1 : 1) } : x));
    void supabase.rpc('toggle_post_like', { p_post_id: p.post_id });
  };

  const postActions = (p: any) => {
    const own = p.author_id === me?.id;
    if (!isMod && !own) return;
    const buttons: any[] = [];
    if (isMod) buttons.push({ text: p.is_pinned ? 'Unpin from top' : 'Pin to top', onPress: async () => {
      const { error } = await supabase.rpc('pin_community_post', { p_post: p.post_id, p_pin: !p.is_pinned });
      if (error) { Alert.alert('Could not pin', error.message); return; }
      setPosts(prev => prev.map(x => x.post_id === p.post_id ? { ...x, is_pinned: !p.is_pinned } : x));
    } });
    if (isMod || own) buttons.push({ text: own ? 'Delete post' : 'Remove post', style: 'destructive', onPress: () => {
      Alert.alert(own ? 'Delete this post?' : 'Remove this post?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: own ? 'Delete' : 'Remove', style: 'destructive', onPress: async () => {
          const r = own
            ? await supabase.from('posts').delete().eq('id', p.post_id)
            : await supabase.rpc('remove_community_post', { p_post: p.post_id });
          if ((r as any).error) { Alert.alert('Failed', (r as any).error.message); return; }
          setPosts(prev => prev.filter(x => x.post_id !== p.post_id));
        } },
      ]);
    } });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(p.author_name || 'Post', undefined, buttons);
  };

  const openMembers = async () => {
    setMembersOpen(true);
    const { data } = await supabase.rpc('get_community_members', { p_community: communityId, p_limit: 100 });
    setMembers(data || []);
  };

  const memberRole = (m: any) => {
    if (!isMod || m.role === 'owner' || m.user_id === me?.id) return;
    if (m.role === 'moderator' && myRole !== 'owner') return;
    const buttons: any[] = [];
    if (myRole === 'owner') buttons.push({ text: m.role === 'moderator' ? 'Make member' : 'Make moderator', onPress: () => applyRole(m, m.role === 'moderator' ? 'member' : 'moderator') });
    buttons.push({ text: m.status === 'limited' ? 'Allow posting again' : 'Limit to viewing only', onPress: () => applyStatus(m, m.status === 'limited' ? 'active' : 'limited') });
    buttons.push({ text: 'Remove from community', style: 'destructive', onPress: () => removeMember(m, false) });
    buttons.push({ text: 'Remove and block from rejoining', style: 'destructive', onPress: () => removeMember(m, true) });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(m.full_name || 'Member', 'Change what this member can do.', buttons);
  };

  const applyRole = async (m: any, role: string) => {
    const { error } = await supabase.rpc('set_community_role', { p_community: communityId, p_user: m.user_id, p_role: role });
    if (error) { Alert.alert('Could not update role', error.message); return; }
    if (role === 'remove') setMembers(prev => prev.filter(x => x.user_id !== m.user_id));
    else setMembers(prev => prev.map(x => x.user_id === m.user_id ? { ...x, role } : x));
  };

  const openRequests = async () => {
    setRequestsOpen(true);
    const { data } = await supabase.rpc('get_join_requests', { p_community: communityId, p_limit: 60 });
    setRequests(data || []);
  };

  const resolveReq = async (r: any, approve: boolean) => {
    const { error } = await supabase.rpc('resolve_join_request', { p_community: communityId, p_user: r.user_id, p_approve: approve });
    if (error) { Alert.alert('Failed', error.message); return; }
    setRequests(prev => prev.filter(x => x.user_id !== r.user_id));
    if (approve) setInfo((p: any) => ({ ...p, member_count: (p.member_count || 0) + 1 }));
  };

  const pickIcon = async () => {
    if (!me?.id) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      preferredAssetRepresentationMode: 'compatible' as ImagePicker.UIImagePickerPreferredAssetRepresentationMode,
      mediaTypes: ['images'] as ImagePicker.MediaType[], allowsEditing: true, aspect: [1, 1], quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setIconBusy(true);
    try {
      const a = result.assets[0];
      const ext = (a.uri.split('.').pop() || 'jpg').toLowerCase().replace('jpeg', 'jpg');
      const { url } = await uploadMedia('avatars', me.id, { uri: a.uri, kind: 'image', ext, mimeType: ext === 'png' ? 'image/png' : 'image/jpeg', width: a.width, height: a.height, base64: null } as any, { filename: 'community_' + communityId + '_' + Date.now() + '.' + ext });
      const { error } = await supabase.rpc('update_community_settings', { p_community: communityId, p_icon_url: url });
      if (error) throw error;
      setInfo((p: any) => ({ ...p, icon_url: url }));
    } catch (e: any) { Alert.alert('Upload failed', e?.message || 'Could not update the icon.'); }
    finally { setIconBusy(false); }
  };

  const saveSettings = async () => {
    if (saving || !eName.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('update_community_settings', {
        p_community: communityId, p_name: eName.trim(), p_description: eDesc.trim() || null,
        p_category: eCat, p_join_mode: eMode, p_cover_color: eColor, p_rules: eRules.trim() || null,
      });
      if (error) throw error;
      setSettingsOpen(false);
      await loadInfo();
    } catch (e: any) { Alert.alert('Could not save', e?.message || 'Please try again.'); }
    finally { setSaving(false); }
  };

  const renderPost = ({ item }: { item: any }) => {
    const mediaArr: any[] = Array.isArray(item.media) ? item.media : [];
    const firstMedia = mediaArr.length > 0 ? mediaArr[0] : null;
    return (
      <TouchableOpacity style={s.card} activeOpacity={0.9}
        onPress={() => navigation.navigate('Post', { postId: item.post_id })}
        onLongPress={() => postActions(item)}>
        {item.is_pinned ? (
          <View style={s.pinRow}><Feather name="bookmark" size={11} color={NAVY} /><Text style={s.pinTxt}>Pinned</Text></View>
        ) : null}
        <View style={s.cardHead}>
          {item.author_avatar ? (
            <ExpoImage source={{ uri: item.author_avatar }} style={s.avatar} contentFit="cover" />
          ) : (
            <View style={[s.avatar, s.avatarFb]}><Text style={s.avatarTxt}>{(item.author_name || 'M')[0]}</Text></View>
          )}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><TierName userId={item.author_id} baseStyle={s.authorName} text={item.author_name || 'Member'} numberOfLines={1} /><VerifiedBadge userId={item.author_id} size={12} /></View>
            <Text style={s.authorMeta} numberOfLines={1}>{item.author_username ? '@' + item.author_username + ' · ' : ''}{relTime(item.created_at)}</Text>
          </View>
          {(isMod || item.author_id === me?.id) ? (
            <TouchableOpacity onPress={() => postActions(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="more-horizontal" size={17} color="#8E8E93" />
            </TouchableOpacity>
          ) : null}
        </View>
        {item.content ? <Text style={s.cardBody}>{item.content}</Text> : null}
        {firstMedia && firstMedia.media_type !== 'video' ? (
          <ExpoImage source={{ uri: firstMedia.url }} style={s.cardMedia} contentFit="cover" />
        ) : !firstMedia && item.media_url ? (
          <ExpoImage source={{ uri: item.media_url }} style={s.cardMedia} contentFit="cover" />
        ) : null}
        {firstMedia && firstMedia.media_type === 'video' ? (
          <View style={[s.cardMedia, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F1419' }]}>
            <Feather name="play" size={26} color="#FFF" />
          </View>
        ) : null}
        <View style={s.cardActions}>
          <TouchableOpacity style={s.actionBtn} onPress={() => toggleLike(item)} hitSlop={{ top: 6, bottom: 6 }}>
            <Feather name="heart" size={16} color={item.viewer_liked ? '#E0245E' : '#5B6B84'} />
            <Text style={[s.actionTxt, item.viewer_liked && { color: '#E0245E' }]}>{item.likes_count || 0}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.actionBtn} onPress={() => navigation.navigate('Post', { postId: item.post_id })} hitSlop={{ top: 6, bottom: 6 }}>
            <Feather name="message-circle" size={16} color="#5B6B84" />
            <Text style={s.actionTxt}>{item.comments_count || 0}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const catLabel = info.category ? (CATEGORIES.find(c => c.key === info.category)?.label || info.category) : null;

  return (
    <SafeAreaView style={s.safe} edges={['left', 'right']}>
      <View style={[s.band, { backgroundColor: band, paddingTop: insets.top + 4 }]}>
        <View style={s.bandRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.bandBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="chevron-left" size={24} color="#1F2937" />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          {isMember && info.join_mode === 'approval' && isMod ? (
            <TouchableOpacity onPress={openRequests} style={s.bandBtn}><Feather name="inbox" size={19} color="#1F2937" /></TouchableOpacity>
          ) : null}
          {isMember ? (
            <TouchableOpacity onPress={openChat} style={s.bandBtn} accessibilityRole="button" accessibilityLabel="Open the community chat"><Feather name="message-circle" size={19} color="#1F2937" /></TouchableOpacity>
          ) : null}
          {isMember && isMod ? (
            <TouchableOpacity onPress={inviteMenu} style={s.bandBtn}><Feather name="user-plus" size={19} color="#1F2937" /></TouchableOpacity>
          ) : null}
          {isMember ? (
            <TouchableOpacity onPress={openMembers} style={s.bandBtn}><Feather name="users" size={19} color="#1F2937" /></TouchableOpacity>
          ) : null}
          {myRole === 'owner' ? (
            <TouchableOpacity onPress={() => setSettingsOpen(true)} style={s.bandBtn}><Feather name="settings" size={19} color="#1F2937" /></TouchableOpacity>
          ) : isMember ? (
            <TouchableOpacity onPress={leave} style={s.bandBtn}><Feather name="log-out" size={18} color="#1F2937" /></TouchableOpacity>
          ) : null}
        </View>
        <View style={s.identRow}>
          {info.icon_url ? (
            <ExpoImage source={{ uri: info.icon_url }} style={s.commIcon} contentFit="cover" />
          ) : (
            <View style={[s.commIcon, { backgroundColor: '#FFFFFFAA', alignItems: 'center', justifyContent: 'center' }]}>
              <Feather name="users" size={22} color="#1F2937" />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.commName} numberOfLines={1}>{info.name}</Text>
            <Text style={s.commMeta} numberOfLines={1}>
              {info.member_count === 1 ? '1 member' : String(info.member_count || 0) + ' members'}{catLabel ? ' · ' + catLabel : ''}
            </Text>
            {info.parent_id ? <TouchableOpacity onPress={() => navigation.navigate('Community', { communityId: info.parent_id, name: info.parent_name })} activeOpacity={0.7}><Text style={s.commMeta} numberOfLines={1}>Part of {info.parent_name}</Text></TouchableOpacity> : null}
          </View>
          {!isMember ? (
            info.has_invite ? (
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity style={s.joinDark} onPress={() => respondInvite(true)} activeOpacity={0.85}><Text style={s.joinDarkTxt}>Accept</Text></TouchableOpacity>
                <TouchableOpacity style={s.joinLight} onPress={() => respondInvite(false)} activeOpacity={0.85}><Text style={s.joinLightTxt}>Decline</Text></TouchableOpacity>
              </View>
            ) : info.is_banned ? (
              <View style={s.joinLight}><Text style={s.joinLightTxt}>Removed</Text></View>
            ) : info.has_pending ? (
              <TouchableOpacity style={s.joinLight} onPress={cancelRequest} activeOpacity={0.85}><Text style={s.joinLightTxt}>Requested</Text></TouchableOpacity>
            ) : info.join_mode === 'invite' ? (
              <View style={s.joinLight}><Text style={s.joinLightTxt}>Invite only</Text></View>
            ) : (
              <TouchableOpacity style={s.joinDark} onPress={join} activeOpacity={0.85}>
                <Text style={s.joinDarkTxt}>{info.join_mode === 'approval' ? 'Request' : 'Join'}</Text>
              </TouchableOpacity>
            )
          ) : null}
        </View>
        {info.description ? <Text style={s.commDesc} numberOfLines={2}>{info.description}</Text> : null}
      </View>

      {info.rules ? (
        <TouchableOpacity style={s.rulesCard} onPress={() => setRulesOpen(o => !o)} activeOpacity={0.85}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Feather name="shield" size={13} color={NAVY} />
            <Text style={s.rulesTitle}>Community rules</Text>
            <Feather name={rulesOpen ? 'chevron-up' : 'chevron-down'} size={14} color="#8E8E93" style={{ marginLeft: 'auto' }} />
          </View>
          <Text style={s.rulesBody} numberOfLines={rulesOpen ? undefined : 2}>{info.rules}</Text>
        </TouchableOpacity>
      ) : null}

      {isMember && (announcements.length > 0 || subs.length > 0 || isMod) ? (
        <View style={s.strip}>
          {announcements.length > 0 || isMod ? (
            <View style={s.annCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Feather name="volume-2" size={13} color={NAVY} />
                <Text style={s.rulesTitle}>Announcements</Text>
                <View style={{ flex: 1 }} />
                {isMod ? <TouchableOpacity onPress={() => setAnnOpen(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Post an announcement"><Feather name="plus-circle" size={16} color={NAVY} /></TouchableOpacity> : null}
              </View>
              {announcements.length === 0 ? <Text style={s.rulesBody}>Nothing announced yet. Only moderators post here; every member sees it.</Text> : announcements.slice(0, 2).map((a) => (
                <TouchableOpacity key={a.id} activeOpacity={isMod ? 0.7 : 1} onLongPress={() => { if (isMod) deleteAnnouncement(a); }} style={{ marginTop: 6 }}>
                  <Text style={s.rulesBody}>{a.body}</Text>
                  <Text style={s.annMeta}>{(a.full_name || a.username || 'Moderator') + ' · ' + relTime(a.created_at)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {subs.length > 0 || isMod ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 6 }}>
              {subs.map((c: any) => (
                <TouchableOpacity key={c.id} style={s.subChip} activeOpacity={0.85} onPress={() => navigation.navigate('Community', { communityId: c.id, name: c.name, coverColor: c.cover_color, iconUrl: c.icon_url, memberCount: c.member_count, myRole: c.my_role, isMember: c.is_member })}>
                  <Feather name="hash" size={12} color={NAVY} />
                  <Text style={s.subChipTxt} numberOfLines={1}>{c.name}</Text>
                  {c.join_mode === 'invite' && !c.is_member ? <Feather name="lock" size={11} color="#8E8E93" /> : null}
                </TouchableOpacity>
              ))}
              {isMod ? (
                <TouchableOpacity style={[s.subChip, { borderStyle: 'dashed' }]} activeOpacity={0.85} onPress={() => setSubOpen(true)}>
                  <Feather name="plus" size={12} color={NAVY} />
                  <Text style={s.subChipTxt}>Sub-group</Text>
                </TouchableOpacity>
              ) : null}
            </ScrollView>
          ) : null}
        </View>
      ) : null}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {loading ? (
          <View style={s.center}><ActivityIndicator color={NAVY} /></View>
        ) : !isMember ? (
          <View style={s.center}>
            <Feather name="lock" size={34} color="#E5E5EA" />
            <Text style={s.emptyTitle}>Members only</Text>
            <Text style={s.emptySub}>{info.has_invite ? 'Accept the invitation above to see the posts.' : info.is_banned ? 'You were removed from this community.' : info.join_mode === 'invite' ? 'Ask a moderator for an invite to see the posts.' : 'Join to see and share posts inside this community.'}</Text>
          </View>
        ) : posts.length === 0 ? (
          <View style={s.center}>
            <Feather name="users" size={34} color="#E5E5EA" />
            <Text style={s.emptyTitle}>Quiet in here</Text>
            <Text style={s.emptySub}>Be the first to post something.</Text>
          </View>
        ) : (
          <FlatList data={posts} keyExtractor={p => p.post_id} renderItem={renderPost}
            contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 16 }}
            keyboardShouldPersistTaps="handled"
            onEndReachedThreshold={0.4}
            onEndReached={() => { const last = posts[posts.length - 1]; if (last) void loadPosts(last.created_at); }} />
        )}
        {isMember && info.my_status === 'limited' ? (
          <View style={[s.limitedBar, { paddingBottom: Math.max(insets.bottom, 10) }]}><Feather name="eye" size={13} color="#8E8E93" /><Text style={s.limitedTxt}>You can view this community but not post in it</Text></View>
        ) : isMember ? (
          <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E5EA', backgroundColor: '#FFF' }}>
            {attach ? (
              <View style={s.attachRow}>
                <ExpoImage source={{ uri: attach.uri }} style={s.attachThumb} contentFit="cover" />
                <TouchableOpacity onPress={() => setAttach(null)} style={s.attachX}><Feather name="x" size={13} color="#FFF" /></TouchableOpacity>
              </View>
            ) : null}
            <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
              <TouchableOpacity style={s.toolBtn} onPress={pickPhoto} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                <Feather name="image" size={20} color="#8E8E93" />
              </TouchableOpacity>
              <TextInput style={s.composerInput} placeholder="Share with the community" placeholderTextColor="#8E8E93" value={draft} onChangeText={setDraft} multiline maxLength={2000} />
              <TouchableOpacity style={[s.sendBtn, ((!draft.trim() && !attach) || posting) && { opacity: 0.4 }]} onPress={submitPost} disabled={(!draft.trim() && !attach) || posting}>
                {posting ? <ActivityIndicator size="small" color="#FFF" /> : <Feather name="arrow-up" size={18} color="#FFF" />}
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      <Modal visible={membersOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setMembersOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
          <View style={s.modalHeader}>
            {isMod ? <TouchableOpacity onPress={openBans} style={{ width: 60 }}><Text style={{ fontSize: 14, color: NAVY, fontWeight: '600' }}>Blocked</Text></TouchableOpacity> : <View style={{ width: 60 }} />}
            <Text style={s.modalTitle}>Members</Text>
            <TouchableOpacity onPress={() => setMembersOpen(false)} style={{ width: 60, alignItems: 'flex-end' }}><Feather name="x" size={22} color="#000" /></TouchableOpacity>
          </View>
          <FlatList data={members} keyExtractor={m => m.user_id}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item: m }) => (
              <TouchableOpacity style={s.memberRow} activeOpacity={isMod && m.role !== 'owner' && m.user_id !== me?.id ? 0.7 : 1} onPress={() => memberRole(m)}>
                {m.avatar_url ? <ExpoImage source={{ uri: m.avatar_url }} style={s.memberAvatar} contentFit="cover" /> : <View style={[s.memberAvatar, s.avatarFb]}><Text style={s.avatarTxt}>{(m.full_name || '?')[0]}</Text></View>}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><TierName userId={m.user_id} baseStyle={s.authorName} text={m.full_name || 'Member'} numberOfLines={1} /><VerifiedBadge userId={m.user_id} size={12} />{m.user_id === me?.id ? <Text style={s.authorMeta}>(you)</Text> : null}</View>
                  {m.username ? <Text style={s.authorMeta}>@{m.username}</Text> : null}
                </View>
                {m.status === 'limited' ? <View style={[s.roleChip, { backgroundColor: '#F2F2F7' }]}><Text style={[s.roleChipTxt, { color: '#8E8E93' }]}>Limited</Text></View> : null}
                {m.role !== 'member' ? <View style={s.roleChip}><Text style={s.roleChipTxt}>{m.role === 'owner' ? 'Owner' : 'Moderator'}</Text></View> : null}
              </TouchableOpacity>
            )} />
        </SafeAreaView>
      </Modal>

      <Modal visible={requestsOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setRequestsOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
          <View style={s.modalHeader}>
            <View style={{ width: 60 }} />
            <Text style={s.modalTitle}>Join requests</Text>
            <TouchableOpacity onPress={() => setRequestsOpen(false)} style={{ width: 60, alignItems: 'flex-end' }}><Feather name="x" size={22} color="#000" /></TouchableOpacity>
          </View>
          <FlatList data={requests} keyExtractor={r => r.user_id}
            contentContainerStyle={{ padding: 16 }}
            ListEmptyComponent={<Text style={{ textAlign: 'center', color: '#8E8E93', marginTop: 30, fontSize: 13.5 }}>No pending requests.</Text>}
            renderItem={({ item: r }) => (
              <View style={s.memberRow}>
                {r.avatar_url ? <ExpoImage source={{ uri: r.avatar_url }} style={s.memberAvatar} contentFit="cover" /> : <View style={[s.memberAvatar, s.avatarFb]}><Text style={s.avatarTxt}>{(r.full_name || '?')[0]}</Text></View>}
                <View style={{ flex: 1 }}>
                  <Text style={s.authorName} numberOfLines={1}><TierName userId={((r) as any)?.id ?? ((r) as any)?.user_id} baseStyle={s.authorName} text={r.full_name || 'Member' || ''} numberOfLines={1} /> <VerifiedBadge userId={((r) as any)?.id ?? ((r) as any)?.user_id} size={12} /></Text>
                  {r.username ? <Text style={s.authorMeta}>@{r.username}</Text> : null}
                </View>
                <TouchableOpacity style={s.approveBtn} onPress={() => resolveReq(r, true)}><Feather name="check" size={15} color="#FFF" /></TouchableOpacity>
                <TouchableOpacity style={s.denyBtn} onPress={() => resolveReq(r, false)}><Feather name="x" size={15} color="#5B6B84" /></TouchableOpacity>
              </View>
            )} />
        </SafeAreaView>
      </Modal>

      <Modal visible={settingsOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSettingsOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={s.modalHeader}>
              <TouchableOpacity onPress={() => setSettingsOpen(false)} style={{ width: 60 }}><Text style={{ fontSize: 16, color: '#8E8E93' }}>Cancel</Text></TouchableOpacity>
              <Text style={s.modalTitle}>Settings</Text>
              <TouchableOpacity onPress={saveSettings} disabled={!eName.trim() || saving} style={{ width: 60, alignItems: 'flex-end' }}>
                {saving ? <ActivityIndicator size="small" color={NAVY} /> : <Text style={{ fontSize: 16, fontWeight: '700', color: NAVY, opacity: eName.trim() ? 1 : 0.35 }}>Save</Text>}
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              <View style={{ alignItems: 'center' }}>
                <TouchableOpacity onPress={pickIcon} activeOpacity={0.85} style={{ width: 76, height: 76 }}>
                  {info.icon_url ? (
                    <ExpoImage source={{ uri: info.icon_url }} style={s.settingsIcon} contentFit="cover" />
                  ) : (
                    <View style={[s.settingsIcon, { backgroundColor: band, alignItems: 'center', justifyContent: 'center' }]}><Feather name="users" size={24} color="#1F2937" /></View>
                  )}
                  <View style={s.iconBadge}>{iconBusy ? <ActivityIndicator size="small" color="#FFF" /> : <Feather name="camera" size={12} color="#FFF" />}</View>
                </TouchableOpacity>
              </View>
              <TextInput style={s.input} placeholder="Name" placeholderTextColor="#C7C7CC" value={eName} onChangeText={setEName} maxLength={60} />
              <TextInput style={[s.input, { minHeight: 64, paddingTop: 12, textAlignVertical: 'top' }]} placeholder="Description" placeholderTextColor="#C7C7CC" value={eDesc} onChangeText={setEDesc} multiline maxLength={200} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['open', 'approval', 'invite'] as const).map(m => (
                  <TouchableOpacity key={m} style={[s.audChip, eMode === m && s.audChipOn]} onPress={() => setEMode(m)} activeOpacity={0.85}>
                    <Text style={[s.audTxt, eMode === m && s.audTxtOn]}>{m === 'open' ? 'Open' : m === 'approval' ? 'Approval' : 'Invite only'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {CATEGORIES.map(c => (
                  <TouchableOpacity key={c.key} style={[s.catChip, eCat === c.key && s.catChipOn]} onPress={() => setECat(eCat === c.key ? null : c.key)} activeOpacity={0.85}>
                    <Text style={[s.catTxt, eCat === c.key && s.catTxtOn]}>{c.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {Object.entries(COMM_COLORS).map(([k, v]) => (
                  <TouchableOpacity key={k} onPress={() => setEColor(k)} style={[s.colorDot, { backgroundColor: v }, eColor === k && s.colorDotOn]} activeOpacity={0.85} />
                ))}
              </View>
              <TextInput style={[s.input, { minHeight: 84, paddingTop: 12, textAlignVertical: 'top' }]} placeholder="Rules shown to people when they join" placeholderTextColor="#C7C7CC" value={eRules} onChangeText={setERules} multiline maxLength={600} />
              {myRole === 'owner' ? (
                <TouchableOpacity onPress={deleteCommunity} activeOpacity={0.8} style={{ marginTop: 28, alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 11, borderRadius: 999, borderWidth: 1, borderColor: '#E0245E' }}>
                  <Text style={{ color: '#E0245E', fontWeight: '700', fontSize: 14 }}>Delete community</Text>
                </TouchableOpacity>
              ) : null}            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      <PeoplePickerSheet visible={inviteOpen} title="Invite to the community" excludeId={me?.id ?? null} onPick={(p) => { setInviteOpen(false); void invitePerson(p); }} onClose={() => setInviteOpen(false)} />

      <Modal visible={annOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAnnOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={s.modalHeader}>
              <TouchableOpacity onPress={() => setAnnOpen(false)} style={{ width: 60 }}><Text style={{ fontSize: 16, color: '#8E8E93' }}>Cancel</Text></TouchableOpacity>
              <Text style={s.modalTitle}>Announcement</Text>
              <TouchableOpacity onPress={postAnnouncement} disabled={!annDraft.trim()} style={{ width: 60, alignItems: 'flex-end' }}><Text style={{ fontSize: 16, fontWeight: '700', color: NAVY, opacity: annDraft.trim() ? 1 : 0.35 }}>Post</Text></TouchableOpacity>
            </View>
            <View style={{ padding: 16 }}>
              <Text style={s.rulesBody}>Announcements go one way: every member sees them, only moderators write them.</Text>
              <TextInput style={[s.input, { minHeight: 120, paddingTop: 12, textAlignVertical: 'top', marginTop: 12 }]} placeholder="What should everyone know?" placeholderTextColor="#8E8E93" value={annDraft} onChangeText={setAnnDraft} multiline maxLength={2000} autoFocus />
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      <Modal visible={subOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSubOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={s.modalHeader}>
              <TouchableOpacity onPress={() => setSubOpen(false)} style={{ width: 60 }}><Text style={{ fontSize: 16, color: '#8E8E93' }}>Cancel</Text></TouchableOpacity>
              <Text style={s.modalTitle}>New sub-group</Text>
              <TouchableOpacity onPress={createSub} disabled={subName.trim().length < 3 || subBusy} style={{ width: 60, alignItems: 'flex-end' }}>
                {subBusy ? <ActivityIndicator size="small" color={NAVY} /> : <Text style={{ fontSize: 16, fontWeight: '700', color: NAVY, opacity: subName.trim().length >= 3 ? 1 : 0.35 }}>Create</Text>}
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
              <Text style={s.rulesBody}>A sub-group lives inside {info.name}. Only its members can join, and leaving {info.name} leaves the sub-group too.</Text>
              <TextInput style={s.input} placeholder="Name" placeholderTextColor="#8E8E93" value={subName} onChangeText={setSubName} maxLength={60} autoFocus />
              <TextInput style={[s.input, { minHeight: 72, paddingTop: 12, textAlignVertical: 'top' }]} placeholder="What is it for?" placeholderTextColor="#8E8E93" value={subDesc} onChangeText={setSubDesc} multiline maxLength={300} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['open', 'approval', 'invite'] as const).map((k) => (
                  <TouchableOpacity key={k} onPress={() => setSubMode(k)} style={[s.audChip, subMode === k && s.audChipOn]} activeOpacity={0.85}>
                    <Text style={[s.audTxt, subMode === k && s.audTxtOn]}>{k === 'open' ? 'Open' : k === 'approval' ? 'Approval' : 'Invite only'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      <Modal visible={invitesOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setInvitesOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
          <View style={s.modalHeader}>
            <View style={{ width: 60 }} />
            <Text style={s.modalTitle}>Pending invitations</Text>
            <TouchableOpacity onPress={() => setInvitesOpen(false)} style={{ width: 60, alignItems: 'flex-end' }}><Feather name="x" size={22} color="#000" /></TouchableOpacity>
          </View>
          <FlatList data={invites} keyExtractor={r => r.user_id}
            contentContainerStyle={{ padding: 16 }}
            ListEmptyComponent={<Text style={{ textAlign: 'center', color: '#8E8E93', marginTop: 30, fontSize: 13.5 }}>No one is waiting on an invitation.</Text>}
            renderItem={({ item: r }) => (
              <View style={s.memberRow}>
                {r.avatar_url ? <ExpoImage source={{ uri: r.avatar_url }} style={s.memberAvatar} contentFit="cover" /> : <View style={[s.memberAvatar, s.avatarFb]}><Text style={s.avatarTxt}>{(r.full_name || '?')[0]}</Text></View>}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><TierName userId={r.user_id} baseStyle={s.authorName} text={r.full_name || 'Member'} numberOfLines={1} /><VerifiedBadge userId={r.user_id} size={12} /></View>
                  <Text style={s.authorMeta}>{r.username ? '@' + r.username + ' · ' : ''}invited {relTime(r.created_at)}</Text>
                </View>
                <TouchableOpacity style={s.denyBtn} onPress={() => revokeInvite(r)} accessibilityRole="button" accessibilityLabel="Withdraw invitation"><Feather name="x" size={15} color="#5B6B84" /></TouchableOpacity>
              </View>
            )} />
        </SafeAreaView>
      </Modal>

      <Modal visible={bansOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setBansOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
          <View style={s.modalHeader}>
            <View style={{ width: 60 }} />
            <Text style={s.modalTitle}>Blocked from rejoining</Text>
            <TouchableOpacity onPress={() => setBansOpen(false)} style={{ width: 60, alignItems: 'flex-end' }}><Feather name="x" size={22} color="#000" /></TouchableOpacity>
          </View>
          <FlatList data={bans} keyExtractor={b => b.user_id}
            contentContainerStyle={{ padding: 16 }}
            ListEmptyComponent={<Text style={{ textAlign: 'center', color: '#8E8E93', marginTop: 30, fontSize: 13.5 }}>No one is blocked.</Text>}
            renderItem={({ item: b }) => (
              <View style={s.memberRow}>
                {b.avatar_url ? <ExpoImage source={{ uri: b.avatar_url }} style={s.memberAvatar} contentFit="cover" /> : <View style={[s.memberAvatar, s.avatarFb]}><Text style={s.avatarTxt}>{(b.full_name || '?')[0]}</Text></View>}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><TierName userId={b.user_id} baseStyle={s.authorName} text={b.full_name || 'Member'} numberOfLines={1} /><VerifiedBadge userId={b.user_id} size={12} /></View>
                  <Text style={s.authorMeta}>{b.username ? '@' + b.username + ' · ' : ''}blocked {relTime(b.created_at)}</Text>
                </View>
                <TouchableOpacity style={s.joinLight} onPress={() => unban(b)} accessibilityRole="button" accessibilityLabel="Allow back in"><Text style={s.joinLightTxt}>Allow back</Text></TouchableOpacity>
              </View>
            )} />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  band: { paddingHorizontal: 10, paddingBottom: 12 },
  bandRow: { flexDirection: 'row', alignItems: 'center' },
  bandBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  identRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, marginTop: 2 },
  commIcon: { width: 52, height: 52, borderRadius: 15 },
  commName: { fontSize: 17.5, fontWeight: '800', color: '#1F2937' },
  commMeta: { fontSize: 12.5, color: '#1F2937', opacity: 0.7, marginTop: 1 },
  commDesc: { fontSize: 13, color: '#1F2937', opacity: 0.8, paddingHorizontal: 6, marginTop: 8, lineHeight: 18 },
  joinDark: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: '#0F1419' },
  joinDarkTxt: { fontSize: 13, fontWeight: '700', color: t.ink.inverse },
  joinLight: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#FFFFFFB3' },
  joinLightTxt: { fontSize: 12.5, fontWeight: '700', color: '#1F2937' },
  rulesCard: { marginHorizontal: 14, marginTop: 10, borderRadius: 12, borderWidth: 1, borderColor: '#E5E5EA', padding: 11 },
  rulesTitle: { fontSize: 12.5, fontWeight: '800', color: NAVY },
  rulesBody: { fontSize: 12.5, color: '#5B6B84', marginTop: 5, lineHeight: 17 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 15.5, fontWeight: '700', color: '#0F1419' },
  emptySub: { fontSize: 13, color: '#8E8E93', textAlign: 'center' },
  card: { backgroundColor: '#F8F9FB', borderRadius: 16, padding: 12, marginBottom: 10 },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  pinTxt: { fontSize: 11, fontWeight: '800', color: NAVY },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarFb: { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 14, fontWeight: '700', color: t.ink.inverse },
  authorName: { fontSize: 14, fontWeight: '700', color: '#0F1419' },
  authorMeta: { fontSize: 11.5, color: '#8E8E93', marginTop: 1 },
  cardBody: { fontSize: 15, color: '#1A1A1A', lineHeight: 21, marginTop: 8 },
  cardMedia: { height: 190, borderRadius: 10, marginTop: 8, backgroundColor: '#E5E5EA' },
  cardActions: { flexDirection: 'row', gap: 18, marginTop: 10 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionTxt: { fontSize: 12.5, fontWeight: '600', color: '#5B6B84' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, backgroundColor: t.surface.canvas },
  composerInput: { flex: 1, backgroundColor: '#F2F2F7', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, fontSize: 15, color: '#0F1419', maxHeight: 110 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  toolBtn: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
  attachRow: { paddingHorizontal: 14, paddingTop: 8, alignSelf: 'flex-start' },
  attachThumb: { width: 62, height: 62, borderRadius: 10 },
  attachX: { position: 'absolute', right: -6, top: 2, width: 20, height: 20, borderRadius: 10, backgroundColor: '#0F1419', alignItems: 'center', justifyContent: 'center' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA' },
  modalTitle: { fontSize: 16.5, fontWeight: '700', color: '#0F1419' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  memberAvatar: { width: 38, height: 38, borderRadius: 19 },
  roleChip: { backgroundColor: t.surface.hairline, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  roleChipTxt: { fontSize: 10.5, fontWeight: '700', color: NAVY },
  approveBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  denyBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  settingsIcon: { width: 76, height: 76, borderRadius: 20 },
  iconBadge: { position: 'absolute', right: -2, bottom: -2, width: 25, height: 25, borderRadius: 13, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: t.ink.inverse },
  input: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#0F1419' },
  audChip: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: '#F5F5F5', borderWidth: 1.5, borderColor: '#E5E5EA' },
  audChipOn: { backgroundColor: NAVY, borderColor: NAVY },
  audTxt: { fontSize: 12.5, fontWeight: '600', color: '#5B6B84' },
  audTxtOn: { color: t.ink.inverse },
  catChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#F5F5F5', borderWidth: 1, borderColor: '#E5E5EA' },
  catChipOn: { backgroundColor: NAVY, borderColor: NAVY },
  catTxt: { fontSize: 12.5, fontWeight: '600', color: '#5B6B84' },
  catTxtOn: { color: t.ink.inverse },
  colorDot: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: 'transparent' },
  colorDotOn: { borderColor: '#0F1419' },
  strip: { paddingHorizontal: 14, paddingTop: 8, gap: 4 },
  annCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,30,61,0.14)', backgroundColor: 'rgba(201,191,176,0.14)', padding: 12 },
  annMeta: { fontSize: 11.5, color: '#8E8E93', marginTop: 3 },
  subChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(11,30,61,0.16)', backgroundColor: '#FFFFFF', maxWidth: 200 },
  subChipTxt: { fontSize: 13, fontWeight: '600', color: '#0B1E3D', flexShrink: 1 },
  limitedBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E5EA', backgroundColor: '#FFF' },
  limitedTxt: { fontSize: 13, color: '#8E8E93', fontWeight: '600' },
}));
