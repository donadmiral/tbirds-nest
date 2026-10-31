import { createNavigationCache, navigationSessionIdentity } from '../../shared/navigationCache';
import { useAuthStore } from '../stores/authStore';

export const navigationCache = createNavigationCache();
let identity: string | null = null, revision = 0;
const listeners = new Set<() => void>();

function sync() {
  const session = useAuthStore.getState().session;
  const next = navigationSessionIdentity(session);
  if (next === identity) return;
  identity = next; revision++;
  navigationCache.setScope(next ? `${revision}:${session!.user.id}` : null);
  listeners.forEach(listener => listener());
}

// This stays subscribed when every data screen is unmounted. An A→B→A account
// round trip invalidates old requests even if React batches the visible update.
useAuthStore.subscribe(sync);
sync();

export function navigationScope() { sync(); return navigationCache.scope(); }
export function navigationRevision() { sync(); return revision; }
export function subscribeNavigationScope(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
