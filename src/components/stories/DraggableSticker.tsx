/**
 * DraggableSticker — Physics-based sticker interaction system
 *
 * Reanimated shared values + RNGH v2 Gesture API.
 * All gesture math runs on the UI thread via worklets.
 * State persistence and haptic feedback use runOnJS.
 *
 * Physics model:
 * - Pan: withDecay on release (velocity-proportional momentum)
 * - Scale: exponential sensitivity curve + dead-zone at 1.0 + withSpring settle
 * - Rotation: detent at 0/90/180/270 + withDecay for fast spins
 * - Boundaries: rubber-band resistance (logarithmic curve)
 * - Snap: magnetic spring to center (not hard threshold)
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDecay,
  withTiming,
  withSequence,
  runOnJS,
  cancelAnimation,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { StoryTextSticker, StoryStickerStyle } from '../../services/storiesService';
import { stickerTextStyle } from '../../utils/stickerStyles';
import StickerPill from './StickerPill';
import PostStoryCard from './PostStoryCard';
import CountdownStickerCard from './CountdownStickerCard';
import { TimeStickerView, DateStickerView, WeatherStickerView, PhotoStickerView, GifStickerView, EntityStickerCard, composedTextStyle } from './storyExtras';
import { motion, feedback } from '../../constants/tokens';

// ── Constants ──

const SNAP_CENTER_ENTRY = 0.04;
const SNAP_CENTER_EXIT = 0.06; // Hysteresis: wider exit prevents oscillation
const STICKER_HIT_W = 180;
const STICKER_HIT_H = 80;
const STICKER_HIT_H_WRAP = 160;
const STICKER_TEXT_MAX_W_RATIO = 0.85;
const BOUNDARY_X_MIN = 0.02;
const BOUNDARY_X_MAX = 0.98;
const BOUNDARY_Y_MIN = 0.05;
const BOUNDARY_Y_MAX = 0.95;
const RUBBER_BAND_FACTOR = 0.3;
const DELETE_ATTRACT_STRENGTH = 0.6; // Peak attraction pixels per frame at zone center

// ── Spring configs ──

const SPRING_SNAP = { damping: 20, stiffness: 400 };
const SPRING_RUBBER = { damping: 30, stiffness: 300 };
const SPRING_MOUNT = { damping: 14, stiffness: 200 };
const SPRING_LAND = { damping: 22, stiffness: 300 }; // Low-velocity landing settle

// ── Physics profiles per sticker type ──

type PhysicsProfile = {
  scaleRange: [number, number];
  scaleExponent: number;
  scaleDeadzone: number;
  scaleSettle: { damping: number; stiffness: number };
  decayStandard: { deceleration: number };
  decayRotation: { deceleration: number };
  rotationDetentRad: number;
  rotationSnapVelocity: number;
  dragPickupScale: number;
  tapPulseScale: number;
};

const PROFILES: Record<string, PhysicsProfile> = {
  emoji: {
    scaleRange: [0.3, 4.0],
    scaleExponent: 0.7,
    scaleDeadzone: 0.05,
    scaleSettle: { damping: 10, stiffness: 180 },
    decayStandard: { deceleration: 0.996 },
    decayRotation: { deceleration: 0.998 },
    rotationDetentRad: 0.087,
    rotationSnapVelocity: 0.5,
    dragPickupScale: 1.05,
    tapPulseScale: 0.92,
  },
  text: {
    scaleRange: [0.4, 3.0],
    scaleExponent: 0.65,
    scaleDeadzone: 0.05,
    scaleSettle: { damping: 20, stiffness: 180 },
    decayStandard: { deceleration: 0.997 },
    decayRotation: { deceleration: 0.997 },
    rotationDetentRad: 0.087,
    rotationSnapVelocity: 0.5,
    dragPickupScale: 1.02,
    tapPulseScale: 0.97,
  },
  poll: {
    scaleRange: [0.7, 1.8],
    scaleExponent: 0.5,
    scaleDeadzone: 0.04,
    scaleSettle: { damping: 24, stiffness: 120 },
    decayStandard: { deceleration: 0.999 },
    decayRotation: { deceleration: 0.999 },
    rotationDetentRad: 0.175, // ~10 degrees
    rotationSnapVelocity: 0.3,
    dragPickupScale: 1.0,
    tapPulseScale: 0.98,
  },
  question: {
    scaleRange: [0.6, 2.0],
    scaleExponent: 0.6,
    scaleDeadzone: 0.05,
    scaleSettle: { damping: 18, stiffness: 140 },
    decayStandard: { deceleration: 0.998 },
    decayRotation: { deceleration: 0.999 },
    rotationDetentRad: 0.087,
    rotationSnapVelocity: 0.4,
    dragPickupScale: 1.01,
    tapPulseScale: 0.97,
  },
  location: {
    scaleRange: [0.5, 2.5],
    scaleExponent: 0.65,
    scaleDeadzone: 0.05,
    scaleSettle: { damping: 18, stiffness: 160 },
    decayStandard: { deceleration: 0.998 },
    decayRotation: { deceleration: 0.998 },
    rotationDetentRad: 0.087,
    rotationSnapVelocity: 0.5,
    dragPickupScale: 1.02,
    tapPulseScale: 0.97,
  },
  slider: {
    scaleRange: [0.7, 1.8],
    scaleExponent: 0.5,
    scaleDeadzone: 0.04,
    scaleSettle: { damping: 22, stiffness: 130 },
    decayStandard: { deceleration: 0.999 },
    decayRotation: { deceleration: 0.999 },
    rotationDetentRad: 0.175,
    rotationSnapVelocity: 0.3,
    dragPickupScale: 1.0,
    tapPulseScale: 0.98,
  },
};

// Default profile for any unrecognized sticker kind
const DEFAULT_PROFILE = PROFILES.text;

function getProfile(kind?: string): PhysicsProfile {
  if (!kind) return DEFAULT_PROFILE;
  if (kind === 'emoji') return PROFILES.emoji;
  if (kind === 'poll' || kind === 'quiz') return PROFILES.poll;
  if (kind === 'question') return PROFILES.question;
  if (kind === 'location' || kind === 'mention' || kind === 'hashtag' || kind === 'link' || kind === 'post' || kind === 'countdown' || kind === 'entity' || kind === 'photo' || kind === 'gif' || kind === 'time' || kind === 'date' || kind === 'weather') return PROFILES.location;
  if (kind === 'slider') return PROFILES.slider;
  return DEFAULT_PROFILE;
}

// ── Types ──

export type SmartGuideKind = 'center' | 'left' | 'right' | 'top' | 'bottom';
export type SmartGuideEntry = { position: number; kind: SmartGuideKind } | null;

export interface DraggableStickerProps {
  sticker: StoryTextSticker;
  containerW: number;
  containerH: number;
  onDragEnd: (id: string, nx: number, ny: number) => void;
  onTap: (id: string) => void;
  onScaleEnd: (id: string, newScale: number) => void;
  onRotateEnd: (id: string, newRotation: number) => void;
  onSnapChange?: (id: string, xSnapped: boolean, ySnapped: boolean) => void;
  guideXOp?: SharedValue<number>;
  guideYOp?: SharedValue<number>;
  onDragStart: (id: string) => void;
  onDeleteZoneChange: (id: string, inZone: boolean) => void;
  onDeleteDrop: (id: string) => void;
  deleteZoneNy: number;
  safeTopNy: number;
  safeBottomNy: number;
  otherStickers: StoryTextSticker[];
  onSmartGuideChange: (id: string, x: SmartGuideEntry, y: SmartGuideEntry) => void;
}

// ── Helpers (pure, used in worklets via runOnJS bridge) ──

function fireHapticLight() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

function fireHapticMedium() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

function fireHapticSelection() {
  Haptics.selectionAsync();
}

// ── Worklet helpers ──

function rubberBand(offset: number, limit: number, factor: number): number {
  'worklet';
  // Logarithmic rubber-band: diminishing returns past boundary
  if (offset <= 0) return 0;
  return (1 - 1 / (offset * (1 / limit) * (1 / factor) + 1)) * limit * factor;
}

function clampWithRubber(value: number, min: number, max: number, factor: number): number {
  'worklet';
  if (value < min) {
    const overshot = min - value;
    return min - rubberBand(overshot, max - min, factor);
  }
  if (value > max) {
    const overshot = value - max;
    return max + rubberBand(overshot, max - min, factor);
  }
  return value;
}

function nearestDetent(rotation: number): number {
  'worklet';
  const PI_2 = Math.PI / 2;
  return Math.round(rotation / PI_2) * PI_2;
}

// ── Component ──

const DraggableSticker = React.memo(function DraggableSticker(props: DraggableStickerProps) {
  const {
    sticker, containerW, containerH,
    onDragEnd, onTap, onScaleEnd, onRotateEnd,
    onSnapChange, onDragStart, onDeleteZoneChange, onDeleteDrop,
    deleteZoneNy, safeTopNy, safeBottomNy,
    otherStickers, onSmartGuideChange,
    guideXOp, guideYOp,
  } = props;

  // ── Visual properties (computed once per render) ──

  const isEmoji = sticker.kind === 'emoji';
  const isLink = sticker.kind === 'link';
  const isLocation = sticker.kind === 'location';
  const isMention = sticker.kind === 'mention';
  const isHashtag = sticker.kind === 'hashtag';
  const isPill = isLink || isLocation || isMention || isHashtag;
  const isTextSticker = !isEmoji && !isPill;

  // ── Physics profile ──
  const profile = useMemo(() => getProfile(sticker.kind), [sticker.kind]);

  const { textStyle, wrapperStyle } = useMemo(() => {
    if (isEmoji || isPill) {
      return { textStyle: { fontSize: isEmoji ? 44 : 13 }, wrapperStyle: {} as const };
    }
    return stickerTextStyle(sticker.style, sticker.color, sticker.bgEnabled, sticker.fontSizeOverride);
  }, [isEmoji, isPill, sticker.style, sticker.color, sticker.bgEnabled, sticker.fontSizeOverride]);

  const stickerOpacityValue = (!isEmoji && !isPill && sticker.opacity !== undefined && sticker.opacity < 1)
    ? sticker.opacity : 1;

  const containerAlign = isEmoji || isPill ? 'center' as const
    : sticker.textAlign === 'left' ? 'flex-start' as const
    : sticker.textAlign === 'right' ? 'flex-end' as const
    : 'center' as const;

  const textMaxWidth = isTextSticker ? Math.round(containerW * STICKER_TEXT_MAX_W_RATIO) : undefined;
  const textMayWrap = isTextSticker && sticker.text.length > 20;

  // ── Shared values ──

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(sticker.scale);
  const rotation = useSharedValue(sticker.rotation);
  const mountProgress = useSharedValue(0);
  const opacity = useSharedValue(stickerOpacityValue);

  // ── Gesture tracking refs (shared values for worklet access) ──

  const startNx = useSharedValue(sticker.nx);
  const startNy = useSharedValue(sticker.ny);
  const posNx = useSharedValue(sticker.nx);
  const posNy = useSharedValue(sticker.ny);
  const committedPos = useRef({ nx: sticker.nx, ny: sticker.ny });
  const committedScale = useRef(sticker.scale);
  const committedRot = useRef(sticker.rotation);
  const pinchBase = useSharedValue(sticker.scale);
  const rotationBase = useSharedValue(sticker.rotation);
  const inDeleteZone = useSharedValue(false);
  const hapticFiredCenter = useSharedValue(false);
  const hapticFiredDelete = useSharedValue(false);
  const isSnappedX = useSharedValue(false);
  const isSnappedY = useSharedValue(false);
  const isSnappedCenter = useSharedValue(false); // Hysteresis state
  const pickupScale = useSharedValue(1); // Drag pickup/release pulse

  // ── Mount animation ──

  useEffect(() => {
    mountProgress.value = withSpring(1, SPRING_MOUNT);
  }, []);

  // ── Sync from props (when external changes happen: undo, edit) ──

  useEffect(() => {
    const c = committedPos.current;
    if (Math.abs(sticker.nx - c.nx) < 1e-6 && Math.abs(sticker.ny - c.ny) < 1e-6) return;
    committedPos.current = { nx: sticker.nx, ny: sticker.ny };
    cancelAnimation(translateX);
    cancelAnimation(translateY);
    translateX.value = 0;
    translateY.value = 0;
    posNx.value = sticker.nx;
    posNy.value = sticker.ny;
    startNx.value = sticker.nx;
    startNy.value = sticker.ny;
  }, [sticker.nx, sticker.ny]);

  useEffect(() => {
    if (Math.abs(sticker.scale - committedScale.current) < 1e-6) return;
    committedScale.current = sticker.scale;
    cancelAnimation(scale);
    scale.value = sticker.scale;
    pinchBase.value = sticker.scale;
  }, [sticker.scale]);

  useEffect(() => {
    if (Math.abs(sticker.rotation - committedRot.current) < 1e-6) return;
    committedRot.current = sticker.rotation;
    cancelAnimation(rotation);
    rotation.value = sticker.rotation;
    rotationBase.value = sticker.rotation;
  }, [sticker.rotation]);

  useEffect(() => {
    opacity.value = stickerOpacityValue;
  }, [stickerOpacityValue]);

  // ── JS-thread callbacks for runOnJS ──

  const jsDragStart = useCallback((id: string) => {
    onDragStart(id);
  }, [onDragStart]);

  const jsDragEnd = useCallback((id: string, nx: number, ny: number) => {
    committedPos.current = { nx, ny };
    onDragEnd(id, nx, ny);
  }, [onDragEnd]);

  const jsScaleEnd = useCallback((id: string, s: number) => {
    committedScale.current = s;
    onScaleEnd(id, s);
  }, [onScaleEnd]);

  const jsRotateEnd = useCallback((id: string, r: number) => {
    committedRot.current = r;
    onRotateEnd(id, r);
  }, [onRotateEnd]);

  const jsTap = useCallback((id: string) => {
    onTap(id);
  }, [onTap]);

  const jsSnapChange = useCallback((id: string, x: boolean, y: boolean) => {
    if (onSnapChange) onSnapChange(id, x, y);
  }, [onSnapChange]);

  const jsDeleteZoneChange = useCallback((id: string, inZone: boolean) => {
    onDeleteZoneChange(id, inZone);
  }, [onDeleteZoneChange]);

  const jsDeleteDrop = useCallback((id: string) => {
    onDeleteDrop(id);
  }, [onDeleteDrop]);

  const jsSmartGuideChange = useCallback((id: string, x: SmartGuideEntry, y: SmartGuideEntry) => {
    onSmartGuideChange(id, x, y);
  }, [onSmartGuideChange]);

  // ── Sticker ID for worklet closures ──
  const stickerId = sticker.id;

  // ── Pan gesture ──

  const panGesture = useMemo(() => Gesture.Pan()
    .minDistance(4)
    .onStart(() => {
      'worklet';
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      if (containerW > 0 && containerH > 0) {
        posNx.value = posNx.value + translateX.value / containerW;
        posNy.value = posNy.value + translateY.value / containerH;
        startNx.value = posNx.value;
        startNy.value = posNy.value;
      }
      translateX.value = 0;
      translateY.value = 0;
      hapticFiredCenter.value = false;
      hapticFiredDelete.value = false;
      inDeleteZone.value = false;
      isSnappedX.value = false;
      isSnappedY.value = false;
      isSnappedCenter.value = false;
      // Pickup pulse
      if (profile.dragPickupScale > 1.0) {
        pickupScale.value = withSpring(profile.dragPickupScale, SPRING_SNAP);
      }
      runOnJS(jsDragStart)(stickerId);
    })
    .onUpdate((e) => {
      'worklet';
      if (containerW === 0 || containerH === 0) {
        translateX.value = e.translationX;
        translateY.value = e.translationY;
        return;
      }

      const rawNx = startNx.value + e.translationX / containerW;
      const rawNy = startNy.value + e.translationY / containerH;

      // Continuous center magnet: no threshold, no teleport. Inside the band
      // the offset is scaled by (d / band)^2, smooth at the band edge and
      // strongly attracted at the center. xClose/yClose = visibly locked.
      const dX = rawNx - 0.5;
      const dY = rawNy - 0.5;
      const magnetX = Math.abs(dX) < SNAP_CENTER_ENTRY;
      const magnetY = Math.abs(dY) < SNAP_CENTER_ENTRY;
      const xClose = magnetX && Math.abs(dX) < SNAP_CENTER_ENTRY * 0.6;
      const yClose = magnetY && Math.abs(dY) < SNAP_CENTER_ENTRY * 0.6;

      // Delete zone with distance-weighted attraction
      const inZone = rawNy > deleteZoneNy;
      if (inZone !== inDeleteZone.value) {
        inDeleteZone.value = inZone;
        runOnJS(jsDeleteZoneChange)(stickerId, inZone);
        if (inZone && !hapticFiredDelete.value) {
          hapticFiredDelete.value = true;
          runOnJS(fireHapticLight)();
        }
        if (!inZone) {
          hapticFiredDelete.value = false;
        }
      }

      // Apply position with rubber-band at edges
      let finalNx: number;
      let finalNy: number;

      if (magnetX) {
        const kx = Math.abs(dX) / SNAP_CENTER_ENTRY;
        finalNx = 0.5 + dX * kx * kx;
      } else {
        finalNx = clampWithRubber(rawNx, BOUNDARY_X_MIN, BOUNDARY_X_MAX, RUBBER_BAND_FACTOR);
      }

      if (magnetY) {
        const ky = Math.abs(dY) / SNAP_CENTER_ENTRY;
        finalNy = 0.5 + dY * ky * ky;
      } else {
        finalNy = clampWithRubber(rawNy, BOUNDARY_Y_MIN, BOUNDARY_Y_MAX, RUBBER_BAND_FACTOR);
      }

      // One haptic per lock-on, re-armed only after leaving both bands
      if ((xClose || yClose) && !hapticFiredCenter.value) {
        hapticFiredCenter.value = true;
        runOnJS(fireHapticLight)();
      } else if (!magnetX && !magnetY) {
        hapticFiredCenter.value = false;
      }

      // Delete zone attraction: distance-weighted downward pull
      if (inZone && containerH > 0) {
        const zoneDepth = (rawNy - deleteZoneNy) / (1.0 - deleteZoneNy); // 0 at entry, 1 at bottom
        const attraction = zoneDepth * zoneDepth * DELETE_ATTRACT_STRENGTH; // Quadratic curve
        finalNy = finalNy + attraction / containerH;
      }

      translateX.value = (finalNx - startNx.value) * containerW;
      translateY.value = (finalNy - startNy.value) * containerH;

      // Guide lines live on the UI thread: opacity only, never mounted or
      // unmounted mid-gesture, no JS round trip.
      if (xClose !== isSnappedX.value) {
        isSnappedX.value = xClose;
        if (guideXOp) guideXOp.value = withTiming(xClose ? 1 : 0, { duration: 120 });
      }
      if (yClose !== isSnappedY.value) {
        isSnappedY.value = yClose;
        if (guideYOp) guideYOp.value = withTiming(yClose ? 1 : 0, { duration: 120 });
      }
    })
    .onEnd((e) => {
      'worklet';
      if (containerW === 0 || containerH === 0) return;

      // Release pickup pulse
      if (profile.dragPickupScale > 1.0) {
        pickupScale.value = withSpring(1, SPRING_SNAP);
      }

      // Clean up snap guides
      isSnappedX.value = false;
      isSnappedY.value = false;
      if (guideXOp) guideXOp.value = withTiming(0, { duration: 120 });
      if (guideYOp) guideYOp.value = withTiming(0, { duration: 120 });
      runOnJS(jsSmartGuideChange)(stickerId, null, null);
      runOnJS(jsDeleteZoneChange)(stickerId, false);

      // Delete drop with animation
      if (inDeleteZone.value) {
        inDeleteZone.value = false;
        scale.value = withTiming(0, { duration: 150 });
        opacity.value = withTiming(0, { duration: 150 }, (finished) => {
          'worklet';
          if (finished) {
            translateX.value = 0;
            translateY.value = 0;
            scale.value = sticker.scale; // Reset for potential undo
            opacity.value = stickerOpacityValue;
            runOnJS(jsDeleteDrop)(stickerId);
          }
        });
        runOnJS(fireHapticMedium)();
        return;
      }

      // Stability model: the resting point is decided HERE, synchronously.
      // Momentum is a short projected toss (Instagram-style), not an
      // open-ended decay, so the position commit never waits on an animation
      // callback and X/Y can never desynchronize. Springs are decorative.
      const visNx = startNx.value + translateX.value / containerW;
      const visNy = startNy.value + translateY.value / containerH;

      const speed = Math.sqrt(e.velocityX * e.velocityX + e.velocityY * e.velocityY);
      let targetNx = visNx;
      let targetNy = visNy;
      if (speed > 100) {
        targetNx = visNx + (e.velocityX * 0.12) / containerW;
        targetNy = visNy + (e.velocityY * 0.12) / containerH;
      }

      const finalNx = Math.max(BOUNDARY_X_MIN, Math.min(BOUNDARY_X_MAX, targetNx));
      const finalNy = Math.max(safeTopNy, Math.min(safeBottomNy, targetNy));

      // Fold: base moves to the final point, translate carries the visual
      // remainder and springs to zero.
      posNx.value = finalNx;
      posNy.value = finalNy;
      startNx.value = finalNx;
      startNy.value = finalNy;
      translateX.value = (visNx - finalNx) * containerW;
      translateY.value = (visNy - finalNy) * containerH;
      translateX.value = withSpring(0, SPRING_LAND);
      translateY.value = withSpring(0, SPRING_LAND);
      runOnJS(jsDragEnd)(stickerId, finalNx, finalNy);
    }),
    [containerW, containerH, stickerId, deleteZoneNy, safeTopNy, safeBottomNy, profile, stickerOpacityValue, jsDragStart, jsDragEnd, jsSnapChange, jsDeleteZoneChange, jsDeleteDrop, jsSmartGuideChange, guideXOp, guideYOp]
  );

  // ── Pinch gesture ──

  const pinchGesture = useMemo(() => Gesture.Pinch()
    .onStart(() => {
      'worklet';
      pinchBase.value = scale.value;
    })
    .onUpdate((e) => {
      'worklet';
      const expScale = Math.pow(e.scale, profile.scaleExponent);
      let newScale = pinchBase.value * expScale;

      // Dead zone at 1.0
      if (Math.abs(newScale - 1.0) < profile.scaleDeadzone) {
        newScale = 1.0;
      }

      scale.value = Math.max(profile.scaleRange[0], Math.min(profile.scaleRange[1], newScale));
    })
    .onEnd((e) => {
      'worklet';
      const currentScale = scale.value;

      // Snap to 1.0 if very close. Commit immediately, spring decorates.
      if (Math.abs(currentScale - 1.0) < profile.scaleDeadzone * 2) {
        scale.value = withSpring(1.0, SPRING_SNAP);
        pinchBase.value = 1.0;
        runOnJS(jsScaleEnd)(stickerId, 1.0);
        runOnJS(fireHapticLight)();
      } else {
        scale.value = withSpring(currentScale, profile.scaleSettle);
        pinchBase.value = currentScale;
        runOnJS(jsScaleEnd)(stickerId, currentScale);
      }
    }),
    [stickerId, profile, jsScaleEnd]
  );

  // ── Rotation gesture ──

  const rotationGesture = useMemo(() => Gesture.Rotation()
    .onStart(() => {
      'worklet';
      rotationBase.value = rotation.value;
    })
    .onUpdate((e) => {
      'worklet';
      let newRotation = rotationBase.value + e.rotation;

      // Detent at 0 degrees
      if (Math.abs(newRotation) < profile.rotationDetentRad) {
        newRotation = 0;
      }
      // Detent at 90-degree increments
      const nearest90 = nearestDetent(newRotation);
      if (Math.abs(newRotation - nearest90) < profile.rotationDetentRad && nearest90 !== 0) {
        newRotation = nearest90;
      }

      rotation.value = newRotation;
    })
    .onEnd((e) => {
      'worklet';
      const velocity = e.velocity;
      const currentRotation = rotation.value;

      // Final angle decided synchronously: fast spins take a short projected
      // toss, then detent-snap. Commit never waits on an animation callback.
      let target = currentRotation;
      if (Math.abs(velocity) > profile.rotationSnapVelocity) {
        target = currentRotation + velocity * 0.12;
      }
      const nearest = nearestDetent(target);
      if (Math.abs(target - nearest) < profile.rotationDetentRad * 3) {
        target = nearest;
      }
      rotation.value = withSpring(target, SPRING_SNAP);
      rotationBase.value = target;
      runOnJS(jsRotateEnd)(stickerId, target);
      if (Math.abs(target) < 0.001 || Math.abs(target % (Math.PI / 2)) < 0.001) {
        runOnJS(fireHapticSelection)();
      }
    }),
    [stickerId, profile, jsRotateEnd]
  );

  // ── Tap gesture ──

  const tapGesture = useMemo(() => Gesture.Tap()
    .maxDuration(250)
    .onEnd(() => {
      'worklet';
      // Per-type tap acknowledgment pulse
      const pulseTarget = profile.tapPulseScale;
      if (pulseTarget < 1.0) {
        scale.value = withSequence(
          withTiming(scale.value * pulseTarget, { duration: 50 }),
          withSpring(scale.value, SPRING_SNAP)
        );
      }
      runOnJS(jsTap)(stickerId);
    }),
    [stickerId, profile, jsTap]
  );

  // ── Composed gesture ──

  const composedGesture = useMemo(() =>
    Gesture.Exclusive(
      tapGesture,
      Gesture.Simultaneous(panGesture, pinchGesture, rotationGesture)
    ),
    [tapGesture, panGesture, pinchGesture, rotationGesture]
  );

  // ── Hit area ──

  const baseHitH = textMayWrap ? STICKER_HIT_H_WRAP : STICKER_HIT_H;
  const hitW = Math.max(textMaxWidth || STICKER_HIT_W, STICKER_HIT_W * sticker.scale);
  const hitH = Math.max(baseHitH, baseHitH * sticker.scale);


  // ── Animated style ──

  const animatedStyle = useAnimatedStyle(() => {
    const mountFactor = 0.85 + 0.15 * mountProgress.value;
    const s = scale.value * mountFactor * pickupScale.value;
    return {
      left: posNx.value * containerW - hitW / 2,
      top: posNy.value * containerH - hitH / 2,
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { scale: s },
        { rotate: `${rotation.value}rad` },
      ],
      opacity: opacity.value,
    };
  });

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: hitW,
            height: hitH,
            zIndex: 10,
          },
          animatedStyle,
        ]}
      >
        <View style={{ flex: 1, alignItems: containerAlign, justifyContent: 'center' }}>
          <View style={wrapperStyle}>
            {sticker.kind === 'gif' ? (
              <GifStickerView sticker={sticker} />
            ) : sticker.kind === 'photo' ? (
              <PhotoStickerView sticker={sticker} />
            ) : sticker.kind === 'time' ? (
              <TimeStickerView sticker={sticker} />
            ) : sticker.kind === 'date' ? (
              <DateStickerView sticker={sticker} />
            ) : sticker.kind === 'weather' ? (
              <WeatherStickerView sticker={sticker} />
            ) : sticker.kind === 'entity' ? (
              <EntityStickerCard sticker={sticker} />
            ) : sticker.kind === 'countdown' ? (
              <CountdownStickerCard title={sticker.countdownTitle || sticker.text} target={sticker.countdownTarget || null} />
            ) : sticker.kind === 'post' ? (
              <PostStoryCard sticker={sticker} />
            ) : isPill ? (
              <StickerPill label={sticker.text} kind={sticker.kind as any}  variant={(sticker as any).pillVariant || 0} userId={(sticker as any).mentionUserId || null} />
            ) : (
              <Text style={[textStyle, textMaxWidth ? { maxWidth: textMaxWidth } : undefined]}>
                {sticker.text}
              </Text>
            )}
          </View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}, (prev, next) => {
  if (prev.sticker !== next.sticker) return false;
  if (prev.containerW !== next.containerW || prev.containerH !== next.containerH) return false;
  if (prev.otherStickers !== next.otherStickers) return false;
  if (prev.deleteZoneNy !== next.deleteZoneNy) return false;
  if (prev.safeTopNy !== next.safeTopNy || prev.safeBottomNy !== next.safeBottomNy) return false;
  return true;
});

export default DraggableSticker;