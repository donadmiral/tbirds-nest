/**
 * VideoTrimmer — non-destructive trim window for video stories.
 * Writes trimStart/trimEnd into media_transform; both viewers seek
 * and stop by those numbers, so no re-encode ever happens on device.
 * Also offers "split into cards" for long clips (doc 12/13).
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, PanResponder, Dimensions, ActivityIndicator } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Feather } from '@expo/vector-icons';

export const STORY_MAX_SEC = 60;
const SCREEN_W = Dimensions.get('window').width;
const TRACK_W = SCREEN_W - 76;
const HANDLE_W = 18;
const THUMB_COUNT = 8;

let VideoThumbnails: any = null;
try { VideoThumbnails = require('expo-video-thumbnails'); } catch {}

/** Cut a duration into <=60s story segments. */
export function autoSegments(durationSec: number): { s: number; e: number }[] {
  const out: { s: number; e: number }[] = [];
  let t = 0;
  const d = Math.max(1, durationSec);
  while (t < d - 0.25) {
    const e = Math.min(d, t + STORY_MAX_SEC);
    out.push({ s: Math.round(t * 10) / 10, e: Math.round(e * 10) / 10 });
    t = e;
  }
  return out.length ? out : [{ s: 0, e: Math.min(d, STORY_MAX_SEC) }];
}

