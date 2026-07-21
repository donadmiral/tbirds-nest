import { Easing } from 'react-native';

/**
 * Shared motion duration constants (ms).
 * Use these instead of magic numbers in Animated.timing calls.
 * NOT wired into existing animations yet — this file is preparation for Phase 2.
 */
export const MOTION = {
  fast: 150,
  normal: 200,
  slow: 300,
  stagger: 40,
} as const;

/**
 * Shared easing curves.
 */
export const EASING = {
  /** Standard decelerate curve — use for elements entering the screen */
  standard: Easing.out(Easing.cubic),
  /** Accelerate curve — use for elements leaving the screen */
  exit: Easing.in(Easing.cubic),
  /** Symmetric ease — use for scale pulses and looping animations */
  symmetric: Easing.inOut(Easing.cubic),
} as const;

/**
 * Shared spring config for gesture release animations.
 */
export const SPRING = {
  /** Default spring for snapping back (swipe cancel, drag release) */
  default: {
    tension: 65,
    friction: 8,
    useNativeDriver: true,
  },
  /** Gentle spring for subtle UI feedback */
  gentle: {
    tension: 40,
    friction: 7,
    useNativeDriver: true,
  },
} as const;