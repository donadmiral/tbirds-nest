import { createNavigationCache, navigationSessionIdentity } from '../../shared/navigationCache';
import { createClient } from './supabase/client';

type NavigationSession = { owner: string | null; scope: string | null; revision: number; initialized: boolean; changed: boolean };
const SERVER_SESSION: NavigationSession = { owner: null, scope: null, revision: 0, initialized: false, changed: false };

function createStore() {
  const cache = createNavigationCache();
  const listeners = new Set<() => void>();
  let snapshot = SERVER_SESSION, identity: string | null = null, observed = 0;
  const apply = (session: Parameters<typeof navigationSessionIdentity>[0]) => {
    observed++;
    const next = navigationSessionIdentity(session);
    if (snapshot.initialized && next === identity) return;
    const revision = snapshot.revision + 1;
    const changed = snapshot.changed || snapshot.initialized;
    identity = next;
    const scope = next && session ? `${revision}:${session.user.id}` : null;
    cache.setScope(scope);
    snapshot = { owner: session?.user.id ?? null, scope, revision, initialized: true, changed };
    listeners.forEach(listener => listener());
  };
  if (typeof window !== 'undefined') {
    const client = createClient();
    // Subscribe before getSession: a late lookup cannot revive A after A→B→A.
    client.auth.onAuthStateChange((_event, session) => apply(session));
    const started = observed;
    void client.auth.getSession().then(({ data, error }) => {
      if (!error && observed === started) apply(data.session);
    }).catch(() => { /* The persistent Auth listener can still establish a session. */ });
  }
  return {
    cache,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => SERVER_SESSION,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

let browserStore: ReturnType<typeof createStore> | null = null;
/** Never retain viewer data in a server module singleton. */
export function getNavigationStore() {
  if (typeof window === 'undefined') return createStore();
  return browserStore ??= createStore();
}
