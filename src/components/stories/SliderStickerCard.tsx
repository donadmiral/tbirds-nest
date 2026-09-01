/**
 * SliderStickerCard - Instagram construction.
 * Light card, black label, emoji rides the track under your finger.
 * After answering, the fill settles and the average is marked.
 */
import React, { useCallback, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSpring, runOnJS, Easing,
} from 'react-native-reanimated';

type Props = {
  label: string;
  emoji: string;
  interactive: boolean;
  isOwn: boolean;
  myValue?: number | null;
  averageValue?: number | null;
  responseCount?: number;
  onSubmit?: (value: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
};

const CARD_W = 252;
const PAD = 16;
const TRACK_W = CARD_W - PAD * 2;
const TRACK_H = 7;
const KNOB = 34;
const SPRING = { damping: 15, stiffness: 190 };
const SOFT = { duration: 420, easing: Easing.bezier(0.16, 1, 0.3, 1) };

function tap() { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }

export default function SliderStickerCard({
  label, emoji, interactive, isOwn, myValue, averageValue, responseCount = 0,
  onSubmit, onDragStart, onDragEnd,
}: Props) {
  const answered = myValue !== null && myValue !== undefined;
  const startValue = answered ? (myValue as number) : (isOwn ? (averageValue ?? 0.5) : 0.5);

  const value = useSharedValue(startValue);
  const dragging = useSharedValue(0);

  useEffect(() => {
    value.value = withTiming(startValue, SOFT);
  }, [startValue]);

  const commit = useCallback((v: number) => {
    onDragEnd?.();
    if (!interactive || isOwn || answered) return;
    onSubmit?.(Math.max(0, Math.min(1, v)));
  }, [interactive, isOwn, answered, onSubmit, onDragEnd]);

  const begin = useCallback(() => { onDragStart?.(); tap(); }, [onDragStart]);

  const locked = isOwn || answered || !interactive;

  const pan = Gesture.Pan()
    .enabled(!locked)
    .onBegin(() => { dragging.value = withTiming(1, { duration: 120 }); runOnJS(begin)(); })
    .onUpdate(e => {
      const next = Math.max(0, Math.min(1, e.x / TRACK_W));
      value.value = next;
    })
    .onEnd(() => {
      dragging.value = withTiming(0, { duration: 180 });
      runOnJS(commit)(value.value);
    })
    .onFinalize(() => { dragging.value = withTiming(0, { duration: 180 }); });

  const fillStyle = useAnimatedStyle(() => ({ width: ((value.value * 100) + '%') as any }));
  const knobStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: value.value * TRACK_W - KNOB / 2 },
      { scale: withSpring(1 + dragging.value * 0.22, SPRING) },
    ],
  }));

  const avgLeft = averageValue !== null && averageValue !== undefined ? averageValue * TRACK_W : null;

  return (
    <View style={s.card}>
      <Text style={s.label} numberOfLines={2}>{label}</Text>

      <GestureDetector gesture={pan}>
        <View style={s.trackArea}>
          <View style={s.track}>
            <Animated.View style={[s.fill, fillStyle]}><LinearGradient colors={['#C9BFB0', '#E8A13A']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} /></Animated.View>
          </View>
          {avgLeft !== null && (isOwn || answered) && (
            <View style={[s.avgMark, { left: avgLeft - 1 }]} pointerEvents="none" />
          )}
          <Animated.View style={[s.knob, knobStyle]} pointerEvents="none">
            <Text style={s.knobTxt}>{emoji}</Text>
          </Animated.View>
        </View>
      </GestureDetector>

      {(isOwn || answered) && (
        <Text style={s.meta}>
          {responseCount > 0
            ? `${responseCount} ${responseCount === 1 ? 'response' : 'responses'}`
            : 'No responses yet'}
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { width: CARD_W, backgroundColor: '#FFFFFF', borderRadius: 18, paddingHorizontal: PAD, paddingTop: 14, paddingBottom: 14, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  label: { fontSize: 16, fontWeight: '800', color: '#0B1E3D', letterSpacing: -0.2, textAlign: 'center', marginBottom: 18 },
  trackArea: { height: KNOB, justifyContent: 'center' },
  track: { height: TRACK_H + 3, borderRadius: (TRACK_H + 3) / 2, backgroundColor: 'rgba(11,30,61,0.10)', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: (TRACK_H + 3) / 2, overflow: 'hidden' },
  avgMark: { position: 'absolute', width: 2.5, height: 18, borderRadius: 1.5, backgroundColor: '#0B1E3D' },
  knob: { position: 'absolute', left: 0, width: KNOB, height: KNOB, alignItems: 'center', justifyContent: 'center' },
  knobTxt: { fontSize: 26 },
  meta: { marginTop: 12, fontSize: 12, fontWeight: '600', color: 'rgba(11,30,61,0.55)', textAlign: 'center' },
});