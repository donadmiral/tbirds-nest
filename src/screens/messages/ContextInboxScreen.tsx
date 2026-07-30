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
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
  Image, RefreshControl, StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { useUnreadStore } from '../../stores/unreadStore';
import { light, typeSize, fontWeight, radius, space } from '../../constants/tokens';

type Row = {
  conversation_id: string;
  is_group: boolean;
  other_id: string | null;
  other_name: string | null;
  other_username: string | null;
  other_avatar: string | null;
  last_message: string | null;
  last_message_time: string | null;
  last_message_sender_id: string | null;
  unread_count: number;
  context: string;
  context_ref_id: string | null;
  ref_title: string | null;
  ref_subtitle: string | null;
  ref_image: string | null;
};

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
  const ctx: 'market' | 'jobs' = route?.params?.context === 'jobs' ? 'jobs' : 'market';
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const myId = (profile as any)?.id ?? null;

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase.rpc('get_conversations_by_context', {
      p_context: ctx, p_include_groups: false,
    });
    if (err) { setError(err.message); setLoading(false); setRefreshing(false); return; }
    setRows((data ?? []) as Row[]);
    setLoading(false);
    setRefreshing(false);
    useUnreadStore.getState().refresh();
  }, [ctx]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const title = ctx === 'market' ? 'Market messages' : 'Job messages';
  const emptyTitle = ctx === 'market' ? 'No buyer or seller chats' : 'No recruiter chats';
  const emptySub = ctx === 'market'
    ? 'When you message a seller or someone messages you about a listing, it appears here rather than mixed in with your friends.'
    : 'Conversations about a role appear here, separate from your personal chats.';

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Feather name="chevron-left" size={26} color={light.ink.primary} />
        </TouchableOpacity>
        <Text style={s.title}>{title}</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={s.centered}><ActivityIndicator color={light.brand.base} /></View>
      ) : error ? (
        <View style={s.centered}>
          <Feather name="alert-circle" size={30} color={light.ink.faint} />
          <Text style={s.emptyTitle}>Could not load messages</Text>
          <Text style={s.emptySub}>{error}</Text>
          <TouchableOpacity style={s.cta} onPress={() => { setLoading(true); load(); }}>
            <Text style={s.ctaTxt}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : rows.length === 0 ? (
        <View style={s.centered}>
          <Feather name={ctx === 'market' ? 'shopping-bag' : 'briefcase'} size={30} color={light.ink.faint} />
          <Text style={s.emptyTitle}>{emptyTitle}</Text>
          <Text style={s.emptySub}>{emptySub}</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={r => r.conversation_id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={light.ink.faint} />}
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
                          <Feather name={ctx === 'market' ? 'tag' : 'briefcase'} size={10} color={light.ink.faint} />
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

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: light.surface.canvas },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: space.sm,
    borderBottomWidth: HAIR, borderBottomColor: light.surface.hairline,
  },
  title: { fontSize: typeSize.subhead, fontWeight: fontWeight.heavy, color: light.ink.primary },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 6 },
  emptyTitle: { fontSize: typeSize.emphasis, fontWeight: fontWeight.bold, color: light.ink.primary, marginTop: 6 },
  emptySub: { fontSize: typeSize.caption, color: light.ink.muted, textAlign: 'center', lineHeight: 19 },
  cta: { marginTop: space.sm, paddingHorizontal: space.lg, paddingVertical: space.xs, borderRadius: radius.full, backgroundColor: light.brand.base },
  ctaTxt: { color: light.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },

  sep: { height: HAIR, backgroundColor: light.surface.divider, marginLeft: 74 },
  row: { flexDirection: 'row', gap: space.sm, paddingHorizontal: 14, paddingVertical: space.sm },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: light.surface.sunken },
  avatarFb: { alignItems: 'center', justifyContent: 'center', backgroundColor: light.brand.base },
  avatarTxt: { color: light.ink.inverse, fontSize: typeSize.body, fontWeight: fontWeight.bold },

  rowBody: { flex: 1, justifyContent: 'center', gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.xs },
  name: { flex: 1, fontSize: typeSize.emphasis, fontWeight: fontWeight.semibold, color: light.ink.primary },
  time: { fontSize: typeSize.micro, color: light.ink.faint },

  subject: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    paddingRight: 8, paddingVertical: 2, paddingLeft: 2,
    borderRadius: radius.sm, backgroundColor: light.brand.tintBg, maxWidth: '100%',
  },
  subjectImg: { width: 18, height: 18, borderRadius: 3, backgroundColor: light.surface.sunken },
  subjectImgFb: { alignItems: 'center', justifyContent: 'center' },
  subjectTxt: { flexShrink: 1, fontSize: typeSize.micro, fontWeight: fontWeight.semibold, color: light.ink.primary },

  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.xs },
  preview: { flex: 1, fontSize: typeSize.caption, color: light.ink.muted },
  previewUnread: { color: light.ink.primary, fontWeight: fontWeight.semibold },
  badge: {
    minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center', backgroundColor: light.brand.base,
  },
  badgeTxt: { fontSize: typeSize.micro, fontWeight: fontWeight.heavy, color: light.ink.inverse },
});
