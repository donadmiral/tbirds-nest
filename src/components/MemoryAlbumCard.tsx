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
      <View style={{ width: 52, height: 64, borderRadius: 6, backgroundColor: c.cover, flexDirection: 'row', overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 }}>
        <View style={{ width: 7, backgroundColor: c.spine }} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
          <Feather name="heart" size={12} color={c.text} />
          <Text numberOfLines={2} style={{ textAlign: 'center', fontSize: 8.5, lineHeight: 10, fontWeight: '700', color: c.text, marginTop: 3 }}>{album.title}</Text>
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