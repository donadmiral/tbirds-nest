/**
 * PlatinumCircles Motion Token System
 *
 * The nervous system of the app. Every animation, transition, and gesture
 * response flows through these values.
 *
 * Philosophy: Motion communicates, it does not decorate.
 * Temperature: Warm nocturnal calm.
 *
 * Rules:
 * - Every Animated.timing call must use a duration and easing from this file.
 * - Every spring animation must use a spring config from this file.
 * - No inline timing values anywhere in the codebase.
 * - If a duration or easing is hardcoded, it is wrong.
 */

import { Easing } from 'react-native';

// ── Duration tiers ──
// Micro:       Feedback that confirms an action happened (tap, toggle, color change)
// Small:       Transitions within a screen (modal sheet, tab switch, pill expand)
// Medium:      Navigation between screens (crossfade, view morph, screen transition)
// Large:       Atmospheric moments (entry animation, session start, caught-up state)
// Atmospheric: Slow environmental changes (chrome fade, ambient dimming, attention shifts)

export const duration = {
  micro: 100,
  small: 180,
  medium: 300,
  large: 500,
  atmospheric: 800,
} as const;

// ── Easing curves ──
// default:    Natural deceleration. Arrivals slow down. The standard curve.
// softSettle: Gentle landing. Modals, content arriving, elements finding their place.
// exit:       Accelerating departure. Dismissals, fades out, elements leaving.
// linear:     Never use for UI motion. Only for progress bars and timers.

export const easing = {
  default: Easing.bezier(0.25, 0.1, 0.25, 1.0),
  softSettle: Easing.bezier(0.16, 1, 0.3, 1),
  exit: Easing.bezier(0.55, 0, 1, 0.45),
} as const;

// ── Spring configs (RN Animated format: tension + friction) ──
// interactive: Story viewer swipe, sticker snap, drag release. Responsive with personality.
// gentle:      Modal settle, content float, ambient motion. Slow and warm.
// snappy:      Quick confirmations, toggle snap, selection feedback. Precise.
// content:     Content scale transitions (story user-switch bounce). Balanced.

export const spring = {
  interactive: { tension: 65, friction: 7 },
  gentle: { tension: 40, friction: 8 },
  snappy: { tension: 120, friction: 10 },
  content: { tension: 80, friction: 8 },
} as const;

// ── Spring configs (Reanimated format: damping + stiffness) ──
// Used by DraggableSticker, engagement stickers, and any Reanimated animation.
// These are the Reanimated equivalents of the RN Animated springs above.

export const reanimatedSpring = {
  snap: { damping: 20, stiffness: 400 },
  rubber: { damping: 30, stiffness: 300 },
  mount: { damping: 14, stiffness: 200 },
  land: { damping: 22, stiffness: 300 },
  settle: { damping: 15, stiffness: 150 },
  gentle: { damping: 20, stiffness: 100 },
} as const;

// ── Stagger timing ──
// Sequential reveal of related elements (menu rows, sticker options, entry animations).
// Maximum 5 elements in a stagger group. Beyond that, show simultaneously.

export const stagger = {
  interval: 40,
  maxElements: 5,
  engagement: 80,
  menu: 80,
} as const;

// ── Semantic motion tokens ──
// Named by intent, not by technical property.
// Use these in components. They encode both duration and easing.

export const motion = {
  // Feedback
  tapResponse: { duration: duration.micro, easing: easing.default },
  toggleSwitch: { duration: duration.micro, easing: easing.default },
  colorChange: { duration: duration.micro, easing: easing.default },

  // Transitions
  modalEnter: { duration: duration.small, easing: easing.softSettle },
  modalDismiss: { duration: duration.small, easing: easing.exit },
  tabSwitch: { duration: duration.small, easing: easing.default },
  pillExpand: { duration: duration.small, easing: easing.softSettle },

  // Navigation
  screenEnter: { duration: duration.medium, easing: easing.softSettle },
  screenExit: { duration: duration.medium, easing: easing.exit },
  crossfade: { duration: duration.medium, easing: easing.default },
  viewMorph: { duration: duration.medium, easing: easing.softSettle },

  // Atmosphere
  entryReveal: { duration: duration.large, easing: easing.softSettle },
  caughtUp: { duration: duration.large, easing: easing.softSettle },
  sessionStart: { duration: duration.large, easing: easing.default },
  chromeFade: { duration: duration.atmospheric, easing: easing.softSettle },
  chromeRestore: { duration: duration.medium, easing: easing.default },
  chromeEngage: { duration: duration.medium, easing: easing.softSettle },

  // Story-specific
  storyCrossfade: { duration: 200, easing: easing.default },
  storyProgress: { duration: 5000, easing: Easing.linear },
  storyHoldover: { duration: 200, easing: easing.default },
  storyDismiss: { duration: duration.small, easing: easing.exit },

  // Composer-specific
  composerEntry: { duration: duration.medium, easing: easing.softSettle },
  composerControlsEntry: { duration: duration.small, easing: easing.softSettle },
  stickerMount: { duration: 200, easing: easing.softSettle },
  stickerSnap: { duration: 80, easing: easing.default },
  stickerDelete: { duration: 150, easing: easing.exit },
  backgroundSwitch: { duration: duration.small, easing: easing.default },
  deleteZoneReveal: { duration: 150, easing: easing.default },

  // Engagement-specific
  engagementReveal: { duration: 550, easing: easing.softSettle },
  engagementPctFade: { duration: 200, easing: easing.default },
  engagementHighlight: { duration: 120, easing: easing.default },
  engagementRevert: { duration: 200, easing: easing.default },
  engagementSettle: { duration: 250, easing: easing.softSettle },
  engagementSuspense: 300,
  sliderSettle: { duration: 400, easing: easing.softSettle },

  // Picker/overlay
  pickerEnter: { duration: duration.small, easing: easing.softSettle },
  pickerDismiss: { duration: duration.micro, easing: easing.exit },
} as const;