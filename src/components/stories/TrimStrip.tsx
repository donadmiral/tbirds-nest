/**
 * TrimStrip - the always-visible trim timeline under the canvas for video
 * stories: play/pause, thumbnail strip, start/end handles, live playhead and
 * a "0:05 / 0:15" counter. Writes the window into the recipe through
 * onChange; the canvas player loops inside that window and seeks as you drag.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, PanResponder, Image, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';

let VideoThumbnails: any = null;
try { VideoThumbnails = require('expo-video-thumbnails'); } catch {}

const THUMBS = 8;
const HANDLE_W = 16;

function fmt(v: number): string {
  const s = Math.max(0, Math.round(v)); const m = Math.floor(s / 60); const r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

export default function TrimStrip({ uri, durationSec, start, end, onChange, player, width }: {
  uri: string; durationSec: number; start: number; end: number;
  onChange: (start: number, end: number) => void; player: any; width: number;
}) {
  const dur = Math.max(1, durationSec || 1);
  const trackW = Math.max(120, width - 96);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [cur, setCur] = useState(start);
  const [playing, setPlaying] = useState(true);
  const startRef = useRef(start); startRef.current = start;
  const endRef = useRef(end); endRef.current = end;
  const grabRef = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!VideoThumbnails?.getThumbnailAsync) return;
      const out: string[] = [];
      for (let i = 0; i < THUMBS; i++) {
        try {
          const t = Math.min(dur - 0.15, (i / THUMBS) * dur + 0.05);
          const th = await VideoThumbnails.getThumbnailAsync(uri, { time: Math.max(0, t * 1000), quality: 0.3 });
          if (!alive) return; out.push(th.uri); setThumbs([...out]);
        } catch { out.push(''); }
      }
    })();
    return () => { alive = false; };
  }, [uri, dur]);

  useEffect(() => {
    const p: any = player; if (!p) return;
    let sub: any = null;
    try { sub = p.addListener?.('timeUpdate', (ev: any) => { const t = typeof ev?.currentTime === 'number' ? ev.currentTime : p.currentTime; if (typeof t === 'number') setCur(t); }); } catch {}
    let sub2: any = null;
    try { sub2 = p.addListener?.('playingChange', (ev: any) => { const v = typeof ev?.isPlaying === 'boolean' ? ev.isPlaying : (typeof ev === 'boolean' ? ev : p.playing); setPlaying(!!v); }); } catch {}
    return () => { try { sub?.remove?.(); } catch {} try { sub2?.remove?.(); } catch {} };
  }, [player]);

  const toX = (sec: number) => (Math.max(0, Math.min(dur, sec)) / dur) * trackW;
  const toSec = (x: number) => Math.round((Math.max(0, Math.min(trackW, x)) / trackW) * dur * 10) / 10;
  const seek = (sec: number) => { try { const p: any = player; if (p && typeof p.currentTime === 'number') p.currentTime = sec; } catch {} };

  const startPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { grabRef.current = toX(startRef.current); },
    onPanResponderMove: (_e, g) => { const v = toSec(grabRef.current + g.dx); const s2 = Math.max(0, Math.min(endRef.current - 1, v)); onChange(s2, endRef.current); seek(s2); },
  })).current;
  const endPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { grabRef.current = toX(endRef.current); },
    onPanResponderMove: (_e, g) => { const v = toSec(grabRef.current + g.dx); const e2 = Math.min(dur, Math.max(startRef.current + 1, v)); onChange(startRef.current, e2); seek(Math.max(startRef.current, e2 - 1)); },
  })).current;

  const togglePlay = () => { try { const p: any = player; if (!p) return; if (p.playing) { p.pause(); setPlaying(false); } else { if (typeof p.currentTime === 'number' && (p.currentTime < start || p.currentTime >= end)) p.currentTime = start; p.play(); setPlaying(true); } } catch {} };
  const rel = Math.max(0, Math.min(end - start, cur - start));

  return (
    <View style={[ts.wrap, { width }]} pointerEvents="box-none">
      <View style={ts.row}>
        <TouchableOpacity style={ts.playBtn} onPress={togglePlay} activeOpacity={0.75} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name={playing ? 'pause' : 'play'} size={16} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={[ts.track, { width: trackW }]}>
          <View style={ts.thumbRow}>
            {thumbs.length === 0 ? <ActivityIndicator color="#FFF" style={{ flex: 1 }} /> : thumbs.map((t, i) => t ? <Image key={i} source={{ uri: t }} style={{ width: trackW / THUMBS, height: 44 }} resizeMode="cover" fadeDuration={0} /> : <View key={i} style={{ width: trackW / THUMBS, height: 44, backgroundColor: '#1B2233' }} />)}
          </View>
          <View pointerEvents="none" style={[ts.dim, { left: 0, width: toX(start) }]} />
          <View pointerEvents="none" style={[ts.dim, { left: toX(end), right: 0 }]} />
          <View pointerEvents="none" style={[ts.win, { left: toX(start), width: Math.max(6, toX(end) - toX(start)) }]} />
          <View pointerEvents="none" style={[ts.playhead, { left: toX(Math.max(start, Math.min(end, cur))) - 1 }]} />
          <View {...startPan.panHandlers} style={[ts.handle, { left: toX(start) - HANDLE_W + 2 }]} hitSlop={{ top: 12, bottom: 12, left: 10, right: 6 }}><View style={ts.grip} /></View>
          <View {...endPan.panHandlers} style={[ts.handle, { left: toX(end) - 2 }]} hitSlop={{ top: 12, bottom: 12, left: 6, right: 10 }}><View style={ts.grip} /></View>
        </View>
        <Text style={ts.counter}>{fmt(rel)} / {fmt(end - start)}</Text>
      </View>
      <Text style={ts.hint}>Pinch to zoom {'\u00B7'} Drag to reposition</Text>
    </View>
  );
}

const ts = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, zIndex: 28, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(12,16,26,0.62)', borderRadius: 16, paddingHorizontal: 8, paddingVertical: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' },
  playBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  track: { height: 44, borderRadius: 8, overflow: 'visible', backgroundColor: '#12141B' },
  thumbRow: { flexDirection: 'row', height: 44, borderRadius: 8, overflow: 'hidden' },
  dim: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.62)', borderRadius: 8 },
  win: { position: 'absolute', top: 0, bottom: 0, borderWidth: 2, borderColor: '#FFFFFF', borderRadius: 6 },
  playhead: { position: 'absolute', top: -4, bottom: -4, width: 2, backgroundColor: '#FFFFFF', borderRadius: 1 },
  handle: { position: 'absolute', top: -4, bottom: -4, width: HANDLE_W, borderRadius: 6, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  grip: { width: 2.5, height: 16, borderRadius: 2, backgroundColor: '#0C0C10' },
  counter: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'], minWidth: 74, textAlign: 'right' },
  hint: { color: 'rgba(255,255,255,0.72)', fontSize: 11.5, fontWeight: '600', marginTop: 6 },
});
