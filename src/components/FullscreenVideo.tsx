/**
 * FullscreenVideo
 *
 * The feed's fullscreen player, the Instagram way: a scrubber that sits inside
 * the safe area with elapsed and total time, drag to seek, double-tap on the
 * left or right half to skip 10 seconds with a ripple, single tap to toggle
 * the controls, pinch to zoom on the UI thread with a spring back, and our own
 * chrome on both platforms. Mounted only while open, so its player is created
 * and destroyed with the modal.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, ActivityIndicator, PanResponder, Dimensions } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming, runOnJS } from 'react-native-reanimated';

function fmt(t: number) {
  const s = Math.max(0, Math.floor(t || 0)); const m = Math.floor(s / 60); const r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

const SKIP = 10;

export default function FullscreenVideo({
  uri, onClose, startMuted = false,
}: { uri: string; onClose: () => void; startMuted?: boolean }) {
  const insets = useSafeAreaInsets();
  const W = Dimensions.get('window').width;
  const H = Dimensions.get('window').height;
  const player = useVideoPlayer(uri, p => {
    p.loop = true;
    p.muted = startMuted;
    p.timeUpdateEventInterval = 0.1;
    p.play();
  });

  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(startMuted);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubT, setScrubT] = useState(0);
  const [ripple, setRipple] = useState<{ side: 'l' | 'r'; n: number } | null>(null);
  const chromeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackW = useRef(1);
  const rippleCount = useRef(0);
  const rippleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const t = player.addListener('timeUpdate', (e: any) => {
      const d = player.duration;
      const c = e?.currentTime ?? player.currentTime;
      if (!scrubbing) setElapsed(c);
      if (d > 0) { setDuration(d); setReady(true); }
    });
    const p = player.addListener('playingChange', (e: any) => setPlaying(!!e?.isPlaying));
    return () => { t.remove(); p.remove(); };
  }, [player, scrubbing]);

  const armHide = useCallback(() => {
    if (chromeTimer.current) clearTimeout(chromeTimer.current);
    chromeTimer.current = setTimeout(() => setChrome(false), 2600);
  }, []);
  useEffect(() => { armHide(); return () => { if (chromeTimer.current) clearTimeout(chromeTimer.current); }; }, [armHide]);

  const seekTo = useCallback((sec: number) => {
    try { const d = player.duration || 0; player.currentTime = Math.max(0, Math.min(d > 0 ? d : sec, sec)); } catch {}
  }, [player]);

  const skip = useCallback((dir: -1 | 1) => {
    seekTo((player.currentTime || 0) + dir * SKIP);
    rippleCount.current += 1;
    setRipple({ side: dir < 0 ? 'l' : 'r', n: rippleCount.current });
    if (rippleTimer.current) clearTimeout(rippleTimer.current);
    rippleTimer.current = setTimeout(() => setRipple(null), 700);
    setChrome(true); armHide();
  }, [seekTo, armHide]);

  const toggleChrome = useCallback(() => { setChrome(c => !c); armHide(); }, [armHide]);

  // Pinch to zoom: focal-correct, on the UI thread, springs back on release.
  const scale = useSharedValue(1); const tx = useSharedValue(0); const ty = useSharedValue(0);
  const ox = useSharedValue(0); const oy = useSharedValue(0);
  const pinch = Gesture.Pinch()
    .onStart(e => { ox.value = e.focalX; oy.value = e.focalY; })
    .onUpdate(e => {
      const sc = Math.min(Math.max(e.scale, 1), 3);
      scale.value = sc;
      tx.value = (ox.value - W / 2) * (1 - sc) + (e.focalX - ox.value);
      ty.value = (oy.value - H / 2) * (1 - sc) + (e.focalY - oy.value);
    })
    .onEnd(() => {
      scale.value = withSpring(1, { damping: 18, stiffness: 220, mass: 0.6 });
      tx.value = withSpring(0, { damping: 18, stiffness: 220, mass: 0.6 });
      ty.value = withSpring(0, { damping: 18, stiffness: 220, mass: 0.6 });
    });
  const tapL = Gesture.Tap().numberOfTaps(2).maxDuration(260).onEnd((e, ok) => { if (ok) runOnJS(skip)(e.x < W / 2 ? -1 : 1); });
  const tap1 = Gesture.Tap().numberOfTaps(1).maxDuration(260).onEnd((_e, ok) => { if (ok) runOnJS(toggleChrome)(); });
  const taps = Gesture.Exclusive(tapL, tap1);
  const composed = Gesture.Simultaneous(pinch, taps);
  const zoomStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }] }));

  // Scrubber: drag anywhere on the track; seeks live while you drag.
  const scrubPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { setScrubbing(true); const t = (Math.max(0, Math.min(trackW.current, e.nativeEvent.locationX)) / trackW.current) * (player.duration || 0); setScrubT(t); },
    onPanResponderMove: (e) => { const t = (Math.max(0, Math.min(trackW.current, e.nativeEvent.locationX)) / trackW.current) * (player.duration || 0); setScrubT(t); },
    onPanResponderRelease: (e) => { const t = (Math.max(0, Math.min(trackW.current, e.nativeEvent.locationX)) / trackW.current) * (player.duration || 0); seekTo(t); setElapsed(t); setScrubbing(false); setChrome(true); armHide(); },
    onPanResponderTerminate: () => { setScrubbing(false); },
  })).current;

  const shown = scrubbing ? scrubT : elapsed;
  const pct = duration > 0 ? Math.min(1, Math.max(0, shown / duration)) : 0;

  return (
    <View style={s.root}>
      <GestureDetector gesture={composed}>
        <Animated.View style={[StyleSheet.absoluteFill, zoomStyle]}>
          <VideoView pointerEvents="none" style={StyleSheet.absoluteFill} player={player} contentFit="contain" nativeControls={false} />
        </Animated.View>
      </GestureDetector>

      {!ready ? <View style={s.loading} pointerEvents="none"><ActivityIndicator color="#FFFFFF" /></View> : null}

      {ripple ? (
        <View pointerEvents="none" style={[s.ripple, ripple.side === 'l' ? { left: 0 } : { right: 0 }]}>
          <View style={s.rippleDisc}>
            <Feather name={ripple.side === 'l' ? 'rewind' : 'fast-forward'} size={22} color="#FFFFFF" />
            <Text style={s.rippleTxt}>{SKIP} seconds</Text>
          </View>
        </View>
      ) : null}

      {chrome ? (
        <>
          <TouchableOpacity style={[s.close, { top: insets.top + 8 }]} onPress={onClose} activeOpacity={0.8} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="x" size={20} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={s.centerRow} pointerEvents="box-none">
            <TouchableOpacity onPress={() => skip(-1)} activeOpacity={0.7} style={s.btn}><Feather name="rotate-ccw" size={22} color="#FFFFFF" /><Text style={s.btnLbl}>10</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => { playing ? player.pause() : player.play(); armHide(); }} activeOpacity={0.7} style={s.btnCenter}>
              <Feather name={playing ? 'pause' : 'play'} size={30} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => skip(1)} activeOpacity={0.7} style={s.btn}><Feather name="rotate-cw" size={22} color="#FFFFFF" /><Text style={s.btnLbl}>10</Text></TouchableOpacity>
          </View>

          <View style={[s.bottom, { paddingBottom: Math.max(insets.bottom, 12) + 10 }]} pointerEvents="box-none">
            <View style={s.timeRow}>
              <Text style={s.time}>{fmt(shown)}</Text>
              <Text style={s.timeDim}> / {fmt(duration)}</Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity onPress={() => { const n = !muted; setMuted(n); player.muted = n; armHide(); }} activeOpacity={0.8} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name={muted ? 'volume-x' : 'volume-2'} size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <View {...scrubPan.panHandlers} style={s.trackHit} onLayout={e => { trackW.current = Math.max(1, e.nativeEvent.layout.width); }}>
              <View style={[s.track, scrubbing && { height: 5 }]}>
                <View style={[s.fill, { width: `${pct * 100}%` }]} />
              </View>
              <View style={[s.knob, scrubbing && s.knobBig, { left: Math.max(0, pct * trackW.current - (scrubbing ? 9 : 6)) }]} />
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', left: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  centerRow: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 44 },
  btn: { alignItems: 'center', justifyContent: 'center' },
  btnLbl: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', marginTop: -2 },
  btnCenter: { width: 66, height: 66, borderRadius: 33, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 30, backgroundColor: 'transparent' },
  timeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  time: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  timeDim: { color: 'rgba(255,255,255,0.6)', fontSize: 12.5, fontWeight: '600', fontVariant: ['tabular-nums'] },
  trackHit: { height: 28, justifyContent: 'center' },
  track: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#FFFFFF' },
  knob: { position: 'absolute', top: 8, width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFFFFF' },
  knobBig: { top: 5, width: 18, height: 18, borderRadius: 9 },
  ripple: { position: 'absolute', top: 0, bottom: 0, width: '45%', alignItems: 'center', justifyContent: 'center' },
  rippleDisc: { width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', gap: 4 },
  rippleTxt: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
