/** A stable active id survives appending pages, unlike an index into refreshed rows. */
export function discoverIndex(ids: string[], activeId: string | null): number {
  return Math.max(0, ids.indexOf(activeId ?? ''));
}
export function discoverNeedsMore(index: number, length: number, hasMore: boolean, loading: boolean, error: unknown): boolean {
  return hasMore && !loading && !error && index >= Math.max(0, length - 4);
}
/** Fit the entire rotated source in the viewport before applying an authored crop. */
export function discoverFrame(width: number, height: number, mediaWidth?: number | null, mediaHeight?: number | null, rotation = 0) {
  const w = mediaWidth && mediaWidth > 0 ? mediaWidth : width;
  const h = mediaHeight && mediaHeight > 0 ? mediaHeight : height;
  const rad = rotation * Math.PI / 180;
  const rw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
  const rh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
  const ratio = Math.min(width / rw, height / rh);
  return { width: Math.max(1, w * ratio), height: Math.max(1, h * ratio) };
}
