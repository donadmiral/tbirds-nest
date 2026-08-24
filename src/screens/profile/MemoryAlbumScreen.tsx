/**
 * MemoryAlbumScreen — the phone album, mirroring web's MemoryAlbumView.
 * View: cover-tinted header, two-column polaroid grid of memory_pages.
 * Owner: add memories from own stories (clean multi-select picker via
 * add_memory_page), edit caption / remove per page, settings sheet
 * (title, cover color, audience) via upsert_memory_album.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, Modal, TextInput,
  ActivityIndicator, Alert, Dimensions, StatusBar, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { supabase } from '../../services/supabase';
import { COVER_COLORS } from '../../components/MemoryAlbumCard';

const SW = Dimensions.get('window').width;
const TILE_W = (SW - 16 * 2 - 14) / 2;

const AUDIENCES = [
  { key: 'profile', label: 'Everyone who can view my profile' },
  { key: 'followers', label: 'Followers only' },
  { key: 'custom', label: 'Only people I choose' },
  { key: 'only_me', label: 'Only me' },
];

export default function MemoryAlbumScreen({ route, navigation }: any) {
  const ownerId: string = route.params?.ownerId;
  const [album, setAlbum] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState(false);
  const [myStories, setMyStories] = useState<any[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState(false);
  const [title, setTitle] = useState('');
  const [color, setColor] = useState('blush');
  const [aud, setAud] = useState('profile');
  const [captionFor, setCaptionFor] = useState<any | null>(null);
  const [captionText, setCaptionText] = useState('');

  const load = useCallback(async () => {
    if (!ownerId) return;
    try {
      const { data, error } = await supabase.rpc('get_memory_album', { p_owner: ownerId });
      if (!error) {
        setAlbum(data ?? null);
        if (data) { setTitle(data.title || 'Memories'); setColor(data.cover_color || 'blush'); setAud(data.audience || 'profile'); }
      }
    } finally { setLoading(false); }
  }, [ownerId]);

  useEffect(() => { load(); }, [load]);

  const c = COVER_COLORS[album?.cover_color] ?? COVER_COLORS.blush;
  const pages: any[] = useMemo(
    () => [...(album?.pages ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [album],
  );

  const openPicker = useCallback(async () => {
    setChosen(new Set());
    setPicker(true);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) return;
    const inAlbum = new Set(pages.map(p => p.media_url).filter(Boolean));
    const { data } = await supabase.from('stories')
      .select('id, media_url, media_type, thumbnail_url, caption, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(120);
    setMyStories((data ?? []).map((s: any) => ({ ...s, _in: inAlbum.has(s.media_url) })));
  }, [pages]);

  const addChosen = useCallback(async () => {
    if (chosen.size === 0 || adding) return;
    setAdding(true);
    try {
      for (const id of chosen) {
        try { await supabase.rpc('add_memory_page', { p_story_id: id }); } catch {}
      }
      setPicker(false);
      await load();
    } finally { setAdding(false); }
  }, [chosen, adding, load]);

  const pageLongPress = useCallback((p: any) => {
    if (!album?.is_owner) return;
    Alert.alert('Memory', p.caption || 'This memory', [
      { text: 'Edit caption', onPress: () => { setCaptionFor(p); setCaptionText(p.caption || ''); } },
      { text: 'Remove from album', style: 'destructive', onPress: async () => {
        await supabase.from('memory_pages').delete().eq('id', p.id);
        load();
      } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [album, load]);

  const saveCaption = useCallback(async () => {
    if (!captionFor) return;
    await supabase.from('memory_pages').update({ caption: captionText.trim() || null }).eq('id', captionFor.id);
    setCaptionFor(null);
    load();
  }, [captionFor, captionText, load]);

  const saveSettings = useCallback(async () => {
    await supabase.rpc('upsert_memory_album', {
      p_title: title.trim() || 'Memories', p_cover_color: color, p_audience: aud,
    });
    setSettings(false);
    load();
  }, [title, color, aud, load]);

  const renderPage = useCallback(({ item }: any) => (
    <TouchableOpacity activeOpacity={0.9} onLongPress={() => pageLongPress(item)} delayLongPress={350}
      style={[st.polaroid, { width: TILE_W }]}>
      <View style={{ width: '100%', height: TILE_W - 16, borderRadius: 4, overflow: 'hidden', backgroundColor: '#0B1E3D' }}>
        {(item.thumbnail_url || item.media_type !== 'video') && (item.thumbnail_url || item.media_url) ? (
          <ExpoImage source={{ uri: item.thumbnail_url || item.media_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={120} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="play" size={22} color="rgba(255,255,255,0.85)" />
          </View>
        )}
        {item.media_type === 'video' ? (
          <View style={st.vidBadge}><Feather name="video" size={10} color="#FFF" /></View>
        ) : null}
      </View>
      <Text numberOfLines={2} style={st.polCaption}>{item.caption || ' '}</Text>
    </TouchableOpacity>
  ), [pageLongPress]);

  if (loading) {
    return (
      <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#0B1E3D" /></View>
      </SafeAreaView>
    );
  }

  if (!album || (!album.is_owner && (!album.can_view || album.count === 0))) {
    return (
      <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
        <View style={st.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="chevron-left" size={26} color="#0B1E3D" />
          </TouchableOpacity>
          <Text style={st.topTitle}>Memory album</Text>
          <View style={{ width: 26 }} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
          <Feather name="lock" size={22} color="#9AA6B8" />
          <Text style={{ marginTop: 10, fontSize: 13.5, color: '#5B6B84', textAlign: 'center' }}>This album is private.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={[st.cover, { backgroundColor: c.cover }]}>
        <View style={st.topRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="chevron-left" size={26} color={c.text} />
          </TouchableOpacity>
          {album.is_owner ? (
            <TouchableOpacity onPress={() => setSettings(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name="settings" size={19} color={c.text} />
            </TouchableOpacity>
          ) : <View style={{ width: 19 }} />}
        </View>
        <Feather name="heart" size={16} color={c.text} />
        <Text style={[st.coverTitle, { color: c.text }]}>{album.title}</Text>
        <Text style={[st.coverCount, { color: c.text }]}>{album.count} {album.count === 1 ? 'memory' : 'memories'}</Text>
      </View>

      <FlatList
        data={pages}
        keyExtractor={(p: any) => p.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 14, paddingHorizontal: 16 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, gap: 14 }}
        renderItem={renderPage}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 60 }}>
            <Text style={{ fontSize: 13, color: '#5B6B84' }}>{album.is_owner ? 'Your book is empty. Add your first memory.' : 'No memories yet.'}</Text>
          </View>
        }
      />

      {album.is_owner ? (
        <TouchableOpacity onPress={openPicker} activeOpacity={0.9} style={st.fab}>
          <Feather name="plus" size={18} color="#FFFFFF" />
          <Text style={st.fabTxt}>Add memories</Text>
        </TouchableOpacity>
      ) : null}

      <Modal visible={picker} animationType="slide" onRequestClose={() => setPicker(false)}>
        <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
          <View style={st.topBar}>
            <TouchableOpacity onPress={() => setPicker(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name="x" size={22} color="#0B1E3D" />
            </TouchableOpacity>
            <Text style={st.topTitle}>Add from your stories</Text>
            <TouchableOpacity disabled={chosen.size === 0 || adding} onPress={addChosen}>
              {adding ? <ActivityIndicator size={16} color="#0B1E3D" /> : (
                <Text style={{ fontSize: 14, fontWeight: '800', color: chosen.size === 0 ? '#C7CEDA' : '#0B1E3D' }}>Add{chosen.size > 0 ? ' ' + chosen.size : ''}</Text>
              )}
            </TouchableOpacity>
          </View>
          <FlatList
            data={myStories}
            keyExtractor={(s: any) => s.id}
            numColumns={3}
            contentContainerStyle={{ padding: 10, gap: 6 }}
            columnWrapperStyle={{ gap: 6 }}
            renderItem={({ item }: any) => {
              const on = chosen.has(item.id);
              return (
                <TouchableOpacity
                  activeOpacity={0.85}
                  disabled={item._in}
                  onPress={() => setChosen(prev => { const n = new Set(prev); if (n.has(item.id)) n.delete(item.id); else n.add(item.id); return n; })}
                  style={{ width: (SW - 20 - 12) / 3, aspectRatio: 0.75, borderRadius: 8, overflow: 'hidden', backgroundColor: '#0B1E3D', opacity: item._in ? 0.35 : 1 }}
                >
                  {(item.thumbnail_url || item.media_url) ? (
                    <ExpoImage source={{ uri: item.thumbnail_url || item.media_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                  ) : null}
                  {item.media_type === 'video' ? (
                    <View style={st.vidBadge}><Feather name="video" size={10} color="#FFF" /></View>
                  ) : null}
                  {item._in ? (
                    <View style={st.inChip}><Text style={st.inChipTxt}>In album</Text></View>
                  ) : on ? (
                    <View style={st.checkWrap}><Feather name="check" size={13} color="#FFFFFF" /></View>
                  ) : null}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={<Text style={{ textAlign: 'center', marginTop: 50, fontSize: 13, color: '#5B6B84' }}>No stories yet. Post a story first.</Text>}
          />
        </SafeAreaView>
      </Modal>

      <Modal visible={settings} transparent animationType="fade" onRequestClose={() => setSettings(false)}>
        <View style={st.sheetWrap}>
          <View style={st.sheet}>
            <Text style={st.sheetTitle}>Album settings</Text>
            <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <TextInput value={title} onChangeText={setTitle} placeholder="Memories" placeholderTextColor="#9AA6B8" style={st.input} maxLength={40} />
            <Text style={st.lbl}>Cover</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {Object.keys(COVER_COLORS).map(k => (
                <TouchableOpacity key={k} onPress={() => setColor(k)}
                  style={{ width: 30, height: 38, borderRadius: 5, backgroundColor: COVER_COLORS[k].cover, borderWidth: color === k ? 2.5 : 1, borderColor: color === k ? '#0B1E3D' : 'rgba(11,30,61,0.15)' }} />
              ))}
            </View>
            <Text style={st.lbl}>Who can open it</Text>
            {AUDIENCES.map(a => (
              <TouchableOpacity key={a.key} onPress={() => setAud(a.key)} style={[st.audRow, aud === a.key && st.audRowOn]}>
                <Text style={[st.audTxt, aud === a.key && { fontWeight: '800' }]}>{a.label}</Text>
                {aud === a.key ? <Feather name="check" size={15} color="#0B1E3D" /> : null}
              </TouchableOpacity>
            ))}
            {aud === 'custom' ? <Text style={st.hint}>Choose the people on the web album page for now.</Text> : null}
            </ScrollView>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 18, marginTop: 14 }}>
              <TouchableOpacity onPress={() => setSettings(false)}><Text style={{ color: '#5B6B84', fontWeight: '700' }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={saveSettings}><Text style={{ color: '#0B1E3D', fontWeight: '800' }}>Save</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!captionFor} transparent animationType="fade" onRequestClose={() => setCaptionFor(null)}>
        <View style={st.sheetWrap}>
          <View style={st.sheet}>
            <Text style={st.sheetTitle}>Caption</Text>
            <TextInput value={captionText} onChangeText={setCaptionText} placeholder="Say something about this memory" placeholderTextColor="#9AA6B8" style={[st.input, { minHeight: 60, textAlignVertical: 'top' }]} multiline maxLength={140} />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 18, marginTop: 8 }}>
              <TouchableOpacity onPress={() => setCaptionFor(null)}><Text style={{ color: '#5B6B84', fontWeight: '700' }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={saveCaption}><Text style={{ color: '#0B1E3D', fontWeight: '800' }}>Save</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  topTitle: { fontSize: 15.5, fontWeight: '800', color: '#0B1E3D' },
  cover: { alignItems: 'center', paddingBottom: 18, borderBottomLeftRadius: 22, borderBottomRightRadius: 22 },
  topRow: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  coverTitle: { fontSize: 20, fontWeight: '800', marginTop: 6 },
  coverCount: { fontSize: 12, fontWeight: '600', marginTop: 3, opacity: 0.8 },
  polaroid: { backgroundColor: '#FFFFFF', borderRadius: 6, padding: 8, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,30,61,0.08)' },
  polCaption: { fontSize: 11.5, color: '#4a4438', marginTop: 7, minHeight: 15 },
  vidBadge: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 2.5 },
  fab: { position: 'absolute', bottom: 26, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#0B1E3D', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 12, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  fabTxt: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '800' },
  checkWrap: { position: 'absolute', top: 6, left: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: '#1D7A38', alignItems: 'center', justifyContent: 'center' },
  inChip: { position: 'absolute', bottom: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2 },
  inChipTxt: { color: '#FFF', fontSize: 9.5, fontWeight: '700' },
  sheetWrap: { flex: 1, backgroundColor: 'rgba(11,30,61,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26 },
  sheet: { alignSelf: 'stretch', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, maxHeight: '82%' },
  sheetTitle: { fontSize: 15.5, fontWeight: '800', color: '#0B1E3D', marginBottom: 10 },
  input: { borderWidth: 1, borderColor: '#E1E6EE', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: '#0B1E3D', marginBottom: 12 },
  lbl: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: '#5B6B84', marginBottom: 8, marginTop: 2 },
  audRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#E7EAF0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 7 },
  audRowOn: { borderColor: '#0B1E3D', backgroundColor: 'rgba(11,30,61,0.03)' },
  audTxt: { fontSize: 13, color: '#0B1E3D', flex: 1, marginRight: 8 },
  hint: { fontSize: 11.5, color: '#5B6B84', marginBottom: 4 },
});