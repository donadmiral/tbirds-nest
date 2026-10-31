/** In-memory navigation data only. A scope change discards values and in-flight work. */
export function createNavigationCache(options: { maxEntries?: number; maxAgeMs?: number; clock?: () => number } = {}) {
  const maxEntries = options.maxEntries ?? 24;
  const maxAgeMs = options.maxAgeMs ?? 30 * 60_000;
  const clock = options.clock ?? Date.now;
  let scope: string | null = null, generation = 0;
  const values = new Map<string, { value: unknown; savedAt: number }>();
  const pending = new Map<string, { controller: AbortController; promise: Promise<unknown> }>();
  const clear = () => {
    generation++;
    values.clear();
    pending.forEach(request => request.controller.abort());
    pending.clear();
  };
  const read = <T>(expectedScope: string | null, key: string): T | null => {
    if (!expectedScope || expectedScope !== scope) return null;
    const entry = values.get(key);
    if (!entry) return null;
    const age = clock() - entry.savedAt;
    if (age < 0 || age >= maxAgeMs) { values.delete(key); return null; }
    values.delete(key); values.set(key, entry);
    return entry.value as T;
  };
  const save = <T>(expectedScope: string | null, key: string, value: T) => {
    if (!expectedScope || expectedScope !== scope) return false;
    values.delete(key); values.set(key, { value, savedAt: clock() });
    while (values.size > maxEntries) values.delete(values.keys().next().value!);
    return true;
  };
  return {
    setScope(next: string | null) { if (next !== scope) { clear(); scope = next; } },
    scope: () => scope,
    revision: () => generation,
    read, save,
    pending<T>(expectedScope: string | null, key: string): Promise<T> | null {
      if (!expectedScope || expectedScope !== scope) return null;
      return (pending.get(key)?.promise as Promise<T> | undefined) ?? null;
    },
    remove(expectedScope: string | null, key: string) { if (expectedScope === scope) values.delete(key); },
    clear,
    load<T>(expectedScope: string | null, key: string, loader: (signal: AbortSignal) => Promise<T>, timeoutMs = 12_000): Promise<T> {
      if (!expectedScope || expectedScope !== scope) return Promise.reject(new Error('The account changed. Please try again.'));
      const existing = pending.get(key);
      if (existing) return existing.promise as Promise<T>;
      const version = generation, controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let rejectAbort!: (reason: Error) => void;
      const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
      const onAbort = () => rejectAbort(new Error('The navigation request was cancelled. Please try again.'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      const current = () => expectedScope === scope && version === generation && !controller.signal.aborted;
      const promise = Promise.race([
        Promise.resolve().then(() => {
          if (!current()) throw new Error('The account changed. Please try again.');
          return loader(controller.signal);
        }),
        aborted,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { reject(new Error('This is taking longer than usual. Please try again.')); controller.abort(); }, timeoutMs);
        }),
      ]).then(value => {
        if (!current()) throw new Error('The account changed. Please try again.');
        save(expectedScope, key, value);
        return value;
      }).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
        if (pending.get(key)?.promise === promise) pending.delete(key);
      });
      pending.set(key, { controller, promise });
      return promise;
    },
  };
}

type CacheSession = { user: { id: string }; access_token: string } | null;

/** JWT claims are used only as a cache namespace, never as authorization. */
export function navigationSessionIdentity(session: CacheSession): string | null {
  if (!session?.user.id || !session.access_token) return null;
  try {
    const payload = session.access_token.split('.')[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof decoded.session_id === 'string' && decoded.session_id.length > 0) return `${session.user.id}:${decoded.session_id}`;
  } catch { /* Older or opaque sessions are isolated by the token below. */ }
  // Kept in memory only, never persisted, rendered or sent to diagnostics.
  // Without a stable session ID, refreshes conservatively invalidate caches.
  return `${session.user.id}:${session.access_token}`;
}
