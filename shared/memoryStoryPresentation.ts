/** Read the saved story recipe without introducing any album music dependency. */
function object(value: unknown): Record<string, any> {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}
const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function memoryStoryRecipe(value: unknown, duration?: number | null) {
  const raw = object(value);
  const limit = typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  const start = clamp(finite(raw.trimStart, 0), 0, Math.max(0, limit - .05));
  const proposedEnd = finite(raw.trimEnd, limit);
  const end = proposedEnd > start ? Math.min(proposedEnd, limit) : limit;
  return {
    start, end: Number.isFinite(end) ? end : null,
    speed: clamp(finite(raw.speed, 1), .25, 4),
    volume: raw.muted === true ? 0 : clamp(finite(raw.mix?.orig, 100) / 100, 0, 1),
    fit: (raw.fit === 'cover' ? 'cover' : 'contain') as 'cover' | 'contain',
    scale: clamp(finite(raw.scale, 1), .35, 5),
    x: clamp(finite(raw.translateNX, 0), -2, 2),
    y: clamp(finite(raw.translateNY, 0), -2, 2),
    filterAmt: clamp(finite(raw.filterAmt, 100), 0, 100),
    adjust: raw.adjust && typeof raw.adjust === 'object' ? raw.adjust : null,
    bg: raw.bg && typeof raw.bg === 'object' ? raw.bg : null,
  };
}

/** Older album reads serialized their JSON; current reads return the array. */
export function memoryStoryStickers(value: unknown): any[] {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return []; } }
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object').slice(0, 30) : [];
}

/** Decode legacy layer JSON before the authorized media manifest is collected. */
export function memoryAlbumStoryLayers<T extends { pages?: unknown; cover_page?: unknown }>(album: T): T {
  const page = (value: any) => value && typeof value === 'object' ? { ...value, stickers: memoryStoryStickers(value.stickers) } : value;
  return { ...album, pages: Array.isArray(album.pages) ? album.pages.map(page) : album.pages, cover_page: page(album.cover_page) };
}

export function memoryStoryLayerVisible(sticker: any, clock: number | null) {
  if (clock == null) return true;
  return clock >= finite(sticker?.startSec, 0) - .05 && clock <= finite(sticker?.endSec, Infinity) + .05;
}

/** Clamp controls and loop a playing clip inside the author's saved excerpt. */
export function memoryStorySeek(time: number, recipe: ReturnType<typeof memoryStoryRecipe>): number | null {
  if (!Number.isFinite(time) || time < recipe.start - .05 || recipe.end != null && time >= recipe.end - .025) return recipe.start;
  return null;
}
