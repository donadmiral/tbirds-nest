import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Image, StatusBar, RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

type Notification = {
  id: string;
  type: 'like' | 'comment' | 'reply' | 'repost' | 'mention' | 'follow' | 'tag';
  actor_id: string;
  post_id?: string | null;
  comment_id?: string | null;
  body_preview?: string | null;
  read: boolean;
  created_at: string;
  actor?: { full_name?: string | null; username?: string | null; avatar_url?: string | null };
};

const TYPE_META: Record<string, { icon: string; color: string; label: (name: string) => string }> = {
  like:    { icon: '♥', color: '#EF4444', label: (n) => `${n} liked your post` },
  comment: { icon: '💬', color: '#2563EB', label: (n) => `${n} commented on your post` },
  reply:   { icon: '↩️', color: '#7C3AED', label: (n) => `${n} replied to your comment` },
  repost:  { icon: '🔁', color: '#10B981', label: (n) => `${n} reposted your post` },
  mention: { icon: '@', color: '#F59E0B', label: (n) => `${n} mentioned you` },
  follow:  { icon: '➕', color: '#06B6D4', label: (n) => `${n} started following you` },
  tag:     { icon: '#', color: '#6366F1', label: (n) => `${n} tagged you in a post` },
};

export default function NotificationsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadNotifications = useCallback(async () => {
    if (!userId) return;
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, actor_id, post_id, comment_id, body_preview, read, created_at')
        .eq('recipient_id', userId)
        .order('created_at', { ascending: false })
        .limit(60);

      if (error || !data) return;

      const actorIds = Array.from(new Set(data.map((n: any) => n.actor_id).filter(Boolean)));
      const actorMap: Record<string, Notification['actor']> = {};
      if (actorIds.length > 0) {
        const { data: actors } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url')
          .in('id', actorIds);
        (actors || []).forEach((a: any) => {
          actorMap[a.id] = { full_name: a.full_name, username: a.username, avatar_url: a.avatar_url };
        });
      }

      const hydrated: Notification[] = data.map((n: any) => ({
        ...n,
        actor: actorMap[n.actor_id],
      }));

      setNotifications(hydrated);
      setUnreadCount(hydrated.filter((n) => !n.read).length);
    } catch (e) {
      console.log('LOAD_NOTIFS', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    loadNotifications();
    if (!userId) return;
    const ch = supabase
      .channel(`notifications_${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
        () => loadNotifications()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadNotifications, userId]);

  const markAllRead = async () => {
    if (!userId) return;
    await supabase.from('notifications').update({ read: true }).eq('recipient_id', userId).eq('read', false);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  const handlePress = async (notif: Notification) => {
    if (!notif.read) {
      await supabase.from('notifications').update({ read: true }).eq('id', notif.id);
      setNotifications((prev) => prev.map((n) => n.id === notif.id ? { ...n, read: true } : n));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    if (notif.post_id) {
      navigation.navigate('Post', { postId: notif.post_id });
    } else if (notif.actor_id) {
      navigation.navigate('UserProfile', { userId: notif.actor_id });
    }
  };

  const formatTime = (d: string) => {
    const diff = Date.now() - new Date(d).getTime();
    const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    if (h < 24) return `${h}h`;
    if (dy < 7) return `${dy}d`;
    return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const getInitials = (name?: string | null) => {
    if (!name) return 'U';
    const p = name.trim().split(' ').filter(Boolean);
    return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
  };

  const renderItem = ({ item }: { item: Notification }) => {
    const meta = TYPE_META[item.type] || TYPE_META.like;
    const actor = item.actor;
    const actorName = actor?.full_name || (actor?.username ? `@${actor.username}` : 'Someone');
    const label = meta.label(actorName);

    return (
      <TouchableOpacity
        style={[s.notifCard, !item.read && s.notifCardUnread]}
        activeOpacity={0.85}
        onPress={() => handlePress(item)}
      >
        {!item.read && <View style={s.unreadDot} />}

        <View style={s.avatarWrap}>
          {actor?.avatar_url
            ? <Image source={{ uri: actor.avatar_url }} style={s.avatar} />
            : <View style={s.avatarFb}><Text style={s.avatarFbTxt}>{getInitials(actor?.full_name || actor?.username)}</Text></View>}
          <View style={[s.typeBadge, { backgroundColor: meta.color }]}>
            <Text style={s.typeBadgeTxt}>{meta.icon}</Text>
          </View>
        </View>

        <View style={s.notifContent}>
          <Text style={s.notifLabel}>
            <Text style={s.notifActor}>{actorName} </Text>
            <Text style={s.notifAction}>{label.replace(actorName, '').trim()}</Text>
          </Text>
          {item.body_preview ? (
            <Text style={s.notifPreview} numberOfLines={2}>&ldquo;{item.body_preview}&rdquo;</Text>
          ) : null}
          <Text style={s.notifTime}>{formatTime(item.created_at)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderHeader = () => (
    <View style={s.header}>
      <View style={s.headerRow}>
        <Text style={s.title}>Notifications</Text>
        {unreadCount > 0 ? (
          <TouchableOpacity onPress={markAllRead} style={s.markAllBtn}>
            <Text style={s.markAllTxt}>Mark all read</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {unreadCount > 0 ? (
        <View style={s.unreadBanner}>
          <Text style={s.unreadBannerTxt}>{unreadCount} new</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={s.safe} edges={['left', 'right', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />
      <View style={[s.container, { paddingTop: insets.top + 8 }]}>
        {loading ? (
          <View style={s.loader}>
            <ActivityIndicator size="large" color="#2563EB" />
            <Text style={s.loaderTxt}>Loading notifications...</Text>
          </View>
        ) : (
          <FlatList
            data={notifications}
            keyExtractor={(n) => n.id}
            renderItem={renderItem}
            ListHeaderComponent={renderHeader}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[s.list, !notifications.length && s.listEmpty, { paddingBottom: Math.max(insets.bottom + 40, 60) }]}
            ListEmptyComponent={() => (
              <View style={s.emptyWrap}>
                <Text style={s.emptyIcon}>🔔</Text>
                <Text style={s.emptyTitle}>No notifications yet</Text>
                <Text style={s.emptySub}>When someone likes, comments, or mentions you, it will show up here.</Text>
              </View>
            )}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={async () => { setRefreshing(true); await loadNotifications(); }}
                tintColor="#2563EB"
              />
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F8FAFC' },
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', color: '#111827', letterSpacing: -0.5 },
  markAllBtn: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#EFF6FF', borderRadius: 10 },
  markAllTxt: { fontSize: 13, fontWeight: '600', color: '#2563EB' },
  unreadBanner: { backgroundColor: '#EFF6FF', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, alignSelf: 'flex-start', marginBottom: 6 },
  unreadBannerTxt: { fontSize: 12, fontWeight: '700', color: '#2563EB' },
  list: { paddingHorizontal: 12 },
  listEmpty: { flexGrow: 1 },
  notifCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#FFF', borderRadius: 16, borderWidth: 1, borderColor: '#E5E7EB',
    padding: 14, marginBottom: 8,
  },
  notifCardUnread: { backgroundColor: '#F0F7FF', borderColor: '#BFDBFE' },
  unreadDot: { position: 'absolute', top: 16, right: 14, width: 8, height: 8, borderRadius: 4, backgroundColor: '#2563EB' },
  avatarWrap: { position: 'relative', marginTop: 2 },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  avatarFb: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' },
  avatarFbTxt: { fontSize: 16, fontWeight: '700', color: '#1D4ED8' },
  typeBadge: { position: 'absolute', bottom: -2, right: -4, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFF' },
  typeBadgeTxt: { fontSize: 10, color: '#FFF', fontWeight: '700' },
  notifContent: { flex: 1 },
  notifLabel: { fontSize: 14, lineHeight: 20, color: '#111827', marginBottom: 4 },
  notifActor: { fontWeight: '700', color: '#111827' },
  notifAction: { fontWeight: '400', color: '#374151' },
  notifPreview: { fontSize: 13, color: '#6B7280', lineHeight: 18, marginBottom: 4, fontStyle: 'italic' },
  notifTime: { fontSize: 12, color: '#9CA3AF' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loaderTxt: { marginTop: 12, fontSize: 14, color: '#6B7280' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#111827', textAlign: 'center' },
  emptySub: { marginTop: 8, fontSize: 14, lineHeight: 20, color: '#6B7280', textAlign: 'center' },
});