import { getNavigationStore } from './navigationCache';

type Entry = { data: unknown; savedAt: number; bytes: number };
type Slot = { entry: Entry | null; revision: number; pending: Promise<unknown> | null };

/** A bounded browser-session cache. Never persisted or used to authorize a write. */
export function createAccountResourceCache(options: { maxEntries?: number; maxBytes?: number; maxAgeMs?: number; clock?: () => number } = {}) {
  const maxEntries = options.maxEntries ?? 24;
  const maxBytes = options.maxBytes ?? 512_000;
  const maxAgeMs = options.maxAgeMs ?? 120_000;
  const now = options.clock ?? Date.now;
  const slots = new Map<string, Slot>();
  const listeners = new Set<() => void>();
  let scope: string | null = null, generation = 0, revision = 0;
  const emit = () => { revision++; listeners.forEach(listener => listener()); };
  const current = (expected: string | null) => !!expected && expected === scope;
  const slot = (key: string) => {
    const value = slots.get(key) ?? { entry: null, revision: 0, pending: null };
    slots.delete(key); slots.set(key, value);
    while (slots.size > maxEntries) slots.delete(slots.keys().next().value!);
    return value;
  };
  const trim = () => {
    let bytes = [...slots.values()].reduce((total, item) => total + (item.entry?.bytes ?? 0), 0);
    for (const [key, item] of slots) {
      if (bytes <= maxBytes) break;
      bytes -= item.entry?.bytes ?? 0; slots.delete(key);
    }
  };
  const store = (item: Slot, data: unknown) => {
    // Refuse unusually large or non-serializable values instead of retaining an
    // unbounded object graph. JSON is only measured, never written to disk.
    let bytes = Infinity;
    try { bytes = JSON.stringify(data).length * 2; } catch { /* Not eligible for memory. */ }
    if (bytes > maxBytes / 2) { item.entry = null; item.revision++; emit(); return false; }
    item.entry = { data, savedAt: now(), bytes }; item.revision++;
    trim(); emit(); return true;
  };
  const read = <T>(expected: string | null, key: string): { data: T } | null => {
    if (!current(expected)) return null;
    const item = slots.get(key), entry = item?.entry;
    if (!entry || now() < entry.savedAt || now() - entry.savedAt >= maxAgeMs) return null;
    return entry as { data: T };
  };
  return {
    setScope(next: string | null) { if (scope !== next) { scope = next; generation++; slots.clear(); emit(); } },
    getSnapshot: () => revision,
    getServerSnapshot: () => 0,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    read,
    write<T>(expected: string | null, key: string, data: T) { return current(expected) && store(slot(key), data); },
    remove(expected: string | null, key: string) {
      if (!current(expected)) return;
      const item = slots.get(key);
      if (item) { item.entry = null; item.revision++; emit(); }
    },
    fetch<T>(expected: string | null, key: string, loader: () => Promise<T>): Promise<T> {
      if (!current(expected)) return Promise.reject(new Error('Your account changed. Reload this page.'));
      const item = slot(key);
      if (item.pending) return item.pending as Promise<T>;
      const started = generation, before = item.revision;
      const work = Promise.resolve().then(() => {
        if (!current(expected) || generation !== started || slots.get(key) !== item) throw new Error('Your account changed. Reload this page.');
        return loader();
      }).then(data => {
        if (!current(expected) || generation !== started || slots.get(key) !== item) throw new Error('Your account changed. Reload this page.');
        if (item.revision !== before) {
          const latest = read<T>(expected, key);
          if (!latest) throw new Error('This information changed. Please refresh it.');
          return latest.data;
        }
        store(item, data);
        return data;
      }).finally(() => { if (item.pending === work) item.pending = null; });
      item.pending = work;
      return work;
    },
  };
}

let browserCache: ReturnType<typeof createAccountResourceCache> | null = null;
export function getAccountResourceCache() {
  if (typeof window === 'undefined') return createAccountResourceCache();
  if (browserCache) return browserCache;
  const memory = browserCache = createAccountResourceCache(), navigation = getNavigationStore();
  const sync = () => memory.setScope(navigation.getSnapshot().scope);
  sync(); navigation.subscribe(sync);
  return memory;
}
