import { storyPhotoColorMatrix, type StoryPhotoLook } from './storyColorMatrix';

export type StoryVideoRecipe = {
  width: number; height: number; trimStart: number; trimEnd: number; speed: number; volume: number;
  fit: 'cover' | 'contain'; scale: number; x: number; y: number; matrix: number[];
};
const bounded = (value: unknown, fallback: number, min: number, max: number) => {
  const n = value == null ? fallback : Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/** Export is a finite, local operation. Bounds apply again in the native bridge. */
export function storyVideoRecipe(input: { duration: number; width: number; height: number; transform?: any; filterId?: string | null }): StoryVideoRecipe {
  if (!Number.isFinite(input.duration) || input.duration <= 0) throw new Error('Wait for the video duration before exporting.');
  if (!Number.isFinite(input.width) || !Number.isFinite(input.height) || input.width <= 0 || input.height <= 0) throw new Error('Wait for the story canvas before exporting.');
  const tx = input.transform || {}, duration = input.duration;
  const start = bounded(tx.trimStart, 0, 0, Math.max(0, duration - .1));
  const end = bounded(tx.trimEnd, Math.min(duration, start + 60), start + .1, Math.min(duration, start + 60));
  const speed = bounded(tx.speed, 1, .25, 4);
  if ((end - start) / speed > 120) throw new Error('Trim the slowed video to two minutes or less before exporting.');
  const ratio = Math.min(1080 / input.width, 1920 / input.height);
  const width = Math.max(2, Math.round(input.width * ratio / 2) * 2);
  const height = Math.max(2, Math.round(input.height * ratio / 2) * 2);
  return { width, height, trimStart: start, trimEnd: end, speed, volume: tx.muted ? 0 : bounded(tx.mix?.orig, 100, 0, 100) / 100,
    fit: tx.fit === 'cover' ? 'cover' : 'contain', scale: bounded(tx.scale, 1, .35, 5), x: bounded(tx.translateNX, 0, -2, 2), y: bounded(tx.translateNY, 0, -2, 2),
    matrix: storyPhotoColorMatrix({ filterId: input.filterId, filterAmt: tx.filterAmt, adjust: tx.adjust } as StoryPhotoLook) };
}

export type StoryVideoLayerWindow = { start: number; end: number; clock: number };
/** Capture only a change in visible timed artwork, not thousands of identical frames. */
export function storyVideoLayerWindows(stickers: readonly any[], recipe: Pick<StoryVideoRecipe, 'trimStart' | 'trimEnd' | 'speed'>): StoryVideoLayerWindow[] {
  const cuts = new Set([recipe.trimStart, recipe.trimEnd]);
  for (const layer of stickers) for (const key of ['startSec', 'endSec']) {
    const value = layer?.[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > recipe.trimStart && value < recipe.trimEnd) cuts.add(value);
  }
  const times = [...cuts].sort((a, b) => a - b);
  if (times.length > 24) throw new Error('This story has too many timed layer changes to export. Simplify its timing first.');
  return times.slice(0, -1).map((time, i) => ({ start: (time - recipe.trimStart) / recipe.speed, end: (times[i + 1] - recipe.trimStart) / recipe.speed, clock: (time + times[i + 1]) / 2 }));
}

/** A still raster must never silently replace an animation or an embedded video. */
export function storyVideoExportLimit(stickers: readonly any[], hasExternalAudio = false, supportsExternalAudio = false): string | null {
  if (hasExternalAudio && !supportsExternalAudio) return 'Export with added music or voiceover needs the new iPhone build. Your soundtrack and draft are kept.';
  if (stickers.some(s => s?.kind === 'gif')) return 'Animated GIF export is not available yet. Remove the GIF to export this edited video.';
  if (stickers.some(s => s?.anim && s.anim !== 'none' || s?.textAnim && s.textAnim !== 'none')) return 'Animated sticker export is not available yet. Set sticker animations to None to export this edited video.';
  if (stickers.some(s => s?.postMediaType === 'video' || s?.storyMediaType === 'video')) return 'Exporting a video inside another video is not available yet. Remove the embedded clip to export this edited video.';
  return null;
}

export function storyVideoLayerAtTime(layer: any, clock: number): boolean {
  return !(typeof layer?.startSec === 'number' && clock < layer.startSec) && !(typeof layer?.endSec === 'number' && clock >= layer.endSec);
}

export function storyVideoMime(supported: (type: string) => boolean): string | null {
  return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(supported) || null;
}
