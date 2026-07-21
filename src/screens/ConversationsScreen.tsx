import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  TextInput, Image, ActivityIndicator, StatusBar,
  ActionSheetIOS, Alert, Platform, ScrollView, Share,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { meetingService, MyActiveMeeting } from '../services/meetingService';

type Conversation = {
  id: string;
  other_user_id: string | null;
  other_name: string;
  other_username: string | null;
  other_avatar: string | null;
  last_message: string;
  last_message_time: string | null;
  unread_count: number;
  is_group: boolean;
  group_emoji?: string | null;
  group_avatar_url?: string | null;
  is_pinned: boolean;
  is_muted: boolean;
  is_archived: boolean;
};

type TabKey = 'all' | 'unread' | 'groups' | 'archived';

function initials(n?: string | null) {
  if (!n) return 'U';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}

function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (m < 1) return 'now';
  if (m < 60) return m + 'm';
  if (h < 24) return h + 'h';
  if (dy === 1) return 'Yesterday';
  if (dy < 7) return new Date(d).toLocaleDateString([], { weekday: 'short' });
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const AVATAR_COLORS = ['#1D4ED8','#065F46','#7C2D12','#1a3560','#5856D6','#C2410C','#0F766E','#7C3AED'];
function avatarColor(id: string) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

const NAVY = '#0B1E3D';

