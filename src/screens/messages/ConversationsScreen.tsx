import { navigationCache, navigationScope, subscribeNavigationScope } from '../../lib/navigationCache';
import { applyNavigationInboxAvatars, compareNativeInbox, matchesNativeInbox, nativeInboxOptions, preserveNavigationInboxPreviews, readNavigationInboxIds,
  readNavigationInboxWindow, refreshNavigationInbox, subscribeNavigationInboxAvatars, type Conversation, type InboxPreview } from '../../services/navigationInbox';
import { createInboxMergeGuard, inboxQueryKey, type InboxPaging } from '../../../shared/inboxWindow';
import { createInboxRefreshQueue } from '../../../shared/inboxRefreshQueue';
import { useReadingWindow } from '../../services/useReadingWindow';
import { MeasuredHistoryList } from '../../components/MeasuredHistoryList';
import { retainRecord } from '../../../shared/retainedMaps';
import { createInboxMentions, readInboxMentionTimes } from '../../../shared/inboxMentions';
import { themedSheet, getTheme, useTheme } from '../../theme/useTheme';
import { TapTopFlatList } from '../../components/TapTopList';
import EmptyState from '../../components/EmptyState';
import TierName from '../../components/TierName';
import VerifiedBadge from '../../components/VerifiedBadge';
import { handleTabBarScroll } from '../../components/AdaptiveTabBar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Image, StatusBar, ActionSheetIOS, Alert, Platform, AppState } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { Feather , Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { createTypingActivity, type TypingRow } from '../../../shared/typingActivity';
import { useUnreadStore } from '../../stores/unreadStore';
import { storiesService } from '../../services/storiesService';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { useDraftStore } from '../../stores/draftStore';
import { Swipeable } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { ConversationsSkeleton } from '../../components/Skeleton';


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
  const { t, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;
  const focused = useIsFocused();
  const [sessionScope, setSessionScope] = useState(navigationScope);

  const [initialInbox] = useState(() => navigationCache.read<Conversation[]>(navigationScope(), 'inbox:personal'));
  const [conversations, setConversationState] = useState<Conversation[]>(initialInbox ?? []);
  const conversationsRef = useRef(conversations); conversationsRef.current = conversations;
  const headReload = useRef<(() => void) | null>(null), headPending = useRef(false);
  const renderRevision = useRef(0);
  const setConversations = useCallback((update: React.SetStateAction<Conversation[]>) => {
    const next = typeof update === 'function' ? update(conversationsRef.current) : update;
    const value = reading.history.current;
    if (value?.available()) {
      const snapshot = value.getSnapshot(), before = snapshot.rows;
      const reordered = next.some((row, index) => row.id !== before[index]?.id);
      if (reordered && snapshot.before === 0 && snapshot.after === 0 && next.length <= 120) {
        const version = ++renderRevision.current, scope = navigationScope(), owner = accountRef.current;
        void reading.commit(next, 'reset', () => mountedRef.current && version === renderRevision.current && navigationScope() === scope && accountRef.current === owner)
          .catch(() => setLoadError('Conversations could not be saved on this device. Please retry.'));
        return;
      }
      if (reordered) headPending.current = true;
      value.replaceHot(next);
      if (reordered && reading.top.current < 80) headReload.current?.();
      return;
    }
    conversationsRef.current = next; setConversationState(next);
  }, []);
  const [paging, setPaging] = useState<InboxPaging | null>(() => navigationCache.read(navigationScope(), 'inbox:personal:paging'));
  const pagingRef = useRef(paging); pagingRef.current = paging;
  const mergeGuard = useRef(createInboxMergeGuard<Conversation>());
  const previewHints = useRef(new Map<string, InboxPreview>());
  const listAbort = useRef<AbortController | null>(null);
  const moreAbort = useRef<AbortController | null>(null);
  const morePending = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [typingConvIds, setTypingConvIds] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [mentionTimes, setMentionTimes] = useState<Record<string, number>>({});
  const mentionsReader = useRef<ReturnType<typeof createInboxMentions> | null>(null);
  const openedTimes = useDraftStore(s => s.openedTimes);
  const mentionAmnesty = useDraftStore(s => userId ? s.mentionAmnesty?.[userId] ?? 0 : 0);
  useEffect(() => {
    if (showArchived && (paging ? paging.summary.archivedPersonal === 0
      : !conversations.some(c => c.is_archived && ((c as any).context || 'personal') === 'personal'))) {
      setShowArchived(false);
    }
  }, [showArchived, conversations, paging]);
  const [loading, setLoading] = useState(initialInbox === null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const [search, setSearch]  = useState('');
  const [tab, setTab]        = useState<'all' | 'groups' | 'unread'>('all');
  const optionsRef = useRef(nativeInboxOptions(search, tab, showArchived));
  optionsRef.current = nativeInboxOptions(search, tab, showArchived);
  const queryKey = inboxQueryKey(optionsRef.current);
  const baseQueryKey = inboxQueryKey(nativeInboxOptions());
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
    }).catch(() => { /* Keep the current rings during a transient refresh failure. */ });
    return () => { alive = false; };
  }, []));
  useFocusEffect(useCallback(() => { useUnreadStore.getState().refresh(); }, []));

  const mountedRef = useRef(true);
  const initialLoadDoneRef = useRef(initialInbox !== null);
  const accountRef = useRef(userId); accountRef.current = userId;
  const inboxScope = useRef(sessionScope);
  const reading = useReadingWindow<Conversation>({ identity: `${sessionScope}:${userId}:${queryKey}`, id: row => row.id,
    current: () => mountedRef.current && navigationScope() === sessionScope && accountRef.current === userId,
    fetch: async (ids, signal) => {
      const key = inboxQueryKey(optionsRef.current), revision = mergeGuard.current.begin();
      const current = () => mountedRef.current && navigationScope() === sessionScope && accountRef.current === userId && inboxQueryKey(optionsRef.current) === key;
      const rows = await readNavigationInboxIds(userId!, optionsRef.current, ids, signal, current);
      return [...rows.values()].filter(row => matchesNativeInbox(row, optionsRef.current) && mergeGuard.current.canApply(row.id, revision));
    },
    rows: rows => { conversationsRef.current = rows; setConversationState(rows); }, error: setLoadError });
  const { commit: commitWindow, restoreMore } = reading;
  useEffect(() => {
    const ids = new Set(conversations.map(row => row.id));
    setMentionTimes(previous => retainRecord(previous, ids));
    for (const id of previewHints.current.keys()) if (!ids.has(id)) previewHints.current.delete(id);
  }, [conversations]);
  useEffect(() => subscribeNavigationInboxAvatars((scope, avatars) => {
    if (scope !== navigationScope() || scope !== inboxScope.current) return;
    setConversations(rows => applyNavigationInboxAvatars(rows, avatars));
  }), []);
  useEffect(() => {
    const sync = () => {
      const next = navigationScope();
      if (inboxScope.current === next) return;
      inboxScope.current = next; setSessionScope(next);
      reading.reset(); headPending.current = false;
      listAbort.current?.abort(); moreAbort.current?.abort(); moreAbort.current = null; mergeGuard.current.clear(); previewHints.current.clear(); morePending.current = false; setLoadingMore(false);
      const cached = navigationCache.read<Conversation[]>(next, 'inbox:personal');
      setConversations(cached ?? []); setMentionTimes({}); setLoadError(null); setLoading(cached === null);
      const nextPaging = navigationCache.read<InboxPaging>(next, 'inbox:personal:paging');
      pagingRef.current = nextPaging; setPaging(nextPaging);
      initialLoadDoneRef.current = cached !== null; loadGeneration.current++;
    };
    sync(); return subscribeNavigationScope(sync);
  }, [userId]);
  useEffect(() => {
    if (initialLoadDoneRef.current && (!paging || paging.query === baseQueryKey)) {
      navigationCache.save(inboxScope.current, 'inbox:personal', conversations);
      navigationCache.save(inboxScope.current, 'inbox:personal:paging', paging);
    }
  }, [conversations, paging, baseQueryKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; listAbort.current?.abort(); moreAbort.current?.abort(); };
  }, []);

  // Preview/order/avatar changes must not restart the typing subscription.
  const typingConversations = conversations.map(row => row.id).sort().join(',');
  useEffect(() => {
    setTypingConvIds(new Set());
    if (!userId || !focused || !typingConversations) return;
    let live = true;
    const scope = inboxScope.current, mine = new Set(typingConversations.split(','));
    const current = () => live && accountRef.current === userId && inboxScope.current === scope && navigationScope() === scope;
    const typing = createTypingActivity({
      active: AppState.currentState === 'active', intervalMs: 3500, lifetimeMs: 8000,
      accept: row => row.user_id !== userId && mine.has(row.conversation_id),
      onChange: rows => {
        if (!current()) return;
        const next = new Set(rows.map(row => row.conversation_id));
        setTypingConvIds(prev => prev.size === next.size && [...prev].every(id => next.has(id)) ? prev : next);
      },
      read: async signal => {
        const { data, error } = await supabase
          .from('conversation_typing')
          .select('conversation_id, user_id, is_typing, updated_at')
          .eq('is_typing', true)
          .gt('updated_at', new Date(Date.now() - 8000).toISOString()).abortSignal(signal);
        if (error) throw error;
        return current() ? (data ?? []) as TypingRow[] : [];
      },
    });
    const ch = supabase.channel(`list_typing_${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_typing' }, payload => { if (current()) typing.change(payload); })
      .subscribe(status => typing.status(status));
    const appState = AppState.addEventListener('change', state => typing.setActive(state === 'active'));
    typing.refresh();
    return () => { live = false; typing.dispose(); appState.remove(); void supabase.removeChannel(ch); };
  }, [userId, focused, typingConversations, sessionScope]);

  const load = useCallback(async (externalSignal?: AbortSignal) => {
    if (!userId) { setLoading(false); return false; }
    const generation = ++loadGeneration.current;
    listAbort.current?.abort();
    moreAbort.current?.abort(); moreAbort.current = null; morePending.current = false; setLoadingMore(false);
    const request = new AbortController(); listAbort.current = request;
    const cancel = () => request.abort(); externalSignal?.addEventListener('abort', cancel, { once: true });
    if (externalSignal?.aborted) cancel();
    const alive = () => mountedRef.current && accountRef.current === userId && generation === loadGeneration.current && navigationScope() === inboxScope.current;
    const current = () => !request.signal.aborted && alive();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const options = optionsRef.current, query = inboxQueryKey(options), revision = mergeGuard.current.begin();
    const previousPaging = pagingRef.current, preserve = !!reading.history.current && reading.top.current >= 80 && previousPaging?.query === query;
    const retainedIds = conversationsRef.current.map(row => row.id);
    setLoadError(null);
    if (!initialLoadDoneRef.current || (pagingRef.current && pagingRef.current.query !== query)) setLoading(true);
    try {
      const work = query === inboxQueryKey(nativeInboxOptions()) && !pagingRef.current
        ? refreshNavigationInbox(userId).then(items => ({ items, paging: navigationCache.read<InboxPaging>(inboxScope.current, 'inbox:personal:paging'), checkedIds: [...retainedIds, ...items.map(row => row.id)] }))
        : readNavigationInboxWindow(userId, options, { items: conversationsRef.current, paging: pagingRef.current }, false, request.signal, current);
      // The event queue owns its timeout and physical transport slot. A
      // second timeout race here would release that slot before work settles.
      let result = externalSignal ? await work : await Promise.race([work, new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => { request.abort(); reject(new Error('Conversation read timed out.')); }, 12_000);
      })]);
      if (!current()) return false;
      if (result.paging && !preserve && result.items.length > 120) result = await readNavigationInboxWindow(userId, options, null, false, request.signal, current);
      if (!current()) return false;
      if (result.paging && query !== inboxQueryKey(optionsRef.current)) {
        previousQuery.current = ''; pagingRef.current = result.paging; setPaging(result.paging); return false;
      }
      const rows = mergeGuard.current.commit(preserveNavigationInboxPreviews(result.items, conversationsRef.current, previewHints.current), conversationsRef.current, revision, result.checkedIds)
        .filter(row => !result.paging || matchesNativeInbox(row, options)).sort(compareNativeInbox);
      if (result.paging) {
        if (preserve && rows.some(row => !conversationsRef.current.some(previous => previous.id === row.id))) headPending.current = true;
        await commitWindow(rows, preserve ? 'refresh' : 'reset', current); if (!current()) return false;
      } else setConversations(rows);
      pagingRef.current = preserve && result.paging && previousPaging ? { ...previousPaging, summary: result.paging.summary } : result.paging; setPaging(pagingRef.current);
      return true;
    } catch { if (alive() && !externalSignal?.aborted) setLoadError('Your conversations could not be refreshed. Please try again.'); return false; }
    finally {
      clearTimeout(deadline);
      if (alive()) { setLoading(false); initialLoadDoneRef.current = true; }
      externalSignal?.removeEventListener('abort', cancel);
      if (listAbort.current === request) listAbort.current = null;
    }
  }, [userId, sessionScope, commitWindow]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    headReload.current = () => { if (timer) return; timer = setTimeout(() => { timer = undefined; if (mountedRef.current) void load(); }, 150); };
    return () => { if (timer) clearTimeout(timer); headReload.current = null; };
  }, [load]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { loadGeneration.current++; listAbort.current?.abort(); moreAbort.current?.abort(); };
  }, [load]));

  const previousQuery = useRef(queryKey);
  useEffect(() => {
    if (previousQuery.current === queryKey) return;
    previousQuery.current = queryKey;
    if (!pagingRef.current && initialLoadDoneRef.current) return; // old backends keep local filtering
    loadGeneration.current++; listAbort.current?.abort(); setLoading(true);
    const timer = setTimeout(() => { if (focused) void load(); }, 250);
    return () => clearTimeout(timer);
  }, [queryKey, paging?.query, focused, load]);

  const loadMore = useCallback(async () => {
    if (await restoreMore().catch(() => true)) return;
    const previous = pagingRef.current, options = optionsRef.current;
    if (!userId || !focused || loading || morePending.current || !previous?.cursor || previous.query !== inboxQueryKey(options)) return;
    morePending.current = true; setLoadingMore(true);
    const generation = loadGeneration.current, scope = inboxScope.current, revision = mergeGuard.current.begin();
    const request = new AbortController(); moreAbort.current = request;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const alive = () => mountedRef.current && generation === loadGeneration.current && scope === navigationScope()
      && accountRef.current === userId && inboxQueryKey(optionsRef.current) === previous.query;
    const current = () => !request.signal.aborted && alive();
    try {
      const next = await Promise.race([readNavigationInboxWindow(userId, options, { items: conversationsRef.current, paging: previous }, true, request.signal, current),
        new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => { request.abort(); reject(new Error('Conversation read timed out.')); }, 12_000); })]);
      if (!current()) return;
      const rows = mergeGuard.current.commit(preserveNavigationInboxPreviews(next.items, conversationsRef.current, previewHints.current), conversationsRef.current, revision, next.checkedIds).filter(row => matchesNativeInbox(row, options)).sort(compareNativeInbox);
      await commitWindow(rows, 'append', current); if (!current()) return;
      pagingRef.current = next.paging; setPaging(next.paging); setLoadError(null);
    } catch { if (alive()) setLoadError('More conversations could not be loaded. Please try again.'); }
    finally { clearTimeout(deadline); request.abort(); if (moreAbort.current === request) { moreAbort.current = null; morePending.current = false; if (mountedRef.current) setLoadingMore(false); } }
  }, [userId, focused, loading, commitWindow, restoreMore]);

  useEffect(() => {
    if (!userId || !focused) return;

    let live = true;
    const scope = inboxScope.current;
    const current = () => live && mountedRef.current && accountRef.current === userId && navigationScope() === scope;
    const updates = createInboxRefreshQueue({ active: AppState.currentState === 'active',
      read: async (ids, signal) => {
        if (!current()) return;
        if (!ids || !pagingRef.current) { if (!await load(signal)) throw new Error('Conversation refresh failed.'); return; }
        const options = optionsRef.current, query = inboxQueryKey(options), revision = mergeGuard.current.begin();
        const fresh = await readNavigationInboxIds(userId, options, ids, signal, current);
        if (!current() || signal.aborted || inboxQueryKey(optionsRef.current) !== query) return;
        const changed = new Set(ids), rows = conversationsRef.current;
        const next = [...rows.filter(row => !changed.has(row.id)), ...fresh.values()].filter(row => matchesNativeInbox(row, options));
        const merged = mergeGuard.current.commit(preserveNavigationInboxPreviews(next, rows, previewHints.current), rows, revision, ids).filter(row => matchesNativeInbox(row, options)).sort(compareNativeInbox);
        setConversations(merged); setLoadError(null);
      },
      onError: () => { if (current()) setLoadError('Your conversations could not be refreshed. Please try again.'); },
    });
    const appState = AppState.addEventListener('change', state => updates.setActive(state === 'active'));
    const changed = (id?: string) => { if (id) updates.changed(id); else updates.refresh(); };

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
          if (!current()) return;
          if (typeof convRow.id === 'string' && (typeof convRow.last_sender_id === 'string' || typeof convRow.last_sender_name === 'string')) {
            previewHints.current.delete(convRow.id);
            previewHints.current.set(convRow.id, { id: convRow.id,
              last_message: typeof convRow.last_message === 'string' ? convRow.last_message : '',
              last_message_time: typeof convRow.last_message_time === 'string' ? convRow.last_message_time : null,
              last_sender_id: typeof convRow.last_sender_id === 'string' ? convRow.last_sender_id : null,
              last_sender_name: typeof convRow.last_sender_name === 'string' ? convRow.last_sender_name : null });
            if (previewHints.current.size > 200) previewHints.current.delete(previewHints.current.keys().next().value!);
          }
          if (pagingRef.current || AppState.currentState !== 'active') { changed(convRow.id); return; }
          mergeGuard.current.touch([convRow.id]);
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_settings', filter: `user_id=eq.${userId}` }, () => updates.refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members', filter: `user_id=eq.${userId}` }, () => updates.refresh())
      .subscribe(status => { if (status === 'SUBSCRIBED') { updates.refresh(); mentionsReader.current?.refresh(); } });

    const msgCh = supabase
      .channel(`inbox_msg_${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const msg = payload.new as any;
          if (!msg.conversation_id || msg.sender_id === userId) return;
          if (msg.receiver_id && msg.receiver_id !== userId) return; // someone else's DM
          if (!current()) return;
          if (pagingRef.current || AppState.currentState !== 'active') { changed(msg.conversation_id); return; }
          mergeGuard.current.touch([msg.conversation_id]);

          setConversations(prev => {
            const idx = prev.findIndex(c => c.id === msg.conversation_id);
            if (idx === -1) {
              updates.refresh();
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
          if (!current()) return;
          if (pagingRef.current || AppState.currentState !== 'active') { changed(msg.conversation_id); return; }
          mergeGuard.current.touch([msg.conversation_id]);

          const preview = msg.text || (
            msg.media_type === 'image' ? '📷 Photo'
            : msg.media_type === 'video' ? '🎬 Video'
            : msg.media_type === 'document' ? '📄 File'
            : '📎 Media'
          );

          setConversations(prev => {
            const idx = prev.findIndex(c => c.id === msg.conversation_id);
            if (idx === -1) {
              updates.refresh();
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
      .subscribe(status => { if (status === 'SUBSCRIBED') { updates.refresh(); mentionsReader.current?.refresh(); } });

    return () => {
      live = false; updates.dispose(); appState.remove();
      supabase.removeChannel(convCh);
      supabase.removeChannel(msgCh);
    };
  }, [userId, focused, load, setConversations]);

  // ── Conversation settings helpers ─────────────────────────────────────────

  const upsertSetting = async (convId: string, patch: Partial<{
    is_pinned: boolean; is_muted: boolean; is_archived: boolean; is_deleted: boolean;
  }>) => {
    if (!userId) return;
    try { await supabase.from('conversation_settings').upsert({
      conversation_id: convId, user_id: userId,
      ...patch, updated_at: new Date().toISOString(),
    }, { onConflict: 'conversation_id,user_id' }); } catch (e) { console.log('[UPSERT_SETTING]', e); }
    mergeGuard.current.touch([convId]);
    setConversations(prev => prev.map(c =>
      c.id === convId ? { ...c, ...patch } : c
    ).filter(c => !('is_deleted' in patch && patch.is_deleted && c.id === convId)));
    if (pagingRef.current) void load();
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
    mergeGuard.current.touch([conv.id]);
    setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, ...patch } : c));
    try {
      const result = await supabase.from('conversation_settings').upsert({
        conversation_id: conv.id, user_id: userId, ...patch,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'conversation_id,user_id' });
      if (result.error) throw result.error;
      if (pagingRef.current) void load();
    } catch {
      mergeGuard.current.touch([conv.id]);
      setConversations(prev => prev.map(c => c.id === conv.id
        ? { ...c, ...Object.fromEntries(Object.keys(patch).map(k => [k, (conv as any)[k]])) } : c));
    }
  }, [userId, load, setConversations]);

  const openChat = (conv: Conversation) => {
    useDraftStore.getState().markOpened(conv.id);
    if ((conv as any).manually_unread) setConvSetting(conv, { manually_unread: false } as any);
    mergeGuard.current.touch([conv.id]);
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
      groupType: conv.is_group ? (conv.group_type || null) : undefined,
      groupRefId: conv.is_group ? (conv.group_ref_id || null) : undefined,
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
    // A community's chat belongs to its community: it lives under Groups, never among people.
    if (c.group_type === 'community') return false; // a community's chat opens from the community, not from here
    if (c.request_pending) return false; // waiting in Message requests until accepted there
    const matchTab = tab === 'all'
      ? ctx === 'personal'
      : tab === 'unread' ? c.unread_count > 0
      : tab === 'groups' ? c.is_group
      : true;
    return matchSearch && matchTab;
  });
  const archivedCount = paging?.summary.archivedPersonal
    ?? conversations.filter(c => c.is_archived && (c.context || 'personal') === 'personal').length;

  // ── Render conversation row ───────────────────────────────────────────────

  useEffect(() => {
    if (!userId || !focused) return;
    let live = true;
    let verified = false;
    const scope = sessionScope;
    const current = () => live && mountedRef.current && accountRef.current === userId && navigationScope() === scope;
    const amnesty = () => {
      if (current() && verified && ((useDraftStore as any).persist?.hasHydrated?.() ?? true)) {
        useDraftStore.getState().ensureMentionAmnesty(userId);
      }
    };
    const reader = createInboxMentions({ active: AppState.currentState === 'active', paged: () => !!pagingRef.current,
      read: (ids, since, signal) => {
        const session = useAuthStore.getState().session;
        if (session?.user.id !== userId || !current()) return Promise.reject(new Error('The account changed.'));
        return readInboxMentionTimes(supabase, { viewer: userId, token: session.access_token, signal, current }, ids, since);
      },
      legacy: async (since, signal) => {
        const session = useAuthStore.getState().session;
        if (session?.user.id !== userId || !current()) throw new Error('The account changed.');
        const pin = (query: any) => query.setHeader('Authorization', `Bearer ${session.access_token}`).abortSignal(signal);
        const { data: ment, error: mentionError } = await pin(supabase
          .from('message_mentions').select('message_id, created_at').eq('mentioned_user_id', userId).gt('created_at', since));
        if (mentionError) throw mentionError;
        if (!current() || signal.aborted) throw new Error('The mention reader changed.');
        const timeByMsg: Record<string, number> = {};
        (ment || []).forEach((row: any) => { timeByMsg[row.message_id] = new Date(row.created_at).getTime(); });
        const msgIds = Object.keys(timeByMsg);
        const times = new Map<string, number>();
        if (msgIds.length) {
          const { data: msgs, error } = await pin(supabase.from('messages').select('id, conversation_id').in('id', msgIds));
          if (error) throw error;
          (msgs || []).forEach((row: any) => {
            if (row.conversation_id) times.set(row.conversation_id, Math.max(times.get(row.conversation_id) || 0, timeByMsg[row.id] || 0));
          });
        }
        if (!current() || signal.aborted) throw new Error('The mention reader changed.');
        return times;
      },
      onChange: (times, checked) => {
        if (!current()) return;
        verified ||= checked; amnesty(); setMentionTimes(times);
      },
    });
    mentionsReader.current = reader;
    const appState = AppState.addEventListener('change', state => reader.setActive(state === 'active'));
    const hydration = (useDraftStore as any).persist?.onFinishHydration?.(amnesty);
    return () => { live = false; reader.dispose(); appState.remove(); hydration?.(); if (mentionsReader.current === reader) mentionsReader.current = null; };
  }, [userId, focused, sessionScope]);
  useEffect(() => {
    mentionsReader.current?.update(filtered.map(row => ({ id: row.id, activity: `${row.last_message_time ?? ''}\0${row.last_message}` })));
  }, [filtered, focused, sessionScope]);

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
                {(((item as any).other_verified_tier || (item as any).other_is_verified) && (item as any).type !== 'group') ? <VerifiedBadge userId={item.other_user_id} tier={(item as any).other_verified_tier} size={14} /> : null}
              </View>
              {item.is_muted && <Text style={{ fontSize: 11 }}>🔕</Text>}
              {item.is_archived && <View style={s.archivedBadge}><Text style={s.archivedTxt}>Archived</Text></View>}
              {item.group_type === 'community' && <View style={s.archivedBadge}><Text style={s.archivedTxt}>Community</Text></View>}
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
                const mentioned = (mentionTimes[item.id] || 0) > Math.max(openedTimes[item.id] || 0, mentionAmnesty);
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
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Header */}
      <View style={s.head}>
        <Text style={s.title}>Messages</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Channels" style={s.iconBtn} onPress={() => navigation.navigate('Channels')}>
            <Feather name="radio" size={18} color={t.ink.primary} />
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Call history" style={s.iconBtn} onPress={() => navigation.navigate('CallLog')}>
            <Feather name="phone" size={18} color={t.ink.secondary} />
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Saved messages" style={s.iconBtn} onPress={() => navigation.navigate('StarredMessages')}>
            <Feather name="bookmark" size={18} color={t.ink.secondary} />
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="New message" style={s.newBtn} onPress={() => navigation.navigate('FindPeople')} activeOpacity={0.8}>
            <Ionicons name="create" size={15} color="#FFF" />
            <Text style={s.newBtnTxt}>New</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search */}
      <View style={s.searchWrap}>
        <Feather name="search" size={15} color={t.ink.secondary} />
        <TextInput
          value={search} onChangeText={setSearch}
          placeholder="Search messages"
          placeholderTextColor={getTheme().ink.secondary} style={s.searchInput}
          autoCapitalize="none" returnKeyType="search"
        />
        {search.length > 0 && <TouchableOpacity onPress={() => setSearch('')}><Feather name="x" size={15} color={t.ink.secondary} /></TouchableOpacity>}
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
      {loadError ? <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}><Text accessibilityRole="alert" style={{ color: t.ink.secondary }}>{loadError}</Text><TouchableOpacity accessibilityRole="button" onPress={() => void load()} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: t.status.link }}>Retry conversations</Text></TouchableOpacity></View> : null}
      {loading && filtered.length === 0 ? (
        <View style={s.center}><ConversationsSkeleton /></View>
      ) : loadError && conversations.length === 0 ? <View style={s.center} /> : filtered.length === 0 && !showArchived && archivedCount === 0 ? (
        <View style={s.empty}>
          <Feather name="message-circle" size={44} color="#E5E5EA" />
          <Text style={s.emptyTitle}>{search ? 'No results' : tab === 'unread' ? 'All caught up' : 'No messages yet'}</Text>
          <Text style={s.emptySub}>{search ? 'Try a different search' : 'Connect with PlatinumCircles and start a conversation'}</Text>
          {!search && <TouchableOpacity style={s.emptyBtn} onPress={() => navigation.navigate('FindPeople')}><Text style={s.emptyBtnTxt}>Find people</Text></TouchableOpacity>}
        </View>
      ) : (
        <MeasuredHistoryList<Conversation> history={reading.history.current} snapshot={reading.snapshot} rowGap={8} ListEmptyComponent={<EmptyState icon="message-circle" title="No conversations" line="Start one from anyone profile, or from a listing." />}automaticallyAdjustKeyboardInsets={true}
          data={[...pinned, ...unpinned]}
          keyExtractor={(i: { id: string }) => i.id}
          renderItem={renderItem}
          onEndReached={() => { if (!loadingMore && !loadError) void loadMore(); }}
          onEndReachedThreshold={0.7}
          onScroll={event => { handleTabBarScroll(event); reading.top.current = event.nativeEvent.contentOffset.y;
            if (reading.top.current < 80 && headPending.current) { headPending.current = false; headReload.current?.(); }
          }} scrollEventThrottle={16} contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          removeClippedSubviews={Platform.OS === 'android'}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={10}
          ListHeaderComponent={(() => {
            const archCount = archivedCount;
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
                  <Feather name="chevron-left" size={20} color={t.ink.primary} />
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

const s = themedSheet((t) => ({

  safe: { flex: 1, backgroundColor: t.surface.canvas },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  title: { fontSize: 30, fontWeight: '700', color: t.ink.primary, letterSpacing: -0.9 },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.brand.base, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  newBtnTxt: { color: t.ink.inverse, fontSize: 13, fontWeight: '700' },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginBottom: 10, backgroundColor: t.surface.sunken, borderRadius: 20, paddingHorizontal: 14, minHeight: 48 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 48, fontSize: 16, color: t.ink.primary, paddingHorizontal: 0, paddingVertical: 10, includeFontPadding: false, textAlignVertical: 'center' },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, marginBottom: 8 },
  tab: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20, backgroundColor: t.brand.tintBg },
  tabActive: { backgroundColor: t.brand.base },
  tabTxt: { fontSize: 13, fontWeight: '700', color: t.ink.secondary, letterSpacing: -0.1 },
  tabTxtActive: { color: t.ink.inverse },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: t.ink.muted, letterSpacing: 0.8 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: t.surface.canvas, borderRadius: 0, paddingHorizontal: 16, paddingVertical: 10 },
  cardArchived: { opacity: 0.6 },
  cardAvatarWrap: { position: 'relative', padding: 2.5, borderRadius: 30, borderWidth: 0, borderColor: 'transparent' },
  cardAvatar: { width: 49, height: 49, borderRadius: 24.5 },
  cardAvatarTxt: { fontSize: 18, fontWeight: '800', color: t.ink.inverse },
  pinBadge: { position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: t.surface.canvas, alignItems: 'center', justifyContent: 'center' },
  pinBadgeTxt: { fontSize: 10 },
  cardBody: { flex: 1, gap: 3, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E9E9EB', paddingBottom: 10 },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardName: { fontSize: 17, fontWeight: '500', color: t.ink.primary, letterSpacing: -0.3, flex: 1 },
  cardNameBold: { fontWeight: '700', color: t.ink.primary },
  cardTime: { fontSize: 12, color: t.ink.muted, marginLeft: 8, fontWeight: '500' },
  cardTimeBold: { color: t.ink.primary, fontWeight: '600' },
  cardPreview: { fontSize: 14.5, color: t.ink.muted, flex: 1, letterSpacing: -0.1 },
  cardPreviewBold: { color: t.ink.primary, fontWeight: '500' },
  badge: { backgroundColor: t.brand.base, borderRadius: 11, minWidth: 21, height: 21, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeTxt: { color: t.ink.inverse, fontSize: 12, fontWeight: '700' },
  mutedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D1D5DB' },
  archivedBadge: { backgroundColor: '#F3F4F6', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  archivedTxt: { fontSize: 10, color: '#4B5563', fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: t.ink.primary },
  emptySub: { fontSize: 14, color: t.ink.muted, textAlign: 'center', lineHeight: 20 },
  emptyBtn: { marginTop: 10, backgroundColor: t.brand.base, borderRadius: 14, paddingHorizontal: 28, paddingVertical: 13 },
  emptyBtnTxt: { color: t.ink.inverse, fontSize: 15, fontWeight: '700' },
}));
