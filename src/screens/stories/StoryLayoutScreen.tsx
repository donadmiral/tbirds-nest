/**
 * Layout: several photos in one story frame.
 *
 * The person picks a grid, taps a cell to fill it from the library, and the
 * finished frame is rendered to a single 1080x1920 image with view-shot, so
 * everything downstream (filters, stickers, the viewer, web) sees one plain
 * photo. No native rendering layer, no new dependency.
 */
import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, Dimensions, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import ViewShot, { captureRef } from 'react-native-view-shot';
import { Feather } from '@expo/vector-icons';
import { light } from '../../constants/tokens/light';

type Cell = { x: number; y: number; w: number; h: number };
type Grid = { key: string; label: string; cells: Cell[] };

// Cells are fractions of the 9:16 frame. Six grids cover what people
// actually use; freeform collage is a separate tool.
const GRIDS: Grid[] = [
  { key: '2v', label: '2 side by side', cells: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }] },
  { key: '2h', label: '2 stacked', cells: [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }] },
  { key: '3v', label: '3 stacked', cells: [{ x: 0, y: 0, w: 1, h: 1 / 3 }, { x: 0, y: 1 / 3, w: 1, h: 1 / 3 }, { x: 0, y: 2 / 3, w: 1, h: 1 / 3 }] },
  { key: '1+2', label: '1 over 2', cells: [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }] },
  { key: '4', label: '4 grid', cells: [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }] },
  { key: '6', label: '6 grid', cells: [0, 1, 2, 3, 4, 5].map((i) => ({ x: (i % 2) * 0.5, y: Math.floor(i / 2) / 3, w: 0.5, h: 1 / 3 })) },
];

const GAP = 6;
const FRAME_W = Math.min(Dimensions.get('window').width - 32, 360);
const FRAME_H = Math.round(FRAME_W * 16 / 9);

export default function StoryLayoutScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const shotRef = useRef<View | null>(null);
  const [grid, setGrid] = useState<Grid>(GRIDS[0]);
  const [uris, setUris] = useState<(string | null)[]>(Array(GRIDS[0].cells.length).fill(null));
  const [busy, setBusy] = useState(false);

  const chooseGrid = (g: Grid) => {
    setGrid(g);
    setUris((cur) => Array.from({ length: g.cells.length }, (_, i) => cur[i] ?? null));
  };

  const fill = async (i: number) => {
    const res = await ImagePicker.launchImageLibraryAsync({
      preferredAssetRepresentationMode: 'compatible' as ImagePicker.UIImagePickerPreferredAssetRepresentationMode,
      mediaTypes: ['images'] as ImagePicker.MediaType[],
      quality: 0.9,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const uri = res.assets[0].uri;
    setUris((cur) => cur.map((u, j) => (j === i ? uri : u)));
  };

  const done = async () => {
    if (uris.some((u) => !u)) { Alert.alert('Fill every cell', 'Tap each empty cell to add a photo.'); return; }
    setBusy(true);
    try {
      const uri = await captureRef(shotRef, { format: 'jpg', quality: 0.92, width: 1080, height: 1920 });
      navigation.replace('StoryComposer', { mode: 'image', assets: [{ localUri: uri, mediaType: 'image' as const, width: 1080, height: 1920 }] });
    } catch (e: any) {
      Alert.alert('Could not build the layout', e?.message || 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[s.root, { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={s.top}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} accessibilityLabel="Back"><Feather name="x" size={22} color="#FFFFFF" /></TouchableOpacity>
        <Text style={s.title}>Layout</Text>
        <TouchableOpacity onPress={done} disabled={busy} style={s.next} accessibilityLabel="Continue to the composer">
          {busy ? <ActivityIndicator color={light.brand.base} size={14} /> : <Text style={s.nextTxt}>Next</Text>}
        </TouchableOpacity>
      </View>

      <ViewShot ref={shotRef as any} style={[s.frame, { width: FRAME_W, height: FRAME_H }]} options={{ format: 'jpg', quality: 0.92 }}>
        {grid.cells.map((c, i) => {
          const left = c.x * FRAME_W + (c.x > 0 ? GAP / 2 : 0);
          const top = c.y * FRAME_H + (c.y > 0 ? GAP / 2 : 0);
          const width = c.w * FRAME_W - (c.x > 0 ? GAP / 2 : 0) - (c.x + c.w < 0.999 ? GAP / 2 : 0);
          const height = c.h * FRAME_H - (c.y > 0 ? GAP / 2 : 0) - (c.y + c.h < 0.999 ? GAP / 2 : 0);
          return (
            <TouchableOpacity key={i} activeOpacity={0.85} onPress={() => fill(i)} style={[s.cell, { left, top, width, height }]} accessibilityLabel={'Cell ' + (i + 1)}>
              {uris[i] ? <Image source={{ uri: uris[i]! }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <Feather name="plus" size={22} color="rgba(255,255,255,0.7)" />}
            </TouchableOpacity>
          );
        })}
      </ViewShot>

      <View style={s.grids}>
        {GRIDS.map((g) => {
          const on = g.key === grid.key;
          return (
            <TouchableOpacity key={g.key} onPress={() => chooseGrid(g)} style={[s.gridBtn, on && s.gridBtnOn]} accessibilityLabel={g.label}>
              <View style={s.mini}>
                {g.cells.map((c, i) => <View key={i} style={{ position: 'absolute', left: c.x * 28 + 1, top: c.y * 44 + 1, width: c.w * 28 - 2, height: c.h * 44 - 2, borderRadius: 2, backgroundColor: on ? light.brand.base : 'rgba(255,255,255,0.7)' }} />)}
              </View>
              <Text numberOfLines={1} style={[s.gridTxt, on && s.gridTxtOn]}>{g.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0B0D', alignItems: 'center' },
  top: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 },
  title: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  next: { backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, minWidth: 64, alignItems: 'center' },
  nextTxt: { color: light.brand.base, fontSize: 14, fontWeight: '700' },
  frame: { backgroundColor: '#000000', borderRadius: 18, overflow: 'hidden' },
  cell: { position: 'absolute', backgroundColor: '#1B2233', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  grids: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 14, paddingHorizontal: 12 },
  gridBtn: { alignItems: 'center', gap: 4, padding: 6, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', width: 76 },
  gridBtnOn: { backgroundColor: 'rgba(201,191,176,0.30)' },
  mini: { width: 28, height: 44, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.12)' },
  gridTxt: { color: 'rgba(255,255,255,0.6)', fontSize: 10.5 },
  gridTxtOn: { color: '#FFFFFF', fontWeight: '700' },
});
