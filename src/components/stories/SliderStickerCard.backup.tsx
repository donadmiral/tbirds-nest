/**
 * SliderStickerCard — Expressive emoji slider for story viewer
 *
 * Emotional design:
 * - Emoji tracks finger position in real-time (UI thread)
 * - Fill grows smoothly with gesture
 * - Haptic landmarks at 25%, 50%, 75%, 100%
 * - Emoji scales up during drag (1.0 → 1.3) for feedback
 * - On release: emoji springs to position, fill animates to average
 * - Token-governed styling
 *
 * Replaces PanResponder with Reanimated + RNGH v2 Gesture API
 */

import React, { useCallback, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import {
  surface, text as textColor, border as borderColor,
  space, borderRadius,
  typeSize, fontWeight as fw,
} from '../../constants/tokens';

// ── Constants ──

const CARD_WIDTH = 240;
const TRACK_WIDTH = 200;
const TRACK_HEIGHT = 6;
const EMOJI_SIZE = 32;
const TRACK_PADDING = (CARD_WIDTH - 32 - TRACK_WIDTH) / 2;

const SPRING_SETTLE = { damping: 14, stiffness: 180 };
const SOFT_SETTLE = { duration: 400, easing: Easing.bezier(0.16, 1, 0.3, 1) };

// Haptic landmark positions (normalized 0-1)
const LANDMARKS = [0.25, 0.5, 0.75, 1.0];
const LANDMARK_THRESHOLD = 0.03;

// ── Types ──

type SliderStickerCardProps = {
  label: string;
  emoji: string;
  interactive: boolean;
  isOwn: boolean;
  myValue?: number | null;
  averageValue?: number | null;
  responseCount?: number;
  onSubmit?: (value: number) => void;
};

// ── Haptic helpers ──

function fireHapticLight() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

function fireHapticMedium() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

function fireSubmit(onSubmit: ((v: number) => void) | undefined, value: number) {
  onSubmit?.(Math.round(value * 100) / 100);
}

// ── Component ──

export default function SliderStickerCard({
  label,
  emoji,
  interactive,
  isOwn,
  myValue,
  averageValue,
  responseCount = 0,
  onSubmit,
}: SliderStickerCardProps) {
  const hasResponded = myValue != null;
  const displayValue = hasResponded ? (averageValue ?? myValue ?? 0) : 0;
  const showAverage = hasResponded || isOwn;
  const canDrag = interactive && !isOwn && !hasResponded;

  // ── Shared values ──

  const dragPosition = useSharedValue(0); // 0-1 normalized
  const fillWidth = useSharedValue(showAverage ? displayValue * TRACK_WIDTH : 0);
  const emojiX = useSharedValue(showAverage ? displayValue * TRACK_WIDTH : 0);
  const emojiScale = useSharedValue(1);
  const isDragging = useSharedValue(false);
  const lastLandmark = useSharedValue(-1);

  // ── Sync from props ──

  useEffect(() => {
    if (showAverage) {
      fillWidth.value = withTiming(displayValue * TRACK_WIDTH, SOFT_SETTLE);
      emojiX.value = withTiming(displayValue * TRACK_WIDTH, SOFT_SETTLE);
    }
  }, [displayValue, showAverage]);

  // ── Gesture ──

  const panGesture = React.useMemo(() => {
    if (!canDrag) return Gesture.Pan().enabled(false);

    return Gesture.Pan()
      .onStart((e) => {
        'worklet';
        isDragging.value = true;
        emojiScale.value = withSpring(1.3, SPRING_SETTLE);
        lastLandmark.value = -1;

        // Calculate initial position from touch
        const trackStartX = TRACK_PADDING;
        const localX = Math.max(0, Math.min(TRACK_WIDTH, e.x - trackStartX));
        const norm = localX / TRACK_WIDTH;
        dragPosition.value = norm;
        fillWidth.value = localX;
        emojiX.value = localX;
      })
      .onUpdate((e) => {
        'worklet';
        const trackStartX = TRACK_PADDING;
        const localX = Math.max(0, Math.min(TRACK_WIDTH, e.x - trackStartX));
        const norm = localX / TRACK_WIDTH;
        dragPosition.value = norm;
        fillWidth.value = localX;
        emojiX.value = localX;

        // Haptic landmarks
        for (let i = 0; i < LANDMARKS.length; i++) {
          if (Math.abs(norm - LANDMARKS[i]) < LANDMARK_THRESHOLD && lastLandmark.value !== i) {
            lastLandmark.value = i;
            runOnJS(fireHapticLight)();
          }
        }
      })
      .onEnd(() => {
        'worklet';
        isDragging.value = false;
        emojiScale.value = withSpring(1, SPRING_SETTLE);

        const finalValue = dragPosition.value;
        runOnJS(fireHapticMedium)();
        runOnJS(fireSubmit)(onSubmit, finalValue);
      });
  }, [canDrag, onSubmit]);

  // ── Animated styles ──

  const fillAnimStyle = useAnimatedStyle(() => ({
    width: fillWidth.value,
  }));

  const emojiAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: emojiX.value - EMOJI_SIZE / 2 },
      { scale: emojiScale.value },
    ],
  }));

  // ── Display value ──

  const pctDisplay = showAverage ? `${Math.round(displayValue * 100)}%` : null;

  return (
    <View style={s.card}>
      <View style={s.header}>
        <View style={s.iconWrap}>
          <Feather name="sliders" size={12} color="#FBBF24" />
        </View>
        <Text style={s.headerLabel}>SLIDER</Text>
        {showAverage && responseCount > 0 && (
          <Text style={s.countLabel}>
            {responseCount} {responseCount === 1 ? 'rating' : 'ratings'}
          </Text>
        )}
      </View>

      <Text style={s.label}>{label}</Text>

      <GestureDetector gesture={panGesture}>
        <View style={s.trackContainer}>
          <View style={s.trackBg}>
            <Animated.View style={[s.trackFill, fillAnimStyle]} />
          </View>

          <Animated.View style={[s.emojiMark, emojiAnimStyle]}>
            <Text style={s.emojiText}>{emoji}</Text>
          </Animated.View>
        </View>
      </GestureDetector>

      {pctDisplay && (
        <Text style={s.avgText}>{pctDisplay}</Text>
      )}

      {canDrag && (
        <Text style={s.hintText}>Drag to rate</Text>
      )}

      {interactive && !isOwn && hasResponded && (
        <View style={s.answeredBadge}>
          <Feather name="check" size={10} color="#34C759" />
          <Text style={s.answeredText}>Rated</Text>
        </View>
      )}
    </View>
  );
}

