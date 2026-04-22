import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  Image, ActivityIndicator, StatusBar, RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { callService, CallRecord } from '../../services/callService';

type Row = CallRecord & {
  other_profile?: {
    id: string;
    full_name: string;
    username: string | null;
    avatar_url: string | null;
  };
};

function initials(n?: string | null) {
  if (!n) return 'U';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}

function fmtDuration(secs?: number | null) {
  if (!secs) return '';
  const m = Math.floor(secs / 60), s = secs % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function fmtTime(d: string) {
  const date = new Date(d), now = new Date();
  const diff = now.getTime() - date.getTime();
  const hours = diff / 3600000, days = diff / 86400000;
  if (hours < 1) return 'Just now';
  if (hours < 24) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days < 7) return date.toLocaleDateString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const AVATAR_COLORS = ['#1D4ED8','#065F46','#7C2D12','#1a3560','#5856D6','#C2410C'];
function avatarBg(id: string) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export default function CallLogScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const [calls, setCalls] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    try {
      const records = await callService.listRecentCalls(userId, 100);
      console.log('[CALL_LOG_LOAD]', { count: records.length });

      if (records.length === 0) { setCalls([]); return; }

      const otherIds = records
        .map(c => c.caller_id === userId ? c.receiver_id : c.caller_id)
        .filter(Boolean) as string[];
      const unique = Array.from(new Set(otherIds));

      const pMap: Record<string, any> = {};
      if (unique.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url')
          .in('id', unique);
        (profiles || []).forEach((p: any) => { pMap[p.id] = p; });
      }

      const rows: Row[] = records.map(c => {
        const otherId = c.caller_id === userId ? c.receiver_id : c.caller_id;
        return { ...c, other_profile: otherId ? pMap[otherId] : undefined };
      });
      setCalls(rows);
    } catch (e) {
      console.log('[CALL_LOG_ERR]', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const startCall = (call: Row, isVideo: boolean) => {
    const other = call.other_profile;
    if (!other || !userId) return;

    callService.initiateCall({
      callerId: userId,
      receiverId: other.id,
      channelId: call.channel_id,
      isVideo,
      conversationId: call.conversation_id,
    }).then(rec => {
      console.log('[CALL_LOG_REDIAL]', { callId: rec?.id, isVideo });
      navigation.navigate('Call', {
        callId: rec?.id ?? null,
        channelId: call.channel_id,
        callerName: other.full_name,
        callerAvatar: other.avatar_url,
        otherUser: other,
        isIncoming: false,
        isVideo,
      });
    });
  };

  const getIcon = (call: Row) => {
    const isOutgoing = call.caller_id === userId;
    if (call.status === 'missed') return { name: 'phone-missed' as const, color: '#EF4444' };
    if (call.status === 'declined') return { name: 'phone-off' as const, color: '#FF9500' };
    return isOutgoing
      ? { name: 'phone-outgoing' as const, color: '#34C759' }
      : { name: 'phone-incoming' as const, color: '#007AFF' };
  };

  const getLabel = (call: Row) => {
    const isOutgoing = call.caller_id === userId;
    if (call.status === 'missed') return 'Missed';
    if (call.status === 'declined') return 'Declined';
    if (call.status === 'ringing') return 'Ringing';
    return isOutgoing ? 'Outgoing' : 'Incoming';
  };

  const renderItem = ({ item }: { item: Row }) => {
    const p = item.other_profile;
    const { name: iconName, color: iconColor } = getIcon(item);
    const isMissed = item.status === 'missed';

    return (
      <View style={s.row}>
        {p?.avatar_url
          ? <Image source={{ uri: p.avatar_url }} style={s.avatar} />
          : <View style={[s.avatar, { backgroundColor: p ? avatarBg(p.id) : '#8E8E93' }]}>
              <Text style={s.avatarTxt}>{initials(p?.full_name)}</Text>
            </View>}

        <View style={s.info}>
          <Text style={[s.name, isMissed && s.nameMissed]}>
            {p?.full_name || 'Unknown'}
          </Text>
          <View style={s.metaRow}>
            <Feather name={iconName} size={12} color={iconColor} />
            <Text style={[s.meta, isMissed && s.metaMissed]}>
              {getLabel(item)}
              {item.is_video ? ' · Video' : ' · Audio'}
              {item.duration_secs ? ` · ${fmtDuration(item.duration_secs)}` : ''}
            </Text>
          </View>
          <Text style={s.time}>{fmtTime(item.created_at)}</Text>
        </View>

        <View style={s.actions}>
          <TouchableOpacity
            style={s.callbackBtn}
            onPress={() => startCall(item, false)}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="phone" size={18} color="#0B1E3D" />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.callbackBtn}
            onPress={() => startCall(item, true)}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="video" size={18} color="#0B1E3D" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Feather name="chevron-left" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={s.title}>Calls</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color="#0B1E3D" size="large" /></View>
      ) : calls.length === 0 ? (
        <View style={s.empty}>
          <Feather name="phone" size={48} color="#E5E5EA" />
          <Text style={s.emptyTitle}>No calls yet</Text>
          <Text style={s.emptySub}>Your call history will appear here.</Text>
        </View>
      ) : (
        <FlatList
          data={calls}
          keyExtractor={c => c.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={s.sep} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor="#0B1E3D"
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: '#000' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: '#F2F2F7', marginLeft: 76 },
  avatar: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarTxt: { fontSize: 17, fontWeight: '800', color: '#FFF' },
  info: { flex: 1, gap: 3 },
  name: { fontSize: 15, fontWeight: '600', color: '#000' },
  nameMissed: { color: '#EF4444' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  meta: { fontSize: 13, color: '#8E8E93' },
  metaMissed: { color: '#EF4444' },
  time: { fontSize: 12, color: '#C7C7CC' },
  actions: { flexDirection: 'row', gap: 8 },
  callbackBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#000' },
  emptySub: { fontSize: 14, color: '#8E8E93' },
});