/**
 * PlatinumCircles Typography Token System
 *
 * Typography carries emotion. It is not decoration.
 * Two systems: UI typography (navigation, labels, body) and
 * Story typography (sticker styles, creative expression).
 *
 * Rules:
 * - Use system fonts (San Francisco on iOS). No custom web fonts for UI.
 * - Never use more than 3 font weights on one screen.
 * - Weight hierarchy: 400 body, 500 labels, 600 emphasis, 700 action.
 * - Story stickers use their own style system (stickerStyles.ts).
 */

// ── UI Type Scale ──
// These are the only font sizes allowed in UI elements.
// Story stickers have their own scale (see storyType below).

export const typeSize = {
  /** 11px - Micro labels. Section headers, uppercase markers. */
  micro: 11,
  /** 12px - Small. Dense metadata, badge and chip text. */
  small: 12,
  /** 13px - Captions. Timestamps, metadata, subtle info. */
  caption: 13,
  /** 14px - Body. Messages, descriptions, input text. */
  body: 14,
  /** 15px - Emphasis. Button text, action labels. */
  emphasis: 15,
  /** 16px - Subhead. Modal titles, section names. */
  subhead: 16,
  /** 19px - Heading. Screen section headings, card titles. */
  heading: 19,
  /** 20px - Title. Menu items, prominent labels. */
  title: 20,
  /** 28px - Display. Screen titles, wordmark. */
  display: 28,
} as const;

// ── Line Height multipliers ──

export const lineHeight = {
  tight: 1.2,
  default: 1.4,
  relaxed: 1.5,
  story: 1.3,
} as const;

// ── Letter Spacing ──

export const letterSpacing = {
  /** +1.5px - Micro labels. Open, airy, uppercase. */
  wide: 1.5,
  /** 0 - Default. Body text, standard labels. */
  normal: 0,
  /** -0.2px - Display. Optically tightened for larger sizes. */
  tight: -0.2,
  /** -0.5px - Dense. Bold display text. */
  dense: -0.5,
} as const;

// ── Font Weights ──

export const fontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  heavy: '800' as const,
  black: '900' as const,
} as const;

// ── Semantic type styles ──
// Named by role. Components use these.
// Each returns a style object ready for React Native's Text component.

export const type = {
  microLabel: {
    fontSize: typeSize.micro,
    fontWeight: fontWeight.semibold,
    letterSpacing: letterSpacing.wide,
    textTransform: 'uppercase' as const,
  },
  caption: {
    fontSize: typeSize.caption,
    fontWeight: fontWeight.regular,
    letterSpacing: letterSpacing.normal,
    lineHeight: typeSize.caption * lineHeight.default,
  },
  body: {
    fontSize: typeSize.body,
    fontWeight: fontWeight.regular,
    letterSpacing: letterSpacing.normal,
    lineHeight: typeSize.body * lineHeight.default,
  },
  bodyMedium: {
    fontSize: typeSize.body,
    fontWeight: fontWeight.medium,
    letterSpacing: letterSpacing.normal,
    lineHeight: typeSize.body * lineHeight.default,
  },
  emphasis: {
    fontSize: typeSize.emphasis,
    fontWeight: fontWeight.bold,
    letterSpacing: letterSpacing.normal,
  },
  subhead: {
    fontSize: typeSize.subhead,
    fontWeight: fontWeight.bold,
    letterSpacing: letterSpacing.normal,
  },
  title: {
    fontSize: typeSize.title,
    fontWeight: fontWeight.medium,
    letterSpacing: letterSpacing.tight,
  },
} as const;

// ── Story type scale ──
// Sticker typography lives in stickerStyles.ts.
// These are reference constants for the story type system.

export const storyType = {
  baseSizeRange: { min: 18, max: 48 },
  emojiSize: 44,
  defaultLineHeight: lineHeight.story,
  maxStickerWidth: 0.85, // Fraction of screen width
} as const;