/**
 * FullscreenVideo
 *
 * The feed's fullscreen player. Mounted only while open, so its player is
 * created and destroyed with the modal rather than living for the life of the
 * screen.
 *
 * On expo-video like every other video in the app. It was previously the last
 * expo-av holdout, and running two video libraries at once is what produced a
 * black frame while the carousel kept playing underneath.
 *
 * Controls are ours, not the platform's: useNativeControls gave iOS its glass
 * chrome and Android something entirely different.
 */
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, ActivityIndicator } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Feather } from '@expo/vector-icons';

function fmt(t: number) {
  if (!isFinite(t) || t < 0) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function FullscreenVideo({
  uri, onClose, startMuted = false,
}: { uri: string; onClose: () => void; startMuted?: boolean }) {
  const player = useVideoPlayer(uri, p => {
    p.bufferOptions = { preferredForwardBufferDuration: 2, waitsToMinimizeStalling: false } as any;
    p.loop = true;
    p.muted = startMuted;
    p.timeUpdateEventInterval = 0.25;
    p.play();
  });

  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(startMuted);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = player.addListener('timeUpdate', (e: any) => {
      const d = player.duration;
      const c = e?.currentTime ?? player.currentTime;
      setElapsed(c);
      if (d > 0) { setProgress(c / d); setReady(true); }
    });
    const p = player.addListener('playingChange', (e: any) => setPlaying(!!e?.isPlaying));
    return () => { t.remove(); p.remove(); };
  }, [player]);

  return (
    <View style={s.root}>
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        contentFit="contain"
        nativeControls={false}
      />

      {!ready ? (
        <View style={s.loading}><ActivityIndicator color="#FFFFFF" /></View>
      ) : null}

      <TouchableOpacity style={s.close} onPress={onClose} activeOpacity={0.8}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Feather name="x" size={20} color="#FFFFFF" />
      </TouchableOpacity>

      <View style={s.controls} pointerEvents="box-none">
        <View style={s.row}>
          <TouchableOpacity onPress={() => { player.currentTime = Math.max(player.currentTime - 10, 0); }}
            activeOpacity={0.7} style={s.btn}>
            <Feather name="rotate-ccw" size={22} color="#FFFFFF" />
            <Text style={s.btnLbl}>10</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => { playing ? player.pause() : player.play(); }}
            activeOpacity={0.7} style={s.btnCenter}>
            <Feather name={playing ? 'pause' : 'play'} size={30} color="#FFFFFF" />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => { if (player.duration > 0) player.currentTime = Math.min(player.currentTime + 10, player.duration); }}
            activeOpacity={0.7} style={s.btn}>
            <Feather name="rotate-cw" size={22} color="#FFFFFF" />
            <Text style={s.btnLbl}>10</Text>
          </TouchableOpacity>
        </View>

        <View style={s.bottomRow}>
          <Text style={s.time}>{fmt(elapsed)}</Text>
          <View style={s.track}>
            <View style={[s.fill, { width: `${Math.min(100, Math.max(0, progress * 100))}%` }]} />
          </View>
          <TouchableOpacity onPress={() => { const n = !muted; setMuted(n); player.muted = n; }}
            activeOpacity={0.8} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name={muted ? 'volume-x' : 'volume-2'} size={17} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  close: {
    position: 'absolute', top: 54, left: 16, width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },
  controls: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 44, flex: 1 },
  btn: { alignItems: 'center', justifyContent: 'center' },
  btnLbl: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', marginTop: -2 },
  btnCenter: {
    width: 66, height: 66, borderRadius: 33, backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingBottom: 42 },
  time: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', minWidth: 38 },
  track: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#FFFFFF' },
});