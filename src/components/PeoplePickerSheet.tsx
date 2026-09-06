/**
 * Pick a person by typing: results appear as you type, name, handle and
 * photo. Used to choose a collaborator; reusable wherever one person is chosen.
 */
import TierName from './TierName';
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, FlatList, Image, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from './SafeArea';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/useTheme';
import VerifiedBadge from './VerifiedBadge';

export type PickedPerson = { id: string; username: string | null; full_name: string | null; avatar_url: string | null; is_verified?: boolean | null; verified_tier?: string | null; headline?: string | null };

export default function PeoplePickerSheet({ visible, title, excludeId, onPick, onClose }: { visible: boolean; title: string; excludeId?: string | null; onPick: (p: PickedPerson) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { t } = useTheme();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PickedPerson[]>([]);

  useEffect(() => {
    if (!visible) { setQ(''); setRows([]); return; }
    const term = q.trim().replace(/^@/, '');
    let dead = false;
    const run = async () => {
      let query = supabase.from('profiles').select('id, username, full_name, avatar_url, is_verified, verified_tier, headline').limit(12);
      query = term ? query.or('username.ilike.' + term + '%,full_name.ilike.%' + term + '%') : query.order('created_at', { ascending: false });
      const { data } = await query;
      if (!dead) setRows(((data as PickedPerson[]) || []).filter((p) => p.id !== excludeId));
    };
    const h = setTimeout(run, 150);
    return () => { dead = true; clearTimeout(h); };
  }, [q, visible, excludeId]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={st.wrap}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
          <View style={[st.sheet, { backgroundColor: t.surface.canvas, paddingBottom: Math.max(insets.bottom, 12) }]}>
            <View style={[st.handle, { backgroundColor: t.ink.faint }]} />
            <Text style={[st.title, { color: t.ink.primary }]}>{title}</Text>
            <View style={[st.search, { backgroundColor: t.surface.sunken }]}>
              <Feather name="at-sign" size={16} color={t.ink.muted} />
              <TextInput value={q} onChangeText={setQ} placeholder="Type a name or @username" placeholderTextColor={t.ink.faint} autoFocus autoCapitalize="none" autoCorrect={false} style={[st.input, { color: t.ink.primary }]} />
            </View>
            <FlatList data={rows} keyExtractor={(p) => p.id} keyboardShouldPersistTaps="handled" style={{ maxHeight: 320 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={st.row} activeOpacity={0.75} onPress={() => { onPick(item); onClose(); }}>
                  {item.avatar_url ? <Image source={{ uri: item.avatar_url }} style={st.avatar} /> : <View style={[st.avatar, { backgroundColor: t.brand.tintBg, alignItems: 'center', justifyContent: 'center' }]}><Text style={{ color: t.ink.primary, fontWeight: '800' }}>{(item.full_name || item.username || '?').slice(0, 1).toUpperCase()}</Text></View>}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Text style={[st.name, { color: t.ink.primary }]} numberOfLines={1}><TierName userId={((item) as any)?.id ?? ((item) as any)?.user_id} baseStyle={[st.name, { color: t.ink.primary }]} text={item.full_name || item.username || ''} numberOfLines={1} /></Text>{item.is_verified ? <VerifiedBadge tier={(item.verified_tier as any) || undefined} userId={item.id} size={14} /> : null}</View>
                    {item.username ? <Text style={[st.handleTxt, { color: t.ink.muted }]} numberOfLines={1}>@{item.username}{item.headline ? '  ·  ' + item.headline : ''}</Text> : null}
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={{ color: t.ink.muted, fontSize: 13, paddingVertical: 14, textAlign: 'center' }}>{q.trim() ? 'No one matches yet' : 'Start typing'}</Text>} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 10 },
  title: { fontSize: 15, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 12, height: 44, marginBottom: 6 },
  input: { flex: 1, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  name: { fontSize: 15, fontWeight: '700' },
  handleTxt: { fontSize: 12.5, marginTop: 1 },
});