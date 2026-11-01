/** Persisted creative settings contain choices, never media delivery URLs. */
type MemoryCoverArtworkBase = {
  inscription: string;
  inscriptionStyle: 'handwritten' | 'serif' | 'sans';
  inscriptionPosition: 'top' | 'bottom';
  postmark: string;
  showDate: boolean;
  photo: { x: number; y: number; scale: number };
};
export type MemoryCoverStroke = {
  tool: 'pen' | 'marker' | 'highlight' | 'neon' | 'arrow' | 'dot';
  color: string;
  /** Width in a 200-point-wide cover, independent of the editor's size. */
  width: number;
  points: { x: number; y: number }[];
};
export type MemoryCoverArtworkV1 = MemoryCoverArtworkBase & { version: 1 };
export type MemoryCoverArtworkV2 = MemoryCoverArtworkBase & {
  version: 2;
  titleStyle: 'design' | 'handwritten' | 'serif' | 'sans';
  layout: 'single' | 'collage';
  /** References only: the reader supplies fresh, authorized media for these pages. */
  storyIds: string[];
  strokes: MemoryCoverStroke[];
  paperColor: string | null;
  inkColor: string | null;
};
export type MemoryCoverArtwork = MemoryCoverArtworkV1 | MemoryCoverArtworkV2;
export const MEMORY_COVER_MAX_STROKES = 64;
export const MEMORY_COVER_MAX_POINTS = 8192;
export const MEMORY_COVER_MAX_STROKE_POINTS = 512;
export const MEMORY_COVER_MAX_PHOTOS = 4;
export const MEMORY_COVER_DRAWING_COLORS = ['#142642', '#FFFFFF', '#932535', '#225071', '#3C5738', '#A15D29', '#9B4A81', '#FFD60A'] as const;

export type MemoryFilmSettings = {
  version: 1;
  mode: 'automatic' | 'original';
  style: 'reflective' | 'bright' | 'cinematic';
  length: 'short' | 'standard' | 'full';
  order: 'book' | 'chronological';
  titleCard: boolean;
  originalAudio: boolean;
};

export const DEFAULT_MEMORY_COVER_ARTWORK: Readonly<MemoryCoverArtworkV1> = {
  version: 1, inscription: '', inscriptionStyle: 'handwritten',
  inscriptionPosition: 'bottom', postmark: '', showDate: true,
  photo: { x: .5, y: .5, scale: 1 },
};

export const DEFAULT_MEMORY_FILM_SETTINGS: Readonly<MemoryFilmSettings> = {
  version: 1, mode: 'automatic', style: 'reflective', length: 'full',
  order: 'book', titleCard: true, originalAudio: true,
};

