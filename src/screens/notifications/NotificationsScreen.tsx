import EmptyState from '../../components/EmptyState';
import TierName from '../../components/TierName';
import VerifiedBadge from '../../components/VerifiedBadge';
/**
 * NotificationsScreen
 *
 * Social engagement only. Messages, calls and the retired connection concept
 * live where they belong and keep their own unread counts; duplicating them
 * here is what made the old list unreadable, and it is why Instagram does not
 * put DMs in notifications either.
 *
 * Grouped server-side: repeated engagement on one post, and repeated follows,
 * collapse into a single row. Six likes on a post is one line, not six.
 *
 * No category tabs. Time sections instead, because people scan notifications
 * chronologically and tabs hide the thing you are looking for.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, SectionList, TouchableOpacity, ActivityIndicator,
  Image, RefreshControl, StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { light, typeSize, fontWeight, radius, space } from '../../constants/tokens';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';

type Notif = {
  notification_id: string;
  type: string;
  message: string | null;
  body_preview: string | null;
  data: any;
  read_at: string | null;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_username: string | null;
  actor_avatar: string | null;
  others_count: number;
  other_avatars: string[] | null;
  post_id: string | null;
  post_thumb: string | null;
  post_text: string | null;
  viewer_follows: boolean;
  unread_in_group: number;
};

const HAIR = StyleSheet.hairlineWidth;

function initials(name?: string | null) {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

function relTime(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 604800)}w`;
}

/** The accent glyph that sits on the avatar, so the kind reads before the words do. */
function badgeFor(type: string): { icon: any; bg: string } | null {
  switch (type) {
    case 'like':
    case 'comment_like':     return { icon: 'heart', bg: '#F04A5C' };
    case 'comment':
    case 'reply':            return { icon: 'message-circle', bg: '#3E7BFA' };
    case 'repost':           return { icon: 'repeat', bg: '#2F9E63' };
    case 'mention':          return { icon: 'at-sign', bg: '#7C5CFF' };
    case 'follow':
    case 'follow_request':
    case 'follow_accepted':  return { icon: 'user-plus', bg: '#0B1E3D' };
    case 'story_reaction':   return { icon: 'zap', bg: '#E8A33D' };
    case 'message_reaction': return { icon: 'smile', bg: '#E8A33D' };
    case 'payment_received': return { icon: 'credit-card', bg: '#2F9E63' };
    case 'job_application':  return { icon: 'briefcase', bg: '#0B1E3D' };
    case 'job_referral':     return { icon: 'send', bg: '#0B1E3D' };
    case 'story_mention':    return { icon: 'at-sign', bg: '#7C5CFF' };
    case 'business_member':  return { icon: 'users', bg: '#B08D3F' };
    default:                 return null;
  }
}

/**
 * A row should read as a sentence someone would say out loud, and it should
 * carry the thing itself: the emoji they reacted with, the words they wrote.
 * "Don reacted 🔥 to your story" tells you more than "Don reacted to your story"
 * and costs nothing, because the trigger already stored it.
 */
function quote(s?: string | null): string {
  const t = (s || '').trim();
  if (!t) return '';
  return t.length > 70 ? `"${t.slice(0, 70).trimEnd()}…"` : `"${t}"`;
}

