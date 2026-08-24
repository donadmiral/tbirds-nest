import { Platform } from 'react-native';
import { isColorLight } from './colorUtils';
import type { StoryStickerStyle } from '../services/storiesService';

// Re-export for convenience
export type { StoryStickerStyle } from '../services/storiesService';

/**
 * Ordered list of sticker styles available in the composer.
 */
export const STICKER_STYLES: StoryStickerStyle[] = [
  'classic', 'bold', 'typewriter', 'neon', 'highlight',
  'outline', 'shadow3d', 'retro', 'script',
];

/**
 * Human-readable labels for each sticker style.
 */
export const STICKER_STYLE_LABELS: Record<StoryStickerStyle, string> = {
  classic: 'Classic',
  bold: 'Bold',
  typewriter: 'Mono',
  neon: 'Neon',
  highlight: 'Highlight',
  outline: 'Outline',
  shadow3d: '3D',
  retro: 'Retro',
  script: 'Script',
};

/**
 * Default font sizes per sticker style (used when no override is set).
 */
export const BASE_FONT_SIZES: Record<StoryStickerStyle, number> = {
  classic: 30,
  bold: 34,
  typewriter: 26,
  neon: 32,
  highlight: 28,
  outline: 32,
  shadow3d: 34,
  retro: 28,
  script: 36,
};

/**
 * Compute text style + wrapper style for a text sticker.
 * Extracted verbatim from StoryComposerScreen + StoryViewerScreen (identical in both).
 */
export function stickerTextStyle(
  style: StoryStickerStyle,
  color: string,
  bgEnabled?: boolean,
  fontSizeOverride?: number,
) {
  if (!style || (BASE_FONT_SIZES as any)[style] === undefined) style = 'classic';
  const wantsPill = !!bgEnabled && style !== 'highlight';

  const pillWrapper = wantsPill ? {
    backgroundColor: color,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20,
  } as const : null;

  const pillTextColor = wantsPill ? (isColorLight(color) ? '#000000' : '#FFFFFF') : null;

  switch (style) {
    case 'classic': {
      const fs = fontSizeOverride ?? 30;
      const lh = Math.round(fs * 1.267);
      return {
        textStyle: {
          fontSize: fs, fontWeight: '700' as const, lineHeight: lh,
          color: pillTextColor || color,
          ...(wantsPill ? {} : {
            textShadowColor: 'rgba(0,0,0,0.45)',
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 3,
          }),
        },
        wrapperStyle: pillWrapper || {} as const,
      };
    }
    case 'bold': {
      const fs = fontSizeOverride ?? 34;
      const lh = Math.round(fs * 1.235);
      return {
        textStyle: {
          fontSize: fs, fontFamily: 'SpaceGrotesk_700Bold', lineHeight: lh,
          color: pillTextColor || color,
          letterSpacing: -0.5,
          ...(wantsPill ? {} : {
            textShadowColor: 'rgba(0,0,0,0.35)',
            textShadowOffset: { width: 0, height: 2 },
            textShadowRadius: 4,
          }),
        },
        wrapperStyle: pillWrapper || {} as const,
      };
    }
    case 'typewriter': {
      const fs = fontSizeOverride ?? 26;
      const lh = Math.round(fs * 1.308);
      return {
        textStyle: {
          fontSize: fs, lineHeight: lh,
          color: pillTextColor || color,
          fontFamily: 'SpaceMono_400Regular',
          letterSpacing: 0.5,
        },
        wrapperStyle: pillWrapper || {
          backgroundColor: 'rgba(0,0,0,0.55)',
          paddingHorizontal: 10, paddingVertical: 6,
          borderRadius: 6,
        } as const,
      };
    }
    case 'neon': {
      const fs = fontSizeOverride ?? 32;
      const lh = Math.round(fs * 1.25);
      return {
        textStyle: {
          fontSize: fs, fontFamily: 'SpaceGrotesk_700Bold', lineHeight: lh,
          color: pillTextColor || color,
          ...(wantsPill ? {} : {
            textShadowColor: color,
            textShadowOffset: { width: 0, height: 0 },
            textShadowRadius: 14,
          }),
        },
        wrapperStyle: pillWrapper || {} as const,
      };
    }
    case 'highlight': {
      const fs = fontSizeOverride ?? 28;
      const lh = Math.round(fs * 1.286);
      const isLight = color.toUpperCase() === '#FFFFFF' || color.toUpperCase() === '#FFCC00';
      return {
        textStyle: {
          fontSize: fs, fontWeight: '800' as const, lineHeight: lh,
          color: isLight ? '#000000' : '#FFFFFF',
        },
        wrapperStyle: {
          backgroundColor: color,
          paddingHorizontal: 10, paddingVertical: 5,
          borderRadius: 4,
        } as const,
      };
    }
    case 'outline': {
      const fs = fontSizeOverride ?? 32;
      const lh = Math.round(fs * 1.25);
      if (wantsPill) {
        return {
          textStyle: {
            fontSize: fs, fontWeight: '800' as const, lineHeight: lh,
            color: pillTextColor!,
            letterSpacing: 1,
          },
          wrapperStyle: {
            backgroundColor: color,
            borderWidth: 2.5,
            borderColor: pillTextColor!,
            paddingHorizontal: 12, paddingVertical: 6,
            borderRadius: 20,
          } as const,
        };
      }
      return {
        textStyle: {
          fontSize: fs, fontWeight: '800' as const, lineHeight: lh,
          color,
          letterSpacing: 1,
        },
        wrapperStyle: {
          borderWidth: 2.5,
          borderColor: color,
          paddingHorizontal: 12, paddingVertical: 6,
          borderRadius: 8,
        } as const,
      };
    }
    case 'shadow3d': {
      const fs = fontSizeOverride ?? 34;
      const lh = Math.round(fs * 1.235);
      return {
        textStyle: {
          fontSize: fs, fontFamily: 'ArchivoBlack_400Regular', lineHeight: lh,
          color: pillTextColor || '#FFFFFF',
          letterSpacing: -0.5,
          ...(wantsPill ? {} : {
            textShadowColor: color,
            textShadowOffset: { width: 3, height: 3 },
            textShadowRadius: 0,
          }),
        },
        wrapperStyle: pillWrapper || {} as const,
      };
    }
    case 'retro': {
      const fs = fontSizeOverride ?? 28;
      const lh = Math.round(fs * 1.357);
      const isLight = isColorLight(color);
      return {
        textStyle: {
          fontSize: fs, fontFamily: 'ArchivoBlack_400Regular', lineHeight: lh,
          color: isLight ? '#000000' : '#FFFFFF',
          letterSpacing: 2,
          textTransform: 'uppercase' as const,
        },
        wrapperStyle: pillWrapper || {
          backgroundColor: color,
          paddingHorizontal: 14, paddingVertical: 8,
          borderRadius: 2,
        } as const,
      };
    }
    case 'script': {
      const fs = fontSizeOverride ?? 36;
      const lh = Math.round(fs * 1.333);
      return {
        textStyle: {
          fontSize: fs, lineHeight: lh,
          color: pillTextColor || color,
          fontFamily: 'Caveat_600SemiBold',
          ...(wantsPill ? {} : {
            textShadowColor: 'rgba(0,0,0,0.3)',
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 4,
          }),
        },
        wrapperStyle: pillWrapper || {} as const,
      };
    }
  }
}