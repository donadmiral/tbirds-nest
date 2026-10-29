export type TouchPoint = { x: number; y: number };

/** Vertical reading and pinch gestures must not turn an attachment page. */
export function carouselSwipe(start: TouchPoint | null, end: TouchPoint | null): -1 | 0 | 1 {
  if (!start || !end) return 0;
  const dx = end.x - start.x, dy = end.y - start.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy) * 1.4) return 0;
  return dx < 0 ? 1 : -1;
}

export function carouselIndex(index: number, length: number): number {
  return Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : 0, Math.max(0, length - 1)));
}
