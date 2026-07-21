/**
 * MemoryProgressArc.tsx
 *
 * Signature PlatinumCircles perimeter progress system.
 *
 * Key design decisions:
 *   - Bottom edge is inset MORE than sides/top (gesture zone clearance)
 *   - Corner radius is LARGER than typical (matches iPhone's ~39px display radius)
 *   - Track is slightly thicker (2px) for corner anti-aliasing resilience
 *   - Glow is wider (5px) with lower opacity for atmospheric bleed
 *   - Ember breathing uses irregular timing (not robotic periodicity)
 *   - Bottom corners use increased radius for optical weight compensation
 */
import React, { useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions, Platform } from 'react-native';
import ReAnimated, {
  SharedValue, useSharedValue, useAnimatedStyle, useAnimatedProps,
  interpolate, withRepeat, withTiming, withSequence, withDelay,
  Easing as REasing, cancelAnimation,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Geometry: tuned for real device optical alignment
const TRACK_WIDTH = 2;
const GLOW_WIDTH = 5;
const SIDE_INSET = 4;     // sides: slight clearance from display edge
const TOP_EXTRA = 4;       // top: extra clearance for Dynamic Island optical balance
const BOTTOM_INSET = 14;   // bottom: significant clearance above gesture zone
const R_TOP = 22;          // top corners: moderate radius
const R_BOTTOM = 28;       // bottom corners: larger to match iPhone display curve and compensate for visual weight

const ReAnimatedPath = ReAnimated.createAnimatedComponent(Path);

type MemoryProgressArcProps = {
  progressSV: SharedValue<number>;
  currentIndex: number;
  totalStories: number;
  chromeOpacity: SharedValue<number>;
  topInset: number;
  isPaused: boolean;
  bottomInset: number;
};

const MemoryProgressArc = React.memo(function MemoryProgressArc({
  progressSV, currentIndex, totalStories, chromeOpacity, topInset, isPaused, bottomInset,
}: MemoryProgressArcProps) {
  const { pathD, totalLength } = useMemo(() => {
    const x1 = SIDE_INSET;
    const x2 = SCREEN_W - SIDE_INSET;
    const y1 = topInset + TOP_EXTRA;
    // Bottom: inset above gesture zone. On phones with home indicator (bottomInset > 0),
    // add extra clearance. On phones without, use base BOTTOM_INSET.
    const bottomClearance = BOTTOM_INSET + (bottomInset > 0 ? bottomInset * 0.4 : 0);
    const y2 = SCREEN_H - bottomClearance;

    const rt = R_TOP;
    const rb = R_BOTTOM;

    // Path: starts top-left after corner, goes clockwise
    const d = [
      `M ${x1 + rt} ${y1}`,
      `L ${x2 - rt} ${y1}`,                              // top edge →
      `A ${rt} ${rt} 0 0 1 ${x2} ${y1 + rt}`,            // TR corner
      `L ${x2} ${y2 - rb}`,                              // right edge ↓
      `A ${rb} ${rb} 0 0 1 ${x2 - rb} ${y2}`,            // BR corner (larger radius)
      `L ${x1 + rb} ${y2}`,                              // bottom edge ←
      `A ${rb} ${rb} 0 0 1 ${x1} ${y2 - rb}`,            // BL corner (larger radius)
      `L ${x1} ${y1 + rt}`,                              // left edge ↑
      `A ${rt} ${rt} 0 0 1 ${x1 + rt} ${y1}`,            // TL corner
    ].join(' ');

    // Path length calculation
    const topEdge = (x2 - rt) - (x1 + rt);
    const rightEdge = (y2 - rb) - (y1 + rt);
    const bottomEdge = (x2 - rb) - (x1 + rb);
    const leftEdge = (y2 - rb) - (y1 + rt);
    const topCornerArc = (Math.PI * rt) / 2;
    const bottomCornerArc = (Math.PI * rb) / 2;
    const total = topEdge + rightEdge + bottomEdge + leftEdge + (2 * topCornerArc) + (2 * bottomCornerArc);

    return { pathD: d, totalLength: total };
  }, [topInset, bottomInset]);

  // Ember breathing: IRREGULAR timing to avoid robotic periodicity
  // Phase 1: 2.0s rise, Phase 2: 3.2s fall, Phase 3: 1.6s rise, Phase 4: 2.6s fall
  // This asymmetry creates organic "living" feeling
  const emberSV = useSharedValue(0);

  useEffect(() => {
    if (isPaused) {
      cancelAnimation(emberSV);
      emberSV.value = withTiming(0.6, { duration: 500, easing: REasing.out(REasing.ease) });
    } else {
      // Irregular cycle: short rise, long fall, shorter rise, medium fall
      emberSV.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 2000, easing: REasing.inOut(REasing.ease) }),
          withTiming(0.2, { duration: 3200, easing: REasing.inOut(REasing.ease) }),
          withTiming(0.85, { duration: 1600, easing: REasing.inOut(REasing.ease) }),
          withTiming(0, { duration: 2600, easing: REasing.inOut(REasing.ease) }),
        ),
        -1, false,
      );
    }
    return () => cancelAnimation(emberSV);
  }, [isPaused]);

  // Visibility: confident presence, never disappears
  const containerStyle = useAnimatedStyle(() => {
    const opacity = interpolate(chromeOpacity.value, [0.4, 0.65, 1], [0.5, 0.72, 0.92]);
    return { opacity };
  });

  // Track fill
  const fillProps = useAnimatedProps(() => {
    const totalProgress = (currentIndex + progressSV.value) / Math.max(totalStories, 1);
    const offset = totalLength * (1 - totalProgress);
    return { strokeDashoffset: offset };
  });

  // Glow fill (same progress, different visual layer)
  const glowFillProps = useAnimatedProps(() => {
    const totalProgress = (currentIndex + progressSV.value) / Math.max(totalStories, 1);
    const offset = totalLength * (1 - totalProgress);
    return { strokeDashoffset: offset };
  });

  // Glow breathing: ember pulse with irregular rhythm
  const glowStyle = useAnimatedStyle(() => {
    const emberInfluence = emberSV.value;
    const opacity = 0.25 + (emberInfluence * 0.3);
    return { opacity };
  });

  // Memory count
  const countStyle = useAnimatedStyle(() => {
    const opacity = interpolate(chromeOpacity.value, [0.4, 0.7, 1], [0.35, 0.55, 0.72]);
    return { opacity };
  });

  if (totalStories <= 0) return null;

  return (
    <>
      <ReAnimated.View style={[s.container, containerStyle]} pointerEvents="none">
        {/* Glow layer: atmospheric bleed behind the fill */}
        <ReAnimated.View style={[StyleSheet.absoluteFill, glowStyle]}>
          <Svg width={SCREEN_W} height={SCREEN_H} style={StyleSheet.absoluteFill}>
            <ReAnimatedPath
              d={pathD}
              stroke="rgba(206,184,145,0.5)"
              strokeWidth={GLOW_WIDTH}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={totalLength}
              animatedProps={glowFillProps}
            />
          </Svg>
        </ReAnimated.View>

        {/* Track layer */}
        <Svg width={SCREEN_W} height={SCREEN_H} style={StyleSheet.absoluteFill}>
          {/* Background track: faint perimeter */}
          <Path
            d={pathD}
            stroke="rgba(196,184,168,0.07)"
            strokeWidth={TRACK_WIDTH}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Active fill: platinum-gold */}
          <ReAnimatedPath
            d={pathD}
            stroke="rgba(196,174,140,0.88)"
            strokeWidth={TRACK_WIDTH}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={totalLength}
            animatedProps={fillProps}
          />
        </Svg>
      </ReAnimated.View>

      {/* Memory count */}
      <ReAnimated.View style={[s.countWrap, { top: topInset + TOP_EXTRA + 10 }, countStyle]} pointerEvents="none">
        <Text style={s.countText}>{currentIndex + 1} of {totalStories}</Text>
      </ReAnimated.View>
    </>
  );
});

export default MemoryProgressArc;

const s = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, zIndex: 8 },
  countWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 8 },
  countText: {
    fontSize: 11, fontWeight: '600', color: 'rgba(196,174,140,0.7)',
    letterSpacing: 0.8,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
});