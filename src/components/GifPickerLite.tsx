/**
 * GifPickerLite — self-contained GIPHY picker modal for comments.
 * Deliberately separate from the chat's picker: the chat one is welded
 * into ChatScreen and works; this shares nothing so neither can break the other.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Feather } from '@expo/vector-icons';

const KEY = process.env.EXPO_PUBLIC_GIPHY_KEY || '';

export default function GifPickerLite({ visible, onClose, onSelect }: {
  visible: boolean; onClose: () => void; onSelect: (url: string) => void;
}) {
  const [q, setQ] = useState('');
  const [gifs, setGifs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const url = q.trim()
          ? `https://api.giphy.com/v1/gifs/search?api_key=${KEY}&q=${encodeURIComponent(q.trim())}&limit=24&rating=pg-13`
          : `https://api.giphy.com/v1/gifs/trending?api_key=${KEY}&limit=24&rating=pg-13`;
        const res = await fetch(url);
        const json = await res.json();
        if (live) setGifs(json?.data || []);
      } catch { if (live) setGifs([]); }
      finally { if (live) setLoading(false); }
    }, q.trim() ? 400 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [q, visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(11,30,61,0.45)' }} activeOpacity={1} onPress={onClose} />
      <View style={{ height: '68%', backgroundColor: '#FFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 10 }}>
        <View style={{ alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: 'rgba(11,30,61,0.16)', marginBottom: 10 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginBottom: 10, backgroundColor: 'rgba(11,30,61,0.05)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 }}>
          <Feather name="search" size={15} color="#8E8E93" />
          <TextInput value={q} onChangeText={setQ} placeholder="Search GIPHY" placeholderTextColor="#8E8E93"
            style={{ flex: 1, fontSize: 15, color: '#0B1E3D', padding: 0 }} autoCorrect={false} />
          {q ? <TouchableOpacity onPress={() => setQ('')}><Feather name="x" size={15} color="#8E8E93" /></TouchableOpacity> : null}
        </View>
        {loading ? <ActivityIndicator style={{ marginTop: 30 }} color="#0B1E3D" /> : (
          <FlatList data={gifs} numColumns={2} keyExtractor={(g: any) => g.id}
            columnWrapperStyle={{ gap: 6, paddingHorizontal: 14 }} contentContainerStyle={{ gap: 6, paddingBottom: 30 }}
            renderItem={({ item }: any) => {
              const grid = item?.images?.fixed_width?.url;
              const full = item?.images?.original?.url || grid;
              if (!grid) return null;
              return (
                <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.8} onPress={() => full && onSelect(full)}>
                  <ExpoImage source={{ uri: grid }} style={{ width: '100%', aspectRatio: 1.2, borderRadius: 10 }} contentFit="cover" />
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={<Text style={{ textAlign: 'center', color: 'rgba(11,30,61,0.5)', marginTop: 30 }}>No GIFs found</Text>} />
        )}
      </View>
    </Modal>
  );
}