/**
 * DrawLayer — freehand drawing for stories (docs 18-21).
 * Strokes are normalized point arrays stored on a single hidden
 * 'drawing' sticker, so phone and web replay the exact same SVG.
 * DrawingLayer renders; DrawSurface captures + edits with undo/redo,
 * eraser, and per-tool rendering (pen, neon, marker, highlight, arrow, dot).
 */
import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, PanResponder } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import { MiniSlider } from './storyPanels';

export type DrawStroke = { tool: string; color: string; width: number; points: { x: number; y: number }[] };

export const DRAW_COLORS = ['#FFFFFF', '#000000', '#FF3B30', '#FF9500', '#FFD60A', '#34C759', '#00C7BE', '#007AFF', '#AF52DE', '#C9BFB0'];
const TOOLS: { id: string; icon: any; label: string }[] = [
  { id: 'pen', icon: 'edit-2', label: 'Pen' },
  { id: 'neon', icon: 'zap', label: 'Neon' },
  { id: 'marker', icon: 'edit-3', label: 'Marker' },
  { id: 'highlight', icon: 'minus', label: 'Highlight' },
  { id: 'arrow', icon: 'arrow-up-right', label: 'Arrow' },
  { id: 'dot', icon: 'circle', label: 'Dot' },
  { id: 'eraser', icon: 'x-square', label: 'Eraser' },
];

