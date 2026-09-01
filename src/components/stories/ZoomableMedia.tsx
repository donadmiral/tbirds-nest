/**
 * ZoomableMedia
 *
 * Pinch to zoom on a story, the way Instagram does it: the image scales under
 * your fingers, follows them, and springs back when you let go. It does not
 * stay zoomed, because a story is on a timer and leaving someone zoomed into a
 * corner while the clock runs is worse than not zooming at all.
 *
 * Composed with Gesture.Simultaneous so it never steals the taps that advance
 * the story or the long-press that pauses it.
 */
import React from 'react';
import { StyleSheet, ViewStyle, Dimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle, useSharedValue, withSpring, runOnJS,
} from 'react-native-reanimated';

type Props = {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** Told when a zoom starts and ends, so the caller can pause the timer. */
  onZoomChange?: (zooming: boolean) => void;
  maxScale?: number;
};

export default function ZoomableMedia({
  children, style, onZoomChange, maxScale = 3,
}: Props) {
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const W = Dimensions.get('window').width;
  const H = Dimensions.get('window').height;

  const notify = (zooming: boolean) => { onZoomChange?.(zooming); };

  // Pinch: the point under your fingers stays under your fingers. Translation is
  // the focal offset from the centre, scaled, plus how far the fingers drift.
  const pinch = Gesture.Pinch()
    .onStart(e => {
      originX.value = e.focalX;
      originY.value = e.focalY;
      panX.value = 0; panY.value = 0;
      if (onZoomChange) runOnJS(notify)(true);
    })
    .onUpdate(e => {
      const s = Math.min(Math.max(e.scale, 1), maxScale);
      scale.value = s;
      tx.value = (originX.value - W / 2) * (1 - s) + (e.focalX - originX.value) + panX.value;
      ty.value = (originY.value - H / 2) * (1 - s) + (e.focalY - originY.value) + panY.value;
    })
    .onEnd(() => {
      scale.value = withSpring(1, { damping: 18, stiffness: 220, mass: 0.6 });
      tx.value = withSpring(0, { damping: 18, stiffness: 220, mass: 0.6 });
      ty.value = withSpring(0, { damping: 18, stiffness: 220, mass: 0.6 });
      if (onZoomChange) runOnJS(notify)(false);
    });

  // Two-finger drag while zoomed moves the picture with the fingers.
  const pan = Gesture.Pan()
    .minPointers(2)
    .maxPointers(2)
    .onUpdate(e => {
      if (scale.value <= 1.01) return;
      panX.value = e.translationX;
      panY.value = e.translationY;
    })
    .onEnd(() => { panX.value = 0; panY.value = 0; });

  const composed = Gesture.Simultaneous(pinch, pan);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={[StyleSheet.absoluteFill, style, animStyle]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
