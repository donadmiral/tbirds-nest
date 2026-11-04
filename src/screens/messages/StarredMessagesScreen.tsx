import { ListRowSkeleton } from '../../components/skeletons';
import { themedSheet, useTheme } from '../../theme/useTheme';
import TierName from '../../components/TierName';
import VerifiedBadge from '../../components/VerifiedBadge';
import { TextInput , View, Text, StyleSheet, TouchableOpacity, FlatList, StatusBar, Image, RefreshControl } from 'react-native';
import EmptyState from '../../components/EmptyState';
/**
 * StarredMessagesScreen.tsx
 * All messages I personally starred, across DMs and groups.
 * Tap a row to open the chat. Tap the star to unstar.
 */
import React, { useCallback, useEffect, useState } from 'react';

import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { signGroupAvatars, isChatMediaUrl } from '../../services/chatMediaService';
import { useAuthStore } from '../../stores/authStore';
import { createScreenReadGuard, isReadAccessDenied, requireReadRows } from '../../../shared/readContinuity';
import { orderTimeout } from '../../../shared/orderRequest';

const bounded = <T,>(work: PromiseLike<T>) => orderTimeout(work, 15000, 'Starred messages could not be loaded.');

type Row = {
  id: string;
  message_id: string;
  starred_at: string;
  conversation_id: string;
  msg: {
    id: string;
    text: string | null;
    media_url: string | null;
    media_type: string | null;
    created_at: string;
    sender_id: string;
  } | null;
  conv: {
    id: string;
    is_group: boolean;
    group_name: string | null;
    group_emoji: string | null;
    group_avatar_url: string | null;
    user_1: string | null;
    user_2: string | null;
  } | null;
  sender_name?: string;
  other_party?: { id: string; full_name: string; avatar_url: string | null } | null;
};

