/**
 * PlatinumCircles Haptic Token System
 *
 * Haptics confirm action. They do not announce it.
 * Every haptic event pairs with a visual change. Never alone.
 *
 * Rules:
 * - Never fire haptics during passive scrolling.
 * - Maximum 3 haptic events within 1 second.
 * - Haptics pair with visual feedback, never standalone.
 * - All haptic calls go through this module for consistency.
 */

import * as Haptics from 'expo-haptics';

// ── Haptic tiers ──
// Tier 1: Light.    Subtle confirmation. Snap to guide, enter zone, soft acknowledge.
// Tier 2: Medium.   Standard confirmation. Button press, toggle, selection.
// Tier 3: Heavy.    Significant action. Publish, delete, major state change.
// Tier 4: Rigid.    Error or boundary. Rejection, limit reached, constraint hit.

export const haptic = {
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  rigid: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  selection: () => Haptics.selectionAsync(),
} as const;

// ── Semantic haptic tokens ──
// Named by interaction, not by intensity.
// Components use these. They encode the correct haptic tier for each event.

export const feedback = {
  // Gesture feedback
  snapToCenter: haptic.light,
  snapToGuide: haptic.light,
  enterDeleteZone: haptic.light,
  stickerDrop: haptic.light,

  // Creation
  capturePhoto: haptic.medium,
  startRecording: haptic.light,
  stopRecording: haptic.medium,
  addSticker: haptic.light,
  removeSticker: haptic.light,
  backgroundSwitch: haptic.selection,

  // Publishing
  publishStory: haptic.medium,
  publishConfirm: haptic.success,

  // Viewing
  storyPause: haptic.light,
  storyResume: haptic.light,
  reactionSend: haptic.light,
  replySend: haptic.medium,

  // Navigation
  tabSwitch: haptic.selection,
  modalOpen: haptic.light,
  modalDismiss: haptic.light,

  // Errors
  limitReached: haptic.rigid,
  actionFailed: haptic.rigid,
  networkError: haptic.rigid,
} as const;