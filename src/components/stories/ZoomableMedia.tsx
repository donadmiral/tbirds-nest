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
import { StyleSheet, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle, useSharedValue, withTiming, runOnJS,
} from 'react-native-reanimated';

type Props = {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** Told when a zoom starts and ends, so the caller can pause the timer. */
  onZoomChange?: (zooming: boolean) => void;
  maxScale?: number;
};

export default function ZoomableMedia({
  children, style, onZoomChange, maxScale = 4,
}: Props) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);

  const notify = (z: boolean) => { onZoomChange?.(z); };

  const pinch = Gesture.Pinch()
    .onStart(e => {
      originX.value = e.focalX;
      originY.value = e.focalY;
      if (onZoomChange) runOnJS(notify)(true);
    })
    .onUpdate(e => {
      const next = savedScale.value * e.scale;
      scale.value = Math.min(Math.max(next, 1), maxScale);
      // Follow the fingers so the point you pinched stays under them.
      tx.value = e.focalX - originX.value;
      ty.value = e.focalY - originY.value;
    })
    .onEnd(() => {
      savedScale.value = 1;
      scale.value = withTiming(1, { duration: 180 });
      tx.value = withTiming(0, { duration: 180 });
      ty.value = withTiming(0, { duration: 180 });
      if (onZoomChange) runOnJS(notify)(false);
    });

  // Panning only does anything once you are zoomed in.
  const pan = Gesture.Pan()
    .minPointers(2)
    .onUpdate(e => {
      if (scale.value <= 1) return;
      tx.value = e.translationX;
      ty.value = e.translationY;
    })
    .onEnd(() => {
      tx.value = withTiming(0, { duration: 180 });
      ty.value = withTiming(0, { duration: 180 });
    });

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