/**
 * StudioSheet - the bottom sheet of the Bottom Sheet Studio layout.
 * Tabs: Stickers (featured + everything), Collections (grouped by intent),
 * Favorites (long-press a tile to star it) and Recents. Search filters all.
 * Tiles are supplied by the composer and run its handlers; the sheet owns
 * only favorites and recents, persisted locally.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, TextInput, StyleSheet, Keyboard, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import StickerIcon from './StickerIcons';

export type StudioTile = { id: string; cat: string; tint: string; icon: string; label: string; on: boolean; run: () => void };
type Tab = 'stickers' | 'collections' | 'favorites' | 'recents';

let AsyncStorage: any = null;
try { AsyncStorage = require('@react-native-async-storage/async-storage').default; } catch {}
const KEY_FAV = 'studio.favorites.v1';
const KEY_REC = 'studio.recents.v1';
const FEATURED = ['entity', 'poll', 'question', 'quiz', 'link', 'location', 'music', 'gif'];
const SECTIONS: { key: string; title: string }[] = [
  { key: 'interactive', title: 'Interactive' }, { key: 'sharing', title: 'Social' }, { key: 'media', title: 'Media' }, { key: 'fun', title: 'Information and fun' },
];

export default function StudioSheet({ visible, onClose, tiles, extra, bottomInset }: { visible: boolean; onClose: () => void; tiles: StudioTile[]; extra?: React.ReactNode; bottomInset: number }) {
  const [tab, setTab] = useState<Tab>('stickers');
  const [q, setQ] = useState('');
  // The sheet is a plain modal at the bottom of the screen, so the keyboard
  // covers it. Track the keyboard height and lift the sheet by that much.
  const [kb, setKb] = useState(0);
  useEffect(() => {
    const showEv = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEv = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(showEv, (e: any) => setKb(e?.endCoordinates?.height || 0));
    const b = Keyboard.addListener(hideEv, () => setKb(0));
    return () => { a.remove(); b.remove(); };
  }, []);
  const [favs, setFavs] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  useEffect(() => {
    if (!AsyncStorage) return;
    AsyncStorage.getItem(KEY_FAV).then((v: string | null) => { try { if (v) setFavs(JSON.parse(v)); } catch {} }).catch(() => {});
    AsyncStorage.getItem(KEY_REC).then((v: string | null) => { try { if (v) setRecents(JSON.parse(v)); } catch {} }).catch(() => {});
  }, []);
  const byId = useMemo(() => { const m: Record<string, StudioTile> = {}; for (const t of tiles) m[t.id] = t; return m; }, [tiles]);
  const pick = (t: StudioTile) => {
    const next = [t.id, ...recents.filter(x => x !== t.id)].slice(0, 8);
    setRecents(next); try { AsyncStorage?.setItem(KEY_REC, JSON.stringify(next)); } catch {}
    onClose(); setTimeout(() => t.run(), 220);
  };
  const toggleFav = (t: StudioTile) => {
    const next = favs.includes(t.id) ? favs.filter(x => x !== t.id) : [...favs, t.id];
    setFavs(next); try { AsyncStorage?.setItem(KEY_FAV, JSON.stringify(next)); } catch {}
  };
  const query = q.trim().toLowerCase();
  const matches = (t: StudioTile) => !query || t.label.toLowerCase().includes(query) || t.id.includes(query);
  const Tile = ({ t }: { t: StudioTile }) => (
    <TouchableOpacity style={ss.tile} activeOpacity={0.75} onPress={() => pick(t)} onLongPress={() => toggleFav(t)} delayLongPress={350}>
      <View style={[ss.tileIcon, t.on && { borderWidth: 1.5, borderColor: t.tint }]}>
        <StickerIcon name={t.id as any} size={22} color={t.tint} bg="transparent" />
        {favs.includes(t.id) && <View style={ss.star}><Feather name="star" size={9} color="#0B1E3D" /></View>}
      </View>
      <Text style={ss.tileLabel} numberOfLines={1}>{t.label}</Text>
    </TouchableOpacity>
  );
  const Grid = ({ list }: { list: StudioTile[] }) => (
    <View style={ss.grid}>{list.map(t => <Tile key={t.id} t={t} />)}</View>
  );
  const featured = FEATURED.map(id => byId[id]).filter(Boolean).filter(matches);
  const rest = tiles.filter(t => !FEATURED.includes(t.id)).filter(matches);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={ss.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={[ss.sheet, { paddingBottom: kb > 0 ? kb + 12 : Math.max(bottomInset, 16) }]}>
            <View style={ss.handle} />
            <View style={ss.tabs}>
              {([['stickers', 'Stickers'], ['collections', 'Collections'], ['favorites', 'Favorites'], ['recents', 'Recents']] as [Tab, string][]).map(([k, lb]) => (
                <TouchableOpacity key={k} onPress={() => setTab(k)} style={[ss.tab, tab === k && ss.tabOn]} activeOpacity={0.8}>
                  <Text style={[ss.tabTxt, tab === k && ss.tabTxtOn]}>{lb}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={ss.searchRow}>
              <View style={ss.search}>
                <Feather name="search" size={15} color="rgba(255,255,255,0.45)" />
                <TextInput value={q} onChangeText={setQ} placeholder="Search stickers" placeholderTextColor="rgba(255,255,255,0.5)" style={ss.searchInput} keyboardAppearance="dark" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => Keyboard.dismiss()} />
              </View>
            </View>
            <ScrollView style={{ maxHeight: kb > 0 ? 240 : 380 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {tab === 'stickers' && (
                <>
                  {featured.length > 0 && <Text style={ss.section}>Featured</Text>}
                  <Grid list={featured} />
                  {rest.length > 0 && <Text style={ss.section}>Everything</Text>}
                  <Grid list={rest} />
                </>
              )}
              {tab === 'collections' && SECTIONS.map(sec => { const list = tiles.filter(t => t.cat === sec.key).filter(matches); if (!list.length) return null; return (<View key={sec.key}><Text style={ss.section}>{sec.title}</Text><Grid list={list} /></View>); })}
              {tab === 'favorites' && (favs.length ? <Grid list={favs.map(id => byId[id]).filter(Boolean).filter(matches)} /> : <Text style={ss.empty}>Long-press any sticker to add it here.</Text>)}
              {tab === 'recents' && (recents.length ? <Grid list={recents.map(id => byId[id]).filter(Boolean).filter(matches)} /> : <Text style={ss.empty}>Stickers you use show up here.</Text>)}
              {extra}
              <View style={{ height: 8 }} />
            </ScrollView>
            <View style={ss.iconRow}>
              <TouchableOpacity onPress={() => setTab('recents')} style={ss.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="clock" size={20} color={tab === 'recents' ? '#C9BFB0' : 'rgba(255,255,255,0.75)'} /></TouchableOpacity>
              <TouchableOpacity onPress={() => setTab('favorites')} style={ss.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="star" size={20} color={tab === 'favorites' ? '#C9BFB0' : 'rgba(255,255,255,0.75)'} /></TouchableOpacity>
              {byId.emoji && <TouchableOpacity onPress={() => pick(byId.emoji)} style={ss.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="smile" size={20} color="rgba(255,255,255,0.75)" /></TouchableOpacity>}
              {byId.gif && <TouchableOpacity onPress={() => pick(byId.gif)} style={ss.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><StickerIcon name={'gif' as any} size={22} color="rgba(255,255,255,0.75)" bg="transparent" /></TouchableOpacity>}
              {byId.photo && <TouchableOpacity onPress={() => pick(byId.photo)} style={ss.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="image" size={20} color="rgba(255,255,255,0.75)" /></TouchableOpacity>}
            </View>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const ss = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: 'rgba(13,20,38,0.98)', borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingTop: 8, paddingHorizontal: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  handle: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.24)', marginBottom: 12 },
  tabs: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  tab: { flex: 1, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  tabOn: { backgroundColor: '#C9BFB0' },
  tabTxt: { color: 'rgba(255,255,255,0.8)', fontSize: 12.5, fontWeight: '700' },
  tabTxtOn: { color: '#0B1E3D' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, borderRadius: 12, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.08)' },
  searchInput: { flex: 1, height: 40, color: '#FFF', fontSize: 14, paddingVertical: 0, includeFontPadding: false, textAlignVertical: 'center' },
  section: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 8, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 6 },
  tile: { width: '22.5%', alignItems: 'center', paddingVertical: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)' },
  tileIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 6 },
  star: { position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: '#C9BFB0', alignItems: 'center', justifyContent: 'center' },
  tileLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 11.5, fontWeight: '600' },
  empty: { color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', marginVertical: 24 },
  iconRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingTop: 10, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  iconBtn: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
});
