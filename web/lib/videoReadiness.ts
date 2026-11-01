/** At most two speculative videos; active playback has a separate owner. */
export function createVideoPreloadBudget(limit = 2) {
  const candidates = new Set<{ priority: number | null; active: boolean; granted: boolean; notify: (ready: boolean) => void }>();
  const update = () => {
    const selected = new Set([...candidates].filter(item => item.priority !== null && !item.active)
      .sort((a, b) => a.priority! - b.priority!).slice(0, limit));
    // Revoke old slots before granting new ones so real DOM loads stay bounded.
    for (const item of candidates) if (item.granted && !selected.has(item)) { item.granted = false; item.notify(false); }
    for (const item of selected) if (!item.granted) { item.granted = true; item.notify(true); }
  };
  return {
    register(notify: (ready: boolean) => void) {
      const item = { priority: null as number | null, active: false, granted: false, notify };
      candidates.add(item);
      return {
        approach(priority: number | null) { item.priority = priority; update(); },
        activate(active: boolean) { item.active = active; update(); },
        dispose() { candidates.delete(item); if (item.granted) notify(false); update(); },
      };
    },
  };
}

// DOM registrations happen only in client effects. No URLs or user data live here.
export const videoPreloads = createVideoPreloadBudget();
