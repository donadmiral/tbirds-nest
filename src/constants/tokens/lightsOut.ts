import { dark } from './dark';

/** Black canvas with distinct raised surfaces. Media keeps its own viewing palette. */
export const lightsOut = {
  ...dark,
  surface: {
    ...dark.surface,
    canvas: '#000000', raised: '#16181C', sunken: '#0A0A0C',
    hairline: '#33363B', divider: '#272B30',
  },
  ink: { ...dark.ink, primary: '#E7E9EA', secondary: '#B3BAC2', muted: '#A1A9B2', inverse: '#0B0D10' },
  brand: { ...dark.brand, base: '#E7E9EA', tintBg: '#202327' },
} as const;
