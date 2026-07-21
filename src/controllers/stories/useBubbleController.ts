/**
 * useBubbleController.ts
 *
 * Owns: bubble position, scale, animated values, gesture handlers, spring physics.
 * Does NOT own: arrangement state, preset selection, primary camera, persistence.
 *
 * Source of truth: bubbleXRef, bubbleYRef, bubbleScaleRef (pixel values).
 * Animated.Values are the render projection, kept in sync via setValue() and spring().
 *
 * Gesture owner: pan (drag) and tap (swap) on the bubble.
 * Animation owner: all bubble springs and pulse feedback.
 * Cleanup: none needed. Springs self-resolve. Animated.Values GC with component.
 */

import { useCallback, useRef } from 'react';
import { Animated } from 'react-native';
import { PanGestureHandler, TapGestureHandler, State as GHState } from 'react-native-gesture-handler';
import {
  SPRING_BUBBLE_SETTLE,
  SPRING_BUBBLE_PULSE_UP,
  SPRING_BUBBLE_PULSE_DOWN,
  BUBBLE_PULSE_SCALE,
  BUBBLE_BASE_WIDTH,
  BUBBLE_BASE_HEIGHT,
} from '../../constants/motionDualMemory';
import type { BubbleTransform } from '../../types/dualMemoryTransform';
import type { CompositionPreset } from '../../components/stories/DualArrangementOverlay';

export interface BubbleControllerInput {
  initialX: number;
  initialY: number;
  initialScale: number;
  screenW: number;
  screenH: number;
  insets: { top: number; bottom: number };
  onSwap: () => void;
  arrangementOpen: boolean;
  publishing: boolean;
}

export interface BubbleControllerOutput {
  animBubbleX: Animated.Value;
  animBubbleY: Animated.Value;
  animBubbleScale: Animated.Value;
  panRef: React.RefObject<PanGestureHandler>;
  tapRef: React.RefObject<TapGestureHandler>;
  onBubblePan: (event: any) => void;
  onBubbleTap: (event: any) => void;
  animateToPreset: (preset: CompositionPreset) => void;
  getBubbleTransform: () => BubbleTransform;
  hydrateFromLayout: (nx: number, ny: number, scale?: number) => void;
}

export function useBubbleController(input: BubbleControllerInput): BubbleControllerOutput {
  const { initialX, initialY, initialScale, screenW, screenH, insets, onSwap, arrangementOpen, publishing } = input;

  // ── Source of truth (pixel refs) ──
  const xRef = useRef(initialX);
  const yRef = useRef(initialY);
  const scaleRef = useRef(initialScale);

  // ── Render projection (Animated.Values) ──
  const animX = useRef(new Animated.Value(initialX)).current;
  const animY = useRef(new Animated.Value(initialY)).current;
  const animScale = useRef(new Animated.Value(initialScale)).current;

  // ── Gesture refs ──
  const panRef = useRef<PanGestureHandler>(null);
  const tapRef = useRef<TapGestureHandler>(null);

  // ── Interaction locks (refs so callbacks stay stable) ──
  const arrangementOpenRef = useRef(arrangementOpen);
  arrangementOpenRef.current = arrangementOpen;
  const publishingLockRef = useRef(publishing);
  publishingLockRef.current = publishing;

  // ── Clamping logic ──
  const clamp = useCallback((rawX: number, rawY: number): { x: number; y: number } => {
    const bw = BUBBLE_BASE_WIDTH * scaleRef.current;
    const bh = BUBBLE_BASE_HEIGHT * scaleRef.current;
    const minX = bw / 2 + 8;
    const maxX = screenW - bw / 2 - 8;
    const minY = bh / 2 + insets.top + 52;
    const maxY = screenH - bh / 2 - insets.bottom - 80;
    return {
      x: Math.max(minX, Math.min(rawX, maxX)),
      y: Math.max(minY, Math.min(rawY, maxY)),
    };
  }, [screenW, screenH, insets.top, insets.bottom]);

  // ── Settle spring (clamp + animate + pulse) ──
  const settleAt = useCallback((rawX: number, rawY: number) => {
    const clamped = clamp(rawX, rawY);
    xRef.current = clamped.x;
    yRef.current = clamped.y;

    Animated.parallel([
      Animated.spring(animX, { toValue: clamped.x, ...SPRING_BUBBLE_SETTLE }),
      Animated.spring(animY, { toValue: clamped.y, ...SPRING_BUBBLE_SETTLE }),
    ]).start();

    // Pulse feedback on settle
    Animated.sequence([
      Animated.spring(animScale, { toValue: scaleRef.current * BUBBLE_PULSE_SCALE, ...SPRING_BUBBLE_PULSE_UP }),
      Animated.spring(animScale, { toValue: scaleRef.current, ...SPRING_BUBBLE_PULSE_DOWN }),
    ]).start();
  }, [animX, animY, animScale, clamp]);

  // ── Pan gesture handler ──
  const onBubblePan = useCallback(({ nativeEvent }: any) => {
    if (publishingLockRef.current) return;
    const { translationX, translationY, state } = nativeEvent;

    if (state === GHState.ACTIVE) {
      // Live tracking: bypass state, write directly to animated values
      animX.setValue(xRef.current + translationX);
      animY.setValue(yRef.current + translationY);
    }

    if (state === GHState.END || state === GHState.CANCELLED) {
      settleAt(xRef.current + translationX, yRef.current + translationY);
    }
  }, [animX, animY, settleAt]);

  // ── Tap gesture handler (swap) ──
  const onBubbleTap = useCallback(({ nativeEvent }: any) => {
    if (publishingLockRef.current) return;
    if (nativeEvent.state === GHState.ACTIVE) {
      onSwap();
    }
  }, [onSwap]);

  // ── Preset animation (called by ArrangementController) ──
  const animateToPreset = useCallback((preset: CompositionPreset) => {
    const targetX = preset.nx * screenW;
    const targetY = preset.ny * screenH;
    xRef.current = targetX;
    yRef.current = targetY;
    scaleRef.current = preset.scale;

    Animated.parallel([
      Animated.spring(animX, { toValue: targetX, ...SPRING_BUBBLE_SETTLE }),
      Animated.spring(animY, { toValue: targetY, ...SPRING_BUBBLE_SETTLE }),
      Animated.spring(animScale, { toValue: preset.scale, ...SPRING_BUBBLE_SETTLE }),
    ]).start();
  }, [screenW, screenH, animX, animY, animScale]);

  // ── Read current transform ──
  const getBubbleTransform = useCallback((): BubbleTransform => ({
    x: xRef.current,
    y: yRef.current,
    scale: scaleRef.current,
  }), []);

  // ── Hydrate from persisted layout (e.g. on mount from route params) ──
  const hydrateFromLayout = useCallback((nx: number, ny: number, scale?: number) => {
    const px = nx * screenW;
    const py = ny * screenH;
    xRef.current = px;
    yRef.current = py;
    if (scale !== undefined) scaleRef.current = scale;
    animX.setValue(px);
    animY.setValue(py);
    if (scale !== undefined) animScale.setValue(scale);
  }, [screenW, screenH, animX, animY, animScale]);

  return {
    animBubbleX: animX,
    animBubbleY: animY,
    animBubbleScale: animScale,
    panRef: panRef as any,
    tapRef: tapRef as any,
    onBubblePan,
    onBubbleTap,
    animateToPreset,
    getBubbleTransform,
    hydrateFromLayout,
  };
}
