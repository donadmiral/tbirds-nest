/** Who voted for what on a post poll; the author only, grouped by option. */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Image, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from './SafeArea';
import { supabase } from '../services/supabase';
import TierName from './TierName';
import VerifiedBadge from './VerifiedBadge';
type Row = { option_id: string; label: string; user_id: string; full_name: string | null; username: string | null; avatar_url: string | null };
export default function PollVotersSheet({ postId, onClose }: { postId: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => { if (!postId) return; setRows(null); supabase.rpc('get_poll_voters', { p_post_id: postId }).then(({ data }) => setRows((data as Row[]) || [])); }, [postId]);
  const groups: Record<string, Row[]> = {}; (rows || []).forEach((r) => { (groups[r.label] = groups[r.label] || []).push(r); });
  return (
    <Modal visible={!!postId} transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.wrap}><TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={[st.sheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={st.handle} /><Text style={st.title}>Votes</Text>
          <ScrollView style={{ maxHeight: 420 }}>
            {rows === null ? <Text style={st.muted}>Loading</Text> : rows.length === 0 ? <Text style={st.muted}>No votes yet</Text> : Object.entries(groups).map(([label, list]) => (
              <View key={label} style={{ marginBottom: 12 }}>
                <Text style={st.group}>{label} · {list.length}</Text>
                {list.map((r) => (
                  <View key={r.user_id} style={st.row}>
                    {r.avatar_url ? <Image source={{ uri: r.avatar_url }} style={st.avatar} /> : <View style={[st.avatar, { backgroundColor: '#EEE' }]} />}
                    <TierName userId={r.user_id} baseStyle={st.name} text={r.full_name || r.username || ''} numberOfLines={1} />
                    <VerifiedBadge userId={r.user_id} size={13} />
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(11,30,61,0.15)', marginBottom: 10 },
  title: { fontSize: 16, fontWeight: '800', color: '#0B1E3D', marginBottom: 10 },
  muted: { fontSize: 13, color: 'rgba(11,30,61,0.5)', paddingVertical: 16 },
  group: { fontSize: 11.5, fontWeight: '800', color: 'rgba(11,30,61,0.5)', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7 },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  name: { fontSize: 14.5, fontWeight: '700', color: '#0B1E3D', flexShrink: 1 },
});