// ── Styles ──

const s = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    backgroundColor: 'rgba(20,20,20,0.85)',
    borderRadius: borderRadius.storyCanvas,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: borderColor.soft,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginBottom: space.xs,
  },
  iconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(251,191,36,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLabel: {
    fontSize: typeSize.micro,
    fontWeight: fw.bold,
    color: textColor.faint,
    letterSpacing: 0.8,
    flex: 1,
  },
  countLabel: {
    fontSize: typeSize.micro,
    fontWeight: fw.semibold,
    color: textColor.faint,
  },
  label: {
    fontSize: typeSize.emphasis,
    fontWeight: fw.bold,
    color: textColor.primary,
    lineHeight: 20,
    marginBottom: space.sm,
  },
  trackContainer: {
    height: EMOJI_SIZE + 12,
    justifyContent: 'center',
    paddingHorizontal: TRACK_PADDING,
  },
  trackBg: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderRadius: TRACK_HEIGHT / 2,
  },
  emojiMark: {
    position: 'absolute',
    top: (EMOJI_SIZE + 12 - EMOJI_SIZE) / 2,
    left: TRACK_PADDING,
    width: EMOJI_SIZE,
    height: EMOJI_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiText: {
    fontSize: 24,
  },
  avgText: {
    fontSize: typeSize.caption,
    fontWeight: fw.bold,
    color: textColor.secondary,
    textAlign: 'center',
    marginTop: space.xs,
  },
  hintText: {
    fontSize: typeSize.micro,
    fontWeight: fw.medium,
    color: textColor.faint,
    textAlign: 'center',
    marginTop: space.xs,
  },
  answeredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs,
    alignSelf: 'center',
    marginTop: space.xs,
  },
  answeredText: {
    fontSize: typeSize.micro,
    fontWeight: fw.semibold,
    color: 'rgba(52,199,89,0.8)',
  },
});