/** Private, device-local history. Only explicit searches are recorded. */
export type RecentSearch = { term: string; at: number };
export const RECENT_SEARCH_LIMIT = 20;
export const RECENT_SEARCH_TTL = 30 * 86400000;
export const recentSearchKey = (owner: string) => `tbn_recent_searches_v1:${owner}`;
export function normalizeSearchTerm(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}
export function parseRecentSearches(raw: string | null, now = Date.now()): RecentSearch[] {
  if (!raw || raw.length > 50000) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    return data.slice(0, 100).flatMap(value => {
      const term = normalizeSearchTerm(typeof value === 'string' ? value : value?.term);
      const at = typeof value === 'string' ? now : value?.at;
      const key = term.toLowerCase();
      if (!term || typeof at !== 'number' || !Number.isFinite(at) || at > now + 60000 || now - at >= RECENT_SEARCH_TTL || seen.has(key)) return [];
      seen.add(key); return [{ term, at }];
    }).sort((a, b) => b.at - a.at).slice(0, RECENT_SEARCH_LIMIT);
  } catch { return []; }
}
export type HistoryStorage = {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): unknown | Promise<unknown>;
  removeItem(key: string): unknown | Promise<unknown>;
};
export type HistorySnapshot = { owner: string | null; ready: boolean; entries: RecentSearch[] };
export const EMPTY_SEARCH_HISTORY: HistorySnapshot = { owner: null, ready: false, entries: [] };
export function createRecentSearchStore(storage: HistoryStorage, now = Date.now) {
  let snapshot = EMPTY_SEARCH_HISTORY, generation = 0, pending = Promise.resolve();
  const listeners = new Set<() => void>();
  const publish = (next: HistorySnapshot) => { snapshot = next; listeners.forEach(fn => fn()); };
  const bind = (owner: string | null, refresh = false) => {
    if (snapshot.owner === owner && !refresh && (snapshot.ready || generation > 0)) return pending;
    const version = ++generation;
    publish({ owner, ready: !owner, entries: [] });
    if (!owner) return pending;
    pending = pending.then(async () => {
      let raw: string | null = null;
      try { raw = await storage.getItem(recentSearchKey(owner)); } catch { /* Storage is optional. */ }
      if (generation === version) publish({ owner, ready: true, entries: parseRecentSearches(raw, now()) });
    });
    return pending;
  };
  const mutate = (transform: (entries: RecentSearch[]) => RecentSearch[]) => {
    const owner = snapshot.owner, version = generation;
    if (!owner) return Promise.resolve();
    pending = pending.then(async () => {
      if (version !== generation || snapshot.owner !== owner) return;
      const entries = transform(parseRecentSearches(JSON.stringify(snapshot.entries), now()));
      publish({ owner, ready: true, entries });
      try {
        if (entries.length) await storage.setItem(recentSearchKey(owner), JSON.stringify(entries));
        else await storage.removeItem(recentSearchKey(owner));
      } catch { /* Keep the current-session history usable if storage is blocked. */ }
    });
    return pending;
  };
  return {
    bind, getSnapshot: () => snapshot, getServerSnapshot: () => EMPTY_SEARCH_HISTORY,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    record(value: string) {
      const term = normalizeSearchTerm(value);
      return term ? mutate(entries => [{ term, at: now() }, ...entries.filter(entry => entry.term.toLowerCase() !== term.toLowerCase())].slice(0, RECENT_SEARCH_LIMIT)) : Promise.resolve();
    },
    remove(term: string) { return mutate(entries => entries.filter(entry => entry.term !== term)); },
    clear() { return mutate(() => []); },
    settled: () => pending,
  };
}
