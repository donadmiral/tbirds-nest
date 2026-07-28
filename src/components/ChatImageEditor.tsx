/**
 * ChatImageEditor — pre-send photo editor for chat.
 * Instagram model: the image pinch-zooms and pans under a fixed crop frame.
 * Aspect presets, rotate 90, mirror. Rotate/mirror apply real pixel ops
 * immediately (manipulateAsync) so the crop math stays rotation-free; Done
 * crops the actual pixels and returns the new file.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ActivityIndicator, Dimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { Image as ExpoImage } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';

const SW = Dimensions.get('window').width;
const SH = Dimensions.get('window').height;
const FRAME_W = SW - 32;

const ASPECTS: { id: string; label: string; ratio: number | null }[] = [
  { id: 'orig', label: 'Original', ratio: null },
  { id: '1:1', label: 'Square', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
];

type Img = { uri: string; width: number; height: number };

export default function ChatImageEditor({ visible, image, onCancel, onDone }: {
  visible: boolean;
  image: Img | null;
  onCancel: () => void;
  onDone: (out: { uri: string; width: number; height: number; base64: string | null }) => void;
}) {
  const [work, setWork] = useState<Img | null>(null);
  const [busy, setBusy] = useState(false);
  const [aspect, setAspect] = useState('orig');

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  useEffect(() => {
    if (visible && image) {
      setWork(image); setAspect('orig');
      scale.value = 1; savedScale.value = 1;
      tx.value = 0; ty.value = 0; savedTx.value = 0; savedTy.value = 0;
    }
  }, [visible, image]);

  const ratio = ASPECTS.find(a => a.id === aspect)?.ratio
    ?? (work ? work.width / work.height : 1);
  const frameH = Math.min(FRAME_W / ratio, SH * 0.55);
  const frameW = frameH * ratio > FRAME_W ? FRAME_W : frameH * ratio;
  const realFrameH = frameW / ratio;

  // base scale: image COVERS the frame at scale 1
  const baseScale = work ? Math.max(frameW / work.width, realFrameH / work.height) : 1;

  const clampJS = useCallback(() => {
    if (!work) return;
    const s = Math.max(1, Math.min(scale.value, 6));
    const dw = work.width * baseScale * s;
    const dh = work.height * baseScale * s;
    const maxX = Math.max(0, (dw - frameW) / 2);
    const maxY = Math.max(0, (dh - realFrameH) / 2);
    scale.value = s;
    tx.value = Math.max(-maxX, Math.min(maxX, tx.value));
    ty.value = Math.max(-maxY, Math.min(maxY, ty.value));
    savedScale.value = scale.value; savedTx.value = tx.value; savedTy.value = ty.value;
  }, [work, baseScale, frameW, realFrameH]);

  const pinch = Gesture.Pinch()
    .onUpdate(e => { scale.value = savedScale.value * e.scale; })
    .onEnd(() => { runOnJS(clampJS)(); });
  const pan = Gesture.Pan()
    .onUpdate(e => { tx.value = savedTx.value + e.translationX; ty.value = savedTy.value + e.translationY; })
    .onEnd(() => { runOnJS(clampJS)(); });
  const gestures = useMemo(() => Gesture.Simultaneous(pinch, pan), [work, baseScale, frameW, realFrameH]);

  const imgStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const applyOp = useCallback(async (op: any) => {
    if (!work || busy) return;
    setBusy(true);
    try {
      const res = await ImageManipulator.manipulateAsync(work.uri, [op], { compress: 1, format: ImageManipulator.SaveFormat.JPEG });
      setWork({ uri: res.uri, width: res.width, height: res.height });
      scale.value = 1; savedScale.value = 1; tx.value = 0; ty.value = 0; savedTx.value = 0; savedTy.value = 0;
    } catch {} finally { setBusy(false); }
  }, [work, busy]);

  const finish = useCallback(async () => {
    if (!work || busy) return;
    setBusy(true);
    try {
      const s = Math.max(1, Math.min(scale.value, 6));
      const eff = baseScale * s;
      const dw = work.width * eff;
      const dh = work.height * eff;
      let ox = (dw / 2 - frameW / 2 - tx.value) / eff;
      let oy = (dh / 2 - realFrameH / 2 - ty.value) / eff;
      let cw = frameW / eff;
      let ch = realFrameH / eff;
      ox = Math.max(0, Math.min(ox, work.width - 1));
      oy = Math.max(0, Math.min(oy, work.height - 1));
      cw = Math.max(16, Math.min(cw, work.width - ox));
      ch = Math.max(16, Math.min(ch, work.height - oy));
      const res = await ImageManipulator.manipulateAsync(
        work.uri,
        [{ crop: { originX: Math.round(ox), originY: Math.round(oy), width: Math.round(cw), height: Math.round(ch) } }],
        { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      onDone({ uri: res.uri, width: res.width, height: res.height, base64: res.base64 ?? null });
    } catch { onCancel(); } finally { setBusy(false); }
  }, [work, busy, baseScale, frameW, realFrameH, onDone, onCancel]);

  if (!visible || !work) return null;

  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onCancel}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={st.root}>
          <View style={st.topBar}>
            <TouchableOpacity onPress={onCancel} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name="x" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={st.title}>Edit photo</Text>
            <TouchableOpacity onPress={finish} disabled={busy} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              {busy ? <ActivityIndicator color="#FFF" size={18} /> : <Feather name="check" size={24} color="#C9BFB0" />}
            </TouchableOpacity>
          </View>

          <View style={st.stage}>
            <View style={[st.frame, { width: frameW, height: realFrameH }]}>
              <GestureDetector gesture={gestures}>
                <Animated.View style={[{ width: work.width * baseScale, height: work.height * baseScale }, imgStyle]}>
                  <ExpoImage source={{ uri: work.uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                </Animated.View>
              </GestureDetector>
              <View pointerEvents="none" style={st.gridV1} /><View pointerEvents="none" style={st.gridV2} />
              <View pointerEvents="none" style={st.gridH1} /><View pointerEvents="none" style={st.gridH2} />
            </View>
          </View>

          <View style={st.aspectRow}>
            {ASPECTS.map(a => (
              <TouchableOpacity key={a.id} style={[st.aspectChip, aspect === a.id && st.aspectOn]} onPress={() => setAspect(a.id)}>
                <Text style={[st.aspectTxt, aspect === a.id && { color: '#0B1E3D' }]}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={st.toolRow}>
            <TouchableOpacity style={st.tool} onPress={() => applyOp({ rotate: 90 })}>
              <Feather name="rotate-cw" size={21} color="#FFFFFF" />
              <Text style={st.toolTxt}>Rotate</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.tool} onPress={() => applyOp({ flip: ImageManipulator.FlipType.Horizontal })}>
              <Feather name="repeat" size={21} color="#FFFFFF" />
              <Text style={st.toolTxt}>Mirror</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.tool} onPress={() => { scale.value = 1; savedScale.value = 1; tx.value = 0; ty.value = 0; savedTx.value = 0; savedTy.value = 0; }}>
              <Feather name="maximize" size={21} color="#FFFFFF" />
              <Text style={st.toolTxt}>Reset</Text>
            </TouchableOpacity>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0E14' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 54, paddingBottom: 10 },
  title: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: { overflow: 'hidden', borderRadius: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  gridV1: { position: 'absolute', left: '33.3%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.35)' },
  gridV2: { position: 'absolute', left: '66.6%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.35)' },
  gridH1: { position: 'absolute', top: '33.3%', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.35)' },
  gridH2: { position: 'absolute', top: '66.6%', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.35)' },
  aspectRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  aspectChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' },
  aspectOn: { backgroundColor: '#C9BFB0' },
  aspectTxt: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '700' },
  toolRow: { flexDirection: 'row', justifyContent: 'center', gap: 34, paddingBottom: 40 },
  tool: { alignItems: 'center', gap: 5 },
  toolTxt: { color: 'rgba(255,255,255,0.7)', fontSize: 11.5, fontWeight: '600' },
});