/**
 * TrimStrip - the always-visible trim timeline under the canvas for video
 * stories: play/pause, thumbnail strip, start/end handles, live playhead and
 * a "0:05 / 0:15" counter. Writes the window into the recipe through
 * onChange; the canvas player loops inside that window and seeks as you drag.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, PanResponder, Image, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

let VideoThumbnails: any = null;
try { VideoThumbnails = require('expo-video-thumbnails'); } catch {}

const THUMBS = 8;
const HANDLE_W = 16;

function fmt(v: number): string {
  const s = Math.max(0, Math.round(v)); const m = Math.floor(s / 60); const r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

export default function TrimStrip({ uri, durationSec, start, end, onChange, onDuration, player, width }: {
  uri: string; durationSec: number; start: number; end: number;
  onChange: (start: number, end: number) => void; onDuration?: (sec: number) => void; player: any; width: number;
}) {
  const dur = Math.max(1, durationSec || 1);
  const trackW = Math.max(120, width - 160);
  const durRef = useRef(dur); durRef.current = dur;
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
      // Frame times stay inside a conservative window: durationSec is rounded and
      // can overshoot the real clip, and a request past the end fails. A failed
      // frame reuses the last good one instead of leaving a blank cell.
      const out: string[] = [];
      let last = '';
      const safeDur = Math.max(0.2, dur - 0.25);
      for (let i = 0; i < THUMBS; i++) {
        const t = Math.max(0, (i / THUMBS) * safeDur);
        let got = '';
        for (const cand of [t, t * 0.6, 0]) {
          try {
            const th = await VideoThumbnails.getThumbnailAsync(uri, { time: Math.round(cand * 1000), quality: 0.3 });
            if (th?.uri) { got = th.uri; break; }
          } catch {}
          if (!alive) return;
        }
        if (!alive) return;
        if (!got) got = last;
        if (got) last = got;
        out.push(got);
        setThumbs([...out]);
      }
    })();
    return () => { alive = false; };
  }, [uri, dur]);

  useEffect(() => {
    const p: any = player; if (!p) return;
    let sub: any = null;
    try { sub = p.addListener?.('timeUpdate', (ev: any) => { const t = typeof ev?.currentTime === 'number' ? ev.currentTime : p.currentTime; if (typeof t === 'number') setCur(t); const d = typeof p.duration === 'number' ? p.duration : 0; if (d > 0.5 && Number.isFinite(d) && Math.abs(d - durRef.current) > 0.3) onDuration?.(Math.round(d * 10) / 10); }); } catch {}
    let sub2: any = null;
    try { sub2 = p.addListener?.('playingChange', (ev: any) => { const v = typeof ev?.isPlaying === 'boolean' ? ev.isPlaying : (typeof ev === 'boolean' ? ev : p.playing); setPlaying(!!v); }); } catch {}
    return () => { try { sub?.remove?.(); } catch {} try { sub2?.remove?.(); } catch {} };
  }, [player, onDuration]);

  const toX = (sec: number) => (Math.max(0, Math.min(dur, sec)) / dur) * trackW;
  const toSec = (x: number) => Math.round((Math.max(0, Math.min(trackW, x)) / trackW) * dur * 10) / 10;
  const seek = (sec: number) => { try { const p: any = player; if (p && typeof p.currentTime === 'number') p.currentTime = sec; } catch {} };

  // Smooth handles: the strip draws from LOCAL values every frame, the parent
  // recipe is committed at most every 60ms plus once on release, and seeks are
  // throttled the same way. Nothing waits on a React round trip mid-drag.
  const [dragS, setDragS] = useState<number | null>(null);
  const [dragE, setDragE] = useState<number | null>(null);
  const liveRef = useRef({ s: start, e: end });
  const lastCommit = useRef(0);
  const lastSeek = useRef(0);
  const commit = (s2: number, e2: number, force: boolean) => {
    const now = Date.now();
    if (!force && now - lastCommit.current < 60) return;
    lastCommit.current = now;
    onChange(s2, e2);
  };
  const seekThrottled = (sec: number, force: boolean) => {
    const now = Date.now();
    if (!force && now - lastSeek.current < 70) return;
    lastSeek.current = now;
    seek(sec);
  };
  const startPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { grabRef.current = toX(startRef.current); liveRef.current = { s: startRef.current, e: endRef.current }; setDragS(startRef.current); try { Haptics.selectionAsync(); } catch {} },
    onPanResponderMove: (_e, g) => {
      const v = toSec(grabRef.current + g.dx);
      const s2 = Math.max(0, Math.min(endRef.current - 1, v));
      liveRef.current.s = s2; setDragS(s2); commit(s2, endRef.current, false); seekThrottled(s2, false);
    },
    onPanResponderRelease: () => { const s2 = liveRef.current.s; commit(s2, endRef.current, true); seekThrottled(s2, true); setDragS(null); },
    onPanResponderTerminate: () => { const s2 = liveRef.current.s; commit(s2, endRef.current, true); setDragS(null); },
  })).current;
  const endPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { grabRef.current = toX(endRef.current); liveRef.current = { s: startRef.current, e: endRef.current }; setDragE(endRef.current); try { Haptics.selectionAsync(); } catch {} },
    onPanResponderMove: (_e, g) => {
      const v = toSec(grabRef.current + g.dx);
      const e2 = Math.min(dur, Math.max(startRef.current + 1, v));
      liveRef.current.e = e2; setDragE(e2); commit(startRef.current, e2, false); seekThrottled(Math.max(startRef.current, e2 - 1), false);
    },
    onPanResponderRelease: () => { const e2 = liveRef.current.e; commit(startRef.current, e2, true); seekThrottled(Math.max(startRef.current, e2 - 1), true); setDragE(null); },
    onPanResponderTerminate: () => { const e2 = liveRef.current.e; commit(startRef.current, e2, true); setDragE(null); },
  })).current;
  // Visual values: the finger wins while dragging.
  const vS = dragS ?? start;
  const vE = dragE ?? end;

  const togglePlay = () => { try { const p: any = player; if (!p) return; if (p.playing) { p.pause(); setPlaying(false); } else { if (typeof p.currentTime === 'number' && (p.currentTime < start || p.currentTime >= end)) p.currentTime = start; p.play(); setPlaying(true); } } catch {} };
  const rel = Math.max(0, Math.min(vE - vS, cur - vS));

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
          <View pointerEvents="none" style={[ts.dim, { left: 0, width: toX(vS) }]} />
          <View pointerEvents="none" style={[ts.dim, { left: toX(vE), right: 0 }]} />
          <View pointerEvents="none" style={[ts.win, { left: toX(vS), width: Math.max(6, toX(vE) - toX(vS)) }]} />
          <View pointerEvents="none" style={[ts.playhead, { left: toX(Math.max(vS, Math.min(vE, cur))) - 1 }]} />
          <View {...startPan.panHandlers} style={[ts.handle, dragS != null && ts.handleOn, { left: toX(vS) - HANDLE_W + 2 }]} hitSlop={{ top: 16, bottom: 16, left: 18, right: 12 }}><View style={ts.grip} /></View>
          <View {...endPan.panHandlers} style={[ts.handle, dragE != null && ts.handleOn, { left: toX(vE) - 2 }]} hitSlop={{ top: 16, bottom: 16, left: 12, right: 18 }}><View style={ts.grip} /></View>
        </View>
        <Text style={ts.counter}>{fmt(rel)} / {fmt(vE - vS)}</Text>
      </View>
      <Text style={ts.hint}>Pinch to zoom {'\u00B7'} Drag to reposition</Text>
    </View>
  );
}

const ts = StyleSheet.create({
  wrap: { alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(12,16,26,0.62)', borderRadius: 16, paddingHorizontal: 8, paddingVertical: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' },
  playBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  track: { height: 44, borderRadius: 8, overflow: 'visible', backgroundColor: '#12141B' },
  thumbRow: { flexDirection: 'row', height: 44, borderRadius: 8, overflow: 'hidden' },
  dim: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.62)', borderRadius: 8 },
  win: { position: 'absolute', top: 0, bottom: 0, borderWidth: 2, borderColor: '#FFFFFF', borderRadius: 6 },
  handleOn: { transform: [{ scaleX: 1.15 }, { scaleY: 1.06 }] },
  playhead: { position: 'absolute', top: -4, bottom: -4, width: 2, backgroundColor: '#FFFFFF', borderRadius: 1 },
  handle: { position: 'absolute', top: -4, bottom: -4, width: HANDLE_W, borderRadius: 6, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  grip: { width: 2.5, height: 16, borderRadius: 2, backgroundColor: '#0C0C10' },
  counter: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'], minWidth: 72, textAlign: 'right' },
  hint: { color: 'rgba(255,255,255,0.72)', fontSize: 11.5, fontWeight: '600', marginTop: 6 },
});
