import TierName from '../../components/TierName';
import VerifiedBadge from '../../components/VerifiedBadge';
import { handleTabBarScroll } from '../../components/AdaptiveTabBar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  TextInput, Image, ActivityIndicator, StatusBar,
  ActionSheetIOS, Alert, Platform, Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useUnreadStore } from '../../stores/unreadStore';
import { storiesService } from '../../services/storiesService';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { useDraftStore } from '../../stores/draftStore';
import { Ionicons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { ConversationsSkeleton } from '../../components/Skeleton';

type Conversation = {
  id: string;
  other_user_id: string;
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

export default function ConversationsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [typingConvIds, setTypingConvIds] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [mentionTimes, setMentionTimes] = useState<Record<string, number>>({});
  const openedTimes = useDraftStore(s => s.openedTimes);
  useEffect(() => {
    if (showArchived && !conversations.some(c => c.is_archived && ((c as any).context || 'personal') === 'personal')) {
      setShowArchived(false);
    }
  }, [showArchived, conversations]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]  = useState('');
  const [tab, setTab]        = useState<'all' | 'groups' | 'unread'>('all');
  // Reuses the same source the story strip draws from, so a ring here and a
  // ring on the feed never disagree.
  const [storyRings, setStoryRings] = useState<Record<string, boolean>>({});
  useFocusEffect(useCallback(() => {
    let alive = true;
    storiesService.getCatchupFeed('all', 60).then(users => {
      if (!alive) return;
      const map: Record<string, boolean> = {};
      (users || []).forEach((u: any) => { if (u?.user_id) map[u.user_id] = !!u.has_unseen; });
      setStoryRings(map);
    });
    return () => { alive = false; };
  }, []));
  useFocusEffect(useCallback(() => { useUnreadStore.getState().refresh(); }, []));

  const mountedRef = useRef(true);
  const initialLoadDoneRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

useEffect(() => {
    if (!userId) return;
    let live = true;
    const tick = async () => {
      try {
        const { data } = await supabase
          .from('conversation_typing')
          .select('conversation_id, user_id, updated_at')
          .eq('is_typing', true)
          .gt('updated_at', new Date(Date.now() - 8000).toISOString());
        if (!live) return;
        const mine = new Set(conversations.map(c => c.id));
        const next = new Set<string>();
        (data || []).forEach((r: any) => {
          if (r.user_id !== userId && mine.has(r.conversation_id)) next.add(r.conversation_id);
        });
        setTypingConvIds(prev => {
          if (prev.size === next.size && [...prev].every(x => next.has(x))) return prev;
          return next;
        });
      } catch {}
    };
    tick();
    const iv = setInterval(tick, 3500);
    const ch = supabase.channel(`list_typing_${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_typing' }, () => tick())
      .subscribe();
    return () => { live = false; clearInterval(iv); supabase.removeChannel(ch); };
  }, [userId, conversations]);

  const load = useCallback(async () => {
    if (!userId) return;
    if (!initialLoadDoneRef.current) setLoading(true);
    try {
      // Load DMs
      const { data: dmConvs } = await supabase
        .from('conversations')
        .select('*')
        .or(`user_1.eq.${userId},user_2.eq.${userId}`)
        .eq('is_group', false)
        .order('last_message_time', { ascending: false });

      // Load group convs via conversation_members
      const { data: memberRows } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', userId);

      const groupIds = (memberRows || []).map((r: any) => r.conversation_id);
      let groupConvs: any[] = [];
      if (groupIds.length > 0) {
        const { data: gc } = await supabase
          .from('conversations')
          .select('*')
          .in('id', groupIds)
          .eq('is_group', true)
          .order('last_message_time', { ascending: false });
        groupConvs = gc || [];
      }

      const allConvs = [...(dmConvs || []), ...groupConvs];
      if (allConvs.length === 0) {
        if (mountedRef.current) setConversations([]);
        return;
      }

      const convIds = allConvs.map((c: any) => c.id);

      // Load conversation settings — non-fatal
      let settingsMap: Record<string, any> = {};
      try {
        const { data: settings } = await supabase
          .from('conversation_settings')
          .select('conversation_id, is_pinned, is_muted, is_archived, is_deleted, manually_unread')
          .eq('user_id', userId)
          .in('conversation_id', convIds);
        (settings || []).forEach((s: any) => { settingsMap[s.conversation_id] = s; });
      } catch (_) { /* table may not exist yet */ }

      // Load DM partner profiles
      const dmOtherIds = (dmConvs || [])
        .map((c: any) => c.user_1 === userId ? c.user_2 : c.user_1)
        .filter(Boolean);
      const profileMap: Record<string, any> = {};
      if (dmOtherIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles').select('id, full_name, username, avatar_url, is_verified, verified_tier').in('id', dmOtherIds);
        (profs || []).forEach((p: any) => { profileMap[p.id] = p; });
      }

      // Unread counts
      const { data: unreadData } = await supabase.rpc('get_unread_counts');
      const unreadMap: Record<string, number> = {};
      (unreadData || []).forEach((m: any) => {
        unreadMap[m.conversation_id] = (unreadMap[m.conversation_id] || 0) + (m.unread || 0);
      });

      const list: Conversation[] = allConvs
        .filter((c: any) => !(settingsMap[c.id]?.is_deleted))
        .map((c: any) => {
          const s = settingsMap[c.id] || {};
          if (c.is_group) {
            return {
              id: c.id, other_user_id: '',
              other_name: c.group_name || 'Group',
              other_username: null, other_avatar: c.group_avatar_url || null,
              last_message: c.last_message || '', last_message_time: c.last_message_time,
              unread_count: unreadMap[c.id] || 0,
              context: c.context || 'personal', is_group: true, group_emoji: c.group_emoji || '💬',
              group_avatar_url: c.group_avatar_url,
              is_pinned: !!s.is_pinned, is_muted: !!s.is_muted, is_archived: !!s.is_archived, manually_unread: !!(s as any).manually_unread,
            };
          }
          const otherId = c.user_1 === userId ? c.user_2 : c.user_1;
          const p = profileMap[otherId] || {};
          return {
            id: c.id, other_user_id: otherId,
            other_name: p.full_name || 'Member',
            other_is_verified: !!(p as any).is_verified, other_verified_tier: (p as any).verified_tier ?? null,
            other_username: p.username || null, other_avatar: p.avatar_url || null,
            last_message: c.last_message || '', last_message_time: c.last_message_time,
            unread_count: unreadMap[c.id] || 0,
            context: c.context || 'personal', is_group: false, group_emoji: null, group_avatar_url: null,
            is_pinned: !!s.is_pinned, is_muted: !!s.is_muted, is_archived: !!s.is_archived, manually_unread: !!(s as any).manually_unread,
          };
        });

      list.sort((a, b) => {
        if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
        const ta = a.last_message_time ? new Date(a.last_message_time).getTime() : 0;
        const tb = b.last_message_time ? new Date(b.last_message_time).getTime() : 0;
        return tb - ta;
      });

      if (mountedRef.current) setConversations(list);
    } catch (e) { console.log('[Conversations] load error:', e); }
    finally {
      if (mountedRef.current) setLoading(false);
      initialLoadDoneRef.current = true;
    }
  }, [userId]);

  useFocusEffect(useCallback(() => {
    if (initialLoadDoneRef.current) {
      const timer = setTimeout(load, 500);
      return () => clearTimeout(timer);
    } else {
      load();
    }
  }, [load]));

  useEffect(() => {
    if (!userId) return;

    const sortInbox = (rows: Conversation[]) => {
      return [...rows].sort((a, b) => {
        if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
        const ta = a.last_message_time ? new Date(a.last_message_time).getTime() : 0;
        const tb = b.last_message_time ? new Date(b.last_message_time).getTime() : 0;
        return tb - ta;
      });
    };

    const convCh = supabase
      .channel(`inbox_conv_${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations' },
        (payload) => {
          const convRow = payload.new as any;
          setConversations(prev => {
            const idx = prev.findIndex(c => c.id === convRow.id);
            if (idx === -1) return prev;

            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              last_message: convRow.last_message || updated[idx].last_message,
              last_message_time: convRow.last_message_time || updated[idx].last_message_time,
              last_sender_id: convRow.last_sender_id ?? (updated[idx] as any).last_sender_id,
              last_sender_name: convRow.last_sender_name ?? (updated[idx] as any).last_sender_name,
            } as any;

            return sortInbox(updated);
          });
        }
      )
      .subscribe();

    const msgCh = supabase
      .channel(`inbox_msg_${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const msg = payload.new as any;
          if (!msg.conversation_id || msg.sender_id === userId) return;
          if (msg.receiver_id && msg.receiver_id !== userId) return; // someone else's DM

          setConversations(prev => {
            const idx = prev.findIndex(c => c.id === msg.conversation_id);
            if (idx === -1) {
              load();
              return prev;
            }

            const preview = msg.text || (
              msg.media_type === 'image' ? '📷 Photo'
              : msg.media_type === 'video' ? '🎬 Video'
              : msg.media_type === 'document' ? '📄 File'
              : '📎 Media'
            );

            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              unread_count: (updated[idx].unread_count || 0) + 1,
              last_message: preview,
              last_message_time: msg.created_at,
            };

            return sortInbox(updated);
          });
        }
      )
      // Phase 4.0A: Outgoing message listener
      // Catches story replies and other messages sent by the user from outside ChatScreen
      // so the conversations list updates immediately without waiting for a full reload
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `sender_id=eq.${userId}` },
        (payload) => {
          const msg = payload.new as any;
          if (!msg.conversation_id) return;

          const preview = msg.text || (
            msg.media_type === 'image' ? '📷 Photo'
            : msg.media_type === 'video' ? '🎬 Video'
            : msg.media_type === 'document' ? '📄 File'
            : '📎 Media'
          );

          setConversations(prev => {
            const idx = prev.findIndex(c => c.id === msg.conversation_id);
            if (idx === -1) {
              load();
              return prev;
            }

            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              last_message: preview,
              last_message_time: msg.created_at,
              // Do NOT increment unread_count — this is the user's own message
            };

            return sortInbox(updated);
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(convCh);
      supabase.removeChannel(msgCh);
    };
  }, [userId, load]);

  // ── Conversation settings helpers ─────────────────────────────────────────

  const upsertSetting = async (convId: string, patch: Partial<{
    is_pinned: boolean; is_muted: boolean; is_archived: boolean; is_deleted: boolean;
  }>) => {
    if (!userId) return;
    try { await supabase.from('conversation_settings').upsert({
      conversation_id: convId, user_id: userId,
      ...patch, updated_at: new Date().toISOString(),
    }, { onConflict: 'conversation_id,user_id' }); } catch (e) { console.log('[UPSERT_SETTING]', e); }
    setConversations(prev => prev.map(c =>
      c.id === convId ? { ...c, ...patch } : c
    ).filter(c => !('is_deleted' in patch && patch.is_deleted && c.id === convId)));
  };

  const showContextMenu = (conv: Conversation) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const options = [
      conv.is_pinned   ? 'Unpin'   : 'Pin',
      conv.is_muted    ? 'Unmute'  : 'Mute',
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
          if (choice === 'Block user') {
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
      // Android fallback
      Alert.alert(conv.other_name, undefined, [
        { text: conv.is_pinned ? 'Unpin' : 'Pin',     onPress: () => upsertSetting(conv.id, { is_pinned: !conv.is_pinned }) },
        { text: conv.is_muted ? 'Unmute' : 'Mute',    onPress: () => upsertSetting(conv.id, { is_muted: !conv.is_muted }) },
        { text: conv.is_archived ? 'Unarchive' : 'Archive', onPress: () => upsertSetting(conv.id, { is_archived: !conv.is_archived }) },
        { text: 'Delete', style: 'destructive', onPress: () => upsertSetting(conv.id, { is_deleted: true }) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  // ── Open chat ─────────────────────────────────────────────────────────────

const setConvSetting = useCallback(async (conv: Conversation, patch: Record<string, any>) => {
    setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, ...patch } : c));
    try {
      await supabase.from('conversation_settings').upsert({
        conversation_id: conv.id, user_id: userId, ...patch,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'conversation_id,user_id' });
    } catch {
      setConversations(prev => prev.map(c => c.id === conv.id
        ? { ...c, ...Object.fromEntries(Object.keys(patch).map(k => [k, (conv as any)[k]])) } : c));
    }
  }, [userId]);

  const openChat = (conv: Conversation) => {
    useDraftStore.getState().markOpened(conv.id);
    if ((conv as any).manually_unread) setConvSetting(conv, { manually_unread: false } as any);
    setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, unread_count: 0 } : c));
    navigation.navigate('Chat', {
      conversationId: conv.id,
      userId: conv.other_user_id,
      userName: conv.other_name,
      otherUser: conv.is_group ? null : {
        id: conv.other_user_id,
        full_name: conv.other_name,
        username: conv.other_username,
        avatar_url: conv.other_avatar,
      },
      isGroup: conv.is_group,
      groupName: conv.is_group ? conv.other_name : undefined,
      groupEmoji: conv.is_group ? (conv.group_emoji || '💬') : undefined,
      groupAvatarUrl: conv.is_group ? conv.group_avatar_url : undefined,
    });
  };

  // ── Filter ────────────────────────────────────────────────────────────────

  const filtered = conversations.filter(c => {
    // Market and job conversations live in their own tabs now, never here.
    const ctxOf = (c as any).context || 'personal';
    if (ctxOf === 'market' || ctxOf === 'jobs') return false;
    if (showArchived) return !!c.is_archived && ((c as any).context || 'personal') === 'personal';
    if (c.is_archived) return false; // archived chats live behind the Archived row
    const matchSearch = !search || c.other_name.toLowerCase().includes(search.toLowerCase());
    const ctx = (c as any).context || 'personal';
    const matchTab = tab === 'all'
      ? ctx === 'personal'
      : tab === 'unread' ? c.unread_count > 0
      : tab === 'groups' ? c.is_group
      : true;
    return matchSearch && matchTab;
  });

  // ── Render conversation row ───────────────────────────────────────────────

useEffect(() => {
    if (!userId || conversations.length === 0) return;
    let live = true;
    (async () => {
      try {
        const { data: ment } = await supabase
          .from('message_mentions')
          .select('message_id, created_at')
          .eq('mentioned_user_id', userId)
          .gt('created_at', new Date(Date.now() - 7 * 86400000).toISOString());
const timeByMsg: Record<string, number> = {};
        (ment || []).forEach((r: any) => { timeByMsg[r.message_id] = new Date(r.created_at).getTime(); });
        const msgIds = Object.keys(timeByMsg);
        const times: Record<string, number> = {};
        if (msgIds.length) {
          const { data: msgs } = await supabase
            .from('messages').select('id, conversation_id').in('id', msgIds);
          (msgs || []).forEach((m: any) => {
            if (!m.conversation_id) return;
            times[m.conversation_id] = Math.max(times[m.conversation_id] || 0, timeByMsg[m.id] || 0);
          });
        }
        if (!live) return;
        // one-time amnesty: a fresh opened-clock forgives all existing mentions
        const hydrated = (useDraftStore as any).persist?.hasHydrated?.() ?? true;
        const ot = useDraftStore.getState().openedTimes;
        if (hydrated && Object.keys(ot).length === 0) {
          Object.keys(times).forEach(id => useDraftStore.getState().markOpened(id));
        }
        setMentionTimes(times);
      } catch {}
    })();
    return () => { live = false; };
  }, [userId, conversations]);

const swipeActions = (item: Conversation) => (
    <View style={{ flexDirection: 'row' }}>
      <TouchableOpacity
        onPress={() => setConvSetting(item, { manually_unread: !(item as any).manually_unread } as any)}
        style={{ width: 78, backgroundColor: '#0B1E3D', alignItems: 'center', justifyContent: 'center' }}>
        <Feather name={(item as any).manually_unread ? 'check-circle' : 'circle'} size={20} color="#FFF" />
        <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '700', marginTop: 4 }}>{(item as any).manually_unread ? 'Read' : 'Unread'}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => setConvSetting(item, { is_archived: !item.is_archived })}
        style={{ width: 78, backgroundColor: '#059669', alignItems: 'center', justifyContent: 'center' }}>
        <Feather name="archive" size={20} color="#FFF" />
        <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '700', marginTop: 4 }}>{item.is_archived ? 'Unarchive' : 'Archive'}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderItem = ({ item }: { item: Conversation }) => {
    const hasUnread = item.unread_count > 0 || !!(item as any).manually_unread;
    const youPrefix = (item as any).last_sender_id === userId ? 'You: '
      : (item.is_group && (item as any).last_sender_name) ? (item as any).last_sender_name + ': ' : '';
    const draftText = useDraftStore.getState().drafts[item.id];
    const storyRing = !item.is_group && item.other_user_id ? storyRings[item.other_user_id] : undefined;
    const ringStyle = storyRing === undefined
      ? null
      : storyRing
        ? { borderWidth: 3, borderColor: '#B08D3F' }
        : { borderWidth: 2, borderColor: 'rgba(11,30,61,0.20)' };
    return (
      <Swipeable renderRightActions={() => swipeActions(item)} overshootRight={false} friction={2}>
      <TouchableOpacity
        style={[s.card, item.is_archived && s.cardArchived]}
        onPress={() => openChat(item)}
        onLongPress={() => showContextMenu(item)}
        activeOpacity={0.85}
      >
        {/* Avatar */}
        <TouchableOpacity
          style={[s.cardAvatarWrap, ringStyle]}
          activeOpacity={storyRing === undefined ? 1 : 0.75}
          onPress={() => {
            if (storyRing === undefined || !item.other_user_id) { openChat(item); return; }
            navigation.navigate('StoryViewer', { userIds: [item.other_user_id], startUserId: item.other_user_id });
          }}
          accessibilityRole='button'
          accessibilityLabel={storyRing === undefined ? 'Open chat' : 'View story'}
        >
          {item.other_avatar
            ? <Image source={{ uri: item.other_avatar }} style={s.cardAvatar} fadeDuration={200} />
            : item.is_group
              ? <View style={[s.cardAvatar, { backgroundColor: '#0B1E3D', alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ fontSize: 22 }}>{item.group_emoji || '💬'}</Text>
                </View>
              : <View style={[s.cardAvatar, { backgroundColor: avatarColor(item.other_user_id) }]}>
                  <Text style={s.cardAvatarTxt}>{initials(item.other_name)}</Text>
                </View>}
          {item.is_pinned && <View style={s.pinBadge}><Text style={s.pinBadgeTxt}>📌</Text></View>}
        </TouchableOpacity>

        {/* Body */}
        <View style={s.cardBody}>
          <View style={s.cardRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 }}>
                <TierName tier={(item as any).type !== 'group' ? ((item as any).other_verified_tier ?? (((item as any).other_is_verified) ? 'business' : null)) : null} baseStyle={[s.cardName, hasUnread && s.cardNameBold, { flexShrink: 1, flex: 0 }]} text={item.other_name} />
                {(((item as any).other_verified_tier || (item as any).other_is_verified) && (item as any).type !== 'group') ? <VerifiedBadge tier={(item as any).other_verified_tier} size={14} /> : null}
              </View>
              {item.is_muted && <Text style={{ fontSize: 11 }}>🔕</Text>}
              {item.is_archived && <View style={s.archivedBadge}><Text style={s.archivedTxt}>Archived</Text></View>}
            </View>
            <Text style={[s.cardTime, hasUnread && s.cardTimeBold]}>{relTime(item.last_message_time)}</Text>
          </View>
          <View style={s.cardRow}>
            {!typingConvIds.has(item.id) && draftText ? (
              <Text style={[s.cardPreview]} numberOfLines={1}><Text style={{ color: '#059669', fontWeight: '700' }}>Draft: </Text>{draftText}</Text>
            ) : typingConvIds.has(item.id) ? (
              <Text style={[s.cardPreview, { color: '#34C759', fontWeight: '600', fontStyle: 'italic' }]} numberOfLines={1}>typing...</Text>
            ) : (
            <Text style={[s.cardPreview, hasUnread && s.cardPreviewBold]} numberOfLines={1}>
              {(() => {
                const mentioned = (mentionTimes[item.id] || 0) > (openedTimes[item.id] || 0);
                const raw = item.last_message ? youPrefix + item.last_message : 'No messages yet';
                if (!mentioned) return raw;
                return String(raw).split(/(@[A-Za-z0-9_\.]{2,30})/g).map((part, i) =>
                  part.startsWith('@')
                    ? <Text key={i} style={{ color: '#059669', fontWeight: '800' }}>{part}</Text>
                    : <Text key={i}>{part}</Text>
                );
              })()}
            </Text>
            )}
            {hasUnread && !item.is_muted && (
              <View style={s.badge}>
                <Text style={s.badgeTxt}>{item.unread_count > 99 ? '99+' : item.unread_count}</Text>
              </View>
            )}
            {hasUnread && item.is_muted && <View style={s.mutedDot} />}
          </View>
        </View>
      </TouchableOpacity>
      </Swipeable>
    );
  };

  const pinned   = filtered.filter(c => c.is_pinned);
  const unpinned = filtered.filter(c => !c.is_pinned);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={s.head}>
        <Text style={s.title}>Messages</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={s.iconBtn} onPress={() => navigation.navigate('SavedMessages')}>
            <Feather name="bookmark" size={18} color="#374151" />
          </TouchableOpacity>
          <TouchableOpacity style={s.newBtn} onPress={() => navigation.navigate('FindPeople')} activeOpacity={0.8}>
            <Ionicons name="create" size={15} color="#FFF" />
            <Text style={s.newBtnTxt}>New</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search */}
      <View style={s.searchWrap}>
        <Feather name="search" size={15} color="#8E8E93" />
        <TextInput
          value={search} onChangeText={setSearch}
          placeholder="Search messages"
          placeholderTextColor="#8E8E93" style={s.searchInput}
          autoCapitalize="none" returnKeyType="search"
        />
        {search.length > 0 && <TouchableOpacity onPress={() => setSearch('')}><Feather name="x" size={15} color="#8E8E93" /></TouchableOpacity>}
      </View>

      {/* Tabs */}
      <View style={s.tabs}>
        {(['all', 'groups', 'unread'] as const).map(t => (
          <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)} activeOpacity={0.8}>
            <Text style={[s.tabTxt, tab === t && s.tabTxtActive]}>
              {t === 'all' ? 'Chats' : t === 'groups' ? 'Groups' : 'Unread'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      {loading ? (
        <View style={s.center}><ConversationsSkeleton /></View>
      ) : filtered.length === 0 ? (
        <View style={s.empty}>
          <Feather name="message-circle" size={44} color="#E5E5EA" />
          <Text style={s.emptyTitle}>{search ? 'No results' : tab === 'unread' ? 'All caught up' : 'No messages yet'}</Text>
          <Text style={s.emptySub}>{search ? 'Try a different search' : 'Connect with PlatinumCircles and start a conversation'}</Text>
          {!search && <TouchableOpacity style={s.emptyBtn} onPress={() => navigation.navigate('FindPeople')}><Text style={s.emptyBtnTxt}>Find people</Text></TouchableOpacity>}
        </View>
      ) : (
        <FlatList
          data={[...pinned, ...unpinned]}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          onScroll={handleTabBarScroll} scrollEventThrottle={16} contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          removeClippedSubviews={Platform.OS === 'android'}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={10}
          ListHeaderComponent={(() => {
            const archCount = conversations.filter(c => c.is_archived && ((c as any).context || 'personal') === 'personal').length;
            return (
            <View>
              {!showArchived && archCount > 0 && (
                <TouchableOpacity onPress={() => setShowArchived(true)} activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
                  <Feather name="archive" size={19} color="rgba(11,30,61,0.55)" />
                  <Text style={{ flex: 1, fontSize: 15.5, fontWeight: '600', color: '#0B1E3D' }}>Archived</Text>
                  <Text style={{ fontSize: 13.5, fontWeight: '600', color: 'rgba(11,30,61,0.45)' }}>{archCount}</Text>
                </TouchableOpacity>
              )}
              {showArchived && (
                <TouchableOpacity onPress={() => setShowArchived(false)} activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 }}>
                  <Feather name="chevron-left" size={20} color="#0B1E3D" />
                  <Text style={{ fontSize: 15.5, fontWeight: '700', color: '#0B1E3D' }}>Archived chats</Text>
                </TouchableOpacity>
              )}
              {pinned.length > 0 && unpinned.length > 0 ? (
            <Text style={s.sectionLabel}>PINNED</Text>
          ) : null}
            </View>
            );
          })()}
          ListHeaderComponentStyle={{ paddingHorizontal: 4, paddingBottom: 4 }}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({

  safe: { flex: 1, backgroundColor: '#FFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  title: { fontSize: 30, fontWeight: '700', color: '#0A0A0A', letterSpacing: -0.9 },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#0B1E3D', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  newBtnTxt: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginBottom: 10, backgroundColor: '#F0F0F2', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9 },
  searchInput: { flex: 1, fontSize: 15, color: '#000', padding: 0 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, marginBottom: 8 },
  tab: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(11,30,61,0.05)' },
  tabActive: { backgroundColor: '#0B1E3D' },
  tabTxt: { fontSize: 13, fontWeight: '700', color: '#4A5568', letterSpacing: -0.1 },
  tabTxtActive: { color: '#FFF' },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#8E8E93', letterSpacing: 0.8 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#FFFFFF', borderRadius: 0, paddingHorizontal: 16, paddingVertical: 10 },
  cardArchived: { opacity: 0.6 },
  cardAvatarWrap: { position: 'relative', padding: 2.5, borderRadius: 30, borderWidth: 0, borderColor: 'transparent' },
  cardAvatar: { width: 49, height: 49, borderRadius: 24.5 },
  cardAvatarTxt: { fontSize: 18, fontWeight: '800', color: '#FFF' },
  pinBadge: { position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  pinBadgeTxt: { fontSize: 10 },
  cardBody: { flex: 1, gap: 3, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E9E9EB', paddingBottom: 10 },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardName: { fontSize: 17, fontWeight: '500', color: '#0A0A0A', letterSpacing: -0.3, flex: 1 },
  cardNameBold: { fontWeight: '700', color: '#0B1E3D' },
  cardTime: { fontSize: 12, color: '#9AA0A6', marginLeft: 8, fontWeight: '500' },
  cardTimeBold: { color: '#0B1E3D', fontWeight: '600' },
  cardPreview: { fontSize: 14.5, color: '#8E8E93', flex: 1, letterSpacing: -0.1 },
  cardPreviewBold: { color: '#0B1E3D', fontWeight: '500' },
  badge: { backgroundColor: '#0B1E3D', borderRadius: 11, minWidth: 21, height: 21, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeTxt: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  mutedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D1D5DB' },
  archivedBadge: { backgroundColor: '#F3F4F6', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  archivedTxt: { fontSize: 10, color: '#6B7280', fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#000' },
  emptySub: { fontSize: 14, color: '#8E8E93', textAlign: 'center', lineHeight: 20 },
  emptyBtn: { marginTop: 10, backgroundColor: '#0B1E3D', borderRadius: 14, paddingHorizontal: 28, paddingVertical: 13 },
  emptyBtnTxt: { color: '#FFF', fontSize: 15, fontWeight: '700' },
});