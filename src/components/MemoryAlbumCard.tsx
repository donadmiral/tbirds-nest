/**
 * MemoryAlbumCard — the shelf of memory books on a profile.
 * Fetches get_memory_albums(p_owner): owner sees every book plus a
 * New book tile; visitors see only viewable books that hold memories.
 * Each mini book mirrors the real cover: spine, stitched border, clasp.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, TextInput, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../services/supabase';

export const COVER_COLORS: Record<string, { cover: string; spine: string; text: string }> = {
  blush: { cover: '#FBE3EA', spine: '#F2B8C6', text: '#8a3b52' },
  rose:  { cover: '#F4C0D1', spine: '#D4537E', text: '#72243E' },
  pearl: { cover: '#F3EDE2', spine: '#C9BFB0', text: '#4a4438' },
  cream: { cover: '#FAF3E3', spine: '#E8D9B8', text: '#6b5b35' },
  sage:  { cover: '#E4EEE2', spine: '#AFC8AB', text: '#3c5738' },
  sky:   { cover: '#E2EEF6', spine: '#A9CBE0', text: '#2c516b' },
  lilac: { cover: '#ECE7F7', spine: '#C4B6E6', text: '#4b3c78' },
  ink:   { cover: '#2A2D33', spine: '#16181c', text: '#f2f0ec' },
};

function MiniBook({ title, colorKey }: { title: string; colorKey: string }) {
  const c = COVER_COLORS[colorKey] ?? COVER_COLORS.blush;
  return (
    <View style={{ width: 62, height: 78 }}>
      <View style={{ flex: 1, borderRadius: 8, backgroundColor: c.spine, padding: 3, paddingLeft: 7, shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 }}>
        <View style={{ flex: 1, borderRadius: 5, backgroundColor: c.cover, borderWidth: 1, borderStyle: 'dashed', borderColor: c.text + '55', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <View style={{ position: 'absolute', top: 3, left: 3, width: 5, height: 5, borderRadius: 2.5, backgroundColor: c.spine }} />
          <View style={{ position: 'absolute', bottom: 3, right: 3, width: 5, height: 5, borderRadius: 2.5, backgroundColor: c.spine }} />
          <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6} style={{ textAlign: 'center', fontSize: 9.5, lineHeight: 11.5, fontWeight: '800', color: c.text }}>{title}</Text>
          <Feather name="heart" size={9} color={c.text} style={{ marginTop: 3, opacity: 0.9 }} />
        </View>
      </View>
      <View style={{ position: 'absolute', right: -5, top: 28, width: 13, height: 18, borderRadius: 4, backgroundColor: '#E4D2A6', borderWidth: 1, borderColor: '#CBB27C', alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#F3EDE2' }} />
      </View>
    </View>
  );
}

export default function MemoryAlbumCard({ ownerId, navigation }: { ownerId?: string | null; navigation: any }) {
  const [data, setData] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newColor, setNewColor] = useState('blush');

  const refresh = useCallback(() => {
    if (!ownerId) { setData(null); return; }
    supabase.rpc('get_memory_albums', { p_owner: ownerId }).then(({ data: d, error }) => {
      if (!error) setData(d ?? null);
    });
  }, [ownerId]);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  if (!ownerId || !data) return null;
  const books: any[] = (data.books ?? []).filter((b: any) => data.is_owner || b.count > 0);
  if (!data.is_owner && (!data.can_view || books.length === 0)) return null;

  const createBook = async () => {
    const t = newTitle.trim();
    if (!t) return;
    try {
      const { data: id, error } = await supabase.rpc('create_memory_book', { p_title: t, p_cover_color: newColor });
      setCreating(false); setNewTitle('');
      refresh();
      if (!error && id) navigation.navigate('MemoryAlbum', { ownerId, albumId: id });
    } catch {}
  };

  return (
    <View style={{ paddingVertical: 10 }}>
      <Text style={{ fontSize: 13.5, fontWeight: '800', color: '#0B1E3D', paddingHorizontal: 16, marginBottom: 8 }}>Memory books</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 16, alignItems: 'flex-start' }}>
        {books.map((b: any) => (
          <TouchableOpacity key={b.id} activeOpacity={0.85} onPress={() => navigation.navigate('MemoryAlbum', { ownerId, albumId: b.id })} style={{ alignItems: 'center', width: 70 }}>
            <MiniBook title={b.title} colorKey={b.cover_color} />
            <Text numberOfLines={1} style={{ fontSize: 10.5, fontWeight: '700', color: '#0B1E3D', marginTop: 6, maxWidth: 70 }}>{b.title}</Text>
            <Text style={{ fontSize: 9.5, color: '#8b93a3', marginTop: 1 }}>{b.count} {b.count === 1 ? 'memory' : 'memories'}</Text>
          </TouchableOpacity>
        ))}
        {data.is_owner ? (
          <TouchableOpacity activeOpacity={0.8} onPress={() => { setNewColor('blush'); setCreating(true); }} style={{ alignItems: 'center', width: 70 }}>
            <View style={{ width: 62, height: 78, borderRadius: 8, borderWidth: 1.6, borderStyle: 'dashed', borderColor: '#B7C0CE', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(11,30,61,0.03)' }}>
              <Feather name="plus" size={18} color="#5B6B84" />
            </View>
            <Text style={{ fontSize: 10.5, fontWeight: '700', color: '#5B6B84', marginTop: 6 }}>New book</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      <Modal visible={creating} transparent animationType="fade" onRequestClose={() => setCreating(false)}>
        <View style={sc.wrap}>
          <View style={sc.card}>
            <Text style={sc.title}>New memory book</Text>
            <TextInput value={newTitle} onChangeText={setNewTitle} placeholder="Happy moments" placeholderTextColor="#9AA6B8" style={sc.input} maxLength={40} autoFocus />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 6 }}>
              {Object.keys(COVER_COLORS).map(k => (
                <TouchableOpacity key={k} onPress={() => setNewColor(k)}
                  style={{ width: 28, height: 36, borderRadius: 5, backgroundColor: COVER_COLORS[k].cover, borderWidth: newColor === k ? 2.5 : 1, borderColor: newColor === k ? '#0B1E3D' : 'rgba(11,30,61,0.15)' }} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 18, marginTop: 10 }}>
              <TouchableOpacity onPress={() => setCreating(false)}><Text style={{ color: '#5B6B84', fontWeight: '700' }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={createBook} disabled={!newTitle.trim()}><Text style={{ color: newTitle.trim() ? '#0B1E3D' : '#C7CEDA', fontWeight: '800' }}>Create</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const sc = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(11,30,61,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  card: { alignSelf: 'stretch', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, maxHeight: '82%' },
  title: { fontSize: 15.5, fontWeight: '800', color: '#0B1E3D', marginBottom: 10 },
  input: { borderWidth: 1, borderColor: '#E1E6EE', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: '#0B1E3D', marginBottom: 12 },
});