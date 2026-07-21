/**
 * PlatinumCircles Spacing Token System
 *
 * Space is the primary communicator of hierarchy.
 * Not color. Not size. Not borders. Space.
 *
 * 8pt grid. Every value is a multiple of 4.
 * Generous space around important elements makes them feel more valuable.
 * Cramped space makes interfaces feel cheap regardless of visual quality.
 *
 * Rules:
 * - Never use arbitrary spacing values. Every gap maps to this scale.
 * - Edge margins: minimum 16px, preferably 20px on mobile.
 * - If two elements feel too close, increase by one step. Never half-step.
 */

export const space = {
  /** 4px - Hairline separation. Related items within a group. */
  xxs: 4,
  /** 8px - Tight grouping. Label to input, icon to text. */
  xs: 8,
  /** 12px - Standard internal padding. Card content, button padding. */
  sm: 12,
  /** 16px - Section breathing. Between groups within a section. */
  md: 16,
  /** 20px - Screen edge margins. Default horizontal padding. */
  edge: 20,
  /** 24px - Section separation. Between distinct sections. */
  lg: 24,
  /** 32px - Major separation. Between content regions. */
  xl: 32,
  /** 48px - Atmospheric space. Hero breathing, screen-level gaps. */
  xxl: 48,
} as const;

// ── Semantic spacing tokens ──
// Named by intent. Components use these.

export const spacing = {
  // Screen layout
  screenPaddingH: space.edge,
  screenPaddingTop: space.md,
  sectionGap: space.lg,
  regionGap: space.xl,

  // Cards and containers
  cardPadding: space.sm,
  cardPaddingLarge: space.md,
  cardGap: space.xs,

  // Lists and rows
  listItemPaddingV: space.sm,
  listItemPaddingH: space.md,
  listItemGap: space.xs,

  // Toolbar and controls
  toolbarPaddingH: space.sm,
  toolbarIconGap: space.md,
  controlGroupGap: space.xs,

  // Modal and sheet
  modalPadding: space.md,
  sheetPaddingTop: space.md,

  // Story viewer
  viewerEdgePadding: space.md,
  viewerProgressPadding: space.md,
  viewerReplyMargin: space.md,

  // Story composer
  composerCanvasMargin: space.xs,
  composerControlsPadding: space.sm,
  composerBottomPadding: space.sm,

  // Feed
  feedCardGap: space.xs,
  feedAvatarGap: space.xs,
  feedStripGap: space.xs,
} as const;