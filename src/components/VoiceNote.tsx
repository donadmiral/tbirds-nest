/**
 * VoiceNote
 *
 * Playback for a chat voice message. Sits inside a bubble, so it has to work on
 * navy and on white, which is why every colour comes in as a prop rather than
 * being decided here.
 *
 * The bars are decorative, not a real waveform. Storing amplitude data per
 * message would mean a schema change and an analysis pass on upload for
 * something nobody looks at closely. They animate with progress, which is the
 * part people actually read.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

type Props = {
  uri: string;
  /** Recorded length in seconds, so the duration shows before the file loads. */
  durationSec?: number | null;
  tint: string;
  dim: string;
  onTint: string;
};

const BAR_COUNT = 27;

function formatTime(total: number) {
  const t = Math.max(0, Math.floor(total));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export default function VoiceNote({ uri, durationSec, tint, dim, onTint }: Props) {
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);
  const [rate, setRate] = useState(1);
  useEffect(() => {
    try { (player as any).setPlaybackRate(rate, 'high'); } catch {}
  }, [rate, player]);

  const playing = !!status?.playing;
  const loaded = !!status?.isLoaded;
  const total = (status?.duration && status.duration > 0)
    ? status.duration
    : (durationSec ?? 0);
  const elapsed = status?.currentTime ?? 0;
  const progress = total > 0 ? Math.min(1, elapsed / total) : 0;

  // A stable pseudo-waveform per message: same uri, same shape every render.
  const heights = useMemo(() => {
    let seed = 0;
    for (let i = 0; i < uri.length; i++) seed = (seed * 31 + uri.charCodeAt(i)) % 100000;
    const out: number[] = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      out.push(0.35 + ((seed % 1000) / 1000) * 0.65);
    }
    return out;
  }, [uri]);

  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!playing) { pulse.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 620, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 620, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [playing, pulse]);

  // Playing to the end leaves the player at the end; rewind so it can replay.
  useEffect(() => {
    if (loaded && !playing && total > 0 && elapsed >= total - 0.15) {
      player.seekTo(0);
    }
  }, [loaded, playing, elapsed, total, player]);

  const toggle = () => {
    if (playing) player.pause();
    else player.play();
  };

  return (
    <View style={s.wrap}>
      <TouchableOpacity
        onPress={toggle}
        style={[s.btn, { backgroundColor: tint }]}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause voice message' : 'Play voice message'}
      >
        <Feather name={playing ? 'pause' : 'play'} size={15} color={onTint} />
      </TouchableOpacity>

      <View style={s.middle}>
        <View style={s.bars}>
          {heights.map((h, i) => {
            const passed = i / BAR_COUNT <= progress;
            return (
              <Animated.View
                key={i}
                style={[
                  s.bar,
                  {
                    height: 4 + h * 18,
                    backgroundColor: passed ? tint : dim,
                    opacity: playing && passed
                      ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] })
                      : 1,
                  },
                ]}
              />
            );
          })}
        </View>
        {(playing || elapsed > 0) ? (
          <TouchableOpacity onPress={() => setRate(r => (r === 1 ? 1.5 : r === 1.5 ? 2 : 1))} style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.12)', marginRight: 5 }}>
            <Text style={{ fontSize: 10.5, fontWeight: '800', color: tint }}>{rate}x</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={[s.time, { color: dim }]}>
          {formatTime(playing || elapsed > 0 ? elapsed : total)}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 210, paddingVertical: 2 },
  btn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  middle: { flex: 1, gap: 3 },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 24 },
  bar: { flex: 1, borderRadius: 1.5, minWidth: 2 },
  time: { fontSize: 11, fontWeight: '600' },
});