function lineFor(n: Notif): { lead: string; rest: string } {
  const name = n.actor_name || 'Someone';
  const others = n.others_count;
  const lead = others > 0
    ? `${name} and ${others} other${others === 1 ? '' : 's'}`
    : name;

  const plural = others > 0;
  const emoji = (n.body_preview || '').trim();

  switch (n.type) {
    case 'like':
      return { lead, rest: plural ? ' liked your post' : ' liked your post' };

    case 'comment_like': {
      const c = quote(n.body_preview);
      return { lead, rest: c ? ` liked your comment ${c}` : ' liked your comment' };
    }

    case 'comment': {
      const c = quote(n.body_preview);
      return { lead, rest: c ? ` commented ${c}` : ' commented on your post' };
    }

    case 'reply': {
      const c = quote(n.body_preview);
      return { lead, rest: c ? ` replied ${c}` : ' replied to you' };
    }

    case 'repost':
      return { lead, rest: ' shared your post' };

    case 'mention': {
      const c = quote(n.body_preview);
      return { lead, rest: c ? ` mentioned you ${c}` : ' mentioned you' };
    }

    case 'follow':
      return { lead, rest: plural ? ' started following you' : ' started following you' };

    case 'follow_request':
      return { lead, rest: ' asked to follow you' };

    case 'follow_accepted':
      return { lead, rest: ' accepted your follow request' };

    case 'story_reaction':
      return { lead, rest: emoji ? ` reacted ${emoji} to your story` : ' reacted to your story' };

    case 'message_reaction':
      return { lead, rest: emoji ? ` reacted ${emoji} to your message` : ' reacted to your message' };

    case 'payment_received': {
      // The trigger writes the whole sentence with the amount in it.
      const msg = (n.message || '').trim();
      const stripped = msg.startsWith(name) ? msg.slice(name.length) : ` sent you money`;
      const note = n.body_preview ? ` · ${n.body_preview}` : '';
      return { lead, rest: stripped + note };
    }

    case 'job_application':
      return { lead, rest: n.body_preview ? ` applied for ${n.body_preview}` : ' applied to your job' };

    case 'job_referral':
      return { lead, rest: n.body_preview ? ' referred you for ' + n.body_preview : ' referred you for a job' };

    case 'story_mention':
      return { lead, rest: n.body_preview ? ' mentioned you in their story ' + quote(n.body_preview) : ' mentioned you in their story' };

    case 'business_member':
      return { lead: n.message || 'You joined a business', rest: n.body_preview ? ` · ${n.body_preview}` : '' };

    default: {
      const msg = (n.message || '').trim();
      const stripped = msg.toLowerCase().startsWith(name.toLowerCase())
        ? msg.slice(name.length)
        : ` ${msg}`;
      return { lead, rest: stripped };
    }
  }
}

function sectionFor(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (days < 7) return 'This week';
  if (days < 30) return 'This month';
  return 'Earlier';
}

