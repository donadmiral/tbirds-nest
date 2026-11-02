/**
 * BusinessInboxScreen — conversations where the business is a party.
 * Team members open a chat acting AS the business: ChatScreen receives
 * actAsId, so replies are authored by the business and reads are marked
 * for the business, regardless of which member is typing.
 */
import { ListRowSkeleton } from '../../components/skeletons';
import { themedSheet, useTheme } from '../../theme/useTheme';
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Image, StatusBar, AppState, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from '../../components/SafeArea';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import { navigationScope } from '../../lib/navigationCache';
import { readBusinessInboxWindow, type BusinessInboxTab, type BusinessInboxWindow } from '../../services/businessInbox';
import { useReadingWindow } from '../../services/useReadingWindow';
import { MeasuredHistoryList } from '../../components/MeasuredHistoryList';


function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (m < 1) return 'now'; if (m < 60) return m + 'm'; if (h < 24) return h + 'h';
  if (dy < 7) return dy + 'd';
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function BusinessInboxScreen() {
  const { t, isDark } = useTheme();
  const NAVY = t.ink.primary;
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const businessId: string = route.params?.businessId;
  const businessName: string = route.params?.businessName || 'Business';

  const { profile } = useAuthStore();
  const owner = profile?.id ?? null, scope = navigationScope();
  const [collection, setCollection] = useState<BusinessInboxWindow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'primary' | 'requests'>('primary');
  const [loadingMore, setLoadingMore] = useState(false), [refreshing, setRefreshing] = useState(false);
  const windows = useRef(new Map<BusinessInboxTab, BusinessInboxWindow>());
  const requestRef = useRef<AbortController | null>(null), generation = useRef(0), focused = useRef(false);
  const identity = useRef({ scope, owner, businessId, tab }); identity.current = { scope, owner, businessId, tab };
  const errorOperation = useRef<'refresh' | 'more'>('refresh');
  const visible = collection?.scope === scope && collection.businessId === businessId ? collection : null;
  const rows = visible?.rows ?? [], summary = visible?.summary ?? { primary: 0, requests: 0 };
  const reading = useReadingWindow<BusinessInboxWindow['rows'][number]>({ identity: `${scope}:${owner}:${businessId}:${tab}`, id: row => row.id,
    current: () => navigationScope() === scope && identity.current.owner === owner && identity.current.businessId === businessId && identity.current.tab === tab,
    fetch: async (ids, signal) => (await readBusinessInboxWindow(owner!, businessId, tab, null, false, signal,
      () => navigationScope() === scope && identity.current.owner === owner && identity.current.businessId === businessId && identity.current.tab === tab, ids)).rows,
    rows: rows => { const previous = windows.current.get(tab); if (previous?.scope === scope && previous.businessId === businessId) { const next = { ...previous, rows }; windows.current.set(tab, next); setCollection(next); } },
    error: setErr });
  const { commit: commitWindow, restoreMore } = reading;

  const load = useCallback(async (more = false, pulled = false) => {
    if (!businessId || !owner || !scope || !focused.current || AppState.currentState !== 'active') return;
    if (more && await restoreMore().catch(() => true)) return;
    const cached = windows.current.get(tab);
    const previous = cached?.scope === scope && cached.businessId === businessId ? cached : null;
    const preserve = !more && !pulled && !!reading.history.current && reading.top.current >= 80;
    if (more && (requestRef.current || !previous?.paging?.cursor)) return;
    const version = ++generation.current; requestRef.current?.abort();
    const request = new AbortController(); requestRef.current = request;
    const current = () => focused.current && generation.current === version && !request.signal.aborted
      && identity.current.scope === scope && identity.current.owner === owner && identity.current.businessId === businessId
      && identity.current.tab === tab && navigationScope() === scope;
    if (previous) setCollection(previous);
    setErr(null); setLoading(!previous); setLoadingMore(more); setRefreshing(pulled);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      let result = await Promise.race([readBusinessInboxWindow(owner, businessId, tab, previous, more, request.signal, current),
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('The business inbox took too long.')), 12000); })]);
      if (!current()) return;
      if (result.paging && !more && !preserve && result.rows.length > 120) result = await readBusinessInboxWindow(owner, businessId, tab, null, false, request.signal, current);
      if (!current()) return;
      if (result.paging) {
        const rows = await commitWindow(result.rows, !result.paging.canView ? 'reset' : more ? 'append' : preserve ? 'refresh' : 'reset', current);
        if (!current() || !rows) return;
        result = { ...result, rows, paging: preserve && result.paging.canView && previous?.paging ? { ...result.paging, cursor: previous.paging.cursor } : result.paging };
      }
      if (!result.paging) {
        windows.current.set('primary', { ...result, tab: 'primary' }); windows.current.set('requests', { ...result, tab: 'requests' });
      } else if (!result.paging.canView) windows.current.clear();
      else windows.current.set(tab, result);
      setCollection(result);
    } catch {
      if (current()) { errorOperation.current = more ? 'more' : 'refresh'; setErr(more ? 'More conversations could not be loaded. Please try again.' : 'The business inbox could not be loaded. Please try again.'); }
    } finally {
      clearTimeout(timeout); if (current()) { setLoading(false); setLoadingMore(false); setRefreshing(false); }
      request.abort(); if (requestRef.current === request) requestRef.current = null;
    }
  }, [businessId, owner, scope, tab, commitWindow, restoreMore]);

  useFocusEffect(useCallback(() => {
    focused.current = true; void load();
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') void load();
      else { generation.current++; requestRef.current?.abort(); requestRef.current = null; }
    });
    return () => { focused.current = false; generation.current++; requestRef.current?.abort(); requestRef.current = null; appState.remove(); };
  }, [load]));

  const openChat = useCallback((r: any) => {
    navigation.navigate('Chat', {
      conversationId: r.conversation_id,
      userId: r.other_id,
      userName: r.other_name || 'Customer',
      actAsId: businessId,
      otherUser: { id: r.other_id, full_name: r.other_name, username: r.other_username, avatar_url: r.other_avatar },
    });
  }, [businessId, navigation]);

  return (
    <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={t.surface.canvas} />
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={26} color={NAVY} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginHorizontal: 10 }}>
          <Text style={st.headerTitle} numberOfLines={1}>{businessName}</Text>
          <Text style={st.headerSub}>Inbox · replies send as the business</Text>
        </View>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <ListRowSkeleton />
      ) : err && (!visible || summary.primary + summary.requests === 0) ? (
        <View style={st.center}><Text style={st.errTxt}>{err}</Text><TouchableOpacity accessibilityRole="button" onPress={() => { void load(); }}><Text style={st.name}>Try again</Text></TouchableOpacity></View>
      ) : summary.primary + summary.requests === 0 ? (
        <View style={st.center}>
          <Feather name="inbox" size={38} color={t.ink.muted} />
          <Text style={st.emptyTitle}>No conversations yet</Text>
          <Text style={st.emptySub}>When customers message {businessName}, the whole team sees it here.</Text>
        </View>
      ) : (
        <MeasuredHistoryList history={reading.history.current} snapshot={reading.snapshot}
          data={rows.filter((r: any) => tab === 'requests' ? r.is_request : !r.is_request)}
          onScroll={event => { reading.top.current = event.nativeEvent.contentOffset.y; }}
          ListHeaderComponent={
            <View style={{ flexDirection: 'row', paddingHorizontal: 2, paddingBottom: 8, gap: 8 }}>
              {(['primary', 'requests'] as const).map(tabKey => {
                const n = summary[tabKey];
                const on = tab === tabKey;
                return (
                  <TouchableOpacity key={tabKey} onPress={() => setTab(tabKey)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: on ? t.ink.primary : t.surface.raised }}>
                    <Text style={{ fontSize: 12.5, fontWeight: '800', color: on ? t.ink.inverse : t.ink.secondary }}>{tabKey === 'primary' ? 'Primary' : 'Requests'}{n > 0 ? ' ' + n : ''}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          }
          keyExtractor={r => r.conversation_id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void load(false, true); }} tintColor={t.ink.muted} />}
          onEndReached={() => { if (!err) void load(true); }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={err ? <View style={{ padding: 16, alignItems: 'center' }}><Text style={st.errTxt}>{err}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry business inbox" onPress={() => { void load(errorOperation.current === 'more'); }}><Text style={st.name}>Try again</Text></TouchableOpacity>
          </View> : loadingMore ? <View style={{ padding: 16 }}><ActivityIndicator color={t.ink.primary} /></View> : null}
          ItemSeparatorComponent={() => <View style={st.sep} />}
          contentContainerStyle={{ paddingVertical: 4, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <TouchableOpacity style={st.row} activeOpacity={0.85} onPress={() => openChat(item)}>
              {item.other_avatar
                ? <Image source={{ uri: item.other_avatar }} style={st.av} />
                : <View style={[st.av, st.avFb]}><Text style={st.avTxt}>{String(item.other_name || '?').slice(0, 1).toUpperCase()}</Text></View>}
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[st.name, item.unread > 0 && { color: NAVY }]} numberOfLines={1}>{item.other_name || 'Customer'}</Text>
                  <Text style={st.time}>{relTime(item.last_at)}</Text>
                </View>
                <Text style={[st.preview, item.unread > 0 && st.previewUnread]} numberOfLines={1}>
                  {item.last_sender === route.params?.businessId ? 'You: ' : ''}{item.last_text || 'Say hello'}
                </Text>
                {item.context && item.context !== 'personal' ? (
                  <View style={st.ctxChip}><Text style={st.ctxTxt}>{String(item.context).toUpperCase()}</Text></View>
                ) : null}
              </View>
              {item.unread > 0 && <View style={st.unreadDot}><Text style={st.unreadTxt}>{item.unread > 99 ? '99+' : item.unread}</Text></View>}
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const st = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline },
  headerTitle: { fontSize: 16, fontWeight: '800', color: t.ink.primary, textAlign: 'center' },
  headerSub: { fontSize: 11.5, color: t.ink.muted, textAlign: 'center', marginTop: 1 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: t.surface.divider, marginLeft: 78 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  av: { width: 50, height: 50, borderRadius: 25 },
  avFb: { backgroundColor: t.ink.primary, alignItems: 'center', justifyContent: 'center' },
  avTxt: { color: t.ink.inverse, fontSize: 18, fontWeight: '800' },
  name: { flex: 1, fontSize: 15.5, fontWeight: '700', color: t.ink.secondary },
  time: { fontSize: 12, color: t.ink.muted, marginLeft: 8 },
  preview: { fontSize: 13.5, color: t.ink.muted, marginTop: 2 },
  previewUnread: { color: t.ink.primary, fontWeight: '600' },
  ctxChip: { alignSelf: 'flex-start', marginTop: 5, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: t.brand.tintBg },
  ctxTxt: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6, color: t.ink.muted },
  unreadDot: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: t.ink.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  unreadTxt: { color: t.ink.inverse, fontSize: 11, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  errTxt: { fontSize: 14.5, fontWeight: '600', color: t.ink.primary, textAlign: 'center' },
  emptyTitle: { fontSize: 16.5, fontWeight: '800', color: t.ink.primary, marginTop: 12 },
  emptySub: { fontSize: 13.5, color: t.ink.muted, textAlign: 'center', marginTop: 4, lineHeight: 19 },
}));
