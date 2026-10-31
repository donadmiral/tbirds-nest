/** Short-lived, per-screen memory. Never share this across accounts or persist capabilities. */
export function createFeedTabCache<T>(ttlMs = 30 * 60_000, clock: () => number = Date.now) {
  const tabs = new Map<string, { value: T; savedAt: number }>();
  return {
    save(key: string, value: T) {
      tabs.delete(key); tabs.set(key, { value, savedAt: clock() });
      while (tabs.size > 16) tabs.delete(tabs.keys().next().value!);
    },
    read(key: string): T | null {
      const saved = tabs.get(key);
      if (!saved) return null;
      const age = clock() - saved.savedAt;
      if (age < 0 || age >= ttlMs) { tabs.delete(key); return null; }
      return saved.value;
    },
    snapshot(): [string, T][] {
      return [...tabs].filter(([, saved]) => clock() - saved.savedAt >= 0 && clock() - saved.savedAt < ttlMs)
        .map(([key, saved]) => [key, saved.value]);
    },
    clear() { tabs.clear(); },
  };
}
