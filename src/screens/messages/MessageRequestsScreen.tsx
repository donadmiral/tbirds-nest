import VerifiedBadge from '../../components/VerifiedBadge';
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Image,
  ActivityIndicator, StatusBar, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

type MessageRequest = {
  conversation_id: string;
  sender_id: string;
  sender_name: string | null;
  sender_username: string | null;
  sender_avatar_url: string | null;
  sender_institution_name: string | null;
  requested_at: string | null;
  last_message_preview: string | null;
  last_message_time: string | null;
  unread_count: number;
};

function initials(n?: string | null) {
  if (!n) return '?';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}

const AVATAR_COLORS = ['#1D4ED8','#065F46','#7C2D12','#1a3560','#5856D6','#C2410C','#0F766E','#7C3AED'];
function avatarColor(id: string) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (m < 1) return 'now';
  if (m < 60) return m + 'm';
  if (h < 24) return h + 'h';
  if (dy < 7) return dy + 'd';
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function MessageRequestsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const myId = profile?.id ?? null;

  const [requests, setRequests] = useState<MessageRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!myId) return;
    try {
      const { data, error } = await supabase.rpc('get_message_requests');
      if (error) {
        console.log('[Requests load error]', error);
        setRequests([]);
      } else {
        setRequests((data || []) as MessageRequest[]);
      }
    } catch (e) {
      console.log('[Requests load]', e);
    } finally {
      setLoading(false);
    }
  }, [myId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setBusy = (id: string, v: boolean) =>
    setBusyIds(p => { const n = { ...p }; if (v) n[id] = true; else delete n[id]; return n; });

  const accept = async (req: MessageRequest) => {
    if (busyIds[req.conversation_id]) return;
    setBusy(req.conversation_id, true);
    try {
      const { error } = await supabase.rpc('accept_message_request', {
        p_conversation_id: req.conversation_id,
      });
      if (error) throw error;

      // Remove from list and open the chat.
      setRequests(prev => prev.filter(r => r.conversation_id !== req.conversation_id));
      navigation.replace('Chat', {
        conversationId: req.conversation_id,
        userId: req.sender_id,
        userName: req.sender_name || 'User',
        otherUser: {
          id: req.sender_id,
          full_name: req.sender_name,
          username: req.sender_username,
          avatar_url: req.sender_avatar_url,
        },
        isGroup: false,
      });
    } catch (e: any) {
      console.log('[Requests accept error]', e);
      Alert.alert('Error', e?.message || 'Could not accept.');
    } finally {
      setBusy(req.conversation_id, false);
    }
  };

  const decline = (req: MessageRequest) => {
    if (busyIds[req.conversation_id]) return;
    Alert.alert(
      'Decline request?',
      `${req.sender_name || 'This user'} will not be notified. Their messages will be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            setBusy(req.conversation_id, true);
            try {
              const { error } = await supabase.rpc('decline_message_request', {
                p_conversation_id: req.conversation_id,
              });
              if (error) throw error;
              setRequests(prev => prev.filter(r => r.conversation_id !== req.conversation_id));
            } catch (e: any) {
              console.log('[Requests decline error]', e);
              Alert.alert('Error', e?.message || 'Could not decline.');
            } finally {
              setBusy(req.conversation_id, false);
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: MessageRequest }) => {
    const busy = !!busyIds[item.conversation_id];
    return (
      <View style={s.card}>
        <View style={s.topRow}>
          {item.sender_avatar_url ? (
            <Image source={{ uri: item.sender_avatar_url }} style={s.avatar} />
          ) : (
            <View style={[s.avatar, { backgroundColor: avatarColor(item.sender_id), alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={s.avatarTxt}>{initials(item.sender_name)}</Text>
            </View>
          )}
          <View style={{ flex: 1, marginLeft: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[s.name, { flexShrink: 1 }]} numberOfLines={1}>{item.sender_name || 'User'}</Text>
              <VerifiedBadge userId={(item as any).sender_id} size={13} />
            </View>
            <View style={s.metaRow}>
              {item.sender_username ? (
                <Text style={s.handle} numberOfLines={1}>@{item.sender_username}</Text>
              ) : null}
              {item.sender_institution_name ? (
                <>
                  <Text style={s.dot}>·</Text>
                  <Text style={s.handle} numberOfLines={1}>{item.sender_institution_name}</Text>
                </>
              ) : null}
            </View>
          </View>
          <Text style={s.time}>{relTime(item.requested_at || item.last_message_time)}</Text>
        </View>

        {item.last_message_preview ? (
          <Text style={s.preview} numberOfLines={2}>{item.last_message_preview}</Text>
        ) : null}

        <View style={s.actions}>
          <TouchableOpacity
            style={[s.btn, s.btnDecline]}
            onPress={() => decline(item)}
            disabled={busy}
            activeOpacity={0.75}
          >
            <Text style={s.btnDeclineTxt}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.btn, s.btnAccept]}
            onPress={() => accept(item)}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color="#FFF" size={14} />
            ) : (
              <Text style={s.btnAcceptTxt}>Accept</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={26} color="#000" />
        </TouchableOpacity>
        <Text style={s.title}>Message requests</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={s.infoBanner}>
        <Feather name="info" size={14} color="#6B7280" />
        <Text style={s.infoTxt}>
          Messages from people outside your school. Accept to reply, decline to remove.
        </Text>
      </View>

      {loading ? (
        <View style={s.loader}>
          <ActivityIndicator color="#000" />
        </View>
      ) : requests.length === 0 ? (
        <View style={s.empty}>
          <Feather name="inbox" size={44} color="#E5E5EA" />
          <Text style={s.emptyTitle}>No requests</Text>
          <Text style={s.emptySub}>New messages from outside your school will show up here.</Text>
        </View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(r) => r.conversation_id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 24 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: '#000' },

  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  infoTxt: { fontSize: 12, color: '#6B7280', flex: 1, lineHeight: 17 },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#000' },
  emptySub: { fontSize: 14, color: '#8E8E93', textAlign: 'center', lineHeight: 20 },

  card: {
    backgroundColor: '#F7F7F7',
    borderRadius: 18,
    padding: 14,
    gap: 10,
  },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  avatarTxt: { fontSize: 15, fontWeight: '800', color: '#FFF' },
  name: { fontSize: 15, fontWeight: '700', color: '#000' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  handle: { fontSize: 12, color: '#8E8E93', maxWidth: 180 },
  dot: { fontSize: 12, color: '#C7C7CC' },
  time: { fontSize: 11, color: '#8E8E93' },

  preview: {
    fontSize: 13,
    color: '#3C3C43',
    lineHeight: 18,
    paddingHorizontal: 2,
  },

  actions: { flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDecline: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E5E7EB' },
  btnDeclineTxt: { fontSize: 14, fontWeight: '700', color: '#374151' },
  btnAccept: { backgroundColor: '#000' },
  btnAcceptTxt: { fontSize: 14, fontWeight: '700', color: '#FFF' },
});