export default function VideoTrimmer({ uri, durationSec, start, end, onChange, onDone, onSplit }: {
  uri: string;
  durationSec: number;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  onDone: () => void;
  onSplit?: (segs: { s: number; e: number }[]) => void;
}) {
  const dur = Math.max(1, durationSec || 1);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [loadingThumbs, setLoadingThumbs] = useState(true);

  const startRef = useRef(start); startRef.current = start;
  const endRef = useRef(end); endRef.current = end;
  const grabStartRef = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!VideoThumbnails?.getThumbnailAsync) { setLoadingThumbs(false); return; }
      const out: string[] = [];
      for (let i = 0; i < THUMB_COUNT; i++) {
        try {
          const t = Math.min(dur - 0.15, (i / THUMB_COUNT) * dur + 0.05);
          const th = await VideoThumbnails.getThumbnailAsync(uri, { time: Math.max(0, t * 1000), quality: 0.35 });
          if (!alive) return;
          out.push(th.uri);
          setThumbs([...out]);
        } catch { out.push(''); }
      }
      if (alive) setLoadingThumbs(false);
    })();
    return () => { alive = false; };
  }, [uri, dur]);

  const toX = (sec: number) => (Math.max(0, Math.min(dur, sec)) / dur) * TRACK_W;
  const toSec = (x: number) => Math.round(((Math.max(0, Math.min(TRACK_W, x)) / TRACK_W) * dur) * 10) / 10;

  const startPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { grabStartRef.current = toX(startRef.current); },
    onPanResponderMove: (_e, g) => {
      const s = toSec(grabStartRef.current + g.dx);
      const maxS = Math.max(0, endRef.current - 1);
      const minS = Math.max(0, endRef.current - STORY_MAX_SEC);
      onChange(Math.max(minS, Math.min(maxS, s)), endRef.current);
    },
  })).current;

  const endPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { grabStartRef.current = toX(endRef.current); },
    onPanResponderMove: (_e, g) => {
      const e = toSec(grabStartRef.current + g.dx);
      const minE = Math.min(dur, startRef.current + 1);
      const maxE = Math.min(dur, startRef.current + STORY_MAX_SEC);
      onChange(startRef.current, Math.max(minE, Math.min(maxE, e)));
    },
  })).current;

  const selected = Math.max(0, end - start);
  const segs = autoSegments(dur);
  const fmt = (v: number) => {
    const m = Math.floor(v / 60); const s = Math.floor(v % 60);
    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${v.toFixed(v < 10 ? 1 : 0)}s`;
  };

  return (
    <View style={tr.dockWrap} pointerEvents="box-none">
      <View style={tr.dock}>
        <View style={tr.head}>
          <Text style={tr.title}>Trim</Text>
          <Text style={tr.selTxt}>{fmt(selected)} selected</Text>
          <TouchableOpacity onPress={() => onChange(0, Math.min(dur, STORY_MAX_SEC))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={tr.reset}>Reset</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDone} style={tr.done} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={tr.doneTxt}>Done</Text>
          </TouchableOpacity>
        </View>

        <View style={tr.trackWrap}>
          <View style={tr.thumbRow}>
            {loadingThumbs && thumbs.length === 0 && <ActivityIndicator color="#FFF" style={{ alignSelf: 'center', flex: 1 }} />}
            {thumbs.map((t, i) => t ? (
              <ExpoImage key={i} source={{ uri: t }} style={tr.thumb} contentFit="cover" transition={0} />
            ) : (
              <View key={i} style={[tr.thumb, { backgroundColor: 'rgba(255,255,255,0.08)' }]} />
            ))}
          </View>
          {/* Dimmed outside the window */}
          <View style={[tr.dim, { left: 0, width: toX(start) }]} pointerEvents="none" />
          <View style={[tr.dim, { left: toX(end), right: 0 }]} pointerEvents="none" />
          {/* Window frame */}
          <View style={[tr.frame, { left: toX(start), width: Math.max(8, toX(end) - toX(start)) }]} pointerEvents="none" />
          {/* Handles */}
          <View {...startPan.panHandlers} style={[tr.handle, { left: toX(start) - HANDLE_W + 2 }]} hitSlop={{ top: 14, bottom: 14, left: 12, right: 6 }}>
            <Feather name="chevron-left" size={13} color="#0B1E3D" />
          </View>
          <View {...endPan.panHandlers} style={[tr.handle, { left: toX(end) - 2 }]} hitSlop={{ top: 14, bottom: 14, left: 6, right: 12 }}>
            <Feather name="chevron-right" size={13} color="#0B1E3D" />
          </View>
        </View>

        <View style={tr.timesRow}>
          <Text style={tr.timeTxt}>{fmt(start)}</Text>
          <Text style={tr.timeTxt}>{fmt(dur)}</Text>
        </View>

        {dur > STORY_MAX_SEC + 0.5 && onSplit && (
          <TouchableOpacity style={tr.splitBtn} onPress={() => onSplit(segs)} activeOpacity={0.85}>
            <Feather name="copy" size={14} color="#0B1E3D" />
            <Text style={tr.splitTxt}>Split into {segs.length} story cards</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const tr = StyleSheet.create({
  dockWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 62 },
  dock: { backgroundColor: 'rgba(12,14,20,0.97)', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 12, paddingBottom: 32, borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, marginBottom: 12 },
  title: { color: '#FFF', fontSize: 15.5, fontWeight: '800' },
  selTxt: { color: 'rgba(255,255,255,0.55)', fontSize: 12.5, flex: 1 },
  reset: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '700' },
  done: { backgroundColor: '#C9BFB0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6 },
  doneTxt: { color: '#0B1E3D', fontSize: 13, fontWeight: '800' },
  trackWrap: { width: TRACK_W, height: 52, alignSelf: 'center' },
  thumbRow: { flexDirection: 'row', width: TRACK_W, height: 52, borderRadius: 10, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.05)' },
  thumb: { width: TRACK_W / THUMB_COUNT, height: 52 },
  dim: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.62)' },
  frame: { position: 'absolute', top: 0, bottom: 0, borderWidth: 2.5, borderColor: '#C9BFB0', borderRadius: 8 },
  handle: { position: 'absolute', top: 4, bottom: 4, width: HANDLE_W, borderRadius: 6, backgroundColor: '#C9BFB0', alignItems: 'center', justifyContent: 'center' },
  timesRow: { flexDirection: 'row', justifyContent: 'space-between', width: TRACK_W, alignSelf: 'center', marginTop: 6 },
  timeTxt: { color: 'rgba(255,255,255,0.5)', fontSize: 11.5, fontVariant: ['tabular-nums'] },
  splitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, alignSelf: 'center', marginTop: 14, backgroundColor: '#C9BFB0', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 9 },
  splitTxt: { color: '#0B1E3D', fontSize: 13, fontWeight: '800' },
});
