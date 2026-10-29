import { STORY_FILTERS } from './storyFilterAppearance';
import type { StoryAdjust } from './storyAdjustAppearance';

export type StoryPhotoLook = { adjust?: StoryAdjust | null; filterId?: string | null; filterAmt?: number | null };
export const IDENTITY_COLOR_MATRIX = [1,0,0,0,0, 0,1,0,0,0, 0,0,1,0,0, 0,0,0,1,0];
const finite = (value: unknown, fallback = 0) => value != null && Number.isFinite(Number(value)) ? Number(value) : fallback;
const amount = (value: unknown) => Math.max(-1, Math.min(1, finite(value) / 100));
const rgb = (r: number, g = r, b = r, ro = 0, go = ro, bo = ro) => [r,0,0,0,ro, 0,g,0,0,go, 0,0,b,0,bo, 0,0,0,1,0];

/** Affine sRGB matrices use normalized channel offsets, matching Skia and SVG. */
export function composeColorMatrices(outer: readonly number[], inner: readonly number[]): number[] {
  return Array.from({ length: 20 }, (_, index) => {
    const row = Math.floor(index / 5), column = index % 5;
    let value = column === 4 ? outer[row * 5 + 4] : 0;
    for (let k = 0; k < 4; k++) value += outer[row * 5 + k] * inner[k * 5 + column];
    return value;
  });
}
function saturation(value: number): number[] {
  const luminance = [.2126,.7152,.0722], matrix = IDENTITY_COLOR_MATRIX.slice();
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) matrix[row * 5 + col] = luminance[col] * (1 - value) + (row === col ? value : 0);
  return matrix;
}
function blendPlane(color: string, opacity: number): number[] {
  const channels = [1,3,5].map(index => parseInt(color.slice(index, index + 2), 16) / 255);
  return rgb(1-opacity,1-opacity,1-opacity,channels[0]*opacity,channels[1]*opacity,channels[2]*opacity);
}
export function storyPhotoColorMatrix(look: StoryPhotoLook | null | undefined): number[] {
  let matrix = IDENTITY_COLOR_MATRIX.slice();
  const append = (next: number[]) => { matrix = composeColorMatrices(next, matrix); };
  const filter = STORY_FILTERS.find(item => item.id === look?.filterId);
  const strength = Math.max(0, Math.min(1, finite(look?.filterAmt, 100) / 100));
  if (filter && strength) {
    for (const match of (filter.css || '').matchAll(/([a-z-]+)\(([\d.]+)\)/g)) {
      const fn = match[1], raw = Number(match[2]), neutral = fn === 'grayscale' || fn === 'sepia' ? 0 : 1;
      const value = neutral + (raw-neutral)*strength;
      if (fn === 'brightness') append(rgb(value));
      if (fn === 'contrast') append(rgb(value,value,value,.5*(1-value)));
      if (fn === 'saturate') append(saturation(value));
      if (fn === 'grayscale') append(saturation(1-value));
      if (fn === 'sepia') {
        const sepia = [.393,.769,.189,0,0, .349,.686,.168,0,0, .272,.534,.131,0,0, 0,0,0,1,0];
        append(sepia.map((n,index) => IDENTITY_COLOR_MATRIX[index] + (n-IDENTITY_COLOR_MATRIX[index])*value));
      }
    }
    for (const layer of filter.layers) append(blendPlane(layer.color, layer.opacity * strength));
  }
  const adjust = look?.adjust;
  if (adjust) {
    const brightness = Math.pow(2, amount(adjust.bri)), contrast = 1 + amount(adjust.con) * .9;
    append(rgb(brightness));
    append(rgb(contrast,contrast,contrast,.5*(1-contrast)));
    append(saturation(1 + amount(adjust.sat)));
    const warmth = amount(adjust.warm), tint = amount(adjust.tint);
    append(rgb(1 + warmth*.25 + tint*.1, 1-tint*.15, 1-warmth*.25+tint*.1));
    // Tonal adjustments follow pixel luminance, rather than screen position.
    const highlights = amount(adjust.hi)*.25, shadows = amount(adjust.sh)*.25;
    if (highlights || shadows) {
      const tonal = IDENTITY_COLOR_MATRIX.slice(), luminance = [.2126,.7152,.0722];
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) tonal[row*5+col] += (highlights-shadows)*luminance[col];
        tonal[row*5+4] = shadows;
      }
      append(tonal);
    }
    const fade = Math.max(0, amount(adjust.fade)) * .28;
    if (fade) append(blendPlane('#D8D2C8', fade));
  }
  return matrix.map(value => Math.round(value*1e8)/1e8);
}
export function hasStoryPhotoLook(look: StoryPhotoLook | null | undefined): boolean {
  return !!look && (!!look.filterId || Object.values(look.adjust || {}).some(value => finite(value) !== 0));
}
/** Grain and vignetting remain spatial overlays after the pixel color grade. */
export function storyPhotoSpatialAdjust(adjust: StoryAdjust | null | undefined): StoryAdjust | null {
  return adjust && (adjust.grain || adjust.vig) ? { grain: adjust.grain, vig: adjust.vig } : null;
}
