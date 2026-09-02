/**
 * Layout: a slot-driven compositor, the way Instagram's Layout works.
 *
 *   Choose  → load a template (slot geometry as fractions of a 9:16 frame)
 *   Fill    → each slot from the camera or the library, one at a time or in bulk
 *   Fit     → cover-scale in the slot, then pan and pinch inside it
 *   Flatten → render the whole frame once to a single 1080x1920 image
 *   Publish → the story pipeline sees one plain photo (filters, stickers,
 *             viewer and web all unchanged)
 *
 * Source photos stay on the device while editing; only the flattened frame
 * moves on. No native rendering layer, no new dependency (react-native-view-shot
 * is already installed).
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, Dimensions, ActivityIndicator, Alert, ScrollView, PanResponder } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import ViewShot, { captureRef } from 'react-native-view-shot';
import { Feather } from '@expo/vector-icons';

type Slot = { x: number; y: number; w: number; h: number };
type Template = { key: string; label: string; slots: Slot[] };
type Fill = { uri: string; scale: number; tx: number; ty: number } | null;

// Slot geometry as fractions of the frame. Seams are drawn by the frame
// background showing through a SEAM-wide inset around every slot.
const TEMPLATES: Template[] = [
  { key: '2v', label: '2 up', slots: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }] },
  { key: '2h', label: 'Stacked', slots: [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }] },
  { key: '3h', label: '3 rows', slots: [0, 1, 2].map(i => ({ x: 0, y: i / 3, w: 1, h: 1 / 3 })) },
  { key: '3v', label: '3 columns', slots: [0, 1, 2].map(i => ({ x: i / 3, y: 0, w: 1 / 3, h: 1 })) },
  { key: '1+2', label: '1 over 2', slots: [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }] },
  { key: '2+1', label: '2 over 1', slots: [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }] },
  { key: '4', label: 'Grid', slots: [0, 1, 2, 3].map(i => ({ x: (i % 2) * 0.5, y: Math.floor(i / 2) * 0.5, w: 0.5, h: 0.5 })) },
  { key: '6', label: 'Six', slots: [0, 1, 2, 3, 4, 5].map(i => ({ x: (i % 2) * 0.5, y: Math.floor(i / 2) / 3, w: 0.5, h: 1 / 3 })) },
  { key: '4h', label: '4 rows', slots: [0, 1, 2, 3].map(i => ({ x: 0, y: i / 4, w: 1, h: 1 / 4 })) },
];

const SEAM = 3;            // white line between slots, in frame points
const MAX_SCALE = 3;
const WIN = Dimensions.get('window');

export default function StoryLayoutScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const shotRef = useRef<View | null>(null);
  const [tpl, setTpl] = useState<Template>(TEMPLATES[6]);
  const [fills, setFills] = useState<Fill[]>(Array(TEMPLATES[6].slots.length).fill(null));
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);

  // Frame: full width, 9:16, sized to what is left between the top bar and the
  // control deck so every control stays on screen on every phone.
  const topBarH = insets.top + 52;
  const deckH = 132 + Math.max(insets.bottom, 12);
  const availH = WIN.height - topBarH - deckH;
  const frameW = Math.min(WIN.width, Math.floor(availH * 9 / 16));
  const frameH = Math.floor(frameW * 16 / 9);

  const firstEmpty = useMemo(() => fills.findIndex(f => !f), [fills]);
  const complete = firstEmpty === -1;

  const chooseTemplate = (t: Template) => {
    // Photos keep their order across templates; extra photos are dropped only
    // if the person confirms.
    const drop = fills.filter((f, i) => f && i >= t.slots.length).length;
    const apply = () => {
      setTpl(t);
      setFills(cur => Array.from({ length: t.slots.length }, (_, i) => (cur[i] ? { ...cur[i]!, scale: 1, tx: 0, ty: 0 } : null)));
      setActive(0);
    };
    if (drop > 0) Alert.alert('Change layout?', drop === 1 ? 'One photo does not fit the new layout and will be removed.' : drop + ' photos do not fit the new layout and will be removed.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Change', onPress: apply }]);
    else apply();
  };

  const setSlot = useCallback((i: number, uri: string | null) => {
    setFills(cur => {
      const out = cur.map((f, j) => (j === i ? (uri ? { uri, scale: 1, tx: 0, ty: 0 } : null) : f));
      if (uri) {
        // Advance to the next empty slot, wrapping around, so Camera keeps filling.
        let next = out.findIndex((f, j) => j > i && !f);
        if (next === -1) next = out.findIndex(f => !f);
        setActive(next === -1 ? i : next);
      } else setActive(i);
      return out;
    });
  }, []);

  const fromCamera = useCallback(async (i: number) => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Camera off', 'Allow camera access to shoot into this slot.'); return; }
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] as any, quality: 0.92 });
      const a = res?.assets?.[0]; if (a?.uri) setSlot(i, a.uri);
    } catch {}
  }, [setSlot]);

  const fromLibrary = useCallback(async (i: number, bulk: boolean) => {
    try {
      const emptyIdx = fills.map((f, j) => (!f ? j : -1)).filter(j => j >= 0);
      const limit = bulk ? Math.max(1, emptyIdx.length) : 1;
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, quality: 0.92, allowsMultipleSelection: limit > 1, selectionLimit: limit, orderedSelection: true } as any);
      const assets = (res?.assets || []).filter(a => !!a?.uri);
      if (assets.length === 0) return;
      if (!bulk || assets.length === 1) { setSlot(i, assets[0].uri); return; }
      // Bulk: first photo fills the first empty slot, the second the next, and so on.
      setFills(cur => { const out = cur.slice(); let k = 0; for (let j = 0; j < out.length && k < assets.length; j++) { if (!out[j]) { out[j] = { uri: assets[k].uri, scale: 1, tx: 0, ty: 0 }; k++; } } return out; });
    } catch {}
  }, [fills, setSlot]);

  const slotMenu = useCallback((i: number) => {
    const has = !!fills[i];
    setActive(i);
    Alert.alert(has ? 'Photo ' + (i + 1) : 'Slot ' + (i + 1), undefined, [
      { text: 'Take a photo', onPress: () => fromCamera(i) },
      { text: has ? 'Replace from library' : 'Choose from library', onPress: () => fromLibrary(i, false) },
      ...(has ? [{ text: 'Remove photo', style: 'destructive' as const, onPress: () => setSlot(i, null) }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, [fills, fromCamera, fromLibrary, setSlot]);

  const done = async () => {
    if (!complete) { Alert.alert('Fill every slot', 'Tap an empty slot, or use Camera and Gallery below, until the layout is full.'); return; }
    setBusy(true);
    try {
      const uri = await captureRef(shotRef, { format: 'jpg', quality: 0.95, width: 1080, height: 1920 });
      navigation.replace('StoryComposer', { mode: 'image', assets: [{ localUri: uri, mediaType: 'image' as const, width: 1080, height: 1920 }] });
    } catch (e: any) {
      Alert.alert('Could not build the layout', e?.message || 'Try again.');
    } finally { setBusy(false); }
  };

  return (
    <View style={s.root}>
      {/* Top bar */}
      <View style={[s.top, { paddingTop: insets.top + 8, height: topBarH }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={s.roundBtn} accessibilityLabel="Close"><Feather name="x" size={20} color="#FFFFFF" /></TouchableOpacity>
        <Text style={s.title}>Layout</Text>
        <TouchableOpacity onPress={done} disabled={busy || !complete} style={[s.next, (!complete || busy) && { opacity: 0.45 }]} accessibilityLabel="Continue">
          {busy ? <ActivityIndicator color="#0B1E3D" size={14} /> : <><Text style={s.nextTxt}>Next</Text><Feather name="arrow-right" size={14} color="#0B1E3D" /></>}
        </TouchableOpacity>
      </View>

      {/* Frame */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ViewShot ref={shotRef as any} style={[s.frame, { width: frameW, height: frameH }]} options={{ format: 'jpg', quality: 0.95 }}>
          {tpl.slots.map((c, i) => {
            const left = Math.round(c.x * frameW) + (c.x > 0.001 ? SEAM / 2 : 0);
            const top = Math.round(c.y * frameH) + (c.y > 0.001 ? SEAM / 2 : 0);
            const width = Math.round(c.w * frameW) - (c.x > 0.001 ? SEAM / 2 : 0) - (c.x + c.w < 0.999 ? SEAM / 2 : 0);
            const height = Math.round(c.h * frameH) - (c.y > 0.001 ? SEAM / 2 : 0) - (c.y + c.h < 0.999 ? SEAM / 2 : 0);
            return (
              <SlotView key={tpl.key + '_' + i} index={i} left={left} top={top} width={width} height={height} fill={fills[i]} isActive={i === active}
                onTap={() => slotMenu(i)}
                onTransform={(scale, tx, ty) => s{Fills(cur => cur.map((f, j) => (j === i && f ? { ...f, scale, tx, ty } : f)))} />
            );
          })}
        </ViewShot>
      </View>

      {/* Control deck */}
      <View style={[s.deck, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={s.actions}>
          <TouchableOpacity onPress={() => fromCamera(firstEmpty === -1 ? active : firstEmpty)} style={s.actionBtn} activeOpacity={0.85} accessibilityLabel="Take a photo into the next slot">
            <Feather name="camera" size={17} color="#FFFFFF" /><Text style={s.actionTxt}>Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => fromLibrary(firstEmpty === -1 ? active : firstEmpty, true)} style={s.actionBtn} activeOpacity={0.85} accessibilityLabel="Choose photos from the library">
            <Feather name="image" size={17} color="#FFFFFF" /><Text style={s.actionTxt}>Gallery</Text>
          </TouchableOpacity>
          <Text style={s.count}>{fills.filter(Boolean).length}/{tpl.slots.length}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tplRow}>
          {TEMPLATES.map(t => {
            const on = t.key === tpl.key;
            return (
              <TouchableOpacity key={t.key} onPress={() => chooseTemplate(t)} style={[s.tplBtn, on && s.tplBtnOn]} activeOpacity={0.8} accessibilityLabel={t.label}>
                <View style={s.mini}>
                  {t.slots.map((c, i) => <View key={i} style={{ position: 'absolute', left: c.x * 30 + 1, top: c.y * 52 + 1, width: c.w * 30 - 2, height: c.h * 52 - 2, borderRadius: 1.5, backgroundColor: on ? '#0B1E3D' : 'rgba(255,255,255,0.75)' }} />)}
                </View>
                <Text numberOfLines={1} style={[s.tplTxt, on && s.tplTxtOn]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

/* One slot: cover-fitted image, pan and pinch inside the slot, bounded so no
 * empty area ever shows. Tap (no movement) opens the slot menu. */
function SlotView({ index, left, top, width, height, fill, isActive, onTap, onTransform }: {
  index: number; left: number; top: number; width: number; height: number; fill: Fill; isActive: boolean;
  onTap: () => void; onTransform: (scale: number, tx: number, ty: number) => void;
}) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const cur = useRef({ scale: fill?.scale || 1, tx: fill?.tx || 0, ty: fill?.ty || 0 });
  const start = useRef({ scale: 1, tx: 0, ty: 0, dist: 0 });
  const moved = useRef(false);
  const [, force] = useState(0);
  const lastUri = useRef<string | null>(fill?.uri || null);
  if ((fill?.uri || null) !== lastUri.current) {
    // A new photo landed in this slot: start it centred at cover scale.
    lastUri.current = fill?.uri || null;
    cur.current = { scale: fill?.scale || 1, tx: fill?.tx || 0, ty: fill?.ty || 0 };
  }

  // Cover size at scale 1: the image fills the slot on both axes.
  const base = useMemo(() => {
    if (!nat || !nat.w || !nat.h) return { w: width, h: height };
    const k = Math.max(width / nat.w, height / nat.h);
    return { w: nat.w * k, h: nat.h * k };
  }, [nat, width, height]);

  const clamp = (scale: number, tx: number, ty: number) => {
    const sc = Math.max(1, Math.min(MAX_SCALE, scale));
    const maxX = Math.max(0, (base.w * sc - width) / 2);
    const maxY = Math.max(0, (base.h * sc - height) / 2);
    return { scale: sc, tx: Math.max(-maxX, Math.min(maxX, tx)), ty: Math.max(-maxY, Math.min(maxY, ty)) };
  };

  const fillRef = useRef(fill); fillRef.current = fill;
  const onTapRef = useRef(onTap); onTapRef.current = onTap;
  const onTransformRef = useRef(onTransform); onTransformRef.current = onTransform;
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      moved.current = false;
      start.current = { ...cur.current, dist: 0 };
      const t = e.nativeEvent.touches;
      if (t && t.length >= 2) start.current.dist = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
    },
    onPanResponderMove: (e, g) => {
      const t = e.nativeEvent.touches;
      if (!fillRef.current) return;
      if (t && t.length >= 2) {
        const d = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
        if (!start.current.dist) { start.current.dist = d; start.current.scale = cur.current.scale; }
        const next = clamp(start.current.scale * (d / start.current.dist), start.current.tx + g.dx, start.current.ty + g.dy);
        cur.current = next; moved.current = true; force(x => x + 1);
        return;
      }
      if (Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3) {
        const next = clamp(start.current.scale, start.current.tx + g.dx, start.current.ty + g.dy);
        cur.current = next; moved.current = true; force(x => x + 1);
      }
    },
    onPanResponderRelease: () => {
      if (!moved.current) { onTapRef.current(); return; }
      onTransformRef.current(cur.current.scale, cur.current.tx, cur.current.ty);
    },
    onPanResponderTerminate: () => { if (moved.current) onTransformRef.current(cur.current.scale, cur.current.tx, cur.current.ty); },
  })).current;

  return (
    <View {...pan.panHandlers} style={[s.slot, { left, top, width, height }, isActive && !fill && s.slotActive]} accessibilityLabel={'Slot ' + (index + 1)}>
      {fill ? (
        <Image
          source={{ uri: fill.uri }}
          onLoad={(e: any) => { const src = e?.nativeEvent?.source; if (src?.width && src?.height) setNat({ w: src.width, h: src.height }); }}
          style={{ position: 'absolute', width: base.w, height: base.h, left: (width - base.w) / 2, top: (height - base.h) / 2, transform: [{ translateX: cur.current.tx }, { translateY: cur.current.ty }, { scale: cur.current.scale }] }}
          resizeMode="cover" />
      ) : (
        <View style={s.empty}>
          <View style={s.plus}><Feather name="plus" size={22} color="#FFFFFF" /></View>
          <Text style={s.emptyTxt}>{index + 1}</Text>
        </View>
      )}
      {fill && isActive ? <View pointerEvents="none" style={s.activeRing} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  roundBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  next: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9, minWidth: 82, justifyContent: 'center' },
  nextTxt: { color: '#0B1E3D', fontSize: 14, fontWeight: '800' },
  frame: { backgroundColor: '#FFFFFF', overflow: 'hidden' },
  slot: { position: 'absolute', backgroundColor: '#121418', overflow: 'hidden' },
  slotActive: { backgroundColor: '#1A1E26' },
  activeRing: { ...StyleSheet.absoluteFillObject, borderWidth: 2, borderColor: '#C9BFB0' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  plus: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  emptyTxt: { color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '700', marginTop: 8 },
  deck: { paddingTop: 10, backgroundColor: '#000000' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, marginBottom: 10 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  actionTxt: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '700' },
  count: { marginLeft: 'auto', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '700' },
  tplRow: { paddingHorizontal: 12, gap: 8 },
  tplBtn: { alignItems: 'center', gap: 5, padding: 6, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', width: 72 },
  tplBtnOn: { backgroundColor: '#C9BFB0' },
  mini: { width: 30, height: 52, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  tplTxt: { color: 'rgba(255,255,255,0.6)', fontSize: 10.5, fontWeight: '600' },
  tplTxtOn: { color: '#0B1E3D', fontWeight: '800' },
});
