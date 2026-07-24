/**
 * PlatinumCircles light theme.
 *
 * The existing tokens in ./colors are dark-first, built for the immersive
 * story surfaces. The rest of the app is a light surface and needs its own
 * semantic layer.
 *
 * Principle: every neutral derives from the navy identity rather than from
 * pure black, so greys carry a trace of the brand and the interface reads as
 * one product instead of a collection of screens.
 *
 * Rule: no hex literals in screens. Import from here.
 */

const NAVY = '#0B1E3D';

export const light = {
  surface: {
    canvas:   '#FFFFFF',
    raised:   '#FAFAF9',
    sunken:   '#F4F3F1',
    hairline: 'rgba(11,30,61,0.08)',
    divider:  'rgba(11,30,61,0.06)',
    scrim:    'rgba(11,30,61,0.45)',
  },
  ink: {
    primary:   NAVY,
    secondary: 'rgba(11,30,61,0.62)',
    muted:     'rgba(11,30,61,0.42)',
    faint:     'rgba(11,30,61,0.24)',
    inverse:   '#FFFFFF',
  },
  brand: {
    base:  NAVY,
    warm:  '#C9BFB0',
    tintBg: 'rgba(11,30,61,0.05)',
  },
  status: {
    innovation:   '#D97706',
    innovationBg: '#FFFBEB',
    link:         '#2563EB',
    linkBg:       '#EFF6FF',
    danger:       '#FF3B30',
    dangerBg:     '#FFF0F0',
    success:      '#059669',
    warning:      '#FF9500',
  },
} as const;

export type LightTheme = typeof light;