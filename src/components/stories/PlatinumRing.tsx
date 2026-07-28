/**
 * PlatinumRing
 * The stories signature ring, extracted for reuse beyond the strip.
 * active: the three-layer animated platinum ring - a live story.
 * inactive: a single still platinum hairline - the brand frame.
 */
import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const PLATINUM_GLOW = '#F5F0E8';
const PLATINUM_START = '#C9BFB0';
const PLATINUM_END = '#A89F91';

function hashSpeed(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return 3500 + (Math.abs(hash) % 1500);
}

export default function PlatinumRing({ userId, size, active = true }: {
  userId: string; size: number; active?: boolean;
}) {
  const center = size / 2;
  const radius = center - 2;
  const circumference = 2 * Math.PI * radius;
  const arcDash = circumference * 0.19;
  const arcOffset = useRef(new Animated.Value(0)).current;
  const speed = hashSpeed(userId || 'me');
  const safeId = `platr_${(userId || 'me').replace(/[^a-zA-Z0-9_]/g, '_')}_${size}`;

  useEffect(() => {
    if (!active) return;
    const anim = Animated.loop(
      Animated.timing(arcOffset, { toValue: circumference, duration: speed, useNativeDriver: false })
    );
    anim.start();
    return () => anim.stop();
  }, [arcOffset, speed, active, circumference]);

  if (!active) {
    return (
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={center} cy={center} r={radius} fill="none" stroke={PLATINUM_END} strokeWidth={1.25} opacity={0.55} />
      </Svg>
    );
  }

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <LinearGradient id={safeId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={PLATINUM_GLOW} />
          <Stop offset="0.4" stopColor={PLATINUM_START} />
          <Stop offset="1" stopColor={PLATINUM_END} />
        </LinearGradient>
      </Defs>
      <Circle cx={center} cy={center} r={radius} fill="none" stroke={`url(#${safeId})`} strokeWidth={2.5} />
      <Circle cx={center} cy={center} r={radius - 1.5} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={0.5} />
      <AnimatedCircle
        cx={center} cy={center} r={radius} fill="none"
        stroke="rgba(255,255,255,0.45)" strokeWidth={1.5}
        strokeDasharray={`${arcDash} ${circumference - arcDash}`}
        strokeLinecap="round" strokeDashoffset={arcOffset}
      />
    </Svg>
  );
}