export default function NotificationsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = (profile as any)?.id ?? null;

  const [rows, setRows] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [done, setDone] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase.rpc('get_notifications', {
      p_limit: 60, p_cursor: null,
    });
    if (!mounted.current) return;
    if (err) { setError(err.message); setLoading(false); setRefreshing(false); return; }
    const batch = (data ?? []) as Notif[];
    setRows(batch);
    cursorRef.current = batch.length ? (batch[batch.length - 1] as any).created_at : null;
    setDone(batch.length < 60);
    setLoading(false);
    setRefreshing(false);
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || done || !cursorRef.current) return;
    setLoadingMore(true);
    const { data } = await supabase.rpc('get_notifications', { p_limit: 60, p_cursor: cursorRef.current });
    if (!mounted.current) return;
    const batch = (data ?? []) as Notif[];
    if (batch.length) {
      cursorRef.current = (batch[batch.length - 1] as any).created_at;
      setRows(prev => { const seen = new Set(prev.map(r => r.notification_id)); return [...prev, ...batch.filter(r => !seen.has(r.notification_id))]; });
    }
    if (batch.length < 60) setDone(true);
    setLoadingMore(false);
  }, [loadingMore, done]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // New notifications arrive while the screen is open.
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel('notifs:' + userId)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
        () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, load]);

  const markAllRead = async () => {
    const unread = rows.filter(r => r.unread_in_group > 0);
    if (unread.length === 0) return;
    setRows(prev => prev.map(r => ({ ...r, unread_in_group: 0, read_at: new Date().toISOString() })));
    const { error: err } = await supabase.rpc('mark_notifications_read', { p_ids: null });
    if (err) { console.log('[NOTIF_READ]', err.message); load(); }
  };

  const open = async (n: Notif) => {
    if (n.unread_in_group > 0) {
      setRows(prev => prev.map(r => r.notification_id === n.notification_id
        ? { ...r, unread_in_group: 0 } : r));
      supabase.rpc('mark_notifications_read', { p_ids: [n.notification_id] });
    }

    const d = n.data || {};
    if (n.post_id || d.post_id) {
      navigation.navigate('Post', { postId: n.post_id || d.post_id, commentId: d.comment_id });
    } else if (n.type === 'payment_received' && d.conversation_id) {
      navigation.navigate('Messages', { screen: 'Chat', params: { conversationId: d.conversation_id } });
    } else if (n.type === 'job_application' && d.job_id) {
      navigation.navigate('Jobs');
    } else if (n.type === 'business_member' && d.business_id) {
      navigation.navigate('Profile', { screen: 'BusinessManage', params: { businessId: d.business_id } });
    } else if (n.actor_id) {
      navigation.navigate('UserProfile', { userId: n.actor_id });
    }
  };

  const followBack = async (n: Notif) => {
    if (!n.actor_id || busy[n.notification_id]) return;
    setBusy(b => ({ ...b, [n.notification_id]: true }));
    const { error: err } = await supabase.rpc('handle_follow_action', { p_target_id: n.actor_id });
    setBusy(b => { const c = { ...b }; delete c[n.notification_id]; return c; });
    if (err) { console.log('[FOLLOW_BACK]', err.message); return; }
    setRows(prev => prev.map(r => r.notification_id === n.notification_id
      ? { ...r, viewer_follows: !r.viewer_follows } : r));
  };

  const respondRequest = async (n: Notif, action: 'accept' | 'reject') => {
    const reqId = n.data?.request_id;
    if (!reqId || busy[n.notification_id]) return;
    setBusy(b => ({ ...b, [n.notification_id]: true }));
    const { error: err } = await supabase.rpc('respond_follow_request', {
      p_request_id: reqId, p_action: action,
    });
    setBusy(b => { const c = { ...b }; delete c[n.notification_id]; return c; });
    if (err) { console.log('[FOLLOW_REQ]', err.message); return; }
    setRows(prev => prev.filter(r => r.notification_id !== n.notification_id));
  };

  const sections = useMemo(() => {
    // Things that want an ACTION from you sit pinned on top, out of the stream.
    const NEEDS = new Set(['follow_request', 'job_application', 'payment_received']);
    const needs: Notif[] = [];
    const order = ['Today', 'This week', 'This month', 'Earlier'];
    const buckets: Record<string, Notif[]> = {};
    rows.forEach(r => {
      if (NEEDS.has(r.type) && (r.type !== 'follow_request' || (r as any).data?.request_id)) { needs.push(r); return; }
      const k = sectionFor(r.created_at);
      (buckets[k] ||= []).push(r);
    });
    const out = order.filter(k => buckets[k]?.length).map(k => ({ title: k, data: buckets[k] }));
    return needs.length ? [{ title: 'Needs you', data: needs }, ...out] : out;
  }, [rows]);

  const unreadTotal = rows.reduce((sum, r) => sum + (r.unread_in_group > 0 ? 1 : 0), 0);

  const renderRow = ({ item }: { item: Notif }) => {
    const badge = badgeFor(item.type);
    const { lead, rest } = lineFor(item);
    const unread = item.unread_in_group > 0;
    const showFollow = item.type === 'follow' && !!item.actor_id;
    const showRequest = item.type === 'follow_request' && !!item.data?.request_id;

    return (
      <TouchableOpacity
        style={[s.row, unread && s.rowUnread]}
        activeOpacity={0.72}
        onPress={() => open(item)}
      >
        <View style={s.avatarWrap}>
          {item.actor_avatar ? (
            <Image source={{ uri: item.actor_avatar }} style={s.avatar} />
          ) : (
            <View style={[s.avatar, s.avatarFb]}>
              <Text style={s.avatarTxt}>{initials(item.actor_name)}</Text>
            </View>
          )}
          {badge ? (
            <View style={[s.badge, { backgroundColor: badge.bg }]}>
              <Feather name={badge.icon} size={10} color="#FFFFFF" />
            </View>
          ) : null}
        </View>

        <View style={s.body}>
          <Text style={s.line} numberOfLines={2}>
            <TierName userId={item.actor_id} baseStyle={s.lead} text={lead} />{item.actor_id ? <VerifiedBadge userId={item.actor_id} size={11} /> : null}
            <Text style={s.rest}>{rest}</Text>
          </Text>
          <View style={s.metaRow}>
            {item.other_avatars?.length ? (
              <View style={{ flexDirection: 'row', marginRight: 6 }}>
                {item.other_avatars.slice(0, 3).map((u, i) => (
                  <Image key={i} source={{ uri: u }} style={{ width: 16, height: 16, borderRadius: 8, marginLeft: i ? -5 : 0, borderWidth: 1, borderColor: '#FFFFFF' }} />
                ))}
              </View>
            ) : null}
            <Text style={s.time}>{relTime(item.created_at)}</Text>
            {item.others_count > 0 && item.unread_in_group > 1 ? (
              <Text style={s.count}>{item.unread_in_group} new</Text>
            ) : null}
          </View>

          {showRequest ? (
            <View style={s.requestRow}>
              <TouchableOpacity
                style={s.accept}
                onPress={() => respondRequest(item, 'accept')}
                disabled={!!busy[item.notification_id]}
              >
                <Text style={s.acceptTxt}>Confirm</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.decline}
                onPress={() => respondRequest(item, 'reject')}
                disabled={!!busy[item.notification_id]}
              >
                <Text style={s.declineTxt}>Delete</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {item.post_thumb ? (
          <Image source={{ uri: item.post_thumb }} style={s.thumb} />
        ) : item.post_id && item.post_text ? (
          <View style={[s.thumb, s.thumbText]}>
            <Text style={s.thumbTxt} numberOfLines={3}>{item.post_text}</Text>
          </View>
        ) : showFollow ? (
          <TouchableOpacity
            style={[s.followBtn, item.viewer_follows && s.followingBtn]}
            onPress={() => followBack(item)}
            disabled={!!busy[item.notification_id]}
          >
            {busy[item.notification_id] ? (
              <ActivityIndicator size="small" color={item.viewer_follows ? light.ink.primary : light.ink.inverse} />
            ) : (
              <Text style={[s.followTxt, item.viewer_follows && s.followingTxt]}>
                {item.viewer_follows ? 'Following' : 'Follow'}
              </Text>
            )}
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <Text style={s.title}>Activity</Text>
        {unreadTotal > 0 ? (
          <TouchableOpacity onPress={markAllRead} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={s.markAll}>Mark all read</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {loading ? (
        <View style={s.centered}><ActivityIndicator color={light.brand.base} /></View>
      ) : error ? (
        <View style={s.centered}>
          <Feather name="alert-circle" size={30} color={light.ink.faint} />
          <Text style={s.emptyTitle}>Could not load your activity</Text>
          <Text style={s.emptySub}>{error}</Text>
          <TouchableOpacity style={s.retry} onPress={() => { setLoading(true); load(); }}>
            <Text style={s.retryTxt}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : rows.length === 0 ? (
        <View style={s.centered}>
          <Feather name="bell" size={30} color={light.ink.faint} />
          <Text style={s.emptyTitle}>Nothing yet</Text>
          <Text style={s.emptySub}>
            Likes, comments, follows and mentions show up here. Messages and calls stay in their own tabs.
          </Text>
        </View>
      ) : (
        <SectionList ListEmptyComponent={<EmptyState icon="bell" title="Nothing new" line="Likes, comments, follows and requests land here." />}
          sections={sections}
          keyExtractor={r => r.notification_id}
          renderItem={renderRow}
          stickySectionHeadersEnabled={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore ? <ActivityIndicator size="small" color={light.ink.faint} style={{ paddingVertical: 16 }} /> : null}
          contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={light.ink.faint} />
          }
          renderSectionHeader={({ section }) => (
            <Text style={s.sectionTitle}>{section.title}</Text>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: light.surface.canvas },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: space.xs, paddingBottom: space.sm,
  },
  title: { fontSize: typeSize.display, fontWeight: fontWeight.heavy, color: light.ink.primary, letterSpacing: -0.9 },
  markAll: { fontSize: typeSize.caption, fontWeight: fontWeight.bold, color: light.status.link },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 42, gap: 6 },
  emptyTitle: { fontSize: typeSize.emphasis, fontWeight: fontWeight.bold, color: light.ink.primary, marginTop: 6 },
  emptySub: { fontSize: typeSize.caption, color: light.ink.muted, textAlign: 'center', lineHeight: 19 },
  retry: { marginTop: space.sm, paddingHorizontal: space.lg, paddingVertical: space.xs, borderRadius: radius.full, backgroundColor: light.brand.base },
  retryTxt: { color: light.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },

  sectionTitle: {
    fontSize: typeSize.micro, fontWeight: fontWeight.semibold, letterSpacing: 1.2,
    textTransform: 'uppercase', color: light.ink.muted,
    paddingHorizontal: 16, paddingTop: space.md, paddingBottom: space.xs,
  },

  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: 16, paddingVertical: 11 },
  rowUnread: { backgroundColor: light.brand.tintBg },

  avatarWrap: { position: 'relative' },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: light.surface.sunken },
  avatarFb: { alignItems: 'center', justifyContent: 'center', backgroundColor: light.brand.base },
  avatarTxt: { color: light.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },
  badge: {
    position: 'absolute', right: -2, bottom: -2,
    width: 19, height: 19, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: light.surface.canvas,
  },

  body: { flex: 1, gap: 2 },
  line: { fontSize: typeSize.caption, lineHeight: 18, color: light.ink.secondary },
  lead: { fontWeight: fontWeight.bold, color: light.ink.primary },
  rest: { color: light.ink.secondary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  time: { fontSize: typeSize.micro, color: light.ink.faint },
  count: { fontSize: typeSize.micro, fontWeight: fontWeight.bold, color: light.brand.base },

  requestRow: { flexDirection: 'row', gap: 8, marginTop: 7 },
  accept: { paddingHorizontal: 18, paddingVertical: 7, borderRadius: radius.md, backgroundColor: light.brand.base },
  acceptTxt: { fontSize: typeSize.micro, fontWeight: fontWeight.bold, color: light.ink.inverse },
  decline: { paddingHorizontal: 18, paddingVertical: 7, borderRadius: radius.md, backgroundColor: 'rgba(11,30,61,0.06)' },
  declineTxt: { fontSize: typeSize.micro, fontWeight: fontWeight.bold, color: light.ink.primary },

  thumb: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: light.surface.sunken },
  thumbText: { padding: 5, justifyContent: 'center', borderWidth: HAIR, borderColor: light.surface.hairline },
  thumbTxt: { fontSize: 8, lineHeight: 10, color: light.ink.muted },

  followBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: radius.md, backgroundColor: light.brand.base, minWidth: 80, alignItems: 'center' },
  followingBtn: { backgroundColor: 'rgba(11,30,61,0.06)' },
  followTxt: { fontSize: typeSize.micro, fontWeight: fontWeight.bold, color: light.ink.inverse },
  followingTxt: { color: light.ink.primary },
});
