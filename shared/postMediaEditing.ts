/** Persisted creative settings shared by the phone and web post editors. */
export type PostCaptionCue = {
  id: string;
  text: string;
  start: number;
  end: number;
  style: 'clean' | 'bold' | 'highlight';
  position: 'top' | 'middle' | 'bottom';
};

export type PostFrameRecipe = {
  aspectRatio?: number;
  aspect?: 'original' | 'square' | 'portrait' | 'landscape';
  captions?: PostCaptionCue[];
};

/** A batch look never copies a different item's crop, timing, cover or tags. */
export function postLookRecipe(source: { filterId?: string | null; filterAmt?: number; adjust?: Record<string, number | undefined> | null }) {
  return { filterId: source.filterId ?? null, filterAmt: source.filterAmt ?? 100, adjust: source.adjust ? { ...source.adjust } : null };
}

export function normalizePostRotation(value = 0): number {
  if (!Number.isFinite(value)) return 0;
  return ((value + 180) % 360 + 360) % 360 - 180;
}

/** Keep a right-angle rotation separate from the small straighten control. */
export function postRotationParts(value = 0) {
  const rotation = normalizePostRotation(value);
  let base = Math.trunc(rotation / 90) * 90;
  let straighten = rotation - base;
  if (straighten > 45) { base += 90; straighten -= 90; }
  if (straighten < -45) { base -= 90; straighten += 90; }
  return { base, straighten };
}

/** Draft timing strings stay editable until blur/Apply, including `2.`. */
export function applyPostCaptionTiming(cue: PostCaptionCue, draft: { start?: string; end?: string } | undefined, from: number, to: number): PostCaptionCue {
  const range = postTrimWindow(to, from, to);
  const gap = Math.min(.1, range.duration);
  const parse = (text: string | undefined, fallback: number) => text !== undefined && text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : fallback;
  const start = Math.max(range.start, Math.min(range.end - gap, parse(draft?.start, cue.start)));
  const end = Math.min(range.end, Math.max(start + gap, parse(draft?.end, cue.end)));
  return { ...cue, start, end };
}

export function postAspectRatio(edit?: PostFrameRecipe | null, width?: number | null, height?: number | null, fallback = 4 / 5): number {
  if (typeof edit?.aspectRatio === 'number' && Number.isFinite(edit.aspectRatio) && edit.aspectRatio >= .25 && edit.aspectRatio <= 4) return edit.aspectRatio;
  if (edit?.aspect === 'square') return 1;
  if (edit?.aspect === 'portrait') return 4 / 5;
  if (edit?.aspect === 'landscape') return 1.91; // Retain the older saved recipe.
  if (edit?.aspect === 'original' && width && height) return Math.max(.25, Math.min(4, width / height));
  return fallback;
}

export function postTrimWindow(duration: number, start?: number | null, end?: number | null) {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const gap = Math.min(.1, total);
  const from = Math.max(0, Math.min(total - gap, Number.isFinite(start) ? start! : 0));
  const to = Math.min(total, Math.max(from + gap, Number.isFinite(end) ? end! : total));
  return { start: from, end: to, duration: Math.max(0, to - from), coverEnd: Math.max(from, to - Math.min(.05, gap / 2)) };
}

export function normalizePostCaptions(value: unknown, duration = 600): PostCaptionCue[] {
  if (!Array.isArray(value)) return [];
  const maximum = Number.isFinite(duration) && duration > 0 ? duration : 600;
  return value.slice(0, 8).flatMap((cue, i) => {
    if (!cue || typeof cue !== 'object' || typeof cue.text !== 'string' || !cue.text.trim()) return [];
    const start = Math.max(0, Math.min(maximum, Number.isFinite(cue.start) ? cue.start : 0));
    const end = Math.max(start, Math.min(maximum, Number.isFinite(cue.end) ? cue.end : maximum));
    if (end <= start) return [];
    return [{ id: typeof cue.id === 'string' ? cue.id.slice(0, 80) : `caption-${i}`, text: cue.text.trim().slice(0, 160), start, end,
      style: cue.style === 'bold' || cue.style === 'highlight' ? cue.style : 'clean',
      position: cue.position === 'top' || cue.position === 'middle' ? cue.position : 'bottom' } as PostCaptionCue];
  });
}

export function postCaptionAt(value: unknown, time: number): PostCaptionCue | null {
  if (!Number.isFinite(time)) return null;
  return normalizePostCaptions(value,Number.MAX_SAFE_INTEGER).filter(cue => time >= cue.start && time < cue.end).sort((a, b) => b.start - a.start)[0] ?? null;
}

export function postTimeLabel(time: number): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(time) ? time : 0));
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
