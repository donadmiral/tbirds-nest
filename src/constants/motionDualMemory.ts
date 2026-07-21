/**
 * motionDualMemory.ts
 *
 * Single source of truth for all motion constants in the dual memory system.
 * Springs, fades, timings, easing curves, opacity values, depth shadows,
 * gesture configs, layout spacing, and cinematic durations.
 *
 * ALL ANIMATION VALUES MUST ORIGINATE FROM THIS FILE.
 * No magic numbers in component files. If a spring, fade, opacity, shadow,
 * or timing value is not defined here, it does not belong in the system.
 *
 * Import from here. Name by emotional/functional purpose.
 */

import { Easing } from 'react-native';

// ── SPRING CONFIGS ─────────────────────────────────────────
// All springs use { damping, stiffness, mass, useNativeDriver: true }

/** Bubble entry when arrangement opens. Gentle, welcoming. */
export const SPRING_BUBBLE_ENTRY = { damping: 14, stiffness: 140, mass: 1.0, useNativeDriver: true };

/** Bubble settle after drag release. Physically satisfying. */
export const SPRING_BUBBLE_SETTLE = { damping: 16, stiffness: 180, mass: 0.9, useNativeDriver: true };

/** Bubble pulse feedback on drag end. Subtle, alive. */
export const SPRING_BUBBLE_PULSE_UP = { damping: 10, stiffness: 220, mass: 0.8, useNativeDriver: true };
export const SPRING_BUBBLE_PULSE_DOWN = { damping: 12, stiffness: 180, mass: 0.8, useNativeDriver: true };

/** Arrangement overlay entry. Atmospheric, cinematic. */
export const SPRING_ARRANGEMENT_ENTER = { damping: 18, stiffness: 160, mass: 1.0, useNativeDriver: true };

/** Keyboard caption spring. Soft, non-jarring. */
export const SPRING_CAPTION_KEYBOARD = { damping: 18, stiffness: 170, useNativeDriver: false };

/** Viewer bubble reveal. Gentle emergence. */
export const SPRING_VIEWER_BUBBLE = { damping: 14, stiffness: 160, mass: 1.0, useNativeDriver: true };

/** Swap transition scale. Quick confidence. */
export const SPRING_SWAP = { damping: 15, stiffness: 200, mass: 0.85, useNativeDriver: true };

// ── EASING CURVES ─────────────────────────────────────────

/** Cinematic: slow deceleration, premium feel. Story transitions, viewer crossfade. */
export const EASE_CINEMATIC = Easing.out(Easing.cubic);

/** Soft exit: gentle symmetrical ease. Overlay dismissal, arrangement close. */
export const EASE_SOFT_EXIT = Easing.inOut(Easing.quad);

/** Swap: fast start, graceful settle. Camera swap, layout switch. */
export const EASE_SWAP = Easing.out(Easing.exp);

/** Sharp UI: snappy response for controls. Bloom open, button press. */
export const EASE_SHARP = Easing.out(Easing.quad);

/** Composer entry: dramatic deceleration. First impression. */
export const EASE_COMPOSER_ENTRY = Easing.bezier(0.16, 1, 0.3, 1);

// ── OPACITY CONSTANTS ─────────────────────────────────────

/** Chrome background on dark media. Readable without heavy. */
export const OPACITY_CHROME_DARK = 0.5;

/** Chrome background on light/open state. Subtle presence. */
export const OPACITY_CHROME_LIGHT = 0.2;

/** Arrangement atmospheric dim. Focused but not oppressive. */
export const OPACITY_ARRANGEMENT_DIM = 0.42;

/** Snap guide visibility. Clear but not distracting. */
export const OPACITY_GUIDES = 0.75;

/** Controls during keyboard open. Present but receded. */
export const OPACITY_KEYBOARD_DIM = 0.75;

/** Undo button background. Quieter than primary controls. */
export const OPACITY_UNDO_BG = 0.45;

// ── SHADOW / DEPTH ────────────────────────────────────────

/** Bubble shadow. Floating, premium depth. */
export const SHADOW_BUBBLE = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.35,
  shadowRadius: 16,
  elevation: 8,
};

/** Canvas frame shadow. Mounted, grounded. */
export const SHADOW_CANVAS = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.15,
  shadowRadius: 20,
  elevation: 8,
};

/** Post button shadow. Action-ready. */
export const SHADOW_POST = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.2,
  shadowRadius: 6,
  elevation: 4,
};

// ── SAFE-AREA SPACING ─────────────────────────────────────

/** Bottom offset for primary action buttons (Post, etc.) */
export const SAFE_BOTTOM_ACTION = 18;

/** Top offset below notch/Dynamic Island for chrome */
export const SAFE_TOP_CHROME = 8;

/** Horizontal padding for edge-aligned controls */
export const SAFE_HORIZONTAL = 14;

// ── INTERRUPTION RECOVERY ─────────────────────────────────

