export type PageState<T> = {
  items: T[]; loading: boolean; error: string | null; hasMore: boolean;
};
export type PageMemory<T> = { items: T[]; hasMore: boolean; offset: number; asOf: string };

/** Serial page reader. A reset invalidates in-flight work before changing identity. */
export function createPagedCollection<T>(options: {
  fetchPage: (offset: number, size: number, asOf: string, signal?: AbortSignal) => Promise<T[]>;
  key: (item: T) => string;
  size?: number;
  memory?: PageMemory<T> | null;
}) {
  const size = options.size ?? 20;
  let state: PageState<T> = { items: options.memory?.items ?? [], loading: false, error: null, hasMore: options.memory?.hasMore ?? true };
  let epoch = 0, offset = options.memory?.offset ?? 0, loaded = !!options.memory, retryRefresh = false;
  let asOf = options.memory?.asOf ?? new Date().toISOString();
  let request: AbortController | null = null, refreshWork: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const emit = (patch: Partial<PageState<T>>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const reset = () => {
    request?.abort(); refreshWork = null;
    epoch++; offset = 0; loaded = false; retryRefresh = false; asOf = new Date().toISOString();
    emit({ items: [], loading: false, error: null, hasMore: true });
  };
  const next = async () => {
    if (state.loading) return;
    if (retryRefresh) return refresh();
    if (!state.hasMore) return;
    const version = epoch;
    const controller = request = new AbortController();
    emit({ loading: true, error: null });
    try {
      const page = await options.fetchPage(offset, size, asOf, controller.signal);
      if (version !== epoch) return;
      const seen = new Set(state.items.map(options.key));
      const added = page.filter((item) => {
        const key = options.key(item);
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
      // Advance by raw rows, not deduplicated/displayed rows.
      offset += page.length;
      loaded = true;
      emit({ items: [...state.items, ...added], hasMore: page.length === size, loading: false });
    } catch (error) {
      controller.abort();
      if (version === epoch) emit({ loading: false, error: error instanceof Error ? error.message : "Could not load this page. Please try again." });
    } finally {
      if (request === controller) request = null;
    }
  };
  // Refresh every loaded page against one new server snapshot. Keep the current
  // rows until the replacement is complete; do not mix offsets from two reads.
  const refresh = (force = false): Promise<void> => {
    if (refreshWork && !force) return refreshWork;
    request?.abort();
    const controller = request = new AbortController();
    const version = ++epoch, target = Math.max(size, offset), nextAsOf = new Date().toISOString();
    const original = new Map(state.items.map(item => [options.key(item), item]));
    retryRefresh = true;
    emit({ loading: true, error: null });
    const work = (async () => {
    try {
      const items: T[] = [], seen = new Set<string>();
      let nextOffset = 0, hasMore = true;
      while (hasMore && nextOffset < target) {
        const page = await options.fetchPage(nextOffset, size, nextAsOf, controller.signal);
        if (version !== epoch) return;
        for (const item of page) {
          const id = options.key(item);
          if (!seen.has(id)) { seen.add(id); items.push(item); }
        }
        nextOffset += page.length;
        hasMore = page.length === size;
      }
      offset = nextOffset; asOf = nextAsOf; loaded = true; retryRefresh = false;
      const current = new Map(state.items.map(item => [options.key(item), item]));
      const merged = items.flatMap(item => {
        const id = options.key(item), before = original.get(id), now = current.get(id);
        if (before && !now) return []; // A local deletion while the refresh was pending.
        return [before && now && before !== now ? now : item];
      });
      const incoming = new Set(items.map(options.key));
      for (const item of state.items) if (!original.has(options.key(item)) && !incoming.has(options.key(item))) merged.push(item);
      emit({ items: merged, hasMore, loading: false });
    } catch (error) {
      controller.abort();
      if (version === epoch) emit({ loading: false, error: error instanceof Error ? error.message : "Could not load this page. Please try again." });
    }
    })();
    refreshWork = work;
    void work.finally(() => { if (refreshWork === work) refreshWork = null; if (request === controller) request = null; });
    return work;
  };
  return {
    snapshot: () => state,
    version: () => epoch,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    next, reset, refresh,
    remember: (): PageMemory<T> | null => loaded && state.items.length <= 200 ? { items: state.items, hasMore: state.hasMore, offset, asOf } : null,
    reload: () => { reset(); return next(); },
    setItems(update: (items: T[]) => T[]) { emit({ items: update(state.items) }); },
    cancel() { epoch++; request?.abort(); refreshWork = null; emit({ loading: false }); },
  };
}
