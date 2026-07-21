/**
 * FollowRequestsScreen.tsx
 * Shows pending follow requests for private account users.
 * Place at: src/screens/profile/FollowRequestsScreen.tsx
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  Image, ActivityIndicator, Alert, StatusBar, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

const NAVY = '#0B1E3D';
const TEXT_PRIMARY = '#000000';
const TEXT_SECONDARY = '#8E8E93';
const HAIRLINE = '#E5E5EA';

type FollowRequest = {
  id: string;
  requester_id: string;
  status: string;
  created_at: string;
  requester: {
    full_name: string;
    username: string | null;
    avatar_url: string | null;
    degree_program: string | null;
  } | null;
};

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
  if (dy < 7) return dy + 'd';
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function FollowRequestsScreen() {
  const navigation = useNavigation<any>();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const [requests, setRequests] = useState<FollowRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const { data, error } = await supabase
        .from('follow_requests')
        .select('id, requester_id, status, created_at')
        .eq('target_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) {
        console.log('[FollowRequests] load error:', error.message);
        return;
      }

      const rows = data || [];
      if (rows.length === 0) {
        setRequests([]);
        return;
      }

      const requesterIds = rows.map((r: any) => r.requester_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url, degree_program')
        .in('id', requesterIds);

      const profileMap: Record<string, any> = {};
      (profiles || []).forEach((p: any) => { profileMap[p.id] = p; });

      const shaped: FollowRequest[] = rows.map((r: any) => ({
        id: r.id,
        requester_id: r.requester_id,
        status: r.status,
        created_at: r.created_at,
        requester: profileMap[r.requester_id] || null,
      }));

      setRequests(shaped);
    } catch (e) {
      console.log('[FollowRequests] load catch:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const respond = async (requestId: string, action: 'accept' | 'reject') => {
    if (busyIds[requestId]) return;
    setBusyIds(prev => ({ ...prev, [requestId]: true }));
    try {
      const { data, error } = await supabase.rpc('respond_follow_request', {
        p_request_id: requestId,
        p_action: action,
      });
      if (error) throw error;
      setRequests(prev => prev.filter(r => r.id !== requestId));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not process request.');
    } finally {
      setBusyIds(prev => { const n = { ...prev }; delete n[requestId]; return n; });
    }
  };

  const renderItem = ({ item }: { item: FollowRequest }) => {
    const name = item.requester?.full_name || 'Member';
    const avatar = item.requester?.avatar_url;
    const username = item.requester?.username;
    const program = item.requester?.degree_program;
    const busy = !!busyIds[item.id];

    return (
      <View style={st.row}>
        <TouchableOpacity
          style={st.rowLeft}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('UserProfile', { userId: item.requester_id })}
        >
          {avatar
            ? <Image source={{ uri: avatar }} style={st.avatar} />
            : <View style={[st.avatar, st.avatarFb]}><Text style={st.avatarFbTxt}>{initials(name)}</Text></View>}
          <View style={{ flex: 1 }}>
            <Text style={st.name} numberOfLines={1}>{name}</Text>
            {username ? <Text style={st.username}>@{username}</Text> : null}
            {program ? <Text style={st.program} numberOfLines={1}>{program}</Text> : null}
            <Text style={st.time}>{relTime(item.created_at)}</Text>
          </View>
        </TouchableOpacity>
        <View style={st.actions}>
          <TouchableOpacity
            style={st.acceptBtn}
            onPress={() => respond(item.id, 'accept')}
            disabled={busy}
            activeOpacity={0.7}
          >
            {busy ? <ActivityIndicator size={14} color="#FFF" /> : <Text style={st.acceptTxt}>Accept</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={st.rejectBtn}
            onPress={() => respond(item.id, 'reject')}
            disabled={busy}
            activeOpacity={0.7}
          >
            <Feather name="x" size={16} color={TEXT_SECONDARY} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={st.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={st.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="chevron-left" size={26} color={NAVY} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>Follow Requests</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={st.center}><ActivityIndicator color={NAVY} size="large" /></View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={r => r.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={NAVY} />
          }
          ListEmptyComponent={
            <View style={st.empty}>
              <Feather name="user-check" size={40} color="#E5E5EA" />
              <Text style={st.emptyTitle}>No pending requests</Text>
              <Text style={st.emptySub}>When someone requests to follow your private account, they will appear here.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE,
  },
  headerTitle: { fontSize: 17, fontWeight: '600', color: TEXT_PRIMARY, flex: 1, textAlign: 'center' },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F2F2F7',
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12, marginRight: 12 },
  avatar: { width: 50, height: 50, borderRadius: 25 },
  avatarFb: { backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  avatarFbTxt: { fontSize: 18, fontWeight: '700', color: NAVY },
  name: { fontSize: 15, fontWeight: '600', color: TEXT_PRIMARY },
  username: { fontSize: 13, color: NAVY, fontWeight: '500', marginTop: 1 },
  program: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 2 },
  time: { fontSize: 11, color: '#C7C7CC', marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  acceptBtn: {
    backgroundColor: NAVY, borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 8,
    minWidth: 70, alignItems: 'center',
  },
  acceptTxt: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  rejectBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center',
  },
  empty: { alignItems: 'center', paddingVertical: 80, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: TEXT_PRIMARY },
  emptySub: { fontSize: 14, color: TEXT_SECONDARY, textAlign: 'center', lineHeight: 20 },
});