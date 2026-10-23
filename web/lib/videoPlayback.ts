export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export function playbackWindow(duration: number, trimStart?: number | null, trimEnd?: number | null) {
  const end = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const start = Number.isFinite(trimStart) ? Math.max(0, Math.min(trimStart!, end)) : 0;
  const trimmedEnd = Number.isFinite(trimEnd) && trimEnd! > start ? Math.min(trimEnd!, end) : end;
  return { start, end: trimmedEnd, duration: Math.max(0, trimmedEnd - start) };
}

export function clampVideoTime(time: number, range: ReturnType<typeof playbackWindow>) {
  return Math.max(range.start, Math.min(Number.isFinite(time) ? time : range.start, range.end));
}

export function formatVideoTime(time: number) {
  const seconds = Math.max(0, Math.floor(Number.isFinite(time) ? time : 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}