export default function ConversationsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeMeetings, setActiveMeetings] = useState<MyActiveMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>('all');
  const searchInputRef = useRef<TextInput | null>(null);

  // ── Load unread counts via RPC (single source of truth) ────────────────────
  const fetchUnreadMap = useCallback(async (): Promise<Record<string, number>> => {
    if (!userId) return {};
    const { data, error } = await supabase.rpc('get_unread_counts', { p_user_id: userId });
    if (error) { console.log('UNREAD_RPC_ERR', error); return {}; }
    const map: Record<string, number> = {};
    (data || []).forEach((r: any) => { map[r.conversation_id] = Number(r.unread_count) || 0; });
    return map;
  }, [userId]);

  const refreshUnreads = useCallback(async () => {
    const map = await fetchUnreadMap();
    setConversations(prev => prev.map(c => ({ ...c, unread_count: map[c.id] || 0 })));
  }, [fetchUnreadMap]);

  // ── Load active meetings (host-only for v1) ────────────────────────────────
  const loadActiveMeetings = useCallback(async () => {
    try {
      const list = await meetingService.listMyActive();
      setActiveMeetings(list);
    } catch (e) { console.log('ACTIVE_MEETINGS_LOAD', e); }
  }, []);

  // ── Load conversations ─────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const { data: dmConvs } = await supabase
        .from('conversations').select('*')
        .or(`user_1.eq.${userId},user_2.eq.${userId}`)
        .eq('is_group', false)
        .order('last_message_time', { ascending: false });

      const { data: memberRows } = await supabase
        .from('conversation_members').select('conversation_id').eq('user_id', userId);

      const groupIds = (memberRows || []).map((r: any) => r.conversation_id);
      let groupConvs: any[] = [];
      if (groupIds.length > 0) {
        const { data: gc } = await supabase
          .from('conversations').select('*').in('id', groupIds)
          .eq('is_group', true)
          .order('last_message_time', { ascending: false });
        groupConvs = gc || [];
      }

      const allConvs = [...(dmConvs || []), ...groupConvs];
      if (allConvs.length === 0) { setConversations([]); return; }

      const convIds = allConvs.map((c: any) => c.id);

      const settingsMap: Record<string, any> = {};
      try {
        const { data: settings } = await supabase
          .from('conversation_settings')
          .select('conversation_id, is_pinned, is_muted, is_archived, is_deleted')
          .eq('user_id', userId).in('conversation_id', convIds);
        (settings || []).forEach((s: any) => { settingsMap[s.conversation_id] = s; });
      } catch (_) { /* may not exist yet */ }

      const dmOtherIds = (dmConvs || [])
        .map((c: any) => c.user_1 === userId ? c.user_2 : c.user_1)
        .filter(Boolean);
      const profileMap: Record<string, any> = {};
      if (dmOtherIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles').select('id, full_name, username, avatar_url').in('id', dmOtherIds);
        (profs || []).forEach((p: any) => { profileMap[p.id] = p; });
      }

      const unreadMap = await fetchUnreadMap();

      const list: Conversation[] = allConvs
        .filter((c: any) => !(settingsMap[c.id]?.is_deleted))
        .map((c: any) => {
          const s = settingsMap[c.id] || {};
          if (c.is_group) {
            return {
              id: c.id,
              other_user_id: null,
              other_name: c.group_name || 'Group',
              other_username: null,
              other_avatar: c.group_avatar_url || null,
              last_message: c.last_message || '',
              last_message_time: c.last_message_time,
              unread_count: unreadMap[c.id] || 0,
              is_group: true,
              group_emoji: c.group_emoji || '💬',
              group_avatar_url: c.group_avatar_url,
              is_pinned: !!s.is_pinned,
              is_muted: !!s.is_muted,
              is_archived: !!s.is_archived,
            };
          }
          const otherId = c.user_1 === userId ? c.user_2 : c.user_1;
          const p = profileMap[otherId] || {};
          return {
            id: c.id,
            other_user_id: otherId,
            other_name: p.full_name || 'Member',
            other_username: p.username || null,
            other_avatar: p.avatar_url || null,
            last_message: c.last_message || '',
            last_message_time: c.last_message_time,
            unread_count: unreadMap[c.id] || 0,
            is_group: false,
            group_emoji: null,
            group_avatar_url: null,
            is_pinned: !!s.is_pinned,
            is_muted: !!s.is_muted,
            is_archived: !!s.is_archived,
          };
        });

      list.sort((a, b) => {
        if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
        const ta = a.last_message_time ? new Date(a.last_message_time).getTime() : 0;
        const tb = b.last_message_time ? new Date(b.last_message_time).getTime() : 0;
        return tb - ta;
      });

      setConversations(list);
    } catch (e) { console.log('CONV_LOAD', e); }
    finally { setLoading(false); }
  }, [userId, fetchUnreadMap]);

  // ── Focus effect: load + realtime ──────────────────────────────────────────
  useFocusEffect(useCallback(() => {
    load();
    loadActiveMeetings();

    if (!userId) return;
    const channel = supabase
      .channel(`inbox_live_${userId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'conversations',
      }, (payload: any) => {
        const updated = payload.new as any;
        setConversations(prev => {
          const idx = prev.findIndex(c => c.id === updated.id);
          if (idx === -1) { load(); return prev; }
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            last_message: updated.last_message ?? next[idx].last_message,
            last_message_time: updated.last_message_time ?? next[idx].last_message_time,
          };
          next.sort((a, b) => {
            if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
            const ta = a.last_message_time ? new Date(a.last_message_time).getTime() : 0;
            const tb = b.last_message_time ? new Date(b.last_message_time).getTime() : 0;
            return tb - ta;
          });
          return next;
        });
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
      }, (payload) => {
        const m = payload.new as any;
        if (!m?.conversation_id || m.sender_id === userId) return;
        // Patch just the affected conversation's count instead of full refresh.
        setConversations(prev => {
          const idx = prev.findIndex(c => c.id === m.conversation_id);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = { ...next[idx], unread_count: (next[idx].unread_count || 0) + 1 };
          return next;
        });
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'message_reads',
        filter: `user_id=eq.${userId}`,
      }, () => { refreshUnreads(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [load, loadActiveMeetings, userId, refreshUnreads]));

  // ── Settings helpers ───────────────────────────────────────────────────────
  const upsertSetting = async (convId: string, patch: Partial<{
    is_pinned: boolean; is_muted: boolean; is_archived: boolean; is_deleted: boolean;
  }>) => {
    if (!userId) return;
    try {
      await supabase.from('conversation_settings').upsert({
        conversation_id: convId, user_id: userId,
        ...patch, updated_at: new Date().toISOString(),
      }, { onConflict: 'conversation_id,user_id' });
    } catch (e) { console.log('[UPSERT_SETTING]', e); }
    setConversations(prev => prev.map(c =>
      c.id === convId ? { ...c, ...patch } : c
    ).filter(c => !('is_deleted' in patch && patch.is_deleted && c.id === convId)));
  };

  const showContextMenu = (conv: Conversation) => {
    const options = [
      conv.is_pinned   ? 'Unpin'     : 'Pin',
      conv.is_muted    ? 'Unmute'    : 'Mute',
      conv.is_archived ? 'Unarchive' : 'Archive',
      !conv.is_group   ? 'Block user' : null,
      'Delete chat',
      'Cancel',
    ].filter(Boolean) as string[];

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: options.indexOf('Delete chat') },
        async (i) => {
          const choice = options[i];
          if (choice === 'Pin' || choice === 'Unpin')         await upsertSetting(conv.id, { is_pinned: !conv.is_pinned });
          if (choice === 'Mute' || choice === 'Unmute')       await upsertSetting(conv.id, { is_muted: !conv.is_muted });
          if (choice === 'Archive' || choice === 'Unarchive') await upsertSetting(conv.id, { is_archived: !conv.is_archived });
          if (choice === 'Delete chat') {
            Alert.alert('Delete chat?', 'This removes it only from your view.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => upsertSetting(conv.id, { is_deleted: true }) },
            ]);
          }
          if (choice === 'Block user' && conv.other_user_id) {
            Alert.alert('Block user?', `${conv.other_name} will not be able to message you.`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Block', style: 'destructive', onPress: async () => {
                await supabase.from('blocked_users').insert({ blocker_id: userId, blocked_id: conv.other_user_id }).select().maybeSingle();
                await upsertSetting(conv.id, { is_deleted: true });
              }},
            ]);
          }
        }
      );
    } else {
      Alert.alert(conv.other_name, undefined, [
        { text: conv.is_pinned ? 'Unpin' : 'Pin',             onPress: () => upsertSetting(conv.id, { is_pinned: !conv.is_pinned }) },
        { text: conv.is_muted ? 'Unmute' : 'Mute',            onPress: () => upsertSetting(conv.id, { is_muted: !conv.is_muted }) },
        { text: conv.is_archived ? 'Unarchive' : 'Archive',   onPress: () => upsertSetting(conv.id, { is_archived: !conv.is_archived }) },
        { text: 'Delete', style: 'destructive',               onPress: () => upsertSetting(conv.id, { is_deleted: true }) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  // ── Primary "+" action sheet ───────────────────────────────────────────────
  const showPrimaryActions = () => {
    const options = ['New message', 'New meeting', 'Join with link', 'New group', 'Cancel'];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: options.length - 1 },
        (i) => {
          if (i === 0) navigation.navigate('Network');
          if (i === 1) navigation.navigate('NewMeeting');
          if (i === 2) promptJoinWithLink();
          if (i === 3) navigation.navigate('CreateGroup');
        }
      );
    } else {
      Alert.alert('New', undefined, [
        { text: 'New message', onPress: () => navigation.navigate('Network') },
        { text: 'New meeting', onPress: () => navigation.navigate('NewMeeting') },
        { text: 'Join with link', onPress: promptJoinWithLink },
        { text: 'New group', onPress: () => navigation.navigate('CreateGroup') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const promptJoinWithLink = async () => {
    // Try to read from clipboard first as a convenience
    let clipboardText = '';
    try { clipboardText = await Clipboard.getStringAsync(); } catch {}

    const parsed = parseMeetingRoomName(clipboardText);
    if (parsed) {
      Alert.alert(
        'Join meeting?',
        `Link detected on your clipboard:\n\n${parsed}`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Join', onPress: () => navigation.navigate('Meeting', { roomName: parsed }) },
        ]
      );
      return;
    }

    // Fallback: manual entry via Alert.prompt (iOS only)
    if (Platform.OS === 'ios' && (Alert as any).prompt) {
      (Alert as any).prompt(
        'Join with link',
        'Paste a PlatinumCircles meeting link or room code',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Join',
            onPress: (text?: string) => {
              const name = parseMeetingRoomName(text || '');
              if (!name) {
                Alert.alert('Invalid link', 'That doesn’t look like a valid meeting link.');
                return;
              }
              navigation.navigate('Meeting', { roomName: name });
            }
          },
        ],
        'plain-text'
      );
    } else {
      Alert.alert('Join with link', 'Copy a meeting link to your clipboard, then tap Join with link again.');
    }
  };

  // ── Open chat ──────────────────────────────────────────────────────────────
  const openChat = (conv: Conversation) => {
    setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, unread_count: 0 } : c));
    navigation.navigate('Chat', {
      conversationId: conv.id,
      userId: conv.other_user_id || undefined,
      userName: conv.other_name,
      otherUser: conv.is_group ? null : (conv.other_user_id ? {
        id: conv.other_user_id,
        full_name: conv.other_name,
        username: conv.other_username,
        avatar_url: conv.other_avatar,
      } : null),
      isGroup: conv.is_group,
      groupName: conv.is_group ? conv.other_name : undefined,
      groupEmoji: conv.is_group ? (conv.group_emoji || '💬') : undefined,
    });
  };

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return conversations.filter(c => {
      // Archived visibility rule: only shown in "archived" tab
      if (tab === 'archived') {
        if (!c.is_archived) return false;
      } else {
        if (c.is_archived) return false;
      }

      if (tab === 'unread' && c.unread_count <= 0) return false;
      if (tab === 'groups' && !c.is_group) return false;

      if (search) {
        const q = search.toLowerCase();
        if (!c.other_name.toLowerCase().includes(q) &&
            !(c.last_message || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [conversations, tab, search]);

  const pinned   = filtered.filter(c => c.is_pinned);
  const unpinned = filtered.filter(c => !c.is_pinned);

  // ── Counts for tab badges ──────────────────────────────────────────────────
  const counts = useMemo(() => {
    const nonArchived = conversations.filter(c => !c.is_archived);
    return {
      unread: nonArchived.filter(c => c.unread_count > 0 && !c.is_muted).length,
      groups: nonArchived.filter(c => c.is_group).length,
      archived: conversations.filter(c => c.is_archived).length,
    };
  }, [conversations]);

  // ── Render a conversation row ──────────────────────────────────────────────
  const renderItem = ({ item }: { item: Conversation }) => {
    const hasUnread = item.unread_count > 0;
    return (
      <TouchableOpacity
        style={s.card}
        onPress={() => openChat(item)}
        onLongPress={() => showContextMenu(item)}
        activeOpacity={0.85}
      >
        <View style={s.cardAvatarWrap}>
          {item.other_avatar
            ? <Image source={{ uri: item.other_avatar }} style={s.cardAvatar} />
            : item.is_group
              ? <View style={[s.cardAvatar, { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ fontSize: 22 }}>{item.group_emoji || '💬'}</Text>
                </View>
              : <View style={[s.cardAvatar, { backgroundColor: avatarColor(item.other_user_id || item.id) }]}>
                  <Text style={s.cardAvatarTxt}>{initials(item.other_name)}</Text>
                </View>}
          {item.is_pinned && <View style={s.pinBadge}><Text style={s.pinBadgeTxt}>📌</Text></View>}
        </View>

        <View style={s.cardBody}>
          <View style={s.cardRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
              <Text style={[s.cardName, hasUnread && s.cardNameBold]} numberOfLines={1}>{item.other_name}</Text>
              {item.is_muted && <Text style={{ fontSize: 11 }}>🔕</Text>}
            </View>
            <Text style={[s.cardTime, hasUnread && s.cardTimeBold]}>{relTime(item.last_message_time)}</Text>
          </View>
          <View style={s.cardRow}>
            <Text style={[s.cardPreview, hasUnread && s.cardPreviewBold]} numberOfLines={1}>
              {item.last_message || 'No messages yet'}
            </Text>
            {hasUnread && !item.is_muted && (
              <View style={s.badge}>
                <Text style={s.badgeTxt}>{item.unread_count > 99 ? '99+' : item.unread_count}</Text>
              </View>
            )}
            {hasUnread && item.is_muted && <View style={s.mutedDot} />}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // ── Active meeting card ────────────────────────────────────────────────────
  const shareMeeting = async (m: MyActiveMeeting) => {
    const link = meetingService.shareLink(m.room_name);
    try { await Share.share({ message: `Join my meeting on PlatinumCircles: ${m.title}\n\n${link}` }); } catch {}
  };

  const renderActiveMeeting = (m: MyActiveMeeting) => (
    <View key={m.id} style={s.activeCard}>
      <View style={s.activePulseWrap}>
        <View style={s.activePulse} />
        <View style={s.activeIconWrap}>
          <Feather name="video" size={16} color="#FFF" />
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.activeLabel}>LIVE MEETING</Text>
        <Text style={s.activeTitle} numberOfLines={1}>{m.title}</Text>
        <Text style={s.activeSub}>
          {m.participant_count} active · {m.is_public ? 'Public' : 'Invite-only'}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <TouchableOpacity style={s.activeShareBtn} onPress={() => shareMeeting(m)} activeOpacity={0.8}>
          <Feather name="share-2" size={14} color={NAVY} />
        </TouchableOpacity>
        <TouchableOpacity
          style={s.activeJoinBtn}
          onPress={() => navigation.navigate('Meeting', { roomName: m.room_name, meetingId: m.id, isHost: true })}
          activeOpacity={0.85}
        >
          <Text style={s.activeJoinTxt}>Rejoin</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Quick access tiles ─────────────────────────────────────────────────────
  const quickAccess = [
    { key: 'calls',    icon: 'phone',       label: 'Calls',     color: '#2563EB', onPress: () => navigation.navigate('CallLog') },
    { key: 'meetings', icon: 'video',       label: 'Meetings',  color: '#7C3AED', onPress: () => navigation.navigate('NewMeeting') },
    { key: 'requests', icon: 'user-plus',   label: 'Requests',  color: '#F59E0B', onPress: () => navigation.navigate('MessageRequests') },
    { key: 'starred',  icon: 'star',        label: 'Starred',   color: '#EAB308', onPress: () => navigation.navigate('StarredMessages') },
  ] as const;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={s.head}>
        <Text style={s.title}>Messages</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            style={s.iconBtn}
            onPress={() => {
              setSearchOpen(s => !s);
              setTimeout(() => searchInputRef.current?.focus(), 50);
            }}
            accessibilityLabel="Search"
            activeOpacity={0.7}
          >
            <Feather name="search" size={18} color="#374151" />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.primaryBtn}
            onPress={showPrimaryActions}
            accessibilityLabel="New"
            activeOpacity={0.85}
          >
            <Feather name="plus" size={18} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search (collapsible) */}
      {searchOpen && (
        <View style={s.searchWrap}>
          <Feather name="search" size={15} color="#8E8E93" />
          <TextInput
            ref={searchInputRef}
            value={search} onChangeText={setSearch}
            placeholder="Search messages and people"
            placeholderTextColor="#8E8E93" style={s.searchInput}
            autoCapitalize="none" returnKeyType="search"
          />
          {search.length > 0
            ? <TouchableOpacity onPress={() => setSearch('')}><Feather name="x" size={15} color="#8E8E93" /></TouchableOpacity>
            : <TouchableOpacity onPress={() => { setSearchOpen(false); setSearch(''); }}><Text style={s.cancelTxt}>Cancel</Text></TouchableOpacity>}
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        stickyHeaderIndices={[2]}
        showsVerticalScrollIndicator={false}
      >

        {/* Active meetings strip */}
        {activeMeetings.length > 0 && (
          <View style={s.activeStrip}>
            {activeMeetings.length === 1
              ? renderActiveMeeting(activeMeetings[0])
              : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 14 }}>
                  {activeMeetings.map(m => (
                    <View key={m.id} style={{ width: 280 }}>{renderActiveMeeting(m)}</View>
                  ))}
                </ScrollView>
              )
            }
          </View>
        )}

        {/* Quick access tiles */}
        <View style={s.quickRow}>
          {quickAccess.map(q => (
            <TouchableOpacity key={q.key} style={s.quickTile} onPress={q.onPress} activeOpacity={0.8}>
              <View style={[s.quickIcon, { backgroundColor: q.color + '22' }]}>
                <Feather name={q.icon as any} size={18} color={q.color} />
              </View>
              <Text style={s.quickLabel}>{q.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tabs (sticky) */}
        <View style={s.tabsWrap}>
          <View style={s.tabs}>
            {(['all', 'unread', 'groups', 'archived'] as const).map(t => {
              const badge =
                t === 'unread' ? counts.unread :
                t === 'groups' ? counts.groups :
                t === 'archived' ? counts.archived : 0;
              return (
                <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)} activeOpacity={0.8}>
                  <Text style={[s.tabTxt, tab === t && s.tabTxtActive]}>
                    {t === 'all' ? 'All' : t === 'unread' ? 'Unread' : t === 'groups' ? 'Groups' : 'Archived'}
                  </Text>
                  {badge > 0 && (
                    <View style={[s.tabBadge, tab === t && s.tabBadgeActive]}>
                      <Text style={[s.tabBadgeTxt, tab === t && s.tabBadgeTxtActive]}>{badge > 99 ? '99+' : badge}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Conversation list */}
        {loading ? (
          <View style={s.centerInline}><ActivityIndicator color="#000" /></View>
        ) : filtered.length === 0 ? (
          <View style={s.emptyInline}>
            <Feather
              name={tab === 'unread' ? 'check-circle' : tab === 'archived' ? 'archive' : 'message-circle'}
              size={44}
              color={tab === 'unread' ? '#22C55E' : '#E5E5EA'}
            />
            <Text style={s.emptyTitle}>
              {search ? 'No results' :
                tab === 'unread' ? "You're all caught up" :
                tab === 'archived' ? 'No archived chats' :
                tab === 'groups' ? 'No groups yet' :
                'No messages yet'}
            </Text>
            <Text style={s.emptySub}>
              {search ? 'Try a different search' :
                tab === 'unread' ? 'No unread messages right now.' :
                tab === 'archived' ? 'Long-press a chat to archive it.' :
                tab === 'groups' ? 'Tap + to start a new group.' :
                'Connect with PlatinumCircles and start a conversation.'}
            </Text>
            {!search && tab === 'all' && (
              <TouchableOpacity style={s.emptyBtn} onPress={() => navigation.navigate('Network')}>
                <Text style={s.emptyBtnTxt}>Find people</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={{ paddingHorizontal: 12, paddingTop: 4, gap: 8 }}>
            {pinned.length > 0 && (
              <Text style={s.sectionLabel}>PINNED</Text>
            )}
            {pinned.map(item => <View key={item.id}>{renderItem({ item })}</View>)}
            {pinned.length > 0 && unpinned.length > 0 && (
              <Text style={[s.sectionLabel, { marginTop: 10 }]}>ALL MESSAGES</Text>
            )}
            {unpinned.map(item => <View key={item.id}>{renderItem({ item })}</View>)}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// Accepts:
//   - https://PlatinumCirclesnest.app/meeting/abc12345
//   - https://platinumcircles.daily.co/abc12345
//   - PlatinumCircles-nest://meeting/abc12345
//   - abc12345 (just the room code)
function parseMeetingRoomName(raw?: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  const patterns = [
    /PlatinumCirclesnest\.app\/meeting\/([a-z0-9-]{4,60})/i,
    /daily\.co\/([a-z0-9-]{4,60})/i,
    /PlatinumCircles-nest:\/\/meeting\/([a-z0-9-]{4,60})/i,
    /^([a-z0-9-]{4,60})$/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerInline: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },

  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  title: { fontSize: 28, fontWeight: '800', color: '#000', letterSpacing: -0.8 },
  iconBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  primaryBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },

  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginBottom: 10, backgroundColor: '#F2F2F7', borderRadius: 13, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 15, color: '#000', padding: 0 },
  cancelTxt: { color: '#2563EB', fontSize: 14, fontWeight: '600' },

  activeStrip: { paddingBottom: 10 },
  activeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 14, padding: 12, borderRadius: 16, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
  activePulseWrap: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  activePulse: { position: 'absolute', width: 42, height: 42, borderRadius: 21, backgroundColor: '#FCA5A5', opacity: 0.5 },
  activeIconWrap: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#DC2626', alignItems: 'center', justifyContent: 'center' },
  activeLabel: { fontSize: 10, fontWeight: '800', color: '#DC2626', letterSpacing: 0.8, marginBottom: 2 },
  activeTitle: { fontSize: 14, fontWeight: '700', color: '#000' },
  activeSub: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  activeJoinBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#DC2626' },
  activeJoinTxt: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  activeShareBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#FECACA', alignItems: 'center', justifyContent: 'center' },

  quickRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  quickTile: { alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 6, minWidth: 60 },
  quickIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontSize: 11, fontWeight: '700', color: '#374151' },

  tabsWrap: { backgroundColor: '#FFF', paddingTop: 10, paddingBottom: 6 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 14 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#F2F2F7' },
  tabActive: { backgroundColor: '#000' },
  tabTxt: { fontSize: 13, fontWeight: '700', color: '#3C3C43' },
  tabTxtActive: { color: '#FFF' },
  tabBadge: { backgroundColor: '#DC2626', borderRadius: 10, minWidth: 18, height: 18, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  tabBadgeActive: { backgroundColor: '#FFF' },
  tabBadgeTxt: { color: '#FFF', fontSize: 10, fontWeight: '800' },
  tabBadgeTxtActive: { color: '#000' },

  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#8E8E93', letterSpacing: 0.8, paddingHorizontal: 4 },

  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F7F7F7', borderRadius: 18, padding: 14 },
  cardAvatarWrap: { position: 'relative' },
  cardAvatar: { width: 50, height: 50, borderRadius: 16 },
  cardAvatarTxt: { fontSize: 18, fontWeight: '800', color: '#FFF' },
  pinBadge: { position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  pinBadgeTxt: { fontSize: 10 },
  cardBody: { flex: 1, gap: 4 },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardName: { fontSize: 15, fontWeight: '600', color: '#000', flex: 1 },
  cardNameBold: { fontWeight: '800' },
  cardTime: { fontSize: 11, color: '#8E8E93' },
  cardTimeBold: { color: '#000', fontWeight: '700' },
  cardPreview: { fontSize: 13, color: '#8E8E93', flex: 1 },
  cardPreviewBold: { color: '#3C3C43', fontWeight: '500' },
  badge: { backgroundColor: '#000', borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeTxt: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  mutedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D1D5DB' },

  emptyInline: { alignItems: 'center', paddingHorizontal: 40, paddingTop: 40, paddingBottom: 20, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#000', marginTop: 6 },
  emptySub: { fontSize: 14, color: '#8E8E93', textAlign: 'center', lineHeight: 20 },
  emptyBtn: { marginTop: 14, backgroundColor: '#000', borderRadius: 14, paddingHorizontal: 28, paddingVertical: 13 },
  emptyBtnTxt: { color: '#FFF', fontSize: 15, fontWeight: '700' },
});