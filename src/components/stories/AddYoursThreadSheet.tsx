/**
 * The Add Yours thread: every story that answered the same prompt, newest
 * first, with the person who started it. Tap one to watch that person's stories.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Image, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from '../SafeArea';
import { supabase } from '../../services/supabase';
import TierName from '../TierName';
import VerifiedBadge from '../VerifiedBadge';

type Row = { id: string; user_id: string; media_url: string | null; thumbnail_url: string | null; created_at: string; profile: { username: string | null; full_name: string | null; avatar_url: string | null } | null };

export default function AddYoursThreadSheet({ visible, prompt, originStoryId, originStickerId, onClose, onOpen }: { visible: boolean; prompt: string; originStoryId: string | null; originStickerId: string | null; onClose: () => void; onOpen: (userId: string, storyId: string) => void }) {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!visible) return;
    setRows(null);
    (async () => {
      const sel = 'id, user_id, media_url, thumbnail_url, created_at, profile:profiles!stories_user_id_fkey(username, full_name, avatar_url)';
      const out: Row[] = [];
      if (originStoryId) { const { data } = await supabase.from('stories').select(sel).eq('id', originStoryId).maybeSingle(); if (data) out.push(data as any); }
      if (originStickerId) { const { data } = await supabase.from('stories').select(sel).contains('stickers_json', [{ addYoursOriginStickerId: originStickerId }]).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(100); (data as any[] || []).forEach((r) => { if (!out.some((x) => x.id === r.id)) out.push(r); }); }
      setRows(out.map((r: any) => ({ ...r, profile: Array.isArray(r.profile) ? r.profile[0] : r.profile })));
    })();
  }, [visible, originStoryId, originStickerId]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.wrap}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={[st.sheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={st.handle} />
          <Text style={st.kicker}>ADD YOURS</Text>
          <Text style={st.title} numberOfLines={2}>{prompt}</Text>
          {rows === null ? <ActivityIndicator color="#C9BFB0" style={{ marginVertical: 24 }} /> : (
            <FlatList data={rows} keyExtractor={(r) => r.id} numColumns={3} columnWrapperStyle={{ gap: 8 }} contentContainerStyle={{ gap: 8, paddingTop: 12 }} style={{ maxHeight: 420 }}
              ListEmptyComponent={<Text style={st.empty}>No one has added theirs yet.</Text>}
              renderItem={({ item, index }) => (
                <TouchableOpacity style={st.cell} activeOpacity={0.85} onPress={() => { onClose(); onOpen(item.user_id, item.id); }}>
                  {item.thumbnail_url || item.media_url ? <Image source={{ uri: item.thumbnail_url || item.media_url || '' }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
                  <View style={st.cellFoot}>
                    {item.profile?.avatar_url ? <Image source={{ uri: item.profile.avatar_url }} style={st.cellAvatar} /> : null}
                    <TierName userId={item.user_id} baseStyle={st.cellName} text={item.profile?.full_name || item.profile?.username || ''} numberOfLines={1} />
                    <VerifiedBadge userId={item.user_id} size={10} />
                  </View>
                  {index === 0 && originStoryId === item.id ? <View style={st.starter}><Text style={st.starterTxt}>Started it</Text></View> : null}
                </TouchableOpacity>
              )} />
          )}
        </View>
      </View>
    </Modal>
  );
}
const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#15161A', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', marginBottom: 12 },
  kicker: { color: '#C9BFB0', fontSize: 10, fontWeight: '800', letterSpacing: 1, textAlign: 'center' },
  title: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  empty: { color: 'rgba(255,255,255,0.6)', fontSize: 13, textAlign: 'center', paddingVertical: 20 },
  cell: { flex: 1, aspectRatio: 9 / 16, borderRadius: 12, overflow: 'hidden', backgroundColor: '#23252B', justifyContent: 'flex-end' },
  cellFoot: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6, backgroundColor: 'rgba(0,0,0,0.45)' },
  cellAvatar: { width: 16, height: 16, borderRadius: 8 },
  cellName: { color: '#FFFFFF', fontSize: 10.5, fontWeight: '700', flexShrink: 1 },
  starter: { position: 'absolute', top: 6, left: 6, backgroundColor: '#C9BFB0', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  starterTxt: { color: '#0B1E3D', fontSize: 9.5, fontWeight: '800' },
});