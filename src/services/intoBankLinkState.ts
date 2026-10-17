type LinkState = { linked: boolean | null; issue: string | null };
type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<unknown> };

// A previous account's cache is never evidence about the current account.
export const intoBankLinkCacheKey = (ownerId: string) => `pc.ib.linked:${encodeURIComponent(ownerId)}`;
const cacheWrites = new Map<string, Promise<unknown>>();

export function createIntoBankLinkState(deps: {
  ownerId: string;
  isCurrentOwner(): boolean;
  storage: Storage;
  readStatus(ownerId: string): Promise<{ linked: boolean }>;
  onState(state: LinkState): void;
}) {
  let generation = 0;
  let disposed = false;
  let state: LinkState = { linked: null, issue: null };
  const current = (version: number) => !disposed && !!deps.ownerId && deps.isCurrentOwner() && version === generation;
  const publish = () => deps.onState({ ...state });
  const cache = (linked: boolean) => {
    const key = intoBankLinkCacheKey(deps.ownerId);
    // Preserve confirmation order even if the native storage calls finish late.
    const write = (cacheWrites.get(key) || Promise.resolve()).catch(() => {}).then(() => deps.storage.setItem(key, linked ? '1' : '0')).catch(() => {});
    cacheWrites.set(key, write);
    void write.finally(() => { if (cacheWrites.get(key) === write) cacheWrites.delete(key); });
  };
  return {
    async refresh() {
      const version = ++generation;
      if (!current(version)) return;
      let confirmed = false;
      state = { ...state, issue: null }; publish();
      // A slow cache read may help after an outage, but cannot replace a fresh
      // answer, a later refresh, or an explicitly confirmed link/unlink action.
      const key = intoBankLinkCacheKey(deps.ownerId);
      if (state.linked === null) void (cacheWrites.get(key) || Promise.resolve()).catch(() => {}).then(() => deps.storage.getItem(key)).then(value => {
        if (current(version) && !confirmed && (value === '1' || value === '0')) {
          state = { ...state, linked: value === '1' }; publish();
        }
      }).catch(() => {});
      try {
        const result = await deps.readStatus(deps.ownerId);
        if (!current(version)) return;
        confirmed = true;
        state = { linked: result.linked, issue: null }; publish(); cache(result.linked);
      } catch (error: any) {
        if (!current(version)) return;
        state = { ...state, issue: error?.message || 'IntoBank could not be reached.' }; publish();
      }
    },
    confirm(linked: boolean) {
      const version = ++generation;
      if (!current(version)) return;
      state = { linked, issue: null }; publish(); cache(linked);
    },
    dispose() { disposed = true; generation++; },
  };
}
