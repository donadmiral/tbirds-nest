import type { createNavigationCache } from '../../shared/navigationCache';

type Cache = ReturnType<typeof createNavigationCache>;
type Size = { width: number; height: number };
type Memory = [string, Size][];
const CACHE_KEY = 'layout:async-blocks:v1';
const MAX_MEASUREMENTS = 128;
const valid = (value: number) => Number.isFinite(value) && value > 0;

/** Only layout numbers live here. Content and media grants are always fetched again. */
export function readAsyncBlockHeight(cache: Cache, scope: string | null, key: string, width: number): number | null {
  if (!valid(width)) return null;
  const previous = cache.read<Memory>(scope, CACHE_KEY)?.find(([id, size]) => id === key && Math.abs(size.width - width) < 0.5)?.[1];
  return previous && valid(previous.width) && valid(previous.height) && Math.abs(previous.width - width) < 0.5
    ? previous.height : null;
}

export function rememberAsyncBlockSize(cache: Cache, scope: string | null, key: string, width: number, height: number) {
  if (!scope || !valid(width) || !valid(height)) return;
  const previous = cache.read<Memory>(scope, CACHE_KEY) ?? [];
  const next: Memory = [...previous.filter(([id, size]) => id !== key || Math.abs(size.width - width) >= 0.5), [key, { width, height }]];
  // One bounded cache entry avoids evicting route data for every rendered post.
  cache.save(scope, CACHE_KEY, next.slice(-MAX_MEASUREMENTS));
}

export function forgetAsyncBlockSize(cache: Cache, scope: string | null, key: string) {
  if (!scope) return;
  const previous = cache.read<Memory>(scope, CACHE_KEY);
  if (!previous?.some(([id]) => id === key)) return;
  const next = previous.filter(([id]) => id !== key);
  if (next.length) cache.save(scope, CACHE_KEY, next);
  else cache.remove(scope, CACHE_KEY);
}
