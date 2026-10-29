import type { VerificationProfile, VerificationTier } from './verification';

type Listener = (tier: VerificationTier | null) => void;
type Row = VerificationProfile & { id: string };
const TTL = 60_000;

/** One batched lookup for mounted badges, bounded cache, and no permanent verification claims. */
export function createVerificationCache(fetchProfiles: (ids: string[]) => Promise<Row[]>) {
  const cache = new Map<string, { tier: VerificationTier | null; at: number }>();
  const listeners = new Map<string, Set<Listener>>();
  const fetching = new Set<string>();
  let queued = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const fresh = (id: string) => { const value = cache.get(id); return value && Date.now() - value.at < TTL ? value : null; };
  const flush = async () => {
    queued = false;
    const missing = [...listeners.keys()].filter(id => !fresh(id) && !fetching.has(id));
    missing.forEach(id => fetching.add(id));
    for (let i = 0; i < missing.length; i += 100) {
      const ids = missing.slice(i, i + 100);
      let rows: Row[] = [];
      try { rows = await fetchProfiles(ids); } catch { /* Hide an unconfirmed badge; retry on the next refresh. */ }
      const byId = new Map(rows.map(row => [row.id, row]));
      for (const id of ids) {
        const row = byId.get(id);
        const tier = row?.is_verified
          ? (['public_figure', 'business', 'official'].includes(row.verified_tier ?? '') ? row!.verified_tier as VerificationTier : 'business')
          : null;
        cache.delete(id);
        cache.set(id, { tier, at: Date.now() });
        fetching.delete(id);
        listeners.get(id)?.forEach(listener => listener(tier));
      }
      while (cache.size > 500) cache.delete(cache.keys().next().value!);
    }
  };
  const schedule = () => { if (!queued) { queued = true; void Promise.resolve().then(flush); } };
  return {
    peek: (id: string) => fresh(id)?.tier ?? null,
    subscribe(id: string, listener: Listener) {
      const set = listeners.get(id) ?? new Set<Listener>();
      set.add(listener); listeners.set(id, set);
      listener(fresh(id)?.tier ?? null);
      schedule();
      if (!timer) timer = setInterval(schedule, TTL);
      return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(id);
        if (!listeners.size && timer) { clearInterval(timer); timer = undefined; }
      };
    },
  };
}
