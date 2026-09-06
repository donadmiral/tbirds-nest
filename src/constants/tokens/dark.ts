/**
 * PlatinumCircles dark theme: the mirror of ./light, same shape, same names.
 *
 * The canvas is the navy identity taken to the deep end rather than pure
 * black, so the app reads as the same product in both modes. Every ink on
 * every surface here clears 4.5:1: the primary ink on the canvas is about
 * 16:1, the muted ink about 7:1, the faint ink is for decoration only.
 * Primary buttons invert: warm white ground, navy text.
 */

const NAVY = '#0B1E3D';
const WARM_WHITE = '#F5F3EF';

export const dark = {
  surface: {
    canvas:   '#0A1220',
    raised:   '#111B2E',
    sunken:   '#0E1626',
    hairline: 'rgba(245,243,239,0.10)',
    divider:  'rgba(245,243,239,0.07)',
    scrim:    'rgba(0,0,0,0.62)',
  },
  ink: {
    primary:   WARM_WHITE,
    secondary: 'rgba(245,243,239,0.74)',
    muted:     'rgba(245,243,239,0.54)',
    faint:     'rgba(245,243,239,0.30)',
    inverse:   NAVY,
  },
  brand: {
    base:  WARM_WHITE,
    warm:  '#C9BFB0',
    tintBg: 'rgba(245,243,239,0.08)',
  },
  status: {
    innovation:   '#F5A524',
    innovationBg: 'rgba(245,165,36,0.14)',
    link:         '#8AB4F8',
    linkBg:       'rgba(138,180,248,0.14)',
    danger:       '#FF6B6B',
    dangerBg:     'rgba(255,107,107,0.14)',
    success:      '#34D399',
    warning:      '#FFB340',
  },
} as const;

export type DarkTheme = typeof dark;