export type PageState<T> = {
  items: T[]; loading: boolean; error: string | null; hasMore: boolean;
};

/** Serial page reader. A reset invalidates in-flight work before changing identity. */
export function createPagedCollection<T>(options: {
  fetchPage: (offset: number, size: number, asOf: string) => Promise<T[]>;
  key: (item: T) => string;
  size?: number;
}) {
  const size = options.size ?? 20;
  let state: PageState<T> = { items: [], loading: false, error: null, hasMore: true };
  let epoch = 0, offset = 0;
  let asOf = new Date().toISOString();
  const listeners = new Set<() => void>();
  const emit = (patch: Partial<PageState<T>>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const reset = () => {
    epoch++; offset = 0; asOf = new Date().toISOString();
    emit({ items: [], loading: false, error: null, hasMore: true });
  };
  const next = async () => {
    if (state.loading || !state.hasMore) return;
    const version = epoch;
    emit({ loading: true, error: null });
    try {
      const page = await options.fetchPage(offset, size, asOf);
      if (version !== epoch) return;
      const seen = new Set(state.items.map(options.key));
      const added = page.filter((item) => {
        const key = options.key(item);
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
      // Advance by raw rows, not deduplicated/displayed rows.
      offset += page.length;
      emit({ items: [...state.items, ...added], hasMore: page.length === size, loading: false });
    } catch (error) {
      if (version === epoch) emit({ loading: false, error: error instanceof Error ? error.message : "Could not load this page. Please try again." });
    }
  };
  return {
    snapshot: () => state,
    version: () => epoch,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    next, reset,
    reload: () => { reset(); return next(); },
    setItems(update: (items: T[]) => T[]) { emit({ items: update(state.items) }); },
    cancel() { epoch++; emit({ loading: false }); },
  };
}
