/**
 * MemoryArrangementScreen.tsx
 *
 * "Shape the memory before you decorate it."
 *
 * Dedicated composition stage between dual capture and the full composer.
 * Users drag, resize, swap, and preset-select their PiP bubble layout.
 *
 * Gesture stack:
 *   TapGestureHandler (swap, waitFor: panRef)
 *     └─ PanGestureHandler (drag, ref: panRef, simultaneousHandlers: [pinchRef])
 *         └─ PinchGestureHandler (resize, ref: pinchRef, simultaneousHandlers: [panRef])
 *
 * All transform animations use useNativeDriver: true.
 * No TextInput. No keyboard. No stickers. No bloom.
 * Single interactive object: the bubble.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  Animated,
  Easing,
  AccessibilityInfo,
  Alert,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  PanGestureHandler,
  PinchGestureHandler,
  TapGestureHandler,
  State as GHState,
} from 'react-native-gesture-handler';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import type { DualCaptureAsset, DualLayout } from '../../components/stories/dual/dualCaptureTypes';

// ─── SCREEN DIMENSIONS ────────────────────────────────────────
const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;

// ─── BUBBLE BASE DIMENSIONS ──────────────────────────────────
const BUBBLE_BASE_W = 120;
const BUBBLE_BASE_H = 160;
const BUBBLE_RADIUS = 28;
const BUBBLE_BORDER = 2.5;

// ─── SCALE LIMITS ────────────────────────────────────────────
const MIN_SCALE = 0.6;
const MAX_SCALE = 2.5;

// ─── SNAP PRESET SCALES ─────────────────────────────────────
const SCALE_PRESETS = [
  { scale: 0.8, threshold: 0.08 },
  { scale: 1.0, threshold: 0.08 },
  { scale: 1.5, threshold: 0.1 },
  { scale: 2.0, threshold: 0.12 },
];

// ─── SNAP ZONE ACTIVATION DISTANCES (px) ────────────────────
const CORNER_SNAP_DIST = 20;
const CENTER_SNAP_DIST = 15;
const EDGE_SNAP_DIST = 12;

// ─── DRAG THRESHOLDS ────────────────────────────────────────
const FLING_VELOCITY = 500;
const THROW_VELOCITY = 1000;
const RUBBER_BAND_FACTOR = 0.3;
const SNAP_VELOCITY_DAMPEN = 0.6;

// ─── SPRING CONFIGS ─────────────────────────────────────────
const SPRINGS = {
  bubbleEntry: { damping: 14, stiffness: 140, mass: 1.0, useNativeDriver: true },
  bubbleSettle: { damping: 16, stiffness: 180, mass: 0.9, useNativeDriver: true },
  snapPull: { damping: 20, stiffness: 200, mass: 0.8, useNativeDriver: true },
  rubberReturn: { damping: 18, stiffness: 200, mass: 0.85, useNativeDriver: true },
  fling: { damping: 12, stiffness: 140, mass: 0.9, useNativeDriver: true },
  scaleSnap: { damping: 18, stiffness: 200, mass: 0.8, useNativeDriver: true },
  presetMove: { damping: 15, stiffness: 160, mass: 0.9, useNativeDriver: true },
  swapTransition: { damping: 14, stiffness: 140, mass: 1.0, useNativeDriver: true },
  doneExit: { damping: 14, stiffness: 160, mass: 0.9, useNativeDriver: true },
};

// ─── COMPOSITION PRESETS ────────────────────────────────────
interface CompositionPreset {
  id: string;
  label: string;
  nx: number;
  ny: number;
  scale: number;
  icon: string;
}

const PRESETS: CompositionPreset[] = [
  { id: 'corner', label: 'Corner', nx: 0.85, ny: 0.72, scale: 0.8, icon: 'corner-down-right' },
  { id: 'centered', label: 'Center', nx: 0.5, ny: 0.5, scale: 1.0, icon: 'crosshair' },
  { id: 'dramatic', label: 'Bold', nx: 0.15, ny: 0.18, scale: 1.5, icon: 'maximize' },
  { id: 'cinematic', label: 'Cinema', nx: 0.5, ny: 0.78, scale: 1.0, icon: 'film' },
  { id: 'minimal', label: 'Minimal', nx: 0.88, ny: 0.12, scale: 0.7, icon: 'minimize-2' },
];

// ─── SERIALIZATION TYPE ─────────────────────────────────────
export interface DualLayoutState {
  version: 1;
  mode: DualLayout;
  primaryCamera: 'front' | 'rear';
  bubble: {
    nx: number;
    ny: number;
    scale: number;
  };
  presetId: string | null;
}

// ─── HELPERS ────────────────────────────────────────────────
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

// ─── COMPONENT ──────────────────────────────────────────────

export default function MemoryArrangementScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();

  // ── Extract params ──
  const asset: DualCaptureAsset | undefined = route.params?.asset ?? route.params?.assets?.[0];
  const extraParams = route.params?.extraParams ?? {};

  // ── Validate ──
  const rearUri = asset?.rearUri ?? null;
  const frontUri = asset?.frontUri ?? null;
  const hasValidAsset = !!(rearUri && frontUri);

  // ── State ──
  const [primaryCamera, setPrimaryCamera] = useState<'front' | 'rear'>('rear');
  const [selectedPreset, setSelectedPreset] = useState<string | null>('corner');
  const [reduceMotion, setReduceMotion] = useState(false);
  const mountedRef = useRef(true);

  // The photo displayed fullscreen vs in bubble depends on primaryCamera
  const fullscreenUri = primaryCamera === 'rear' ? rearUri : frontUri;
  const bubbleUri = primaryCamera === 'rear' ? frontUri : rearUri;

  // ── Safe zone computation ──
  const safeTop = insets.top + 52;
  const safeBottom = SCREEN_H - insets.bottom - 130;
  const safeLeft = 8;
  const safeRight = SCREEN_W - 8;

  // ── Bubble state (pixels, center-anchored) ──
  const initialPreset = PRESETS[0]; // corner
  const initialX = initialPreset.nx * SCREEN_W;
  const initialY = initialPreset.ny * SCREEN_H;
  const initialScale = initialPreset.scale;

  // These refs track the "committed" bubble state (updated on gesture end)
  const bubbleX = useRef(initialX);
  const bubbleY = useRef(initialY);
  const bubbleScale = useRef(initialScale);

  // Animated values for rendering
  const animX = useRef(new Animated.Value(initialX)).current;
  const animY = useRef(new Animated.Value(initialY)).current;
  const animScale = useRef(new Animated.Value(initialScale)).current;
  const animBubbleOpacity = useRef(new Animated.Value(0)).current;

  // Gesture base refs (captured at gesture start)
  const panBaseX = useRef(initialX);
  const panBaseY = useRef(initialY);
  const pinchBaseScale = useRef(initialScale);

  // ── Swap animation values ──
  const swapFullscreenOpacity = useRef(new Animated.Value(1)).current;
  const swapNewFullscreenOpacity = useRef(new Animated.Value(0)).current;
  const swapBubbleOpacity = useRef(new Animated.Value(1)).current;
  const swapping = useRef(false);

  // ── UI entry animation values ──
  const topBarOpacity = useRef(new Animated.Value(0)).current;
  const bottomStripTransY = useRef(new Animated.Value(60)).current;
  const bottomStripOpacity = useRef(new Animated.Value(0)).current;
  const presetStripOpacity = useRef(new Animated.Value(0)).current;

  // ── Guide line state ──
  const [guideX, setGuideX] = useState<number | null>(null);
  const [guideY, setGuideY] = useState<number | null>(null);

  // ── Gesture refs for handler wiring ──
  const panRef = useRef<PanGestureHandler>(null);
  const pinchRef = useRef<PinchGestureHandler>(null);
  const tapRef = useRef<TapGestureHandler>(null);

  // ── Lifecycle ──
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Reduced motion ──
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub?.remove?.();
  }, []);

  // ── Entry animation ──
  useEffect(() => {
    if (!hasValidAsset) return;

    if (reduceMotion) {
      animBubbleOpacity.setValue(1);
      topBarOpacity.setValue(0.6);
      bottomStripTransY.setValue(0);
      bottomStripOpacity.setValue(1);
      presetStripOpacity.setValue(1);
      return;
    }

    // Bubble springs in
    Animated.parallel([
      Animated.spring(animBubbleOpacity, { toValue: 1, delay: 200, ...SPRINGS.bubbleEntry }),
      Animated.spring(animScale, { toValue: initialScale, delay: 200, ...SPRINGS.bubbleEntry }),
    ]).start();

    // Top bar fades in
    Animated.timing(topBarOpacity, {
      toValue: 0.6,
      duration: 300,
      delay: 400,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();

    // Bottom strip slides up
    Animated.parallel([
      Animated.timing(bottomStripTransY, {
        toValue: 0,
        duration: 280,
        delay: 500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(bottomStripOpacity, {
        toValue: 1,
        duration: 280,
        delay: 500,
        useNativeDriver: true,
      }),
    ]).start();

    // Preset strip fades in
    Animated.timing(presetStripOpacity, {
      toValue: 1,
      duration: 250,
      delay: 600,
      useNativeDriver: true,
    }).start();
  }, [hasValidAsset, reduceMotion]);

  // ── Safe zone clamping for bubble center ──
  const clampToSafe = useCallback((x: number, y: number, scale: number): { x: number; y: number } => {
    const halfW = (BUBBLE_BASE_W * scale) / 2;
    const halfH = (BUBBLE_BASE_H * scale) / 2;
    const minX = safeLeft + halfW;
    const maxX = safeRight - halfW;
    const minY = safeTop + halfH;
    const maxY = safeBottom - halfH;
    return {
      x: clamp(x, Math.min(minX, maxX), Math.max(minX, maxX)),
      y: clamp(y, Math.min(minY, maxY), Math.max(minY, maxY)),
    };
  }, [safeTop, safeBottom, safeLeft, safeRight]);

  // ── Snap zone detection ──
  const findSnapTarget = useCallback((cx: number, cy: number, scale: number): {
    snapX: number | null;
    snapY: number | null;
    distX: number;
    distY: number;
  } => {
    const clamped = clampToSafe(cx, cy, scale);
    const halfW = (BUBBLE_BASE_W * scale) / 2;
    const halfH = (BUBBLE_BASE_H * scale) / 2;
    const minX = safeLeft + halfW;
    const maxX = safeRight - halfW;
    const minY = safeTop + halfH;
    const maxY = safeBottom - halfH;
    const centerX = SCREEN_W / 2;
    const centerY = SCREEN_H / 2;

    let bestSnapX: number | null = null;
    let bestDistX = Infinity;
    let bestSnapY: number | null = null;
    let bestDistY = Infinity;

    // Corner and edge X candidates
    const xCandidates = [
      { pos: minX, dist: CORNER_SNAP_DIST },
      { pos: maxX, dist: CORNER_SNAP_DIST },
      { pos: centerX, dist: CENTER_SNAP_DIST },
    ];

    for (const c of xCandidates) {
      const d = Math.abs(cx - c.pos);
      if (d < c.dist && d < bestDistX) {
        bestDistX = d;
        bestSnapX = c.pos;
      }
    }

    // Corner and edge Y candidates
    const yCandidates = [
      { pos: minY, dist: CORNER_SNAP_DIST },
      { pos: maxY, dist: CORNER_SNAP_DIST },
      { pos: centerY, dist: CENTER_SNAP_DIST },
    ];

    for (const c of yCandidates) {
      const d = Math.abs(cy - c.pos);
      if (d < c.dist && d < bestDistY) {
        bestDistY = d;
        bestSnapY = c.pos;
      }
    }

    return { snapX: bestSnapX, snapY: bestSnapY, distX: bestDistX, distY: bestDistY };
  }, [clampToSafe, safeTop, safeBottom, safeLeft, safeRight]);

  // ── Haptic tracker (prevent repeat haptics in same snap zone) ──
  const lastSnapZoneRef = useRef<string | null>(null);

  // ── PAN GESTURE ───────────────────────────────────────────
  const onPanEvent = useCallback((e: any) => {
    if (swapping.current) return;
    const { translationX, translationY } = e.nativeEvent;
    const scale = bubbleScale.current;
    const rawX = panBaseX.current + translationX;
    const rawY = panBaseY.current + translationY;

    // Compute safe bounds
    const halfW = (BUBBLE_BASE_W * scale) / 2;
    const halfH = (BUBBLE_BASE_H * scale) / 2;
    const minX = safeLeft + halfW;
    const maxX = safeRight - halfW;
    const minY = safeTop + halfH;
    const maxY = safeBottom - halfH;

    // Apply rubber band outside safe zone
    let finalX = rawX;
    let finalY = rawY;

    if (rawX < minX) {
      finalX = minX + (rawX - minX) * RUBBER_BAND_FACTOR;
    } else if (rawX > maxX) {
      finalX = maxX + (rawX - maxX) * RUBBER_BAND_FACTOR;
    }

    if (rawY < minY) {
      finalY = minY + (rawY - minY) * RUBBER_BAND_FACTOR;
    } else if (rawY > maxY) {
      finalY = maxY + (rawY - maxY) * RUBBER_BAND_FACTOR;
    }

    // Snap zone detection for guide lines and velocity dampening
    const snap = findSnapTarget(rawX, rawY, scale);
    const inSnapX = snap.snapX !== null;
    const inSnapY = snap.snapY !== null;

    // Apply snap dampening (pull toward snap point)
    if (inSnapX && snap.snapX !== null) {
      const pull = 1 - (snap.distX / CORNER_SNAP_DIST) * (1 - SNAP_VELOCITY_DAMPEN);
      finalX = finalX + (snap.snapX - finalX) * (1 - pull) * 0.3;
    }
    if (inSnapY && snap.snapY !== null) {
      const pull = 1 - (snap.distY / CORNER_SNAP_DIST) * (1 - SNAP_VELOCITY_DAMPEN);
      finalY = finalY + (snap.snapY - finalY) * (1 - pull) * 0.3;
    }

    // Update guide lines
    const snapKey = `${inSnapX ? snap.snapX?.toFixed(0) : 'n'}_${inSnapY ? snap.snapY?.toFixed(0) : 'n'}`;
    if (snapKey !== lastSnapZoneRef.current) {
      lastSnapZoneRef.current = snapKey;
      if (inSnapX || inSnapY) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }
    setGuideX(inSnapX ? snap.snapX : null);
    setGuideY(inSnapY ? snap.snapY : null);

    animX.setValue(finalX);
    animY.setValue(finalY);
  }, [findSnapTarget, safeTop, safeBottom, safeLeft, safeRight]);

  const onPanStateChange = useCallback((e: any) => {
    if (swapping.current) return;
    const { state, translationX, translationY, velocityX, velocityY } = e.nativeEvent;

    if (state === GHState.BEGAN) {
      panBaseX.current = bubbleX.current;
      panBaseY.current = bubbleY.current;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSelectedPreset(null);
    }

    if (state === GHState.END || state === GHState.CANCELLED) {
      setGuideX(null);
      setGuideY(null);
      lastSnapZoneRef.current = null;

      if (state === GHState.CANCELLED) {
        // Return to pre-drag position
        const config = reduceMotion
          ? { toValue: 0, duration: 200, useNativeDriver: true }
          : SPRINGS.bubbleSettle;

        Animated.parallel([
          reduceMotion
            ? Animated.timing(animX, { ...config, toValue: bubbleX.current })
            : Animated.spring(animX, { ...config, toValue: bubbleX.current }),
          reduceMotion
            ? Animated.timing(animY, { ...config, toValue: bubbleY.current })
            : Animated.spring(animY, { ...config, toValue: bubbleY.current }),
        ]).start();
        return;
      }

      const scale = bubbleScale.current;
      const rawX = panBaseX.current + translationX;
      const rawY = panBaseY.current + translationY;
      const clamped = clampToSafe(rawX, rawY, scale);
      const velocity = Math.sqrt(velocityX ** 2 + velocityY ** 2);

      // Check snap zones at clamped position
      const snap = findSnapTarget(clamped.x, clamped.y, scale);
      const hasSnap = snap.snapX !== null || snap.snapY !== null;

      let targetX = clamped.x;
      let targetY = clamped.y;

      if (hasSnap) {
        if (snap.snapX !== null) targetX = snap.snapX;
        if (snap.snapY !== null) targetY = snap.snapY;
      }

      // Apply fling momentum for high velocity (only if no snap)
      if (!hasSnap && velocity > FLING_VELOCITY) {
        const momentumDuration = 0.1; // 100ms of momentum
        const momentumX = velocityX * momentumDuration;
        const momentumY = velocityY * momentumDuration;
        const flung = clampToSafe(targetX + momentumX, targetY + momentumY, scale);
        targetX = flung.x;
        targetY = flung.y;
      }

      bubbleX.current = targetX;
      bubbleY.current = targetY;

      // Choose spring config
      let springConfig;
      if (hasSnap) {
        springConfig = SPRINGS.snapPull;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } else if (velocity > THROW_VELOCITY) {
        springConfig = SPRINGS.fling;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else if (rawX !== clamped.x || rawY !== clamped.y) {
        // Was outside safe zone, springing back
        springConfig = SPRINGS.rubberReturn;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else {
        springConfig = SPRINGS.bubbleSettle;
      }

      if (reduceMotion) {
        animX.setValue(targetX);
        animY.setValue(targetY);
      } else {
        Animated.parallel([
          Animated.spring(animX, { ...springConfig, toValue: targetX }),
          Animated.spring(animY, { ...springConfig, toValue: targetY }),
        ]).start();
      }
    }
  }, [clampToSafe, findSnapTarget, reduceMotion]);

  // ── PINCH GESTURE ─────────────────────────────────────────
  const onPinchEvent = useCallback((e: any) => {
    if (swapping.current) return;
    const { scale } = e.nativeEvent;
    const newScale = clamp(pinchBaseScale.current * scale, MIN_SCALE, MAX_SCALE);
    animScale.setValue(newScale);

    // Re-clamp position at new scale
    const clamped = clampToSafe(bubbleX.current, bubbleY.current, newScale);
    if (clamped.x !== bubbleX.current || clamped.y !== bubbleY.current) {
      animX.setValue(clamped.x);
      animY.setValue(clamped.y);
    }
  }, [clampToSafe]);

  const onPinchStateChange = useCallback((e: any) => {
    if (swapping.current) return;
    const { state, scale } = e.nativeEvent;

    if (state === GHState.BEGAN) {
      pinchBaseScale.current = bubbleScale.current;
      setSelectedPreset(null);
    }

    if (state === GHState.END || state === GHState.CANCELLED) {
      const rawScale = clamp(pinchBaseScale.current * scale, MIN_SCALE, MAX_SCALE);

      // Check for preset scale snap
      let finalScale = rawScale;
      let snapped = false;
      for (const preset of SCALE_PRESETS) {
        if (Math.abs(rawScale - preset.scale) < preset.threshold) {
          finalScale = preset.scale;
          snapped = true;
          break;
        }
      }

      bubbleScale.current = finalScale;
      pinchBaseScale.current = finalScale;

      // Clamp position at final scale
      const clamped = clampToSafe(bubbleX.current, bubbleY.current, finalScale);
      bubbleX.current = clamped.x;
      bubbleY.current = clamped.y;

      if (snapped) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      if (reduceMotion) {
        animScale.setValue(finalScale);
        animX.setValue(clamped.x);
        animY.setValue(clamped.y);
      } else {
        Animated.parallel([
          Animated.spring(animScale, { ...SPRINGS.scaleSnap, toValue: finalScale }),
          Animated.spring(animX, { ...SPRINGS.scaleSnap, toValue: clamped.x }),
          Animated.spring(animY, { ...SPRINGS.scaleSnap, toValue: clamped.y }),
        ]).start();
      }
    }
  }, [clampToSafe, reduceMotion]);

  // ── TAP TO SWAP ───────────────────────────────────────────
  const onTapStateChange = useCallback((e: any) => {
    if (e.nativeEvent.state !== GHState.ACTIVE) return;
    if (swapping.current) return;

    swapping.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const dur = reduceMotion ? 200 : 200; // phase duration

    // Phase 1: fade out current
    Animated.parallel([
      Animated.timing(swapFullscreenOpacity, { toValue: 0.3, duration: dur, useNativeDriver: true }),
      Animated.timing(swapBubbleOpacity, { toValue: 0.3, duration: dur, useNativeDriver: true }),
    ]).start(() => {
      if (!mountedRef.current) return;

      // Flip primary camera
      setPrimaryCamera(prev => prev === 'rear' ? 'front' : 'rear');

      // Phase 2: fade in new arrangement
      Animated.parallel([
        Animated.timing(swapFullscreenOpacity, { toValue: 1, duration: dur, useNativeDriver: true }),
        Animated.timing(swapBubbleOpacity, { toValue: 1, duration: dur, useNativeDriver: true }),
      ]).start(() => {
        if (mountedRef.current) {
          swapping.current = false;
        }
      });
    });
  }, [reduceMotion]);

  // ── PRESET SELECTION ──────────────────────────────────────
  const selectPreset = useCallback((preset: CompositionPreset) => {
    if (swapping.current) return;

    Haptics.selectionAsync();
    setSelectedPreset(preset.id);

    const targetX = preset.nx * SCREEN_W;
    const targetY = preset.ny * SCREEN_H;
    const targetScale = preset.scale;

    // Clamp target to safe zone
    const clamped = clampToSafe(targetX, targetY, targetScale);

    bubbleX.current = clamped.x;
    bubbleY.current = clamped.y;
    bubbleScale.current = targetScale;
    pinchBaseScale.current = targetScale;

    if (reduceMotion) {
      animX.setValue(clamped.x);
      animY.setValue(clamped.y);
      animScale.setValue(targetScale);
    } else {
      Animated.parallel([
        Animated.spring(animX, { ...SPRINGS.presetMove, toValue: clamped.x }),
        Animated.spring(animY, { ...SPRINGS.presetMove, toValue: clamped.y }),
        Animated.spring(animScale, { ...SPRINGS.presetMove, toValue: targetScale }),
      ]).start();
    }
  }, [clampToSafe, reduceMotion]);

  // ── DONE ──────────────────────────────────────────────────
  const handleDone = useCallback(() => {
    if (swapping.current) return;
    console.log('[Arrangement.handleDone]', { primaryCamera, nx: bubbleX.current / SCREEN_W, ny: bubbleY.current / SCREEN_H, scale: bubbleScale.current, preset: selectedPreset });

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    const layoutState: DualLayoutState = {
      version: 1,
      mode: primaryCamera === 'rear' ? 'pip_front_small' : 'pip_rear_small',
      primaryCamera,
      bubble: {
        nx: bubbleX.current / SCREEN_W,
        ny: bubbleY.current / SCREEN_H,
        scale: bubbleScale.current,
      },
      presetId: selectedPreset,
    };

    const composerParams = {
      mode: 'dual',
      assets: [{ ...asset, layout: layoutState }],
      ...extraParams,
    };

    if (reduceMotion) {
      navigation.navigate('StoryComposer', composerParams);
      return;
    }

    // Exit choreography
    Animated.parallel([
      Animated.timing(bottomStripOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(bottomStripTransY, { toValue: 60, duration: 200, useNativeDriver: true }),
      Animated.timing(presetStripOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(topBarOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start();

    // Bubble pulse then navigate
    Animated.sequence([
      Animated.spring(animScale, {
        ...SPRINGS.doneExit,
        toValue: bubbleScale.current * 1.05,
      }),
      Animated.spring(animScale, {
        ...SPRINGS.doneExit,
        toValue: bubbleScale.current,
      }),
    ]).start(() => {
      if (mountedRef.current) {
        navigation.navigate('StoryComposer', composerParams);
      }
    });
  }, [primaryCamera, selectedPreset, asset, extraParams, reduceMotion, navigation]);

  // ── CANCEL ────────────────────────────────────────────────
  const handleCancel = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // ── BUBBLE RENDER TRANSFORM ───────────────────────────────
  const bubbleTransform = useMemo(() => {
    // Bubble is center-anchored. We translate so that the Animated position
    // represents the center of the bubble.
    const offsetX = Animated.subtract(animX, BUBBLE_BASE_W / 2);
    const offsetY = Animated.subtract(animY, BUBBLE_BASE_H / 2);

    return {
      transform: [
        { translateX: Animated.subtract(animX, SCREEN_W / 2) },
        { translateY: Animated.subtract(animY, SCREEN_H / 2) },
        { scale: animScale },
      ],
      opacity: Animated.multiply(animBubbleOpacity, swapBubbleOpacity),
    };
  }, []);

  // ── ERROR STATE ───────────────────────────────────────────
  if (!hasValidAsset) {
    return (
      <View style={s.errorWrap}>
        <StatusBar barStyle="light-content" />
        <Feather name="alert-circle" size={40} color="rgba(255,255,255,0.4)" />
        <Text style={s.errorTitle}>Memory lost</Text>
        <Text style={s.errorSub}>Could not load captured photos.</Text>
        <TouchableOpacity style={s.errorBtn} onPress={handleCancel} activeOpacity={0.7}>
          <Text style={s.errorBtnTxt}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── MAIN RENDER ───────────────────────────────────────────
  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" />

      {/* ── Fullscreen rear/front photo ── */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: swapFullscreenOpacity }]}>
        <Image
          source={{ uri: fullscreenUri! }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      </Animated.View>

      {/* ── Atmospheric gradients ── */}
      <LinearGradient
        colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0)']}
        style={s.topGradient}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.5)']}
        style={s.bottomGradient}
        pointerEvents="none"
      />

      {/* ── Guide lines ── */}
      {guideX !== null && (
        <View style={[s.guideVertical, { left: guideX }]} pointerEvents="none" />
      )}
      {guideY !== null && (
        <View style={[s.guideHorizontal, { top: guideY }]} pointerEvents="none" />
      )}

      {/* ── Draggable bubble ── */}
      <TapGestureHandler
        ref={tapRef}
        waitFor={panRef}
        numberOfTaps={1}
        maxDist={10}
        onHandlerStateChange={onTapStateChange}
      >
        <Animated.View style={StyleSheet.absoluteFill}>
          <PanGestureHandler
            ref={panRef}
            simultaneousHandlers={[pinchRef]}
            minDist={8}
            onGestureEvent={onPanEvent}
            onHandlerStateChange={onPanStateChange}
          >
            <Animated.View style={StyleSheet.absoluteFill}>
              <PinchGestureHandler
                ref={pinchRef}
                simultaneousHandlers={[panRef]}
                onGestureEvent={onPinchEvent}
                onHandlerStateChange={onPinchStateChange}
              >
                <Animated.View style={StyleSheet.absoluteFill}>
                  {/* The bubble itself */}
                  <Animated.View
                    style={[
                      s.bubble,
                      {
                        width: BUBBLE_BASE_W,
                        height: BUBBLE_BASE_H,
                        borderRadius: BUBBLE_RADIUS,
                        // Position at center of screen, then translate to actual position
                        left: SCREEN_W / 2 - BUBBLE_BASE_W / 2,
                        top: SCREEN_H / 2 - BUBBLE_BASE_H / 2,
                        transform: [
                          { translateX: Animated.subtract(animX, SCREEN_W / 2) },
                          { translateY: Animated.subtract(animY, SCREEN_H / 2) },
                          { scale: animScale },
                        ],
                        opacity: Animated.multiply(animBubbleOpacity, swapBubbleOpacity),
                      },
                    ]}
                  >
                    <Image
                      source={{ uri: bubbleUri! }}
                      style={s.bubbleImg}
                      resizeMode="cover"
                    />
                    <View style={s.bubbleIconWrap}>
                      <Feather
                        name={primaryCamera === 'rear' ? 'smile' : 'globe'}
                        size={10}
                        color="#FFF"
                      />
                    </View>
                  </Animated.View>
                </Animated.View>
              </PinchGestureHandler>
            </Animated.View>
          </PanGestureHandler>
        </Animated.View>
      </TapGestureHandler>

      {/* ── Top bar ── */}
      <Animated.View style={[s.topBar, { paddingTop: insets.top + 8, opacity: topBarOpacity }]}>
        <TouchableOpacity
          style={s.cancelBtn}
          onPress={handleCancel}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <View style={s.cancelBtnInner}>
            <Feather name="x" size={18} color="#FFF" />
          </View>
        </TouchableOpacity>

        <Text style={s.titleTxt}>Compose your memory</Text>

        <View style={{ width: 44 }} />
      </Animated.View>

      {/* ── Bottom controls ── */}
      <Animated.View
        style={[
          s.bottomControls,
          {
            paddingBottom: Math.max(insets.bottom, 16) + 8,
            opacity: bottomStripOpacity,
            transform: [{ translateY: bottomStripTransY }],
          },
        ]}
      >
        {/* Preset strip */}
        <Animated.View style={[s.presetStrip, { opacity: presetStripOpacity }]}>
          {PRESETS.map(preset => {
            const isActive = selectedPreset === preset.id;
            return (
              <TouchableOpacity
                key={preset.id}
                style={[s.presetItem, isActive && s.presetItemActive]}
                onPress={() => selectPreset(preset)}
                activeOpacity={0.7}
              >
                <View style={[s.presetIcon, isActive && s.presetIconActive]}>
                  <Feather
                    name={preset.icon as any}
                    size={16}
                    color={isActive ? '#FFF' : 'rgba(255,255,255,0.5)'}
                  />
                </View>
                <Text style={[s.presetLabel, isActive && s.presetLabelActive]}>
                  {preset.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </Animated.View>

        {/* Swap hint + Done row */}
        <View style={s.actionRow}>
          <TouchableOpacity style={s.swapHint} onPress={() => {
            // Manual swap trigger (alternative to tapping bubble)
            if (!swapping.current) {
              onTapStateChange({ nativeEvent: { state: GHState.ACTIVE } });
            }
          }} activeOpacity={0.7}>
            <Feather name="repeat" size={14} color="rgba(255,255,255,0.6)" />
            <Text style={s.swapHintTxt}>Swap</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.doneBtn}
            onPress={handleDone}
            activeOpacity={0.85}
          >
            <Text style={s.doneBtnTxt}>Done</Text>
            <Feather name="arrow-right" size={14} color="#FFF" />
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

// ─── STYLES ─────────────────────────────────────────────────
const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },

  // Atmospheric gradients
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
    zIndex: 2,
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 220,
    zIndex: 2,
  },

  // Guide lines
  guideVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    zIndex: 5,
  },
  guideHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    zIndex: 5,
  },

  // Bubble
  bubble: {
    position: 'absolute',
    zIndex: 10,
    overflow: 'hidden',
    borderWidth: BUBBLE_BORDER,
    borderColor: 'rgba(255,255,255,0.6)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 10,
  },
  bubbleImg: {
    width: '100%',
    height: '100%',
  },
  bubbleIconWrap: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Top bar
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  cancelBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnInner: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleTxt: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: -0.1,
  },

  // Bottom controls
  bottomControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 30,
    paddingHorizontal: 16,
  },

  // Preset strip
  presetStrip: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginBottom: 20,
  },
  presetItem: {
    alignItems: 'center',
    gap: 6,
  },
  presetItemActive: {},
  presetIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  presetIconActive: {
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  presetLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.1,
  },
  presetLabelActive: {
    color: 'rgba(255,255,255,0.8)',
  },

  // Action row
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  swapHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  swapHintTxt: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '500',
  },
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: '#C9A96E',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  doneBtnTxt: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },

  // Error state
  errorWrap: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  errorTitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 18,
    fontWeight: '600',
  },
  errorSub: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    textAlign: 'center',
  },
  errorBtn: {
    marginTop: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  errorBtnTxt: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
});