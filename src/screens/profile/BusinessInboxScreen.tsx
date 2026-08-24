/**
 * BusinessInboxScreen — conversations where the business is a party.
 * Team members open a chat acting AS the business: ChatScreen receives
 * actAsId, so replies are authored by the business and reads are marked
 * for the business, regardless of which member is typing.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Image, ActivityIndicator, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';

const NAVY = '#0B1E3D';
const PLATINUM = '#C9BFB0';

function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (m < 1) return 'now'; if (m < 60) return m + 'm'; if (h < 24) return h + 'h';
  if (dy < 7) return dy + 'd';
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function BusinessInboxScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const businessId: string = route.params?.businessId;
  const businessName: string = route.params?.businessName || 'Business';

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'primary' | 'requests'>('primary');

  useFocusEffect(useCallback(() => {
    let live = true;
    (async () => {
      if (!businessId) return;
      setErr(null);
      try {
        const { data, error } = await supabase.rpc('get_business_conversations', { p_business_id: businessId });
        if (error) throw error;
        if (live) setRows(data ?? []);
      } catch (e: any) { if (live) setErr(e?.message || 'Could not load inbox'); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [businessId]));

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
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
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
        <View style={st.center}><ActivityIndicator size="large" color={NAVY} /></View>
      ) : err ? (
        <View style={st.center}><Text style={st.errTxt}>{err}</Text></View>
      ) : rows.length === 0 ? (
        <View style={st.center}>
          <Feather name="inbox" size={38} color="#C7CDD6" />
          <Text style={st.emptyTitle}>No conversations yet</Text>
          <Text style={st.emptySub}>When customers message {businessName}, the whole team sees it here.</Text>
        </View>
      ) : (
        <FlatList
          data={rows.filter((r: any) => tab === 'requests' ? r.is_request : !r.is_request)}
          ListHeaderComponent={
            <View style={{ flexDirection: 'row', paddingHorizontal: 2, paddingBottom: 8, gap: 8 }}>
              {(['primary', 'requests'] as const).map(t => {
                const n = rows.filter((r: any) => t === 'requests' ? r.is_request : !r.is_request).length;
                const on = tab === t;
                return (
                  <TouchableOpacity key={t} onPress={() => setTab(t)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: on ? '#0B1E3D' : '#F0F2F5' }}>
                    <Text style={{ fontSize: 12.5, fontWeight: '800', color: on ? '#FFFFFF' : '#5B6B84' }}>{t === 'primary' ? 'Primary' : 'Requests'}{n > 0 ? ' ' + n : ''}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          }
          keyExtractor={r => r.conversation_id}
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

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(11,30,61,0.08)' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: NAVY, textAlign: 'center' },
  headerSub: { fontSize: 11.5, color: 'rgba(11,30,61,0.5)', textAlign: 'center', marginTop: 1 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(11,30,61,0.07)', marginLeft: 78 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  av: { width: 50, height: 50, borderRadius: 25 },
  avFb: { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  avTxt: { color: PLATINUM, fontSize: 18, fontWeight: '800' },
  name: { flex: 1, fontSize: 15.5, fontWeight: '700', color: 'rgba(11,30,61,0.85)' },
  time: { fontSize: 12, color: 'rgba(11,30,61,0.4)', marginLeft: 8 },
  preview: { fontSize: 13.5, color: 'rgba(11,30,61,0.5)', marginTop: 2 },
  previewUnread: { color: NAVY, fontWeight: '600' },
  ctxChip: { alignSelf: 'flex-start', marginTop: 5, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: 'rgba(11,30,61,0.05)' },
  ctxTxt: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6, color: 'rgba(11,30,61,0.55)' },
  unreadDot: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#FF3040', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  unreadTxt: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  errTxt: { fontSize: 14.5, fontWeight: '600', color: '#DC2626', textAlign: 'center' },
  emptyTitle: { fontSize: 16.5, fontWeight: '800', color: NAVY, marginTop: 12 },
  emptySub: { fontSize: 13.5, color: 'rgba(11,30,61,0.55)', textAlign: 'center', marginTop: 4, lineHeight: 19 },
});