export const LEGACY_MEMORY_FILM_SETTINGS: Readonly<MemoryFilmSettings> = {
  ...DEFAULT_MEMORY_FILM_SETTINGS, mode: 'original', titleCard: false,
};

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key));
const text = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && Array.from(value).length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const number = (value: unknown, low: number, high: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
const oneOf = (value: unknown, allowed: readonly string[]): value is string =>
  typeof value === 'string' && allowed.includes(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const round = (value: number) => Math.round(value * 10000) / 10000;
const baseCoverKeys = ['version', 'inscription', 'inscriptionStyle', 'inscriptionPosition', 'postmark', 'showDate', 'photo'];

export function parseMemoryCoverStrokes(value: unknown): MemoryCoverStroke[] | null {
  if (!Array.isArray(value) || value.length > MEMORY_COVER_MAX_STROKES) return null;
  let pointCount = 0;
  const strokes: MemoryCoverStroke[] = [];
  for (const stroke of value) {
    if (!record(stroke) || !keys(stroke, ['tool', 'color', 'width', 'points']) ||
        !oneOf(stroke.tool, ['pen', 'marker', 'highlight', 'neon', 'arrow', 'dot']) ||
        !hex(stroke.color) || !number(stroke.width, .5, 16) || !Array.isArray(stroke.points) ||
        !stroke.points.length || stroke.points.length > MEMORY_COVER_MAX_STROKE_POINTS) return null;
    pointCount += stroke.points.length;
    if (pointCount > MEMORY_COVER_MAX_POINTS) return null;
    const points: MemoryCoverStroke['points'] = [];
    for (const point of stroke.points) {
      if (!record(point) || !keys(point, ['x', 'y']) || !number(point.x, 0, 1) || !number(point.y, 0, 1)) return null;
      points.push({ x: round(point.x), y: round(point.y) });
    }
    strokes.push({ tool: stroke.tool as MemoryCoverStroke['tool'], color: stroke.color.toUpperCase(), width: round(stroke.width), points });
  }
  return strokes;
}

/** Unknown versions and malformed server values do not become editable drafts. */
export function parseMemoryCoverArtwork(value: unknown): MemoryCoverArtwork | null {
  if (!record(value) || value.version !== 1 && value.version !== 2 ||
      !keys(value, value.version === 1 ? baseCoverKeys : [...baseCoverKeys, 'titleStyle', 'layout', 'storyIds', 'strokes', 'paperColor', 'inkColor'])) return null;
  if (!text(value.inscription, 160) || !text(value.postmark, 32) ||
      !oneOf(value.inscriptionStyle, ['handwritten', 'serif', 'sans']) ||
      !oneOf(value.inscriptionPosition, ['top', 'bottom']) || typeof value.showDate !== 'boolean') return null;
  if (!record(value.photo) || !keys(value.photo, ['x', 'y', 'scale']) ||
      !number(value.photo.x, 0, 1) || !number(value.photo.y, 0, 1) || !number(value.photo.scale, 1, 2.5)) return null;
  const base: MemoryCoverArtworkV1 = { version: 1, inscription: value.inscription, postmark: value.postmark,
    inscriptionStyle: value.inscriptionStyle as MemoryCoverArtwork['inscriptionStyle'],
    inscriptionPosition: value.inscriptionPosition as MemoryCoverArtwork['inscriptionPosition'],
    showDate: value.showDate, photo: { x: value.photo.x, y: value.photo.y, scale: value.photo.scale } };
  if (value.version === 1) return base;
  if (!oneOf(value.titleStyle, ['design', 'handwritten', 'serif', 'sans']) || !oneOf(value.layout, ['single', 'collage']) ||
      !Array.isArray(value.storyIds) || value.storyIds.length > MEMORY_COVER_MAX_PHOTOS ||
      value.storyIds.some(id => typeof id !== 'string' || !uuid.test(id)) ||
      new Set(value.storyIds.map(id => String(id).toLowerCase())).size !== value.storyIds.length ||
      value.paperColor !== null && !hex(value.paperColor) || value.inkColor !== null && !hex(value.inkColor)) return null;
  const strokes = parseMemoryCoverStrokes(value.strokes);
  if (!strokes) return null;
  return { ...base, version: 2, titleStyle: value.titleStyle as MemoryCoverArtworkV2['titleStyle'],
    layout: value.layout as MemoryCoverArtworkV2['layout'], storyIds: value.storyIds.map(id => String(id).toLowerCase()), strokes,
    paperColor: value.paperColor ? value.paperColor.toUpperCase() : null, inkColor: value.inkColor ? value.inkColor.toUpperCase() : null };
}

/** Upgrade only after a personalized control is used; legacy saves stay version 1. */
export function personalizeMemoryCover(value: MemoryCoverArtwork): MemoryCoverArtworkV2 {
  const cover = memoryCoverArtwork(value);
  return cover.version === 2 ? cover : { ...cover, version: 2, titleStyle: 'design', layout: 'single', storyIds: [], strokes: [], paperColor: null, inkColor: null };
}

export function parseMemoryFilmSettings(value: unknown): MemoryFilmSettings | null {
  if (!record(value) || !keys(value, ['version', 'mode', 'style', 'length', 'order', 'titleCard', 'originalAudio']) || value.version !== 1) return null;
  if (!oneOf(value.mode, ['automatic', 'original']) ||
      !oneOf(value.style, ['reflective', 'bright', 'cinematic']) ||
      !oneOf(value.length, ['short', 'standard', 'full']) ||
      !oneOf(value.order, ['book', 'chronological']) ||
      typeof value.titleCard !== 'boolean' || typeof value.originalAudio !== 'boolean') return null;
  return { version: 1, mode: value.mode as MemoryFilmSettings['mode'], style: value.style as MemoryFilmSettings['style'],
    length: value.length as MemoryFilmSettings['length'], order: value.order as MemoryFilmSettings['order'],
    titleCard: value.titleCard, originalAudio: value.originalAudio };
}

export function memoryCoverArtwork(value?: unknown): MemoryCoverArtwork {
  return parseMemoryCoverArtwork(value) ?? { ...DEFAULT_MEMORY_COVER_ARTWORK, photo: { ...DEFAULT_MEMORY_COVER_ARTWORK.photo } };
}

/** The centered editor setting preserves each design's intentional crop. */
export function memoryCoverPhotoPosition(artwork: MemoryCoverArtwork, baseX = 50, baseY = 50): { x: number; y: number } {
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  return { x: clamp(baseX + (artwork.photo.x - .5) * 100), y: clamp(baseY + (artwork.photo.y - .5) * 100) };
}

/** An older book keeps its original timing until the owner chooses a new cut. */
export function memoryFilmSettings(value?: unknown): MemoryFilmSettings {
  return parseMemoryFilmSettings(value) ?? { ...LEGACY_MEMORY_FILM_SETTINGS };
}

export function memoryBookCreativeAvailable(data: unknown, error?: unknown): boolean {
  return !error && record(data) && data.version === 1 && data.supported === true;
}

export type MemoryCreativeSaveResult = {
  id: string; presentation_revision: number; cover_artwork: MemoryCoverArtwork; film_settings: MemoryFilmSettings;
};

export function parseMemoryCreativeSaveResult(data: unknown, expectedId?: string): MemoryCreativeSaveResult | null {
  if (!record(data) || typeof data.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.id) ||
      expectedId && data.id !== expectedId || !Number.isSafeInteger(data.presentation_revision) || Number(data.presentation_revision) < 0) return null;
  const cover = parseMemoryCoverArtwork(data.cover_artwork), film = parseMemoryFilmSettings(data.film_settings);
  return cover && film ? { id: data.id, presentation_revision: Number(data.presentation_revision), cover_artwork: cover, film_settings: film } : null;
}

export function memoryCreativeSaveError(error: unknown): string {
  const message = record(error) && typeof error.message === 'string' ? error.message : String(error ?? '');
  if (message.includes('MEMORY_BOOK_REQUEST_CONFLICT')) return 'This create request already saved a different version of the book. Reopen your books to check it before creating another.';
  if (['Creative book saving is unavailable.', 'Personalized cover saving is unavailable.', 'The book session changed.', 'The book save could not be confirmed.', 'Reload the book before saving'].some(prefix => message.startsWith(prefix))) return message;
  return message.includes('MEMORY_BOOK_CHANGED')
    ? 'This book changed in another session. Reload the saved book before trying again. Your draft is kept.'
    : 'Your book could not save. Your changes are kept. Try again.';
}