function fmtShortDate(d?: string | null) {
  if (!d) return '';
  const date = new Date(d), now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const days = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (days < 7) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function initials(n?: string | null) {
  if (!n) return 'U';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}

export default function StarredMessagesScreen() {
  const { t, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const myId = useAuthStore(state => state.profile?.id ?? null);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reads] = useState(() => createScreenReadGuard(myId));
  reads.setScope(myId);
  useEffect(() => { setRows([]); setLoading(!!myId); setRefreshing(false); setLoadError(null); }, [myId]);
  const [q, setQ] = useState('');
  const load = useCallback(async () => {
    if (!myId) { setLoading(false); return; }
    const current = reads.begin(myId);
    if (!current()) return;
    setLoadError(null);
    try {
      const { data: starred, error } = await bounded(supabase
        .from('starred_messages')
        .select('id, message_id, starred_at, conversation_id, msg:messages!message_id(id, text, media_url, media_type, created_at, sender_id)')
        .eq('starred_by', myId)
        .order('starred_at', { ascending: false }));

      if (!current()) return;
      if (error) throw error;
      const starredRows = requireReadRows<any>(starred);
      if (starredRows.length === 0) { setRows([]); return; }
      // Message attachments are not rendered here. Chat authorizes them on open.

      const convIds = Array.from(new Set(starredRows.map(r => r.conversation_id)));
      const { data: convs, error: conversationError } = await bounded(supabase
        .from('conversations')
        .select('id, is_group, group_name, group_emoji, group_avatar_url, user_1, user_2')
        .in('id', convIds));
      if (conversationError) throw conversationError;
      if (!current()) return;
      const conversations = requireReadRows<any>(convs);
      const convMap: Record<string, any> = {};
      const privateIds = new Set(conversations.filter(c => isChatMediaUrl(c.group_avatar_url)).map(c => c.id));
      const discardAvatars = (ids: Set<string>) => {
        if (current() && ids.size) setRows(previous => current() ? previous.map(row => row.conv && ids.has(row.conv.id) ? { ...row, conv: { ...row.conv, group_avatar_url: null } } : row) : previous);
      };
      const signedConversations = await bounded(signGroupAvatars(conversations)).catch(error => { discardAvatars(privateIds); throw error; });
      signedConversations.forEach((c: any) => { convMap[c.id] = c; });
      discardAvatars(new Set([...privateIds].filter(id => !convMap[id]?.group_avatar_url)));

      const senderIds = Array.from(new Set(starredRows.map(r => r.msg?.sender_id).filter(Boolean)));
      const dmOtherIds = new Set<string>();
      conversations.forEach((c: any) => {
        if (!c.is_group) {
          const other = c.user_1 === myId ? c.user_2 : c.user_1;
          if (other) dmOtherIds.add(other);
        }
      });
      const allProfileIds = Array.from(new Set([...senderIds, ...dmOtherIds]));
      const profileMap: Record<string, any> = {};
      if (allProfileIds.length > 0) {
        const { data: profs, error: profileError } = await bounded(supabase
          .from('profiles').select('id, full_name, avatar_url').in('id', allProfileIds));
        if (profileError) throw profileError;
        requireReadRows<any>(profs).forEach((p: any) => { profileMap[p.id] = p; });
      }

      const composed: Row[] = starredRows.map((r: any) => {
        const conv = convMap[r.conversation_id] || null;
        const sender = r.msg?.sender_id ? profileMap[r.msg.sender_id] : null;
        let otherParty = null;
        if (conv && !conv.is_group) {
          const otherId = conv.user_1 === myId ? conv.user_2 : conv.user_1;
          otherParty = otherId ? profileMap[otherId] : null;
        }
        return {
          id: r.id,
          message_id: r.message_id,
          starred_at: r.starred_at,
          conversation_id: r.conversation_id,
          msg: r.msg,
          conv,
          sender_name: sender?.full_name || 'Member',
          other_party: otherParty,
        };
      });
      if (current()) setRows(composed);
    } catch (e) {
      if (current()) {
        if (isReadAccessDenied(e)) setRows([]);
        setLoadError('Starred messages could not be refreshed. Tap to retry.');
      }
    } finally {
      if (current()) { setLoading(false); setRefreshing(false); }
    }
  }, [myId, reads]);

  // Reload every time the screen comes into focus. Stars removed
  // elsewhere (reaction sheet, chat info modal) show up immediately.
  useFocusEffect(useCallback(() => { void load(); return () => reads.invalidate(); }, [load, reads]));

  const unstar = async (row: Row) => {
    reads.begin(myId);
    const current = reads.capture(myId);
    if (!current()) return;
    setLoading(false); setRefreshing(false);
    setRows(prev => prev.filter(r => r.id !== row.id));
    try {
      const { error } = await bounded(supabase.from('starred_messages').delete().eq('id', row.id));
      if (error) throw error;
      if (current()) { reads.begin(myId); setRows(prev => prev.filter(r => r.id !== row.id)); setLoading(false); setRefreshing(false); }
    } catch { if (current()) void load(); }
  };

  const openChat = (row: Row) => {
    if (!row.conv) return;
    if (row.conv.is_group) {
      navigation.navigate('Chat', {
        conversationId: row.conversation_id,
        isGroup: true,
        groupName: row.conv.group_name || 'Group',
        groupEmoji: row.conv.group_emoji || '💬',
      });
    } else {
      const otherId = row.conv.user_1 === myId ? row.conv.user_2 : row.conv.user_1;
      navigation.navigate('Chat', {
        conversationId: row.conversation_id,
        userId: otherId,
        otherUser: row.other_party,
      });
    }
  };

  const nq = q.trim().toLowerCase();
  const filteredRows = !nq ? rows : rows.filter(r => (r.msg?.text || '').toLowerCase().includes(nq) || (r.other_party?.full_name || '').toLowerCase().includes(nq) || (r.conv?.group_name || '').toLowerCase().includes(nq) || (r.sender_name || '').toLowerCase().includes(nq));

  const renderRow = ({ item }: { item: Row }) => {
    const conv = item.conv;
    const isGroup = !!conv?.is_group;
    const contextName = isGroup
      ? (conv?.group_name || 'Group')
      : (item.other_party?.full_name || 'Direct Message');
    const senderLabel = item.msg?.sender_id === myId ? 'You' : (item.sender_name || 'Member');
    const preview = item.msg?.text
      || (item.msg?.media_type === 'image' ? '📷 Photo'
        : item.msg?.media_type === 'video' ? '🎬 Video'
        : item.msg?.media_type === 'gif' ? '🎞 GIF'
        : item.msg?.media_type === 'document' ? '📄 Document'
        : '📎 Media');

    return (
      <TouchableOpacity style={s.row} activeOpacity={0.85} onPress={() => openChat(item)}>
        {isGroup
          ? (conv?.group_avatar_url
              ? <Image source={{ uri: conv.group_avatar_url }} style={s.avatar} />
              : <View style={[s.avatar, s.avatarFb]}><Text style={{ fontSize: 22 }}>{conv?.group_emoji || '💬'}</Text></View>)
          : (item.other_party?.avatar_url
              ? <Image source={{ uri: item.other_party.avatar_url }} style={s.avatar} />
              : <View style={[s.avatar, s.avatarFb]}><Text style={s.avatarTxt}>{initials(contextName)}</Text></View>)}
        <View style={{ flex: 1 }}>
          <View style={s.rowTop}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}>{!isGroup && item.other_party?.id ? (<TierName userId={item.other_party.id} baseStyle={s.contextName} text={contextName} />) : (<Text style={s.contextName} numberOfLines={1}>{contextName}</Text>)}{!isGroup && item.other_party?.id ? <VerifiedBadge userId={item.other_party.id} size={12} /> : null}</View>
            <Text style={s.date}>{fmtShortDate(item.starred_at)}</Text>
          </View>
          <Text style={s.sender}>{senderLabel}</Text>
          <Text style={s.preview} numberOfLines={2}>{preview}</Text>
        </View>
        <TouchableOpacity
          style={s.unstarBtn}
          onPress={() => unstar(item)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.6}
        >
          <Text style={s.unstarIcon}>★</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={t.surface.canvas} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.6}>
          <Text style={s.backChev}>‹</Text>
          <Text style={s.backLbl}>Messages</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Starred</Text>
        <View style={{ minWidth: 90 }} />
      </View>

      {loadError ? <TouchableOpacity accessibilityRole="button" onPress={() => { setRefreshing(true); void load(); }}><Text accessibilityRole="alert" style={{ padding: 16, color: t.status.danger }}>{loadError}</Text></TouchableOpacity> : null}
      {loading && rows.length === 0 ? (
        <ListRowSkeleton />
      ) : rows.length === 0 && !loadError ? (
        <View style={s.empty}>
          <Text style={s.emptyStar}>★</Text>
          <Text style={s.emptyTitle}>No starred messages</Text>
          <Text style={s.emptyTxt}>
            Long-press any message in a chat and tap Star to save it here.
          </Text>
        </View>
      ) : (
        <FlatList ListHeaderComponent={<View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 }}><TextInput value={q} onChangeText={setQ} placeholder="Search saved messages" placeholderTextColor="#9A9DA4" autoCapitalize="none" style={{ backgroundColor: '#F2F2F7', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14.5, color: '#111' }} /></View>}
 ListEmptyComponent={loadError ? null : <EmptyState icon="star" title="No starred messages" line="Star a message to keep it within reach." />}
          data={filteredRows}
          keyExtractor={r => r.id}
          renderItem={renderRow}
          contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#007AFF" />}
        />
      )}
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#C6C6C8' },
  backBtn: { flexDirection: 'row', alignItems: 'center', minWidth: 90, paddingVertical: 6 },
  backChev: { fontSize: 30, color: '#007AFF', lineHeight: 34, marginLeft: 4, marginRight: 2 },
  backLbl: { fontSize: 17, color: t.status.link },
  headerTitle: { fontSize: 17, fontWeight: '600', color: t.ink.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 10 },
  emptyStar: { fontSize: 52, color: '#FFD60A' },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: t.ink.primary },
  emptyTxt: { fontSize: 14, color: t.ink.muted, textAlign: 'center', lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  avatarFb: { backgroundColor: '#E5E5EA', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 16, fontWeight: '700', color: '#3C3C43' },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  contextName: { fontSize: 15, fontWeight: '700', color: '#000', flex: 1 },
  date: { fontSize: 12, color: '#8E8E93' },
  sender: { fontSize: 12, color: '#007AFF', fontWeight: '600', marginTop: 2 },
  preview: { fontSize: 14, color: '#3C3C43', marginTop: 4, lineHeight: 19 },
  unstarBtn: { padding: 6 },
  unstarIcon: { fontSize: 22, color: '#FFD60A' },
}));
