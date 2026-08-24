/**
 * MemoryAlbumCard — the little book on a profile, mirroring web's MemoryAlbumBook.
 * Fetches get_memory_album(p_owner) and hides itself exactly like web:
 * owner always sees it; others only when can_view and count > 0.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
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

export default function MemoryAlbumCard({ ownerId, navigation }: { ownerId?: string | null; navigation: any }) {
  const [album, setAlbum] = useState<any | null>(null);

  useFocusEffect(useCallback(() => {
    let live = true;
    if (!ownerId) { setAlbum(null); return () => { live = false; }; }
    supabase.rpc('get_memory_album', { p_owner: ownerId }).then(({ data, error }) => {
      if (live && !error) setAlbum(data ?? null);
    });
    return () => { live = false; };
  }, [ownerId]));

  if (!ownerId || !album) return null;
  if (!album.is_owner && (!album.can_view || album.count === 0)) return null;

  const c = COVER_COLORS[album.cover_color] ?? COVER_COLORS.blush;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => navigation.navigate('MemoryAlbum', { ownerId })}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 }}
    >
      <View style={{ width: 56, height: 70 }}>
        <View style={{ flex: 1, borderRadius: 7, backgroundColor: c.spine, padding: 3, paddingLeft: 6, shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 }}>
          <View style={{ flex: 1, borderRadius: 5, backgroundColor: c.cover, borderWidth: 1, borderStyle: 'dashed', borderColor: c.text + '55', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
            <View style={{ position: 'absolute', top: 3, left: 3, width: 5, height: 5, borderRadius: 2.5, backgroundColor: c.spine }} />
            <View style={{ position: 'absolute', bottom: 3, right: 3, width: 5, height: 5, borderRadius: 2.5, backgroundColor: c.spine }} />
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ textAlign: 'center', fontSize: 9, fontWeight: '800', color: c.text }}>{album.title}</Text>
            <Feather name="heart" size={9} color={c.text} style={{ marginTop: 3, opacity: 0.9 }} />
          </View>
        </View>
        <View style={{ position: 'absolute', right: -5, top: 24, width: 13, height: 18, borderRadius: 4, backgroundColor: '#E4D2A6', borderWidth: 1, borderColor: '#CBB27C', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#F3EDE2' }} />
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 13.5, fontWeight: '800', color: '#0B1E3D' }}>Memory album</Text>
        <Text style={{ fontSize: 12, color: '#5B6B84', marginTop: 2 }}>
          {album.count === 0 ? 'Add your first memory' : album.count + (album.count === 1 ? ' memory' : ' memories') + ' · tap to open'}
        </Text>
      </View>
      <Feather name="chevron-right" size={16} color="#9AA6B8" />
    </TouchableOpacity>
  );
}