/**
 * Everyone on a collab post: photo, name, handle and seal, each opening the
 * profile. Opened from "× N others" on the card.
 */
import TierName from './TierName';
import React from 'react';
import { View, Text, TouchableOpacity, Modal, Image, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from './SafeArea';
import { useNavigation } from '@react-navigation/native';
import VerifiedBadge from './VerifiedBadge';
import { useTheme } from '../theme/useTheme';

export type CollabPerson = { id: string; username: string | null; full_name: string | null; avatar_url?: string | null; is_verified?: boolean; verified_tier?: string | null };

export default function CollaboratorsSheet({ visible, people, onClose }: { visible: boolean; people: CollabPerson[]; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { t } = useTheme();
  const navigation = useNavigation<any>();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.wrap}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={[st.sheet, { backgroundColor: t.surface.canvas, paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={[st.handle, { backgroundColor: t.ink.faint }]} />
          <Text style={[st.title, { color: t.ink.primary }]}>Collaborators</Text>
          <ScrollView style={{ maxHeight: 380 }}>
            {people.map((p) => (
              <TouchableOpacity key={p.id} style={st.row} activeOpacity={0.75} onPress={() => { onClose(); navigation.navigate('UserProfile', { userId: p.id }); }}>
                {p.avatar_url ? <Image source={{ uri: p.avatar_url }} style={st.avatar} /> : <View style={[st.avatar, { backgroundColor: t.brand.tintBg, alignItems: 'center', justifyContent: 'center' }]}><Text style={{ color: t.ink.primary, fontWeight: '800' }}>{(p.full_name || p.username || '?').slice(0, 1).toUpperCase()}</Text></View>}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={[st.name, { color: t.ink.primary }]} numberOfLines={1}><TierName userId={((p) as any)?.id ?? ((p) as any)?.user_id} baseStyle={[st.name, { color: t.ink.primary }]} text={p.full_name || p.username || ''} numberOfLines={1} /> <VerifiedBadge userId={((p) as any)?.id ?? ((p) as any)?.user_id} size={12} /></Text>
                    {(p.is_verified || p.verified_tier) ? <VerifiedBadge tier={(p.verified_tier as any) || undefined} userId={p.id} size={14} /> : null}
                  </View>
                  {p.username ? <Text style={[st.handleTxt, { color: t.ink.muted }]} numberOfLines={1}>@{p.username}</Text> : null}
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 10 },
  title: { fontSize: 15, fontWeight: '800', textAlign: 'center', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  name: { fontSize: 15, fontWeight: '700' },
  handleTxt: { fontSize: 12.5, marginTop: 1 },
});