import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Image,
  RefreshControl, StatusBar, Animated, ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

// ─── Types ────────────────────────────────────────────────────────────────────

type NotifType =
  | 'like' | 'comment' | 'reply' | 'repost' | 'mention' | 'tag'
  | 'follow' | 'connection_request' | 'connection_accepted'
  | 'orbit' | 'orbit_post'
  | 'job_new' | 'job_referral' | 'job_application_viewed'
    | 'job_shortlisted' | 'job_interview';

type Notification = {
  id: string;
  recipient_id: string;
  actor_id: string;
  type: NotifType;
  post_id?: string | null;
  comment_id?: string | null;
  body_preview?: string | null;
  read: boolean;
  created_at: string;
  actor?: {
    id: string;
    full_name?: string | null;
    username?: string | null;
    avatar_url?: string | null;
    degree_program?: string | null;
  };
};

type TabId = 'all' | 'social' | 'network' | 'jobs';

const TABS: { id: TabId; label: string }[] = [
  { id: 'all',     label: 'All' },
  { id: 'social',  label: 'Social' },
  { id: 'network', label: 'Network' },
  { id: 'jobs',    label: 'Jobs' },
];

const SOCIAL_TYPES: NotifType[]  = ['like','comment','reply','repost','mention','tag'];
const NETWORK_TYPES: NotifType[] = ['follow','connection_request','connection_accepted','orbit','orbit_post'];
const JOB_TYPES: NotifType[]     = ['job_new','job_referral','job_application_viewed','job_shortlisted','job_interview'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(d?: string | null): string {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const dy = Math.floor(h / 24);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`;
  if (dy < 7) return `${dy}d`;
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function initials(name?: string | null): string {
  if (!name) return '?';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

type NotifMeta = {
  icon: string;
  color: string;
  bg: string;
  label: (actorName: string, preview?: string | null) => string;
};

const NOTIF_META: Record<string, NotifMeta> = {
  like: {
    icon: '❤', color: '#FF3B30', bg: '#FFF1F0',
    label: (n) => `${n} liked your post`,
  },
  comment: {
    icon: '💬', color: '#007AFF', bg: '#EFF6FF',
    label: (n, p) => `${n} commented: ${p || ''}`,
  },
  reply: {
    icon: '↩', color: '#5856D6', bg: '#F5F3FF',
    label: (n, p) => `${n} replied: ${p || ''}`,
  },
  repost: {
    icon: '🔁', color: '#34C759', bg: '#F0FDF4',
    label: (n) => `${n} reposted your post`,
  },
  mention: {
    icon: '@', color: '#FF9500', bg: '#FFF7ED',
    label: (n, p) => `${n} mentioned you: ${p || ''}`,
  },
  tag: {
    icon: '#', color: '#FF9500', bg: '#FFF7ED',
    label: (n, p) => `${n} tagged you: ${p || ''}`,
  },
  follow: {
    icon: '✦', color: '#5856D6', bg: '#F5F3FF',
    label: (n) => `${n} started orbiting you`,
  },
  orbit: {
    icon: '◎', color: '#5856D6', bg: '#F5F3FF',
    label: (n) => `${n} is now in your orbit`,
  },
  orbit_post: {
    icon: '◎', color: '#5856D6', bg: '#F5F3FF',
    label: (n, p) => `${n} posted: ${p || ''}`,
  },
  connection_request: {
    icon: '🤝', color: '#007AFF', bg: '#EFF6FF',
    label: (n) => `${n} wants to connect`,
  },
  connection_accepted: {
    icon: '✓', color: '#34C759', bg: '#F0FDF4',
    label: (n) => `${n} accepted your connection`,
  },
  job_new: {
    icon: '💼', color: '#007AFF', bg: '#EFF6FF',
    label: (n, p) => `New opportunity: ${p || ''}`,
  },
  job_referral: {
    icon: '🎯', color: '#FF9500', bg: '#FFF7ED',
    label: (n, p) => `${n} referred you to a job${p ? `: ${p}` : ''}`,
  },
  job_application_viewed: {
    icon: '👁', color: '#5856D6', bg: '#F5F3FF',
    label: (n, p) => `Your application was viewed${p ? ` — ${p}` : ''}`,
  },
  job_shortlisted: {
    icon: '⭐', color: '#FF9500', bg: '#FFF7ED',
    label: (n, p) => `You were shortlisted${p ? ` — ${p}` : ''}`,
  },
  job_interview: {
    icon: '🎉', color: '#34C759', bg: '#F0FDF4',
    label: (n, p) => `Interview request${p ? `: ${p}` : ''}`,
  },
};

function getMeta(type: string): NotifMeta {
  return NOTIF_META[type] ?? {
    icon: '●', color: '#8E8E93', bg: '#F2F2F7',
    label: (n: string, p?: string | null) => p || `${n} interacted with you`,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NotificationsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const [tab, setTab] = useState<TabId>('all');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const mountedRef = useRef(true);
  const tabUnderline = useRef(new Animated.Value(0)).current;

  // Animate tab indicator
  const tabIndex = TABS.findIndex(t => t.id === tab);
  useEffect(() => {
    Animated.spring(tabUnderline, {
      toValue: tabIndex,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  }, [tabIndex]);

  // ── Data ──────────────────────────────────────────────────────────────────

  const loadNotifications = useCallback(async (showLoader = true) => {
    if (!userId) return;
    try {
      if (showLoader && mountedRef.current) setLoading(true);

      const { data, error } = await supabase
        .from('notifications')
        .select(`
          id, recipient_id, actor_id, type, post_id, comment_id,
          body_preview, read, created_at,
          actor:profiles!actor_id(id, full_name, username, avatar_url, degree_program)
        `)
        .eq('recipient_id', userId)
        .order('created_at', { ascending: false })
        .limit(120);

      if (!error && mountedRef.current) {
        setNotifications((data || []) as unknown as Notification[]);
      }
    } catch (e) {
      console.log('LOAD_NOTIFICATIONS_ERROR', e);
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      mountedRef.current = true;
      loadNotifications(true);

      const ch = supabase
        .channel(`notifs_${userId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${userId}`,
        }, () => loadNotifications(false))
        .subscribe();

      return () => {
        mountedRef.current = false;
        supabase.removeChannel(ch);
      };
    }, [loadNotifications, userId])
  );

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('recipient_id', userId)
      .eq('read', false);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, [userId]);

  const markOneRead = useCallback(async (id: string) => {
    await supabase.from('notifications').update({ read: true }).eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const handlePress = useCallback((notif: Notification) => {
    if (!notif.read) markOneRead(notif.id);
    if (SOCIAL_TYPES.includes(notif.type) && notif.post_id) {
      navigation.navigate('Post', { postId: notif.post_id });
    } else if (notif.type === 'connection_request' || notif.type === 'connection_accepted') {
      navigation.navigate('UserProfile', { userId: notif.actor_id });
    } else if (notif.type === 'orbit' || notif.type === 'follow') {
      navigation.navigate('UserProfile', { userId: notif.actor_id });
    } else if (notif.type === 'orbit_post' && notif.post_id) {
      navigation.navigate('Post', { postId: notif.post_id });
    } else if (JOB_TYPES.includes(notif.type)) {
      navigation.navigate('Jobs');
    }
  }, [markOneRead, navigation]);

  // ── Filtered data ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (tab === 'all')     return notifications;
    if (tab === 'social')  return notifications.filter(n => SOCIAL_TYPES.includes(n.type));
    if (tab === 'network') return notifications.filter(n => NETWORK_TYPES.includes(n.type));
    if (tab === 'jobs')    return notifications.filter(n => JOB_TYPES.includes(n.type));
    return notifications;
  }, [notifications, tab]);

  const unreadByTab = useMemo(() => {
    const count = (types: NotifType[]) =>
      notifications.filter(n => !n.read && types.includes(n.type)).length;
    return {
      all:     notifications.filter(n => !n.read).length,
      social:  count(SOCIAL_TYPES),
      network: count(NETWORK_TYPES),
      jobs:    count(JOB_TYPES),
    };
  }, [notifications]);

  // Group by date
  const grouped = useMemo(() => {
    const sections: { title: string; data: Notification[] }[] = [];
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    let todayItems: Notification[] = [];
    let yesterdayItems: Notification[] = [];
    let earlierItems: Notification[] = [];

    filtered.forEach(n => {
      const d = new Date(n.created_at).toDateString();
      if (d === today) todayItems.push(n);
      else if (d === yesterday) yesterdayItems.push(n);
      else earlierItems.push(n);
    });

    if (todayItems.length)     sections.push({ title: 'Today', data: todayItems });
    if (yesterdayItems.length) sections.push({ title: 'Yesterday', data: yesterdayItems });
    if (earlierItems.length)   sections.push({ title: 'Earlier', data: earlierItems });
    return sections;
  }, [filtered]);

  const flatData = useMemo(() => {
    const items: any[] = [];
    grouped.forEach(g => {
      items.push({ type: 'header', title: g.title, id: `hdr-${g.title}` });
      g.data.forEach(n => items.push({ type: 'notif', data: n, id: n.id }));
    });
    return items;
  }, [grouped]);

  const totalUnread = unreadByTab.all;

  // ── Render ────────────────────────────────────────────────────────────────

  const TAB_WIDTH = 100; // approximate, overridden by flex

  const renderItem = ({ item }: { item: any }) => {
    if (item.type === 'header') {
      return <Text style={s.sectionHeader}>{item.title}</Text>;
    }

    const n: Notification = item.data;
    const meta = getMeta(n.type);
    const actor = n.actor;
    const name = actor?.full_name || actor?.username || 'Someone';
    const label = meta.label(name, n.body_preview);

    return (
      <TouchableOpacity
        style={[s.card, !n.read && s.cardUnread]}
        activeOpacity={0.75}
        onPress={() => handlePress(n)}
      >
        {/* Unread indicator */}
        {!n.read && <View style={s.unreadBar} />}

        {/* Avatar + type badge */}
        <View style={s.avatarWrap}>
          {actor?.avatar_url
            ? <Image source={{ uri: actor.avatar_url }} style={s.avatar} />
            : (
              <View style={[s.avatarFb, { backgroundColor: meta.bg }]}>
                <Text style={[s.avatarFbTxt, { color: meta.color }]}>{initials(name)}</Text>
              </View>
            )}
          <View style={[s.typeBadge, { backgroundColor: meta.bg, borderColor: meta.color + '30' }]}>
            <Text style={[s.typeBadgeIcon, { color: meta.color }]}>{meta.icon}</Text>
          </View>
        </View>

        {/* Content */}
        <View style={s.content}>
          <Text style={[s.label, !n.read && s.labelUnread]} numberOfLines={2}>
            {label}
          </Text>
          {actor?.degree_program && (
            <Text style={s.subLabel} numberOfLines={1}>{actor.degree_program}</Text>
          )}
          <Text style={s.time}>{relativeTime(n.created_at)}</Text>
        </View>

        {/* Connection request accept/decline inline */}
        {n.type === 'connection_request' && !n.read && (
          <View style={s.inlineActions}>
            <TouchableOpacity
              style={s.acceptBtn}
              activeOpacity={0.8}
              onPress={async () => {
                await supabase.from('connections')
                  .update({ status: 'accepted', updated_at: new Date().toISOString() })
                  .eq('requester_id', n.actor_id).eq('recipient_id', userId);
                markOneRead(n.id);
                loadNotifications(false);
              }}
            >
              <Text style={s.acceptBtnTxt}>Accept</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.declineBtn}
              activeOpacity={0.8}
              onPress={async () => {
                await supabase.from('connections')
                  .update({ status: 'declined' })
                  .eq('requester_id', n.actor_id).eq('recipient_id', userId);
                markOneRead(n.id);
                loadNotifications(false);
              }}
            >
              <Text style={s.declineBtnTxt}>Decline</Text>
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <View style={s.container}>

        {/* ── Title row ── */}
        <View style={s.titleRow}>
          <View>
            <Text style={s.title}>Notifications</Text>
            {totalUnread > 0 && (
              <Text style={s.unreadCount}>{totalUnread} new</Text>
            )}
          </View>
          {totalUnread > 0 && (
            <TouchableOpacity style={s.markAllBtn} onPress={markAllRead} activeOpacity={0.7}>
              <Text style={s.markAllTxt}>Mark all read</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Category tabs ── */}
        <View style={s.tabRow}>
          {TABS.map(t => {
            const count = unreadByTab[t.id];
            const active = tab === t.id;
            return (
              <TouchableOpacity
                key={t.id}
                style={s.tabItem}
                activeOpacity={0.7}
                onPress={() => setTab(t.id)}
              >
                <View style={s.tabLabelRow}>
                  <Text style={[s.tabTxt, active && s.tabTxtActive]}>{t.label}</Text>
                  {count > 0 && (
                    <View style={[s.tabBadge, active && s.tabBadgeActive]}>
                      <Text style={[s.tabBadgeTxt, active && s.tabBadgeTxtActive]}>
                        {count > 99 ? '99+' : count}
                      </Text>
                    </View>
                  )}
                </View>
                {active && <View style={s.tabUnderline} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Hairline */}
        <View style={s.divider} />

        {/* ── List ── */}
        {loading ? (
          <View style={s.loader}>
            <ActivityIndicator color="#007AFF" size="large" />
          </View>
        ) : (
          <FlatList
            data={flatData}
            keyExtractor={item => item.id}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[s.list, !flatData.length && s.listEmpty]}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); loadNotifications(false); }}
                tintColor="#007AFF"
              />
            }
            ListEmptyComponent={
              <View style={s.empty}>
                <View style={s.emptyIconWrap}>
                  <Text style={s.emptyIcon}>
                    {tab === 'social'  ? '❤' :
                     tab === 'network' ? '🤝' :
                     tab === 'jobs'    ? '💼' : '🔔'}
                  </Text>
                </View>
                <Text style={s.emptyTitle}>All caught up</Text>
                <Text style={s.emptyTxt}>
                  {tab === 'social'  ? 'Likes, comments, and mentions will appear here.' :
                   tab === 'network' ? 'Connection requests and orbit activity will appear here.' :
                   tab === 'jobs'    ? 'Job alerts and referrals will appear here.' :
                   'You have no new notifications.'}
                </Text>
              </View>
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const AVATAR = 46;

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  container: { flex: 1, backgroundColor: '#FFFFFF' },

  // Title
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
  },
  title: { fontSize: 34, fontWeight: '700', color: '#000000', letterSpacing: -0.5 },
  unreadCount: { fontSize: 13, color: '#007AFF', fontWeight: '500', marginTop: 2 },
  markAllBtn: { paddingBottom: 4 },
  markAllTxt: { fontSize: 15, color: '#007AFF', fontWeight: '400' },

  // Tabs
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
  },
  tabItem: { flex: 1, alignItems: 'center', paddingBottom: 10 },
  tabLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tabTxt: { fontSize: 15, fontWeight: '500', color: '#8E8E93' },
  tabTxtActive: { color: '#000000', fontWeight: '600' },
  tabBadge: {
    backgroundColor: '#E5E5EA',
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeActive: { backgroundColor: '#007AFF' },
  tabBadgeTxt: { fontSize: 11, fontWeight: '700', color: '#8E8E93' },
  tabBadgeTxtActive: { color: '#FFFFFF' },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    left: '15%',
    right: '15%',
    height: 2,
    borderRadius: 1,
    backgroundColor: '#000000',
  },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#C6C6C8' },

  list: { paddingBottom: 40 },
  listEmpty: { flexGrow: 1 },

  // Section header
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },

  // Card
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F2F2F7',
  },
  cardUnread: { backgroundColor: '#F9F9FF' },
  unreadBar: {
    position: 'absolute',
    left: 0,
    top: 14,
    bottom: 14,
    width: 3,
    borderRadius: 2,
    backgroundColor: '#007AFF',
  },

  // Avatar
  avatarWrap: { position: 'relative', marginRight: 12, marginTop: 1 },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 },
  avatarFb: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, alignItems: 'center', justifyContent: 'center' },
  avatarFbTxt: { fontSize: 18, fontWeight: '700' },
  typeBadge: {
    position: 'absolute',
    bottom: -2,
    right: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeBadgeIcon: { fontSize: 11, fontWeight: '700' },

  // Content
  content: { flex: 1 },
  label: { fontSize: 15, color: '#3C3C43', lineHeight: 20, fontWeight: '400' },
  labelUnread: { color: '#000000', fontWeight: '500' },
  subLabel: { fontSize: 13, color: '#8E8E93', marginTop: 2 },
  time: { fontSize: 12, color: '#C6C6C8', marginTop: 4, fontWeight: '400' },

  // Inline accept/decline
  inlineActions: { flexDirection: 'row', gap: 8, marginLeft: 8, alignSelf: 'center' },
  acceptBtn: { backgroundColor: '#007AFF', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  acceptBtnTxt: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  declineBtn: { backgroundColor: '#F2F2F7', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  declineBtnTxt: { fontSize: 13, fontWeight: '600', color: '#3C3C43' },

  // Loader
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Empty state
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyIconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyIcon: { fontSize: 30 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#000000', marginBottom: 8, textAlign: 'center' },
  emptyTxt: { fontSize: 14, color: '#8E8E93', textAlign: 'center', lineHeight: 20 },
});