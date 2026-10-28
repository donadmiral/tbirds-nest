/**
 * StudioSheet - the bottom sheet of the Bottom Sheet Studio layout.
 * Tabs: Stickers (featured + everything), Collections (grouped by intent),
 * Favorites (long-press a tile to star it) and Recents. Search filters all.
 * Tiles are supplied by the composer and run its handlers; the sheet owns
 * only favorites and recents, persisted locally.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, TextInput, StyleSheet, Keyboard, Platform, Pressable, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import StickerIcon from './StickerIcons';
import StickerGalleryPreview from './StickerGalleryPreview';

export type StudioTile = { id: string; cat: string; tint: string; icon: string; label: string; on: boolean; run: () => void };
type Tab = 'stickers' | 'collections' | 'favorites' | 'recents';

let AsyncStorage: any = null;
try { AsyncStorage = require('@react-native-async-storage/async-storage').default; } catch {}
const KEY_FAV = 'studio.favorites.v1';
const KEY_REC = 'studio.recents.v1';
const FEATURED = ['location', 'mention', 'poll', 'question', 'link', 'slider', 'countdown', 'addyours'];
const SECTIONS: { key: string; title: string }[] = [
  { key: 'interactive', title: 'Interactive' }, { key: 'sharing', title: 'Social' }, { key: 'media', title: 'Media' }, { key: 'fun', title: 'Information and fun' },
];

export function parseStudioIds(value: string | null): string[] {
  try {
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, 64) : [];
  } catch { return []; }
}

export function studioSheetHeight(windowHeight: number, keyboardHeight: number, ios: boolean): number {
  // Android resizes the window for its keyboard; iOS overlays it.
  return Math.max(1, windowHeight - (ios ? Math.max(0, keyboardHeight) : 0) - 48);
}

export default function StudioSheet({ visible, onClose, tiles, extra, bottomInset }: { visible: boolean; onClose: () => void; tiles: StudioTile[]; extra?: React.ReactNode; bottomInset: number }) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const pickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPick = useRef<StudioTile | null>(null);
  useEffect(() => () => { if (pickTimer.current) clearTimeout(pickTimer.current); pendingPick.current = null; }, []);
  const runPendingPick = () => {
    if (pickTimer.current) clearTimeout(pickTimer.current);
    pickTimer.current = null;
    const tile = pendingPick.current; pendingPick.current = null;
    tile?.run();
  };
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
    AsyncStorage.getItem(KEY_FAV).then((v: string | null) => { try { setFavs(parseStudioIds(v)); } catch {} }).catch(() => {});
    AsyncStorage.getItem(KEY_REC).then((v: string | null) => { try { setRecents(parseStudioIds(v)); } catch {} }).catch(() => {});
  }, []);
  const byId = useMemo(() => { const m: Record<string, StudioTile> = {}; for (const t of tiles) m[t.id] = t; return m; }, [tiles]);
  const pick = (t: StudioTile) => {
    const next = [t.id, ...recents.filter(x => x !== t.id)].slice(0, 8);
    setRecents(next); try { AsyncStorage?.setItem(KEY_REC, JSON.stringify(next))?.catch(() => {}); } catch {}
    pendingPick.current = t;
    Keyboard.dismiss(); onClose();
    if (pickTimer.current) clearTimeout(pickTimer.current);
    // iOS cannot present the next editor while this modal is dismissing.
    // Its native onDismiss signal is the reliable handoff point.
    if (Platform.OS !== 'ios') pickTimer.current = setTimeout(runPendingPick, 350);
  };
  const toggleFav = (t: StudioTile) => {
    const next = favs.includes(t.id) ? favs.filter(x => x !== t.id) : [...favs, t.id];
    setFavs(next); try { AsyncStorage?.setItem(KEY_FAV, JSON.stringify(next))?.catch(() => {}); } catch {}
  };
  const query = q.trim().toLowerCase();
  const matches = (t: StudioTile) => !query || t.label.toLowerCase().includes(query) || t.id.includes(query);
  const renderTile = (t: StudioTile) => (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={t.label} accessibilityHint="Double tap to add. Long press to change favorites." accessibilityState={{ selected: t.on }} key={t.id} style={[ss.tile, { width: Math.max(44, (Math.min(windowWidth, 560) - 46) / 2) }]} activeOpacity={0.75} onPress={() => pick(t)} onLongPress={() => toggleFav(t)} delayLongPress={350}>
      <View style={ss.tilePreview}><StickerGalleryPreview id={t.id} label={t.label} /></View>
      <View style={ss.tileCaption}><Text style={ss.tileLabel} numberOfLines={1}>{t.label}</Text>{favs.includes(t.id) ? <Feather name="star" size={12} color="#E8D3B6" /> : null}{t.on ? <Feather name="check-circle" size={12} color="#C4CFB5" /> : null}</View>
    </TouchableOpacity>
  );
  const renderGrid = (list: StudioTile[]) => <View style={ss.grid}>{list.map(renderTile)}</View>;
  const featured = FEATURED.map(id => byId[id]).filter(Boolean).filter(matches);
  const rest = tiles.filter(t => !FEATURED.includes(t.id)).filter(matches);
  const availableHeight = studioSheetHeight(windowHeight, kb, Platform.OS === 'ios');
  const hasMatches = tiles.some(matches);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={runPendingPick}>
      <View style={ss.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close sticker studio" style={StyleSheet.absoluteFill} onPress={onClose} />
          <View accessibilityViewIsModal style={[ss.sheet, { maxHeight: availableHeight, marginBottom: Platform.OS === 'ios' ? kb : 0, paddingBottom: kb > 0 ? 12 : Math.max(bottomInset, 16) }]}>
            <View style={ss.handle} /><View style={ss.sheetHeader}>
              <Text style={ss.title}>Stickers</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close sticker studio" onPress={onClose} style={ss.closeButton}><Feather name="x" size={20} color="#FFFFFF" /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: windowHeight * 0.7, flexShrink: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            <View style={ss.searchRow}>
              <View style={ss.search}>
                <Feather name="search" size={15} color="rgba(255,255,255,0.45)" />
                <TextInput accessibilityLabel="Search stickers" value={q} onChangeText={setQ} placeholder="Search stickers" placeholderTextColor="rgba(255,255,255,0.5)" style={ss.searchInput} keyboardAppearance="dark" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => Keyboard.dismiss()} />
              </View>
            </View>
            <View style={ss.tabs}>
              {([['stickers', 'For you'], ['favorites', 'Saved'], ['recents', 'Recent']] as [Tab, string][]).map(([k, lb]) => (
                <TouchableOpacity accessibilityRole="tab" accessibilityLabel={lb} accessibilityState={{ selected: tab === k }} key={k} onPress={() => setTab(k)} style={[ss.tab, tab === k && ss.tabOn]} activeOpacity={0.8}>
                  <Text style={[ss.tabTxt, tab === k && ss.tabTxtOn]}>{lb}</Text>
                </TouchableOpacity>
              ))}
            </View>
              {query && !hasMatches ? <Text accessibilityLiveRegion="polite" style={ss.empty}>No stickers found. Try another name.</Text> : null}
              {tab === 'stickers' && (
                <>
                  {featured.length > 0 && <Text style={ss.section}>Interactive</Text>}
                  {renderGrid(featured)}
                  {rest.length > 0 && <Text style={ss.section}>Create more</Text>}
                  {renderGrid(rest)}
                </>
              )}
              {tab === 'collections' && SECTIONS.map(sec => { const list = tiles.filter(t => t.cat === sec.key).filter(matches); if (!list.length) return null; return (<View key={sec.key}><Text style={ss.section}>{sec.title}</Text>{renderGrid(list)}</View>); })}
              {tab === 'favorites' && (favs.length ? renderGrid(favs.map(id => byId[id]).filter(Boolean).filter(matches)) : <Text style={ss.empty}>Long-press any sticker to add it here.</Text>)}
              {tab === 'recents' && (recents.length ? renderGrid(recents.map(id => byId[id]).filter(Boolean).filter(matches)) : <Text style={ss.empty}>Stickers you use show up here.</Text>)}
              {extra}
              <View style={{ height: 8 }} />
            <View style={ss.iconRow}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Recent stickers" onPress={() => setTab('recents')} style={ss.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="clock" size={20} color={tab === 'recents' ? '#C9BFB0' : 'rgba(255,255,255,0.75)'} /></TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Favorite stickers" onPress={() => setTab('favorites')} style={ss.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="star" size={20} color={tab === 'favorites' ? '#C9BFB0' : 'rgba(255,255,255,0.75)'} /></TouchableOpacity>
              {byId.emoji && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add emoji" onPress={() => pick(byId.emoji)} style={ss.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="smile" size={20} color="rgba(255,255,255,0.75)" /></TouchableOpacity>}
              {byId.gif && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add GIF" onPress={() => pick(byId.gif)} style={ss.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><StickerIcon name={'gif' as any} size={22} color="rgba(255,255,255,0.75)" bg="transparent" /></TouchableOpacity>}
              {byId.photo && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add photo" onPress={() => pick(byId.photo)} style={ss.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="image" size={20} color="rgba(255,255,255,0.75)" /></TouchableOpacity>}
            </View>
            </ScrollView>
          </View>
      </View>
    </Modal>
  );
}

const ss = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { width: '100%', maxWidth: 560, alignSelf: 'center', backgroundColor: '#191C1F', borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingTop: 10, paddingHorizontal: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, marginBottom: 6 },
  title: { color: '#FFFFFF', fontSize: 23, fontWeight: '800' },
  closeButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  handle: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.24)', marginBottom: 12 },
  tabs: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  tab: { flex: 1, minHeight: 44, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  tabOn: { backgroundColor: '#E8D3B6' },
  tabTxt: { color: 'rgba(255,255,255,0.8)', fontSize: 12.5, fontWeight: '700' },
  tabTxtOn: { color: '#0B1E3D' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, borderRadius: 15, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.08)' },
  searchInput: { flex: 1, height: 46, color: '#FFF', fontSize: 14, paddingVertical: 0, includeFontPadding: false, textAlignVertical: 'center' },
  section: { color: '#B8BEC5', fontSize: 14, fontWeight: '600', marginTop: 14, marginBottom: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 10 },
  tile: { alignItems: 'center', justifyContent: 'center', minHeight: 116, paddingVertical: 4, borderRadius: 18 },
  tilePreview: { width: '100%', flex: 1, alignItems: 'center', justifyContent: 'center' },
  tileCaption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 24, marginTop: 4 },
  tileIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 6 },
  star: { position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: '#E8D3B6', alignItems: 'center', justifyContent: 'center' },
  tileLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 11.5, fontWeight: '600' },
  empty: { color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', marginVertical: 24 },
  iconRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingTop: 10, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
