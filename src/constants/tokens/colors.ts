/**
 * PlatinumCircles Semantic Color System
 *
 * The emotional temperature of the app. Every surface, text element, border,
 * and accent references these tokens.
 *
 * Temperature: Warm nocturnal calm.
 * Navy atmosphere. Softened whites. Intimate luminance. Evening energy.
 *
 * Rules:
 * - Never use raw hex colors inline. Always reference a semantic token.
 * - Semantic names describe purpose, not appearance.
 * - "text.muted" not "white50". "surface.overlay" not "blackTransparent".
 * - This enables future theming without renaming.
 */

// ── Identity colors ──
// The raw palette. Components should rarely use these directly.
// Use the semantic tokens below instead.

export const palette = {
  platinumWhite: '#F5F0EB',
  platinumAccent: '#C9BFB0',
  platinumMuted: '#A89F91',
  navy: '#0B1E3D',
  warmBlack: 'rgb(6,12,24)',
  pureWhite: '#FFFFFF',
  warmWhite: '#F8F7F5',
  error: '#FF3B30',
  success: '#34C759',
  info: '#007AFF',
  warning: '#FF9500',
} as const;

// ── Surface colors ──
// Backgrounds and container fills. Ordered from deepest to lightest.

export const surface = {
  immersive: palette.warmBlack,
  primary: '#000000',
  creation: palette.navy,
  secondary: 'rgba(255,255,255,0.08)',
  elevated: 'rgba(255,255,255,0.12)',
  active: 'rgba(255,255,255,0.15)',
  overlay: 'rgba(0,0,0,0.55)',
  overlayLight: 'rgba(0,0,0,0.4)',
  scrim: 'rgba(0,0,0,0.3)',
} as const;

// ── Surface colors (light mode) ──
export const surfaceLight = {
  primary: palette.warmWhite,
  secondary: 'rgba(0,0,0,0.03)',
  elevated: 'rgba(0,0,0,0.06)',
  active: 'rgba(0,0,0,0.08)',
  overlay: 'rgba(0,0,0,0.55)',
} as const;

// ── Text colors ──

export const text = {
  primary: '#FFFFFF',
  secondary: 'rgba(255,255,255,0.7)',
  muted: 'rgba(255,255,255,0.5)',
  faint: 'rgba(255,255,255,0.3)',
  whisper: 'rgba(255,255,255,0.15)',
  inverse: palette.navy,
} as const;

export const textLight = {
  primary: palette.navy,
  secondary: 'rgba(11,30,61,0.5)',
  muted: 'rgba(11,30,61,0.3)',
  faint: 'rgba(11,30,61,0.15)',
} as const;

// ── Border colors ──

export const border = {
  soft: 'rgba(255,255,255,0.08)',
  default: 'rgba(255,255,255,0.15)',
  strong: 'rgba(255,255,255,0.3)',
  accent: palette.platinumAccent,
} as const;

export const borderLight = {
  soft: 'rgba(0,0,0,0.04)',
  default: 'rgba(0,0,0,0.08)',
  strong: 'rgba(0,0,0,0.15)',
  accent: palette.platinumAccent,
} as const;

// ── Accent colors ──

export const accent = {
  primary: palette.platinumWhite,
  warm: palette.platinumAccent,
  warmMuted: palette.platinumMuted,
  error: palette.error,
  success: palette.success,
  info: palette.info,
  warning: palette.warning,
} as const;

// ── Story background palette ──
// The 8 text story backgrounds. Each defines the background rendering
// and whether default sticker text should be light or dark.

export const storyBackgrounds = [
  { id: 'navy', label: 'Navy', kind: 'solid' as const, color: palette.navy, isDark: true },
  { id: 'warmblack', label: 'Night', kind: 'solid' as const, color: palette.warmBlack, isDark: true },
  { id: 'slate', label: 'Slate', kind: 'solid' as const, color: '#334155', isDark: true },
  { id: 'white', label: 'White', kind: 'solid' as const, color: palette.pureWhite, isDark: false },
  { id: 'platinum', label: 'Platinum', kind: 'gradient' as const, colors: ['#C9BFB0', '#A89F91'] as [string, string], direction: 'diagonal' as const, isDark: false },
  { id: 'dusk', label: 'Dusk', kind: 'gradient' as const, colors: ['#1a1a2e', '#16213e'] as [string, string], direction: 'vertical' as const, isDark: true },
  { id: 'sunrise', label: 'Sunrise', kind: 'gradient' as const, colors: ['#ff9a9e', '#fecfef'] as [string, string], direction: 'diagonal' as const, isDark: false },
  { id: 'ocean', label: 'Ocean', kind: 'gradient' as const, colors: ['#667eea', '#764ba2'] as [string, string], direction: 'diagonal' as const, isDark: true },
] as const;

// ── Sticker color palette ──
// The 8 discrete color options for text stickers.

export const stickerColors = [
  '#FFFFFF',
  '#000000',
  '#FF3B30',
  '#FF9500',
  '#FFCC00',
  '#34C759',
  '#007AFF',
  '#AF52DE',
] as const;