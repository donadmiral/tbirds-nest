/**
 * PlatinumCircles Design Token System
 *
 * The constitutional layer of PlatinumCircles.
 * Every component, screen, and interaction references these tokens.
 *
 * Temperature: Warm nocturnal calm.
 * Test: Does this feel inevitable?
 *
 * Import usage:
 *   import { motion, duration, easing, spring } from '../constants/tokens';
 *   import { surface, text, accent } from '../constants/tokens';
 *   import { space, spacing } from '../constants/tokens';
 *   import { radius, borderRadius } from '../constants/tokens';
 *   import { elevation, material, blur } from '../constants/tokens';
 *   import { type, typeSize, fontWeight } from '../constants/tokens';
 *   import { haptic, feedback } from '../constants/tokens';
 */

export { duration, easing, spring, stagger, motion } from './motion';
export { palette, surface, surfaceLight, text, textLight, border, borderLight, accent, storyBackgrounds, stickerColors } from './colors';
export { space, spacing } from './spacing';
export { radius, borderRadius } from './radius';
export { blur, shadow, elevation, material } from './elevation';
export { typeSize, lineHeight, letterSpacing, fontWeight, type, storyType } from './typography';
export { haptic, feedback } from './haptics';