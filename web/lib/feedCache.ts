import { createFeedSnapshotStore } from '../../shared/feedSnapshot';
import { createClient } from './supabase/client';

let browserStore: ReturnType<typeof createFeedSnapshotStore> | null = null;
/** No request-specific cache instance is ever retained on the server. */
export function getFeedCache() {
  if (typeof window === 'undefined') return createFeedSnapshotStore({ getItem: async () => null, setItem: async () => {}, removeItem: async () => {} });
  if (browserStore) return browserStore;
  browserStore = createFeedSnapshotStore({
    getItem: async key => { try { return window.localStorage.getItem(key); } catch { return null; } },
    setItem: async (key, value) => { try { window.localStorage.setItem(key, value); } catch { /* Storage quota or privacy setting. */ } },
    removeItem: async key => { try { window.localStorage.removeItem(key); } catch { /* Storage disabled. */ } },
  });
  const store = browserStore;
  // Remains active when Home is unmounted so signing out on any route purges it.
  createClient().auth.onAuthStateChange((_event, session) => { store.setAccount(session?.user.id ?? null); });
  return store;
}