function toPath(points: { x: number; y: number }[], w: number, h: number): string {
  if (!points.length) return '';
  let d = `M ${points[0].x * w} ${points[0].y * h}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1], c = points[i];
    const mx = ((p.x + c.x) / 2) * w, my = ((p.y + c.y) / 2) * h;
    d += ` Q ${p.x * w} ${p.y * h} ${mx} ${my}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x * w} ${last.y * h}`;
  return d;
}

function StrokePaths({ st, w, h }: { st: DrawStroke; w: number; h: number }) {
  const d = useMemo(() => toPath(st.points, w, h), [st.points, w, h]);
  if (st.points.length === 1 || st.tool === 'dot') {
    const p = st.points[st.points.length - 1];
    if (!p) return null;
    return <Circle cx={p.x * w} cy={p.y * h} r={Math.max(2, st.width * 0.9)} fill={st.color} opacity={st.tool === 'highlight' ? 0.4 : 1} />;
  }
  if (st.tool === 'neon') {
    return (
      <>
        <Path d={d} stroke={st.color} strokeWidth={st.width * 2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.35} />
        <Path d={d} stroke={st.color} strokeWidth={st.width * 1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.55} />
        <Path d={d} stroke="#FFFFFF" strokeWidth={Math.max(1.5, st.width * 0.6)} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </>
    );
  }
  if (st.tool === 'highlight') {
    return <Path d={d} stroke={st.color} strokeWidth={st.width * 2.2} strokeLinecap="butt" strokeLinejoin="round" fill="none" opacity={0.4} />;
  }
  if (st.tool === 'marker') {
    return <Path d={d} stroke={st.color} strokeWidth={st.width * 1.6} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.75} />;
  }
  if (st.tool === 'arrow') {
    const n = st.points.length;
    const a = st.points[Math.max(0, n - 4)], b = st.points[n - 1];
    let head = null as any;
    if (a && b) {
      const ang = Math.atan2((b.y - a.y) * h, (b.x - a.x) * w);
      const L = Math.max(10, st.width * 3.2);
      const x = b.x * w, y = b.y * h;
      const p1x = x - L * Math.cos(ang - Math.PI / 7), p1y = y - L * Math.sin(ang - Math.PI / 7);
      const p2x = x - L * Math.cos(ang + Math.PI / 7), p2y = y - L * Math.sin(ang + Math.PI / 7);
      head = <Path d={`M ${p1x} ${p1y} L ${x} ${y} L ${p2x} ${p2y}`} stroke={st.color} strokeWidth={st.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />;
    }
    return (
      <>
        <Path d={d} stroke={st.color} strokeWidth={st.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        {head}
      </>
    );
  }
  // pen
  return <Path d={d} stroke={st.color} strokeWidth={st.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />;
}

/** Pure renderer — used by canvas preview and both viewers. */
export function DrawingLayer({ strokes, width, height, zIndex }: { strokes: DrawStroke[] | null | undefined; width: number; height: number; zIndex?: number }) {
  if (!strokes || !strokes.length || !width || !height) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, zIndex != null ? { zIndex } : null]}>
      <Svg width={width} height={height}>
        {strokes.map((st, i) => <StrokePaths key={i} st={st} w={width} h={height} />)}
      </Svg>
    </View>
  );
}

/** Full-screen capture + toolbar. Mount only while drawing. */
export default function DrawSurface({ width, height, strokes, onChange, onDone }: {
  width: number; height: number;
  strokes: DrawStroke[];
  onChange: (s: DrawStroke[]) => void;
  onDone: () => void;
}) {
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#FFFFFF');
  const [size, setSize] = useState(8);
  const [live, setLive] = useState<DrawStroke | null>(null);
  const redoRef = useRef<DrawStroke[]>([]);
  const [, bump] = useState(0);

  const strokesRef = useRef(strokes); strokesRef.current = strokes;
  const toolRef = useRef(tool); toolRef.current = tool;
  const colorRef = useRef(color); colorRef.current = color;
  const sizeRef = useRef(size); sizeRef.current = size;
  const liveRef = useRef<DrawStroke | null>(null);
  const dimsRef = useRef({ w: width, h: height }); dimsRef.current = { w: width, h: height };

  const eraseAt = (nx: number, ny: number) => {
    const hit = strokesRef.current.findIndex(st => st.points.some(p => Math.hypot(p.x - nx, p.y - ny) < 0.035));
    if (hit >= 0) {
      const next = strokesRef.current.filter((_, i) => i !== hit);
      onChange(next);
    }
  };

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const { w, h } = dimsRef.current;
      const nx = e.nativeEvent.locationX / Math.max(1, w);
      const ny = e.nativeEvent.locationY / Math.max(1, h);
      if (toolRef.current === 'eraser') { eraseAt(nx, ny); return; }
      const st: DrawStroke = { tool: toolRef.current, color: colorRef.current, width: sizeRef.current, points: [{ x: nx, y: ny }] };
      liveRef.current = st;
      setLive(st);
    },
    onPanResponderMove: (e) => {
      const { w, h } = dimsRef.current;
      const nx = e.nativeEvent.locationX / Math.max(1, w);
      const ny = e.nativeEvent.locationY / Math.max(1, h);
      if (toolRef.current === 'eraser') { eraseAt(nx, ny); return; }
      const st = liveRef.current;
      if (!st) return;
      const last = st.points[st.points.length - 1];
      if (last && Math.hypot(nx - last.x, ny - last.y) < 0.004) return;
      st.points = [...st.points, { x: Math.max(0, Math.min(1, nx)), y: Math.max(0, Math.min(1, ny)) }];
      setLive({ ...st });
    },
    onPanResponderRelease: () => {
      const st = liveRef.current;
      liveRef.current = null;
      setLive(null);
      if (st && st.points.length > 0) {
        redoRef.current = [];
        onChange([...strokesRef.current, st]);
      }
    },
    onPanResponderTerminate: () => { liveRef.current = null; setLive(null); },
  })).current;

  const undo = () => {
    if (!strokesRef.current.length) return;
    const next = [...strokesRef.current];
    const popped = next.pop()!;
    redoRef.current = [...redoRef.current, popped];
    onChange(next); bump(x => x + 1);
  };
  const redo = () => {
    if (!redoRef.current.length) return;
    const back = [...redoRef.current];
    const st = back.pop()!;
    redoRef.current = back;
    onChange([...strokesRef.current, st]); bump(x => x + 1);
  };

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 64 }]}>
      <View style={StyleSheet.absoluteFill} {...pan.panHandlers}>
        <DrawingLayer strokes={live ? [...strokes, live] : strokes} width={width} height={height} />
      </View>

      <View style={dw.topRow} pointerEvents="box-none">
        <TouchableOpacity onPress={undo} style={dw.topBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="corner-up-left" size={19} color="#FFF" />
        </TouchableOpacity>
        <TouchableOpacity onPress={redo} style={dw.topBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="corner-up-right" size={19} color="#FFF" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { redoRef.current = []; onChange([]); }} style={dw.topBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="trash-2" size={18} color="#FFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={onDone} style={dw.doneBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={dw.doneTxt}>Done</Text>
        </TouchableOpacity>
      </View>

      <View style={dw.dock} pointerEvents="box-none">
        <View style={dw.toolRow}>
          {TOOLS.map(t => (
            <TouchableOpacity key={t.id} onPress={() => setTool(t.id)} style={[dw.toolBtn, tool === t.id && dw.toolBtnOn]} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
              <Feather name={t.icon} size={17} color={tool === t.id ? '#0B1E3D' : '#FFF'} />
            </TouchableOpacity>
          ))}
        </View>
        <View style={dw.colorRow}>
          {DRAW_COLORS.map(c => (
            <TouchableOpacity key={c} onPress={() => setColor(c)} style={[dw.swatch, { backgroundColor: c }, color === c && dw.swatchOn]} hitSlop={{ top: 6, bottom: 6, left: 3, right: 3 }} />
          ))}
        </View>
        <View style={dw.sizeRow}>
          <View style={[dw.sizePreview, { width: Math.max(6, size), height: Math.max(6, size), borderRadius: Math.max(3, size / 2), backgroundColor: color === '#000000' ? '#FFF' : color }]} />
          <MiniSlider value={size} min={2} max={26} onChange={setSize} width={200} />
        </View>
      </View>
    </View>
  );
}

const dw = StyleSheet.create({
  topRow: { position: 'absolute', top: 58, left: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  topBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  doneBtn: { backgroundColor: '#C9BFB0', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 8 },
  doneTxt: { color: '#0B1E3D', fontSize: 13.5, fontWeight: '800' },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: 34, paddingTop: 12, backgroundColor: 'rgba(10,12,18,0.88)', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  toolRow: { flexDirection: 'row', justifyContent: 'center', gap: 9, marginBottom: 10 },
  toolBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  toolBtnOn: { backgroundColor: '#C9BFB0' },
  colorRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 10 },
  swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.4)' },
  swatchOn: { borderWidth: 2.5, borderColor: '#FFFFFF', transform: [{ scale: 1.15 }] },
  sizeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  sizePreview: {},
});
