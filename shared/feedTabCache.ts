/** Short-lived, per-screen memory. Never share this across accounts or persist capabilities. */
export function createFeedTabCache<T>(ttlMs = 240_000, clock: () => number = Date.now) {
  const tabs = new Map<string, { value: T; savedAt: number }>();
  return {
    save(key: string, value: T) { tabs.set(key, { value, savedAt: clock() }); },
    read(key: string): T | null {
      const saved = tabs.get(key);
      if (!saved) return null;
      if (clock() - saved.savedAt >= ttlMs) { tabs.delete(key); return null; }
      return saved.value;
    },
    clear() { tabs.clear(); },
  };
}