/** Duration for settling UI after app foreground or gesture cancel */
export const DURATION_INTERRUPT_SETTLE = 140;

/** Duration for restoring opacity after interruption */
export const FADE_INTERRUPT_RESTORE = 200;

// ── TIMING DURATIONS ───────────────────────────────────────

/** Arrangement overlay atmospheric dim fade in/out */
export const FADE_ARRANGEMENT_DIM = 260;

/** Arrangement overlay guide fade */
export const FADE_ARRANGEMENT_GUIDES = 200;

/** Swap crossfade: out duration */
export const FADE_SWAP_OUT = 120;

/** Swap crossfade: in duration */
export const FADE_SWAP_IN = 180;

/** Viewer story crossfade */
export const FADE_VIEWER_CROSSFADE = 320;

/** Canvas gesture restoration delay after arrangement closes */
export const DELAY_GESTURE_RESTORE = 180;

/** Memory reveal hold before navigation */
export const DELAY_MEMORY_REVEAL = 850;

/** Composer entry fade */
export const FADE_COMPOSER_ENTRY = 400;

/** Composer entry scale */
export const DURATION_COMPOSER_ENTRY_SCALE = 600;

/** Publish exit animation */
export const FADE_PUBLISH_EXIT = 300;

// ── GESTURE CONFIGS ────────────────────────────────────────

/** Edge magnetism: distance threshold in px */
export const EDGE_MAGNET_DISTANCE = 40;

/** Edge magnetism: velocity reduction factor inside threshold */
export const EDGE_MAGNET_RESISTANCE = 0.35;

/** Snap zone thresholds in px */
export const SNAP_EDGE = 12;
export const SNAP_CENTER = 15;
export const SNAP_CORNER = 20;
export const SNAP_THIRDS = 12;

/** Bubble scale limits during pinch resize */
export const BUBBLE_SCALE_MIN = 0.6;
export const BUBBLE_SCALE_MAX = 2.5;

/** Bubble pulse scale multiplier on drag end */
export const BUBBLE_PULSE_SCALE = 1.04;

/** Default bubble dimensions (px) */
export const BUBBLE_BASE_WIDTH = 120;
export const BUBBLE_BASE_HEIGHT = 160;
export const BUBBLE_BASE_RADIUS = 28;

// ── VIEWER MOTION ──────────────────────────────────────────

/** Micro parallax: scale range during story progress */
export const PARALLAX_SCALE_START = 1.02;
export const PARALLAX_SCALE_END = 1.0;

// ── HAPTIC MAP ─────────────────────────────────────────────
// These are string constants matching expo-haptics ImpactFeedbackStyle
// Import and use: Haptics.impactAsync(Haptics.ImpactFeedbackStyle[HAPTIC_X])

export const HAPTIC_DRAG_START = 'Light' as const;
export const HAPTIC_SNAP_ENTER = 'Light' as const;
export const HAPTIC_SNAP_SETTLE = 'Medium' as const;
export const HAPTIC_SWAP = 'Medium' as const;
export const HAPTIC_PRESET = 'Selection' as const;
export const HAPTIC_DONE = 'Heavy' as const;
export const HAPTIC_PUBLISH = 'Medium' as const;

// ── Z-INDEX LAYER HIERARCHY ───────────────────────────────
// Strict stacking order. No component may invent its own zIndex.

export const Z_MEDIA = 0;
export const Z_SCRIM = 1;
export const Z_BUBBLE = 10;
export const Z_STICKERS = 15;
export const Z_CHROME = 20;
export const Z_BLOOM = 25;
export const Z_ARRANGEMENT = 30;
export const Z_CAPTION = 50;
export const Z_MODAL = 100;

// ── TOUCH TARGETS ─────────────────────────────────────────
// Apple HIG minimum: 44pt. All interactive elements must meet or exceed.

export const TOUCH_MIN = 44;
export const TOUCH_BLOOM = 48;
export const TOUCH_POST = 52;

// ── KEYBOARD TIMING ───────────────────────────────────────

/** Default keyboard transition duration when iOS duration unavailable */
export const KEYBOARD_TRANSITION = 260;

// ── IMAGE QUALITY ─────────────────────────────────────────

/** Image fadeDuration: 0 for instant sharp rendering */
export const IMAGE_FADE_DURATION = 0;

/** Prefetch timeout for dual assets before composer mount */
export const IMAGE_PREFETCH_TIMEOUT = 4000;

// ── REDUCE MOTION ─────────────────────────────────────────
// When AccessibilityInfo.isReduceMotionEnabled() is true, use these.

/** Minimal scale change for reduced motion entry */
export const REDUCE_MOTION_SCALE = 0.98;

/** Fast duration for reduced motion transitions */
export const REDUCE_MOTION_DURATION = 120;

// ── DRAFT PERSISTENCE KEY ──────────────────────────────────

export const DRAFT_STORAGE_PREFIX = 'pc_dual_draft_';