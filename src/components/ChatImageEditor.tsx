/**
 * ChatImageEditor — pre-send photo editor for chat.
 * Step 1, crop: the image pinch-zooms and pans under a fixed crop frame.
 * Aspect presets, rotate 90, mirror. Rotate/mirror apply real pixel ops
 * immediately (manipulateAsync) so the crop math stays rotation-free.
 * Step 2, decorate: freehand drawing, draggable text and a caption on the
 * cropped result; Send bakes everything into real pixels via view-shot.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ActivityIndicator, Dimensions, PanResponder, KeyboardAvoidingView, Platform } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { Image as ExpoImage } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import Svg, { Polyline } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';

const SW = Dimensions.get('window').width;
const SH = Dimensions.get('window').height;
const FRAME_W = SW - 32;

const ASPECTS: { id: string; label: string; ratio: number | null }[] = [
  { id: 'orig', label: 'Original', ratio: null },
  { id: '1:1', label: 'Square', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
];

const PALETTE = ['#FFFFFF', '#0B1E3D', '#C9BFB0', '#FF3B30', '#1D7A38', '#F5B301'];

type Img = { uri: string; width: number; height: number };
type Stroke = { color: string; points: string };
type Overlay = { id: string; txt: string; color: string; x: number; y: number };

export default function ChatImageEditor({ visible, image, onCancel, onDone }: {
  visible: boolean;
  image: Img | null;
  onCancel: () => void;
  onDone: (out: { uri: string; width: number; height: number; base64: string | null; caption?: string }) => void;
}) {
  const [work, setWork] = useState<Img | null>(null);
  const [busy, setBusy] = useState(false);
  const [aspect, setAspect] = useState('orig');
  const [step, setStep] = useState<'crop' | 'decorate'>('crop');

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [liveStroke, setLiveStroke] = useState<Stroke | null>(null);
  const [texts, setTexts] = useState<Overlay[]>([]);
  const [color, setColor] = useState('#FFFFFF');
  const [drawOn, setDrawOn] = useState(false);
  const [caption, setCaption] = useState('');
  const [askText, setAskText] = useState(false);
  const [draft, setDraft] = useState('');
  const shotRef = useRef<View>(null);
  const liveRef = useRef<{ color: string; pts: { x: number; y: number }[] } | null>(null);
  const colorRef = useRef(color);
  useEffect(() => { colorRef.current = color; }, [color]);
  const dragRef = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    if (visible && image) {
      setWork(image); setAspect('orig'); setStep('crop');
      setStrokes([]); setLiveStroke(null); setTexts([]); setColor('#FFFFFF');
      setDrawOn(false); setCaption(''); setAskText(false); setDraft('');
      scale.value = 1; savedScale.value = 1;
      tx.value = 0; ty.value = 0; savedTx.value = 0; savedTy.value = 0;
    }
  }, [visible, image]);

  const ratio = ASPECTS.find(a => a.id === aspect)?.ratio
    ?? (work ? work.width / work.height : 1);
  const frameH = Math.min(FRAME_W / ratio, SH * 0.55);
  const frameW = frameH * ratio > FRAME_W ? FRAME_W : frameH * ratio;
  const realFrameH = frameW / ratio;

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

  const decoW = useMemo(() => {
    if (!work) return SW - 24;
    const maxW = SW - 24, maxH = SH * 0.6;
    const r = work.width / work.height;
    const w = Math.min(maxW, maxH * r);
    return w;
  }, [work]);
  const decoH = work ? decoW / (work.width / work.height) : 0;

  const drawResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const { locationX, locationY } = e.nativeEvent;
      liveRef.current = { color: colorRef.current, pts: [{ x: locationX, y: locationY }] };
      setLiveStroke({ color: colorRef.current, points: `${locationX},${locationY}` });
    },
    onPanResponderMove: (e) => {
      if (!liveRef.current) return;
      const { locationX, locationY } = e.nativeEvent;
      liveRef.current.pts.push({ x: locationX, y: locationY });
      setLiveStroke({ color: liveRef.current.color, points: liveRef.current.pts.map(p => `${p.x},${p.y}`).join(' ') });
    },
    onPanResponderRelease: () => {
      const l = liveRef.current;
      liveRef.current = null;
      setLiveStroke(null);
      if (l && l.pts.length > 1) {
        setStrokes(prev => [...prev, { color: l.color, points: l.pts.map(p => `${p.x},${p.y}`).join(' ') }]);
      }
    },
    onPanResponderTerminate: () => { liveRef.current = null; setLiveStroke(null); },
  }), []);

  const textResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 3,
    onPanResponderGrant: () => {},
    onPanResponderMove: (_e, g) => {
      const d = dragRef.current;
      if (!d) return;
      setTexts(prev => prev.map(t => t.id === d.id ? { ...t, x: d.ox + g.dx, y: d.oy + g.dy } : t));
    },
    onPanResponderRelease: () => { dragRef.current = null; },
    onPanResponderTerminate: () => { dragRef.current = null; },
  }), []);

  const finish = useCallback(async () => {
    if (!work || busy) return;
    if (step === 'crop') {
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
        setWork({ uri: res.uri, width: res.width, height: res.height });
        setStep('decorate');
      } catch { onCancel(); } finally { setBusy(false); }
      return;
    }
    setBusy(true);
    try {
      if (strokes.length === 0 && texts.length === 0) {
        onDone({ uri: work.uri, width: work.width, height: work.height, base64: null, caption: caption.trim() });
        return;
      }
      const uri = await captureRef(shotRef, {
        format: 'jpg', quality: 0.92, result: 'tmpfile',
        width: work.width, height: work.height,
      });
      onDone({ uri, width: work.width, height: work.height, base64: null, caption: caption.trim() });
    } catch { onCancel(); } finally { setBusy(false); }
  }, [work, busy, step, baseScale, frameW, realFrameH, strokes, texts, caption, onDone, onCancel]);

  if (!visible || !work) return null;

  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onCancel}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={st.root}>
          <View style={st.topBar}>
            <TouchableOpacity onPress={step === 'crop' ? onCancel : () => setStep('crop')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name={step === 'crop' ? 'x' : 'chevron-left'} size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={st.title}>{step === 'crop' ? 'Edit photo' : 'Decorate'}</Text>
            <TouchableOpacity onPress={finish} disabled={busy} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              {busy ? <ActivityIndicator color="#FFF" size={18} /> : <Feather name={step === 'crop' ? 'check' : 'send'} size={23} color="#C9BFB0" />}
            </TouchableOpacity>
          </View>

          {step === 'crop' ? (
            <>
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
            </>
          ) : (
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <View style={st.stage}>
                <View ref={shotRef} collapsable={false} style={{ width: decoW, height: decoH, backgroundColor: '#000' }}>
                  <ExpoImage source={{ uri: work.uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                  <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={decoW} height={decoH}>
                    {strokes.map((sk, i) => (
                      <Polyline key={i} points={sk.points} fill="none" stroke={sk.color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
                    ))}
                    {liveStroke ? (
                      <Polyline points={liveStroke.points} fill="none" stroke={liveStroke.color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
                    ) : null}
                  </Svg>
                  {texts.map(t => (
                    <View
                      key={t.id}
                      {...textResponder.panHandlers}
                      onStartShouldSetResponder={() => true}
                      onResponderGrant={() => { dragRef.current = { id: t.id, sx: 0, sy: 0, ox: t.x, oy: t.y }; }}
                      style={{ position: 'absolute', left: t.x, top: t.y, maxWidth: decoW - 20 }}
                    >
                      <Text
                        onLongPress={() => setTexts(prev => prev.filter(x => x.id !== t.id))}
                        style={{ color: t.color, fontSize: 26, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } }}
                      >
                        {t.txt}
                      </Text>
                    </View>
                  ))}
                  {drawOn ? (
                    <View style={StyleSheet.absoluteFill} {...drawResponder.panHandlers} />
                  ) : null}
                </View>
              </View>

              <TextInput
                value={caption}
                onChangeText={setCaption}
                placeholder="Add a caption"
                placeholderTextColor="rgba(255,255,255,0.45)"
                style={st.caption}
                maxLength={500}
              />

              <View style={st.paletteRow}>
                {PALETTE.map(c => (
                  <TouchableOpacity key={c} onPress={() => setColor(c)} style={[st.dot, { backgroundColor: c }, color === c && st.dotOn]} />
                ))}
              </View>

              <View style={st.toolRow}>
                <TouchableOpacity style={st.tool} onPress={() => setDrawOn(v => !v)}>
                  <Feather name="edit-3" size={21} color={drawOn ? '#C9BFB0' : '#FFFFFF'} />
                  <Text style={[st.toolTxt, drawOn && { color: '#C9BFB0' }]}>Draw</Text>
                </TouchableOpacity>
                <TouchableOpacity style={st.tool} onPress={() => { setDraft(''); setAskText(true); }}>
                  <Feather name="type" size={21} color="#FFFFFF" />
                  <Text style={st.toolTxt}>Text</Text>
                </TouchableOpacity>
                <TouchableOpacity style={st.tool} onPress={() => setStrokes(prev => prev.slice(0, -1))}>
                  <Feather name="corner-up-left" size={21} color="#FFFFFF" />
                  <Text style={st.toolTxt}>Undo</Text>
                </TouchableOpacity>
              </View>

              {askText ? (
                <Modal transparent animationType="fade" visible onRequestClose={() => setAskText(false)}>
                  <View style={st.promptWrap}>
                    <View style={st.promptCard}>
                      <TextInput
                        value={draft}
                        onChangeText={setDraft}
                        autoFocus
                        placeholder="Say something"
                        placeholderTextColor="#9AA6B8"
                        style={st.promptInput}
                        maxLength={80}
                      />
                      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 12 }}>
                        <TouchableOpacity onPress={() => setAskText(false)}><Text style={{ color: '#5B6B84', fontWeight: '700' }}>Cancel</Text></TouchableOpacity>
                        <TouchableOpacity onPress={() => {
                          const v = draft.trim();
                          if (v) setTexts(prev => [...prev, { id: `${Date.now()}`, txt: v, color: colorRef.current, x: decoW * 0.18, y: decoH * 0.42 }]);
                          setAskText(false);
                        }}><Text style={{ color: '#0B1E3D', fontWeight: '800' }}>Add</Text></TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </Modal>
              ) : null}
            </KeyboardAvoidingView>
          )}
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
  caption: { marginHorizontal: 16, marginBottom: 10, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: '#FFFFFF', fontSize: 14 },
  paletteRow: { flexDirection: 'row', justifyContent: 'center', gap: 14, paddingBottom: 12 },
  dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)' },
  dotOn: { borderColor: '#C9BFB0', borderWidth: 3 },
  promptWrap: { flex: 1, backgroundColor: 'rgba(11,30,61,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  promptCard: { alignSelf: 'stretch', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16 },
  promptInput: { borderWidth: 1, borderColor: '#E1E6EE', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, color: '#0B1E3D' },
});