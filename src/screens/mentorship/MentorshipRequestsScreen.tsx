import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Image,
  ActivityIndicator, StatusBar, Alert, Modal, TextInput,
  KeyboardAvoidingView, Platform, Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  getIncomingRequests, acceptMentorshipRequest, declineMentorshipRequest,
  IncomingRequest,
} from '../../services/mentorshipService';
import * as Haptics from 'expo-haptics';

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

function relTime(iso?: string | null) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

export default function MentorshipRequestsScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [requests, setRequests] = useState<IncomingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});

  const [declineOpen, setDeclineOpen] = useState<IncomingRequest | null>(null);
  const [declineNote, setDeclineNote] = useState('');

  const load = useCallback(async () => {
    const data = await getIncomingRequests();
    setRequests(data);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setBusy = (id: string, v: boolean) =>
    setBusyIds(p => { const n = { ...p }; if (v) n[id] = true; else delete n[id]; return n; });

  const accept = async (r: IncomingRequest) => {
    if (busyIds[r.request_id]) return;
    setBusy(r.request_id, true);
    try {
      const mentorshipId = await acceptMentorshipRequest(r.request_id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setRequests(prev => prev.filter(x => x.request_id !== r.request_id));
      Alert.alert(
        'Accepted',
        `You're now mentoring ${r.full_name || 'them'}. Open the mentorship to start.`,
        [
          { text: 'Later' },
          { text: 'Open', onPress: () => nav.navigate('MentorshipDetail', { mentorshipId }) },
        ]
      );
    } catch (e: any) {
      Alert.alert('Could not accept', e?.message || 'Please try again.');
    } finally {
      setBusy(r.request_id, false);
    }
  };

  const openDecline = (r: IncomingRequest) => {
    setDeclineNote('');
    setDeclineOpen(r);
  };

  const confirmDecline = async () => {
    if (!declineOpen) return;
    const r = declineOpen;
    Keyboard.dismiss();
    setDeclineOpen(null);
    setBusy(r.request_id, true);
    try {
      await declineMentorshipRequest(r.request_id, declineNote.trim() || undefined);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setRequests(prev => prev.filter(x => x.request_id !== r.request_id));
    } catch (e: any) {
      Alert.alert('Could not decline', e?.message || 'Please try again.');
    } finally {
      setBusy(r.request_id, false);
    }
  };

  const renderItem = ({ item }: { item: IncomingRequest }) => {
    const busy = !!busyIds[item.request_id];
    return (
      <View style={s.card}>
        <View style={s.topRow}>
          {item.avatar_url ? (
            <Image source={{ uri: item.avatar_url }} style={s.avatar} fadeDuration={200} />
          ) : (
            <View style={[s.avatar, { backgroundColor: colorFor(item.mentee_id) }]}>
              <Text style={s.avatarTxt}>{initials(item.full_name)}</Text>
            </View>
          )}
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.name} numberOfLines={1}>{item.full_name || 'User'}</Text>
            {item.username ? <Text style={s.handle}>@{item.username}</Text> : null}
            {item.headline ? <Text style={s.headline} numberOfLines={1}>{item.headline}</Text> : null}
          </View>
          <Text style={s.time}>{relTime(item.requested_at)}</Text>
        </View>

        {item.focus_areas.length > 0 && (
          <View style={s.focusRow}>
            {item.focus_areas.map(t => (
              <View key={t} style={s.focusTag}>
                <Text style={s.focusTxt}>{t}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={s.message}>{item.message}</Text>

        <View style={s.actions}>
          <TouchableOpacity
            style={[s.btn, s.btnDecline]}
            onPress={() => openDecline(item)}
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
            {busy ? <ActivityIndicator color="#FFF" size={14} /> : <Text style={s.btnAcceptTxt}>Accept</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => nav.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={26} color="#000" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Requests</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={s.loader}><ActivityIndicator color="#000" /></View>
      ) : requests.length === 0 ? (
        <View style={s.empty}>
          <Feather name="inbox" size={40} color="#E5E5EA" />
          <Text style={s.emptyTitle}>No pending requests</Text>
          <Text style={s.emptySub}>New mentorship requests will appear here.</Text>
        </View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={r => r.request_id}
          renderItem={renderItem}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal
        visible={!!declineOpen}
        transparent
        animationType="slide"
        onRequestClose={() => { Keyboard.dismiss(); setDeclineOpen(null); }}
      >
        <KeyboardAvoidingView style={s.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Decline request</Text>
            <Text style={s.modalSub}>
              {declineOpen ? `Let ${declineOpen.full_name?.split(' ')[0] || 'them'} know why this isn't the right fit. Optional but appreciated.` : ''}
            </Text>
            <TextInput
              value={declineNote}
              onChangeText={t => t.length <= 300 && setDeclineNote(t)}
              placeholder="Optional short note..."
              placeholderTextColor="#9CA3AF"
              style={s.modalInput}
              multiline
              textAlignVertical="top"
            />
            <View style={s.modalActions}>
              <TouchableOpacity style={[s.btn, s.btnDecline, { flex: 1 }]} onPress={() => { Keyboard.dismiss(); setDeclineOpen(null); }}>
                <Text style={s.btnDeclineTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btn, s.btnConfirm, { flex: 1 }]} onPress={confirmDecline}>
                <Text style={s.btnAcceptTxt}>Send decline</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },

  card: {
    backgroundColor: '#F9FAFB', borderRadius: 16,
    padding: 14, gap: 10,
  },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 14, fontWeight: '800', color: '#FFF' },
  name: { fontSize: 15, fontWeight: '700', color: '#000' },
  handle: { fontSize: 12, color: '#8E8E93', marginTop: 1 },
  headline: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  time: { fontSize: 11, color: '#9CA3AF' },

  focusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  focusTag: { backgroundColor: '#DBEAFE', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  focusTxt: { fontSize: 11, fontWeight: '700', color: '#1E40AF' },

  message: {
    fontSize: 13, color: '#1F2937', lineHeight: 19,
    backgroundColor: '#FFF', borderRadius: 10, padding: 10,
  },

  actions: { flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1, paddingVertical: 11, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  btnDecline: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E5E7EB' },
  btnDeclineTxt: { fontSize: 14, fontWeight: '700', color: '#374151' },
  btnAccept: { backgroundColor: '#000' },
  btnAcceptTxt: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  btnConfirm: { backgroundColor: '#DC2626' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#000', marginTop: 8 },
  emptySub: { fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 18 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 16, paddingBottom: 40,
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#E0E0E0',
    alignSelf: 'center', marginBottom: 14,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#000', marginBottom: 6 },
  modalSub: { fontSize: 13, color: '#6B7280', lineHeight: 18, marginBottom: 14 },
  modalInput: {
    backgroundColor: '#F9FAFB', borderRadius: 12,
    padding: 12, minHeight: 90,
    fontSize: 14, color: '#111', lineHeight: 19,
    marginBottom: 14,
  },
  modalActions: { flexDirection: 'row', gap: 8 },
});