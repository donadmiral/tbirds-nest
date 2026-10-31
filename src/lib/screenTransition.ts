import { navigationCache, navigationScope } from './navigationCache';

type Prefetched<T> = { value: T; at: number };
const TTL = 60_000;
const cacheKey = (key: string) => `prefetch:${key}`;

/** Compatibility for detail screens: ready content no longer waits for an animation timer. */
export function useAfterTransition(): boolean { return true; }

/** Intent-driven, deduplicated reads. Private data never survives a session change. */
export function prefetch<T>(key: string, load: (signal: AbortSignal) => Promise<T>): void {
  const scope = navigationScope();
  if (!scope) return;
  const hit = navigationCache.read<Prefetched<T>>(scope, cacheKey(key));
  if (hit && Date.now() - hit.at < TTL) return;
  void navigationCache.load(scope, cacheKey(key), async signal => ({ value: await load(signal), at: Date.now() })).catch(() => {});
}

/** A settled value is usable immediately; the screen still refreshes live data. */
export function takePrefetched<T>(key: string): T | null {
  const hit = navigationCache.read<Prefetched<T>>(navigationScope(), cacheKey(key));
  return hit && Date.now() - hit.at < TTL ? hit.value : null;
}

export async function awaitPrefetched<T>(key: string): Promise<T | null> {
  const scope = navigationScope();
  const cached = takePrefetched<T>(key);
  if (cached !== null) return cached;
  const pending = navigationCache.pending<Prefetched<T>>(scope, cacheKey(key));
  if (!pending) return null;
  try {
    const hit = await pending;
    return scope === navigationScope() ? hit.value : null;
  } catch { return null; }
}
