export type LivePlaybackStartup = { startedAt: number; attempts: number; played: boolean };
export const LIVE_STARTUP_WINDOW_MS = 40000;
export const LIVE_STARTUP_MAX_RETRIES = 6;

/** Only media failures after a valid application playback grant enter this policy. */
export function liveStartupDelay(startup: LivePlaybackStartup, expiresAt: number, now: number, message = '', jitter = Math.random()): number | null {
  if (startup.played || startup.attempts >= LIVE_STARTUP_MAX_RETRIES || now - startup.startedAt >= LIVE_STARTUP_WINDOW_MS) return null;
  if (/offline|not connected|internet connection|network (?:is )?unreachable|network is down|-1009|unauthorized|not authorized|sign in|permission denied|expired|unsupported|not supported|decode|drm|license/i.test(message)) return null;
  const delay = Math.min(8000, 1500 * 2 ** startup.attempts) + Math.floor(Math.max(0, Math.min(1, jitter)) * 750);
  if (now + delay >= startup.startedAt + LIVE_STARTUP_WINDOW_MS || now + delay + 1000 >= expiresAt) return null;
  return delay;
}
