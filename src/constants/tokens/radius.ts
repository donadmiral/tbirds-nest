/**
 * PlatinumCircles Radius Token System
 *
 * Radius communicates permanence.
 * Sharper = structural. Rounder = ephemeral.
 *
 * Rules:
 * - Never mix radius sizes within the same visual group.
 * - Cards within cards: inner radius = outer radius minus padding.
 * - Modals: 16px top corners, 0px bottom (anchored to screen edge).
 */

export const radius = {
  /** 0px - Structural edges. Dividers, full-bleed media. */
  none: 0,
  /** 4px - Dense elements. Tags, tiny badges, inline pills. */
  xs: 4,
  /** 8px - Standard controls. Buttons, inputs, small cards. */
  sm: 8,
  /** 12px - Soft containers. Pills, search fields, grouped items. */
  md: 12,
  /** 16px - Floating elements. Modal sheets, overlays, bottom sheets. */
  lg: 16,
  /** 20px - Story canvas. Full composition surfaces. */
  xl: 20,
  /** 9999px - Circular. Avatars, round buttons, dots. */
  full: 9999,
} as const;

// ── Semantic radius tokens ──

export const borderRadius = {
  button: radius.sm,
  input: radius.md,
  card: radius.md,
  pill: radius.md,
  modal: radius.lg,
  storyCanvas: radius.xl,
  avatar: radius.full,
  badge: radius.xs,
  swatch: radius.full,
  thumbnail: radius.sm,
  progressBar: 1,
} as const;