/**
 * SaveToMemorySheet — pick which memory book a story goes into.
 * Replaces highlights: lists the owner's books (get_memory_albums),
 * one tap adds the story via add_memory_page(p_story_id, p_album_id),
 * with an inline New book creator. Same props as the old highlight sheet.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { COVER_COLORS } from '../MemoryAlbumCard';

export default function SaveToMemorySheet({ visible, onClose, storyId, userId }: {
  visible: boolean; onClose: () => void; storyId: string; userId: string;
}) {
  const [books, setBooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [savedTo, setSavedTo] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newColor, setNewColor] = useState('blush');

  useEffect(() => {
    if (!visible) return;
    setSavedTo(new Set()); setCreating(false); setNewTitle('');
    setLoading(true);
    supabase.rpc('get_memory_albums', { p_owner: userId }).then(({ data, error }) => {
      if (!error) setBooks(data?.books ?? []);
      setLoading(false);
    });
  }, [visible, userId]);

  const addTo = useCallback(async (bookId: string) => {
    if (busy || savedTo.has(bookId)) return;
    setBusy(bookId);
    try {
      const { error } = await supabase.rpc('add_memory_page', { p_story_id: storyId, p_album_id: bookId });
      if (!error) setSavedTo(prev => new Set(prev).add(bookId));
    } finally { setBusy(null); }
  }, [busy, savedTo, storyId]);

  const createAndAdd = useCallback(async () => {
    const t = newTitle.trim();
    if (!t || busy) return;
    setBusy('new');
    try {
      const { data: id, error } = await supabase.rpc('create_memory_book', { p_title: t, p_cover_color: newColor });
      if (!error && id) {
        const { error: e2 } = await supabase.rpc('add_memory_page', { p_story_id: storyId, p_album_id: id });
        setBooks(prev => [...prev, { id, title: t, cover_color: newColor, is_default: false, count: e2 ? 0 : 1 }]);
        if (!e2) setSavedTo(prev => new Set(prev).add(id));
        setCreating(false); setNewTitle('');
      }
    } finally { setBusy(null); }
  }, [newTitle, newColor, busy, storyId]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={ms.wrap}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={ms.sheet}>
          <View style={ms.handle} />
          <Text style={ms.title}>Add to a memory book</Text>
          {loading ? (
            <View style={{ paddingVertical: 30, alignItems: 'center' }}><ActivityIndicator color="#0B1E3D" /></View>
          ) : (
            <ScrollView style={{ flexGrow: 0, maxHeight: 340 }} showsVerticalScrollIndicator={false}>
              {books.map(b => {
                const c = COVER_COLORS[b.cover_color] ?? COVER_COLORS.blush;
                const done = savedTo.has(b.id);
                return (
                  <TouchableOpacity key={b.id} onPress={() => addTo(b.id)} disabled={done} style={ms.row}>
                    <View style={[ms.miniBook, { backgroundColor: c.spine }]}>
                      <View style={[ms.miniCover, { backgroundColor: c.cover, borderColor: c.text + '55' }]}>
                        <Feather name="heart" size={9} color={c.text} />
                      </View>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={ms.rowTitle}>{b.title}</Text>
                      <Text style={ms.rowSub}>{b.count} {b.count === 1 ? 'memory' : 'memories'}</Text>
                    </View>
                    {busy === b.id ? <ActivityIndicator size={14} color="#0B1E3D" /> :
                      done ? <View style={ms.doneChip}><Feather name="check" size={12} color="#FFF" /><Text style={ms.doneTxt}>Added</Text></View> :
                      <Feather name="plus-circle" size={20} color="#0B1E3D" />}
                  </TouchableOpacity>
                );
              })}
              {!creating ? (
                <TouchableOpacity onPress={() => setCreating(true)} style={ms.row}>
                  <View style={ms.newTile}><Feather name="plus" size={15} color="#5B6B84" /></View>
                  <Text style={[ms.rowTitle, { color: '#5B6B84' }]}>New book</Text>
                </TouchableOpacity>
              ) : (
                <View style={ms.createBox}>
                  <TextInput value={newTitle} onChangeText={setNewTitle} placeholder="Happy moments" placeholderTextColor="#9AA6B8" style={ms.input} maxLength={40} autoFocus />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                    {Object.keys(COVER_COLORS).map(k => (
                      <TouchableOpacity key={k} onPress={() => setNewColor(k)}
                        style={{ width: 24, height: 30, borderRadius: 4, backgroundColor: COVER_COLORS[k].cover, borderWidth: newColor === k ? 2 : 1, borderColor: newColor === k ? '#0B1E3D' : 'rgba(11,30,61,0.15)' }} />
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 16 }}>
                    <TouchableOpacity onPress={() => setCreating(false)}><Text style={{ color: '#5B6B84', fontWeight: '700', fontSize: 13 }}>Cancel</Text></TouchableOpacity>
                    <TouchableOpacity onPress={createAndAdd} disabled={!newTitle.trim() || busy === 'new'}>
                      {busy === 'new' ? <ActivityIndicator size={13} color="#0B1E3D" /> : <Text style={{ color: newTitle.trim() ? '#0B1E3D' : '#C7CEDA', fontWeight: '800', fontSize: 13 }}>Create and add</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </ScrollView>
          )}
          <TouchableOpacity onPress={onClose} style={ms.doneBtn}><Text style={ms.doneBtnTxt}>Done</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const ms = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28, maxHeight: '78%' },
  handle: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: '#D9DEE7', marginBottom: 10 },
  title: { fontSize: 15.5, fontWeight: '800', color: '#0B1E3D', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  miniBook: { width: 34, height: 44, borderRadius: 5, padding: 2, paddingLeft: 4 },
  miniCover: { flex: 1, borderRadius: 3, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 14, fontWeight: '700', color: '#0B1E3D' },
  rowSub: { fontSize: 11.5, color: '#8b93a3', marginTop: 1 },
  doneChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1D7A38', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 4 },
  doneTxt: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  newTile: { width: 34, height: 44, borderRadius: 5, borderWidth: 1.4, borderStyle: 'dashed', borderColor: '#B7C0CE', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(11,30,61,0.03)' },
  createBox: { borderWidth: 1, borderColor: '#E7EAF0', borderRadius: 12, padding: 12, marginTop: 4 },
  input: { borderWidth: 1, borderColor: '#E1E6EE', borderRadius: 9, paddingHorizontal: 11, paddingVertical: 8, fontSize: 13.5, color: '#0B1E3D', marginBottom: 10 },
  doneBtn: { marginTop: 12, backgroundColor: '#0B1E3D', borderRadius: 12, alignItems: 'center', paddingVertical: 12 },
  doneBtnTxt: { color: '#FFF', fontSize: 14, fontWeight: '800' },
});