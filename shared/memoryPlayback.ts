/** An album is read manually until its viewer deliberately presses Play book. */
export function memoryPhotoDuration(page: { duration_sec?: unknown } | null | undefined): number {
  const duration = page?.duration_sec;
  return typeof duration === 'number' && Number.isFinite(duration) && duration > 0
    ? Math.min(30, Math.max(3, duration)) * 1000 : 6000;
}

/** Pause/resume uses elapsed foreground playback, never a background wall-clock jump. */
export function createMemoryPlaybackClock() {
  let key = '', elapsed = 0, previous: number | null = null, completed = false;
  return {
    step(pageKey: string, now: number, playing: boolean, duration: number) {
      if (pageKey !== key) { key = pageKey; elapsed = 0; previous = null; completed = false; }
      if (playing && previous != null && !completed) elapsed += Math.max(0, now - previous);
      previous = playing ? now : null;
      const end = !completed && playing && elapsed >= duration;
      if (end) completed = true;
      return { progress: Math.min(1, elapsed / Math.max(1, duration)), end };
    },
    pause() { previous = null; },
    reset() { key = ''; elapsed = 0; previous = null; completed = false; },
  };
}
