/**
 * NotificationsScreen.tsx
 * Design: Option 3 — Card Style, Clean Premium.
 * Real-time via Supabase. Inline accept/decline for connection requests.
 * Filters: All, Requests, Likes, Mentions, Comments.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Image, StatusBar, RefreshControl, ScrollView, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

const NAVY = '#0B1E3D';
const BG_GREY = '#F7F7F9';
const TEXT_PRIMARY = '#000000';
const TEXT_SECONDARY = '#8E8E93';
const HAIRLINE = '#E5E5EA';

type NotifType =
  | 'like' | 'comment' | 'reply' | 'repost' | 'mention'
  | 'follow' | 'tag' | 'connection_request' | 'connection_accepted'
  | 'message' | 'event' | 'mentorship';

type Notification = {
  id: string;
  type: NotifType | string;
  recipient_id: string;
  actor_id: string | null;
  message: string | null;
  data: any;
  body_preview: string | null;
  read_at: string | null;
  created_at: string;
  actor?: { id?: string; full_name?: string | null; username?: string | null; avatar_url?: string | null };
  _connectionId?: string | null;
  _connectionStatus?: string | null;
};

type Filter = 'all' | 'requests' | 'likes' | 'mentions' | 'comments';

const FILTERS: { id: Filter; label: string; match: (n: Notification) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'requests', label: 'Requests', match: (n) => n.type === 'connection_request' || n.type === 'connection_accepted' || n.type === 'follow' },
  { id: 'likes', label: 'Likes', match: (n) => n.type === 'like' || n.type === 'repost' },
  { id: 'mentions', label: 'Mentions', match: (n) => n.type === 'mention' || n.type === 'tag' },
  { id: 'comments', label: 'Comments', match: (n) => n.type === 'comment' || n.type === 'reply' },
];

function getTypeMeta(type: string): { icon: any; color: string; defaultLabel: string } {
  switch (type) {
    case 'like':
      return { icon: 'heart', color: '#FF3B30', defaultLabel: 'liked your post' };
    case 'comment':
      return { icon: 'message-circle', color: '#0B1E3D', defaultLabel: 'commented on your post' };
    case 'reply':
      return { icon: 'corner-up-left', color: '#AF52DE', defaultLabel: 'replied to your comment' };
    case 'repost':
      return { icon: 'repeat', color: '#34C759', defaultLabel: 'reposted your post' };
    case 'mention':
      return { icon: 'at-sign', color: '#FF9500', defaultLabel: 'mentioned you' };
    case 'follow':
      return { icon: 'user-plus', color: '#0B1E3D', defaultLabel: 'started following you' };
    case 'connection_request':
      return { icon: 'user-plus', color: '#0B1E3D', defaultLabel: 'sent you a connection request' };
    case 'connection_accepted':
      return { icon: 'user-check', color: '#34C759', defaultLabel: 'accepted your connection' };
    case 'tag':
      return { icon: 'tag', color: '#5856D6', defaultLabel: 'tagged you' };
    case 'message':
      return { icon: 'message-square', color: '#0B1E3D', defaultLabel: 'sent you a message' };
    case 'event':
      return { icon: 'calendar', color: '#FF9500', defaultLabel: 'event update' };
    case 'mentorship':
      return { icon: 'award', color: '#AF52DE', defaultLabel: 'mentorship update' };
    default:
      return { icon: 'bell', color: '#8E8E93', defaultLabel: 'notification' };
  }
}

function getInitials(name?: string | null) {
  if (!name) return '?';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

const AVATAR_BG = ['#0B1E3D', '#1A3560', '#065F46', '#7C2D12', '#5856D6', '#C2410C', '#0F766E', '#AF52DE'];
function avatarBg(id?: string | null) {
  if (!id) return NAVY;
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % AVATAR_BG.length;
  return AVATAR_BG[Math.abs(h) % AVATAR_BG.length];
}

function formatTime(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`;
  if (dy < 7) return `${dy}d`;
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function NotificationsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<Filter>('all');
  const [actionBusy, setActionBusy] = useState<Record<string, boolean>>({});
  const mountedRef = useRef(true);

  const unreadCount = useMemo(() => notifications.filter(n => !n.read_at).length, [notifications]);
  const counts = useMemo(() => {
    const out: Record<Filter, number> = { all: 0, requests: 0, likes: 0, mentions: 0, comments: 0 };
    for (const n of notifications) {
      if (n.read_at) continue;
      out.all += 1;
      for (const f of FILTERS) if (f.id !== 'all' && f.match(n)) out[f.id] += 1;
    }
    return out;
  }, [notifications]);

  const filtered = useMemo(() => {
    const f = FILTERS.find(x => x.id === activeFilter) || FILTERS[0];
    return notifications.filter(f.match);
  }, [notifications, activeFilter]);

  const loadNotifications = useCallback(async () => {
    if (!userId) return;
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, recipient_id, actor_id, message, data, body_preview, read_at, created_at')
        .eq('recipient_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error || !data) return;

      const actorIds = Array.from(new Set(data.map((n: any) => n.actor_id).filter(Boolean)));
      const actorMap: Record<string, Notification['actor']> = {};
      if (actorIds.length > 0) {
        const { data: actors } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url')
          .in('id', actorIds);
        (actors || []).forEach((a: any) => {
          actorMap[a.id] = { id: a.id, full_name: a.full_name, username: a.username, avatar_url: a.avatar_url };
        });
      }

      const connRequestActors = data
        .filter((n: any) => n.type === 'connection_request' && n.actor_id)
        .map((n: any) => n.actor_id);

      const connMap: Record<string, { id: string; status: string }> = {};
      if (connRequestActors.length > 0) {
        const { data: conns } = await supabase
          .from('connections')
          .select('id, requester_id, status')
          .eq('recipient_id', userId)
          .in('requester_id', connRequestActors);
        (conns || []).forEach((c: any) => {
          connMap[c.requester_id] = { id: c.id, status: c.status };
        });
      }

      const hydrated: Notification[] = data.map((n: any) => {
        const conn = n.actor_id ? connMap[n.actor_id] : null;
        return {
          ...n,
          actor: n.actor_id ? actorMap[n.actor_id] : undefined,
          _connectionId: conn?.id ?? null,
          _connectionStatus: conn?.status ?? null,
        };
      });

      if (mountedRef.current) setNotifications(hydrated);
    } catch (e) {
      console.log('[NOTIFS_LOAD_ERR]', e);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    mountedRef.current = true;
    loadNotifications();
    if (!userId) return;

    const ch = supabase
      .channel(`notifications_${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
        () => loadNotifications()
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
        () => loadNotifications()
      )
      .subscribe();

    return () => {
      mountedRef.current = false;
      supabase.removeChannel(ch);
    };
  }, [loadNotifications, userId]);

  const markAllRead = async () => {
    if (!userId || unreadCount === 0) return;
    const now = new Date().toISOString();
    setNotifications(prev => prev.map(n => n.read_at ? n : { ...n, read_at: now }));
    const { error } = await supabase.from('notifications')
      .update({ read_at: now })
      .eq('recipient_id', userId)
      .is('read_at', null);
    if (error) {
      console.log('[MARK_ALL_ERR]', error.message);
      loadNotifications();
    }
  };

  const markOneRead = async (notif: Notification) => {
    if (notif.read_at) return;
    const now = new Date().toISOString();
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read_at: now } : n));
    await supabase.from('notifications').update({ read_at: now }).eq('id', notif.id);
  };

  const acceptRequest = async (notif: Notification) => {
    if (!notif._connectionId || actionBusy[notif.id]) return;
    setActionBusy(prev => ({ ...prev, [notif.id]: true }));
    const { error } = await supabase.from('connections')
      .update({ status: 'accepted', updated_at: new Date().toISOString() })
      .eq('id', notif._connectionId);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, _connectionStatus: 'accepted', read_at: new Date().toISOString() } : n));
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', notif.id);
    }
    setActionBusy(prev => ({ ...prev, [notif.id]: false }));
  };

  const declineRequest = async (notif: Notification) => {
    if (!notif._connectionId || actionBusy[notif.id]) return;
    setActionBusy(prev => ({ ...prev, [notif.id]: true }));
    const { error } = await supabase.from('connections')
      .delete()
      .eq('id', notif._connectionId);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, _connectionStatus: 'declined', read_at: new Date().toISOString() } : n));
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', notif.id);
    }
    setActionBusy(prev => ({ ...prev, [notif.id]: false }));
  };

  const handlePress = async (notif: Notification) => {
    await markOneRead(notif);
    const postId = notif.data?.post_id;
    const commentId = notif.data?.comment_id;
    const conversationId = notif.data?.conversation_id;

    if (postId) {
      navigation.navigate('Post', { postId, commentId });
      return;
    }
    if (conversationId) {
      navigation.navigate('Chat', { conversationId });
      return;
    }
    if (notif.actor_id) {
      navigation.navigate('UserProfile', { userId: notif.actor_id });
    }
  };

  const renderNotif = ({ item }: { item: Notification }) => {
    const meta = getTypeMeta(item.type);
    const actor = item.actor;
    const actorName = actor?.full_name || (actor?.username ? `@${actor.username}` : 'Someone');
    const labelAction = item.message?.trim() || meta.defaultLabel;
    const isUnread = !item.read_at;
    const isRequest = item.type === 'connection_request';
    const requestHandled = isRequest && (item._connectionStatus === 'accepted' || item._connectionStatus === 'declined' || !item._connectionId);
    const showActions = isRequest && item._connectionId && item._connectionStatus === 'pending' && !actionBusy[item.id];
    const busy = actionBusy[item.id];

    return (
      <TouchableOpacity
        style={[s.card, isUnread && s.cardUnread]}
        activeOpacity={0.82}
        onPress={() => handlePress(item)}
      >
        <View style={s.avaWrap}>
          {actor?.avatar_url ? (
            <ExpoImage source={{ uri: actor.avatar_url }} style={s.ava} contentFit="cover" />
          ) : (
            <View style={[s.ava, { backgroundColor: avatarBg(actor?.id) }]}>
              <Text style={s.avaTxt}>{getInitials(actorName)}</Text>
            </View>
          )}
          <View style={[s.typeBadge, { backgroundColor: meta.color }]}>
            <Feather name={meta.icon} size={10} color="#FFF" />
          </View>
        </View>

        <View style={s.nc}>
          <View style={s.nTop}>
            <Text style={s.nBody} numberOfLines={2}>
              <Text style={s.nActor}>{actorName}</Text>
              <Text style={s.nAction}> {labelAction}</Text>
            </Text>
            <Text style={s.nTime}>{formatTime(item.created_at)}</Text>
          </View>

          {item.body_preview ? (
            <Text style={s.nPreview} numberOfLines={2}>“{item.body_preview}”</Text>
          ) : null}

          {requestHandled && item._connectionStatus === 'accepted' && (
            <View style={s.nStatus}>
              <Feather name="check" size={12} color="#34C759" />
              <Text style={[s.nStatusTxt, { color: '#34C759' }]}>Connected</Text>
            </View>
          )}
          {requestHandled && item._connectionStatus === 'declined' && (
            <View style={s.nStatus}>
              <Text style={s.nStatusTxt}>Declined</Text>
            </View>
          )}

          {showActions && (
            <View style={s.nActions}>
              <TouchableOpacity
                style={s.btnPrimary}
                onPress={(e) => { e.stopPropagation(); acceptRequest(item); }}
                activeOpacity={0.8}
                disabled={busy}
              >
                {busy ? <ActivityIndicator size={12} color="#FFF" /> : <Text style={s.btnPrimaryTxt}>Accept</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={s.btnSecondary}
                onPress={(e) => { e.stopPropagation(); declineRequest(item); }}
                activeOpacity={0.8}
                disabled={busy}
              >
                <Text style={s.btnSecondaryTxt}>Decline</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (!userId) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
        <View style={s.loader}><Text style={s.emptySub}>Sign in to see notifications.</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      <View style={s.header}>
        <Text style={s.headerTitle}>Notifications</Text>
        <TouchableOpacity
          onPress={markAllRead}
          disabled={unreadCount === 0}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[s.headerAction, unreadCount === 0 && { color: '#C7C7CC' }]}>
            Mark all read
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.chipsScroll}
        contentContainerStyle={s.chipsRow}
      >
        {FILTERS.map(f => {
          const active = activeFilter === f.id;
          const count = counts[f.id];
          return (
            <TouchableOpacity
              key={f.id}
              style={[s.chip, active && s.chipActive]}
              onPress={() => setActiveFilter(f.id)}
              activeOpacity={0.75}
            >
              <Text style={[s.chipTxt, active && s.chipTxtActive]}>{f.label}</Text>
              {count > 0 && (
                <View style={[s.chipCount, active && s.chipCountActive]}>
                  <Text style={[s.chipCountTxt, active && s.chipCountTxtActive]}>{count}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={s.loader}>
          <ActivityIndicator color={NAVY} size="large" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(n) => n.id}
          renderItem={renderNotif}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            s.list,
            filtered.length === 0 && { flexGrow: 1 },
            { paddingBottom: Math.max(insets.bottom + 20, 40) },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => { setRefreshing(true); await loadNotifications(); }}
              tintColor={NAVY}
            />
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Feather name="bell" size={32} color="#C7C7CC" />
              </View>
              <Text style={s.emptyTitle}>
                {activeFilter === 'all' ? 'No notifications yet' : 'Nothing here'}
              </Text>
              <Text style={s.emptySub}>
                {activeFilter === 'all'
                  ? 'When someone connects, likes, or mentions you, it will show up here.'
                  : 'Try a different filter.'}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG_GREY },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY, letterSpacing: -0.3 },
  headerAction: { fontSize: 13, fontWeight: '500', color: NAVY },

  chipsScroll: {
    backgroundColor: '#FFFFFF',
    flexGrow: 0, flexShrink: 0,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE,
  },
  chipsRow: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE,
  },
  chipActive: { backgroundColor: NAVY, borderColor: NAVY },
  chipTxt: { fontSize: 13, fontWeight: '600', color: '#3C3C43' },
  chipTxtActive: { color: '#FFFFFF' },
  chipCount: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 8, backgroundColor: 'rgba(11,30,61,0.08)' },
  chipCountActive: { backgroundColor: 'rgba(255,255,255,0.22)' },
  chipCountTxt: { fontSize: 11, fontWeight: '700', color: NAVY },
  chipCountTxtActive: { color: '#FFFFFF' },

  list: { padding: 10 },

  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    marginBottom: 8,
  },
  cardUnread: {
    borderLeftWidth: 3,
    borderLeftColor: NAVY,
    paddingLeft: 11,
  },

  avaWrap: { position: 'relative', flexShrink: 0 },
  ava: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avaTxt: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  typeBadge: {
    position: 'absolute', bottom: -2, right: -2,
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#FFFFFF',
  },

  nc: { flex: 1, minWidth: 0 },
  nTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  nBody: { fontSize: 14, lineHeight: 19, color: '#1A1A1A', flex: 1 },
  nActor: { fontWeight: '600', color: TEXT_PRIMARY },
  nAction: { fontWeight: '400', color: '#3C3C43' },
  nTime: { fontSize: 11, color: TEXT_SECONDARY, fontWeight: '500', paddingTop: 2 },
  nPreview: { fontSize: 12, color: '#6E6E73', lineHeight: 17, marginTop: 4, fontStyle: 'italic' },
  nActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btnPrimary: { backgroundColor: NAVY, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 16, minWidth: 72, alignItems: 'center' },
  btnPrimaryTxt: { fontSize: 12, fontWeight: '600', color: '#FFFFFF' },
  btnSecondary: { backgroundColor: '#F2F2F7', paddingHorizontal: 16, paddingVertical: 7, borderRadius: 16, minWidth: 72, alignItems: 'center' },
  btnSecondaryTxt: { fontSize: 12, fontWeight: '600', color: NAVY },
  nStatus: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  nStatusTxt: { fontSize: 12, fontWeight: '600', color: TEXT_SECONDARY },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingTop: 80 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: TEXT_PRIMARY, marginBottom: 6 },
  emptySub: { fontSize: 13, lineHeight: 19, color: TEXT_SECONDARY, textAlign: 'center' },
});