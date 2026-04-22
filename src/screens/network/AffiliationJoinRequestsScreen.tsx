import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Image,
  ActivityIndicator, StatusBar, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import {
  PendingJoinRequest,
  getPendingJoinRequests,
  approveJoinRequest,
  declineJoinRequest,
} from '../../services/affiliationsService';

function initials(n?: string | null) {
  if (!n) return '?';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}

const COLORS = ['#1D4ED8','#065F46','#7C2D12','#5856D6','#C2410C','#0F766E','#7C3AED','#0B1E3D'];
function colorFor(id: string) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % COLORS.length;
  return COLORS[Math.abs(h) % COLORS.length];
}

function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (m < 1) return 'now';
  if (m < 60) return m + 'm ago';
  if (h < 24) return h + 'h ago';
  if (dy < 7) return dy + 'd ago';
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function AffiliationJoinRequestsScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const affiliationId: string = route.params?.affiliationId;

  const [requests, setRequests] = useState<PendingJoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!affiliationId) return;
    const data = await getPendingJoinRequests(affiliationId);
    setRequests(data);
    setLoading(false);
  }, [affiliationId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setBusy = (id: string, v: boolean) =>
    setBusyIds(p => { const n = { ...p }; if (v) n[id] = true; else delete n[id]; return n; });

  const approve = async (req: PendingJoinRequest) => {
    if (busyIds[req.request_id]) return;
    setBusy(req.request_id, true);
    try {
      await approveJoinRequest(req.request_id);
      setRequests(prev => prev.filter(r => r.request_id !== req.request_id));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not approve.');
    } finally {
      setBusy(req.request_id, false);
    }
  };

  const decline = (req: PendingJoinRequest) => {
    if (busyIds[req.request_id]) return;
    Alert.alert(
      'Decline request?',
      `${req.full_name || 'This user'} will not be added to the community.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            setBusy(req.request_id, true);
            try {
              await declineJoinRequest(req.request_id);
              setRequests(prev => prev.filter(r => r.request_id !== req.request_id));
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Could not decline.');
            } finally {
              setBusy(req.request_id, false);
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: PendingJoinRequest }) => {
    const busy = !!busyIds[item.request_id];
    return (
      <View style={s.card}>
        <View style={s.topRow}>
          {item.avatar_url ? (
            <Image source={{ uri: item.avatar_url }} style={s.avatar} />
          ) : (
            <View style={[s.avatar, { backgroundColor: colorFor(item.user_id) }]}>
              <Text style={s.avatarTxt}>{initials(item.full_name)}</Text>
            </View>
          )}
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.name} numberOfLines={1}>{item.full_name || 'User'}</Text>
            <View style={s.metaRow}>
              {item.username ? (
                <Text style={s.meta} numberOfLines={1}>@{item.username}</Text>
              ) : null}
              {item.institution_name ? (
                <>
                  <Text style={s.dot}>·</Text>
                  <Text style={s.meta} numberOfLines={1}>{item.institution_name}</Text>
                </>
              ) : null}
            </View>
          </View>
          <Text style={s.time}>{relTime(item.requested_at)}</Text>
        </View>

        {item.message ? (
          <Text style={s.message} numberOfLines={4}>"{item.message}"</Text>
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
            style={[s.btn, s.btnApprove]}
            onPress={() => approve(item)}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color="#FFF" size={14} />
            ) : (
              <Text style={s.btnApproveTxt}>Approve</Text>
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
        <Text style={s.title}>Join requests</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={s.loader}>
          <ActivityIndicator color="#000" />
        </View>
      ) : requests.length === 0 ? (
        <View style={s.empty}>
          <Feather name="inbox" size={44} color="#E5E5EA" />
          <Text style={s.emptyTitle}>No pending requests</Text>
          <Text style={s.emptySub}>New requests from members will appear here.</Text>
        </View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(r) => r.request_id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: '#000' },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#000' },
  emptySub: { fontSize: 13, color: '#8E8E93', textAlign: 'center', lineHeight: 18 },

  card: { backgroundColor: '#F7F7F7', borderRadius: 18, padding: 14, gap: 10 },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 14, fontWeight: '800', color: '#FFF' },
  name: { fontSize: 15, fontWeight: '700', color: '#000' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  meta: { fontSize: 12, color: '#8E8E93', maxWidth: 160 },
  dot: { fontSize: 12, color: '#C7C7CC' },
  time: { fontSize: 11, color: '#8E8E93' },

  message: {
    fontSize: 13, color: '#3C3C43', lineHeight: 18,
    backgroundColor: '#FFF', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontStyle: 'italic',
  },

  actions: { flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1, paddingVertical: 11, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  btnDecline: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E5E7EB' },
  btnDeclineTxt: { fontSize: 14, fontWeight: '700', color: '#374151' },
  btnApprove: { backgroundColor: '#000' },
  btnApproveTxt: { fontSize: 14, fontWeight: '700', color: '#FFF' },
});