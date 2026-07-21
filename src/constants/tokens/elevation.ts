/**
 * PlatinumCircles Elevation Token System
 *
 * Blur creates focus. Depth creates context.
 * What recedes matters as much as what is prominent.
 *
 * Material surfaces define how different layers of the interface behave.
 * Each surface type has distinct opacity, blur, shadow, and luminance
 * characteristics.
 */

// ── Blur scale ──

export const blur = {
  /** 0 - Content layer. Full clarity. Primary focus. */
  none: 0,
  /** 10 - Soft separation. Overlay behind modals. */
  soft: 10,
  /** 20 - Environmental. Background behind floating sheets. */
  medium: 20,
  /** 30 - Atmospheric. Blurred image behind contain-fit media. */
  heavy: 30,
} as const;

// ── Shadow presets ──

export const shadow = {
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  subtle: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  medium: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  strong: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
} as const;

// ── Elevation tiers ──
// Each tier defines the visual treatment for a layer of the interface.

export const elevation = {
  /** Ground: No shadow, no blur. Feed content, list items. Flat on the surface. */
  ground: {
    shadow: shadow.none,
    blur: blur.none,
    zIndex: 0,
  },
  /** Lifted: Subtle shadow. Cards, pills, floating badges. Slightly above ground. */
  lifted: {
    shadow: shadow.subtle,
    blur: blur.none,
    zIndex: 1,
  },
  /** Floating: Medium shadow + optional blur backdrop. Modals, sheets. */
  floating: {
    shadow: shadow.medium,
    blur: blur.soft,
    zIndex: 10,
  },
  /** Overlay: Dark scrim + content above. Story viewer, lightboxes. */
  overlay: {
    shadow: shadow.none,
    blur: blur.medium,
    zIndex: 20,
  },
  /** Immersive: Full-screen takeover. Camera, story creation. */
  immersive: {
    shadow: shadow.none,
    blur: blur.none,
    zIndex: 30,
  },
} as const;

// ── Material surfaces ──
// Each material defines how a surface type behaves across the app.
// These are conceptual groupings that combine elevation, opacity, and identity.

export const material = {
  /** Grounded: Feed cards, list items, settings rows. Solid, no depth tricks. */
  grounded: {
    elevation: elevation.ground,
    opacity: 1.0,
    description: 'Solid surface, no depth. Content sits here.',
  },
  /** Editorial: Profile headers, story strip, section titles. Clean, confident. */
  editorial: {
    elevation: elevation.ground,
    opacity: 1.0,
    description: 'Content-forward surface. Typography leads.',
  },
  /** Glass: Modals, overlays, floating sheets. Semi-transparent, dimmed backdrop. */
  glass: {
    elevation: elevation.floating,
    opacity: 0.92,
    description: 'Translucent surface over dimmed content.',
  },
  /** Atmospheric: Viewer scrims, gradient overlays, ambient layers. */
  atmospheric: {
    elevation: elevation.overlay,
    opacity: 0.6,
    description: 'Gradient or scrim that creates mood without blocking.',
  },
  /** Immersive: Camera viewfinder, story canvas. Full-bleed, zero chrome. */
  immersive: {
    elevation: elevation.immersive,
    opacity: 1.0,
    description: 'Full-screen surface. Interface disappears.',
  },
} as const;