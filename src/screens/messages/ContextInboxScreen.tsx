import { themedSheet, getTheme, useTheme } from '../../theme/useTheme';
import EmptyState from '../../components/EmptyState';
import TierName from '../../components/TierName';
import VerifiedBadge from '../../components/VerifiedBadge';
/**
 * ContextInboxScreen
 *
 * The Market inbox and the Jobs inbox are the same screen with a different
 * context. Two copies would have drifted apart within a month.
 *
 * The difference from a normal chat list is the subject: a market row shows the
 * listing with its price and photo, a jobs row shows the role and company. A
 * seller with ten enquiries needs to know which item each one is about, and
 * that is precisely what Facebook Marketplace messaging fails to show.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
  Image, RefreshControl, StatusBar, AppState,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import { useUnreadStore } from '../../stores/unreadStore';
import { typeSize, fontWeight, radius, space } from '../../constants/tokens';
import { navigationScope } from '../../lib/navigationCache';
import { readContextInboxWindow, type ContextInboxWindow } from '../../services/contextInbox';

function initials(name?: string | null) {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

function relTime(iso?: string | null) {
  if (!iso) return '';
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function ContextInboxScreen({ route, navigation }: any) {
  const { t, isDark } = useTheme();
  const ctx: 'market' | 'jobs' = route?.params?.context === 'jobs' ? 'jobs' : 'market';
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const myId = (profile as any)?.id ?? null;

  const scope = navigationScope();
  const [collection, setCollection] = useState<ContextInboxWindow | null>(null);
  const collectionRef = useRef(collection); collectionRef.current = collection;
  const rows = collection?.scope === scope && collection.context === ctx ? collection.rows : [];
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorOperation = useRef<'refresh' | 'more'>('refresh');
  const requestRef = useRef<AbortController | null>(null);
  const generation = useRef(0), focused = useRef(false);
  const currentIdentity = useRef({ scope, ctx, myId }); currentIdentity.current = { scope, ctx, myId };

  const load = useCallback(async (more = false, pulled = false) => {
    if (!myId || !scope || !focused.current || AppState.currentState !== 'active') return;
    const previous = collectionRef.current?.scope === scope && collectionRef.current.context === ctx ? collectionRef.current : null;
    if (more && (requestRef.current || !previous?.paging?.cursor)) return;
    const version = ++generation.current;
    requestRef.current?.abort();
    const request = new AbortController(); requestRef.current = request;
    const current = () => focused.current && generation.current === version && !request.signal.aborted
      && currentIdentity.current.scope === scope && currentIdentity.current.ctx === ctx
      && currentIdentity.current.myId === myId && navigationScope() === scope;
    setError(null); setLoading(!previous?.rows.length); setRefreshing(pulled); setLoadingMore(more);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([readContextInboxWindow(myId, ctx, previous, more, request.signal, current),
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('The conversation read took too long.')), 12000); })]);
      if (!current()) return;
      collectionRef.current = result; setCollection(result);
      if (!more) void useUnreadStore.getState().refresh();
    } catch {
      if (current()) {
        errorOperation.current = more ? 'more' : 'refresh';
        setError(more ? 'More conversations could not be loaded. Please try again.' : 'Conversations could not be loaded. Please try again.');
      }
    } finally {
      clearTimeout(timeout);
      if (current()) { setLoading(false); setRefreshing(false); setLoadingMore(false); }
      request.abort(); if (requestRef.current === request) requestRef.current = null;
    }
  }, [myId, scope, ctx]);

  useFocusEffect(useCallback(() => {
    focused.current = true; void load();
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') void load();
      else { generation.current++; requestRef.current?.abort(); requestRef.current = null; }
    });
    return () => { focused.current = false; generation.current++; requestRef.current?.abort(); requestRef.current = null; appState.remove(); };
  }, [load]));

  const title = ctx === 'market' ? 'Market messages' : 'Job messages';
  const emptyTitle = ctx === 'market' ? 'No buyer or seller chats' : 'No recruiter chats';
  const emptySub = ctx === 'market'
    ? 'When you message a seller or someone messages you about a listing, it appears here rather than mixed in with your friends.'
    : 'Conversations about a role appear here, separate from your personal chats.';

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={t.surface.canvas} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Feather name="chevron-left" size={26} color={getTheme().ink.primary} />
        </TouchableOpacity>
        <Text style={s.title}>{title}</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={s.centered}><ActivityIndicator color={getTheme().brand.base} /></View>
      ) : error && rows.length === 0 ? (
        <View style={s.centered}>
          <Feather name="alert-circle" size={30} color={getTheme().ink.faint} />
          <Text style={s.emptyTitle}>Could not load messages</Text>
          <Text style={s.emptySub}>{error}</Text>
          <TouchableOpacity style={s.cta} onPress={() => { void load(); }}>
            <Text style={s.ctaTxt}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : rows.length === 0 ? (
        <View style={s.centered}>
          <Feather name={ctx === 'market' ? 'shopping-bag' : 'briefcase'} size={30} color={getTheme().ink.faint} />
          <Text style={s.emptyTitle}>{emptyTitle}</Text>
          <Text style={s.emptySub}>{emptySub}</Text>
        </View>
      ) : (
        <FlatList ListEmptyComponent={<EmptyState icon="inbox" title="No conversations" line="Chats about your listings and jobs appear here." />}
          data={rows}
          keyExtractor={r => r.conversation_id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void load(false, true); }} tintColor={getTheme().ink.faint} />}
          onEndReached={() => { if (!error) void load(true); }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={error ? <View style={{ padding: space.md, alignItems: 'center' }}>
            <Text style={s.emptySub}>{error}</Text>
            <TouchableOpacity style={s.cta} accessibilityRole="button" accessibilityLabel="Retry conversations" onPress={() => { void load(errorOperation.current === 'more'); }}>
              <Text style={s.ctaTxt}>Try again</Text>
            </TouchableOpacity>
          </View> : loadingMore ? <View style={{ padding: space.md }}><ActivityIndicator color={getTheme().brand.base} /></View> : null}
          contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 24 }}
          ItemSeparatorComponent={() => <View style={s.sep} />}
          renderItem={({ item }) => {
            const mine = item.last_message_sender_id === myId;
            return (
              <TouchableOpacity
                style={s.row}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('Chat', {
                  conversationId: item.conversation_id,
                  userId: item.other_id,
                  userName: item.other_name,
                  userAvatar: item.other_avatar,
                })}
              >
                {item.other_avatar ? (
                  <Image source={{ uri: item.other_avatar }} style={s.avatar} />
                ) : (
                  <View style={[s.avatar, s.avatarFb]}><Text style={s.avatarTxt}>{initials(item.other_name)}</Text></View>
                )}

                <View style={s.rowBody}>
                  <View style={s.rowTop}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <TierName userId={(item as any).other_user_id} baseStyle={[s.name, { flexShrink: 1 }]} text={item.other_name || 'User'} />
                      <VerifiedBadge userId={(item as any).other_user_id} size={13} />
                    </View>
                    <Text style={s.time}>{relTime(item.last_message_time)}</Text>
                  </View>

                  {item.ref_title ? (
                    <View style={s.subject}>
                      {item.ref_image ? (
                        <Image source={{ uri: item.ref_image }} style={s.subjectImg} />
                      ) : (
                        <View style={[s.subjectImg, s.subjectImgFb]}>
                          <Feather name={ctx === 'market' ? 'tag' : 'briefcase'} size={10} color={getTheme().ink.faint} />
                        </View>
                      )}
                      <Text style={s.subjectTxt} numberOfLines={1}>
                        {item.ref_title}{item.ref_subtitle ? `  ·  ${item.ref_subtitle}` : ''}
                      </Text>
                    </View>
                  ) : null}

                  <View style={s.rowBottom}>
                    <Text style={[s.preview, item.unread_count > 0 && s.previewUnread]} numberOfLines={1}>
                      {mine ? 'You: ' : ''}{item.last_message || 'No messages yet'}
                    </Text>
                    {item.unread_count > 0 ? (
                      <View style={s.badge}><Text style={s.badgeTxt}>{item.unread_count > 99 ? '99+' : item.unread_count}</Text></View>
                    ) : null}
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const HAIR = StyleSheet.hairlineWidth;

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: space.sm,
    borderBottomWidth: HAIR, borderBottomColor: t.surface.hairline,
  },
  title: { fontSize: typeSize.subhead, fontWeight: fontWeight.heavy, color: t.ink.primary },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 6 },
  emptyTitle: { fontSize: typeSize.emphasis, fontWeight: fontWeight.bold, color: t.ink.primary, marginTop: 6 },
  emptySub: { fontSize: typeSize.caption, color: t.ink.muted, textAlign: 'center', lineHeight: 19 },
  cta: { marginTop: space.sm, paddingHorizontal: space.lg, paddingVertical: space.xs, borderRadius: radius.full, backgroundColor: t.brand.base },
  ctaTxt: { color: t.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },

  sep: { height: HAIR, backgroundColor: t.surface.divider, marginLeft: 74 },
  row: { flexDirection: 'row', gap: space.sm, paddingHorizontal: 14, paddingVertical: space.sm },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: t.surface.sunken },
  avatarFb: { alignItems: 'center', justifyContent: 'center', backgroundColor: t.brand.base },
  avatarTxt: { color: t.ink.inverse, fontSize: typeSize.body, fontWeight: fontWeight.bold },

  rowBody: { flex: 1, justifyContent: 'center', gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.xs },
  name: { flex: 1, fontSize: typeSize.emphasis, fontWeight: fontWeight.semibold, color: t.ink.primary },
  time: { fontSize: typeSize.micro, color: t.ink.muted },

  subject: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    paddingRight: 8, paddingVertical: 2, paddingLeft: 2,
    borderRadius: radius.sm, backgroundColor: t.brand.tintBg, maxWidth: '100%',
  },
  subjectImg: { width: 18, height: 18, borderRadius: 3, backgroundColor: t.surface.sunken },
  subjectImgFb: { alignItems: 'center', justifyContent: 'center' },
  subjectTxt: { flexShrink: 1, fontSize: typeSize.micro, fontWeight: fontWeight.semibold, color: t.ink.primary },

  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.xs },
  preview: { flex: 1, fontSize: typeSize.caption, color: t.ink.muted },
  previewUnread: { color: t.ink.primary, fontWeight: fontWeight.semibold },
  badge: {
    minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center', backgroundColor: t.brand.base,
  },
  badgeTxt: { fontSize: typeSize.micro, fontWeight: fontWeight.heavy, color: t.ink.inverse },
}));
