/**
 * Transition discipline, shared by every screen.
 *
 *  useAfterTransition()  true once the push animation has finished (or at once when there is none),
 *                        so heavy lists and images mount after the slide instead of during it.
 *  prefetch(key, load)   starts a load on the tap that navigates; the destination reads it with
 *                        takePrefetched(key) and paints at once instead of fetching again.
 *                        null from takePrefetched means "nothing cached"; a cached false or 0 is returned as is.
 */
import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';
import { useNavigation } from '@react-navigation/native';

export function useAfterTransition(): boolean {
  const navigation = useNavigation<any>();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let done = false;
    const finish = () => { if (!done) { done = true; setReady(true); } };
    const unsub = navigation.addListener?.('transitionEnd', finish);
    const task = InteractionManager.runAfterInteractions(finish);
    const cap = setTimeout(finish, 450);
    return () => { unsub?.(); task.cancel?.(); clearTimeout(cap); };
  }, [navigation]);
  return ready;
}

type Entry = { at: number; promise: Promise<any>; value?: any };
const cache = new Map<string, Entry>();
const TTL = 60_000;
// One sweep per TTL keeps the map from growing over a long session.
const g = globalThis as any;
if (!g.__pcPrefetchSweep) { g.__pcPrefetchSweep = setInterval(() => { const now = Date.now(); cache.forEach((v, k) => { if (now - v.at > TTL) cache.delete(k); }); }, TTL); }

export function prefetch<T>(key: string, load: () => Promise<T>): void {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return;
  const entry: Entry = { at: Date.now(), promise: load().then((v) => { entry.value = v; return v; }).catch(() => undefined) };
  cache.set(key, entry);
}

/** The prefetched value if it has landed, else null. */
export function takePrefetched<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > TTL) return null;
  return (hit.value as T) ?? null;
}

/** Awaits a prefetch in flight, or null when none was started. */
export async function awaitPrefetched<T>(key: string): Promise<T | null> {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > TTL) return null;
  const v = await hit.promise;
  return (v as T) ?? null;
}