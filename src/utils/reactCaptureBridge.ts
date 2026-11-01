import type { ReactExport } from '../../shared/reactVideoComposition';
import { useAuthStore } from '../stores/authStore';
import { navigationScope, subscribeNavigationScope } from '../lib/navigationCache';

let pending: { owner: string; scope: ReturnType<typeof navigationScope>; media: ReactExport } | null = null;
const listeners = new Set<() => void>();
const notify = () => { listeners.forEach(listener => listener()); };

// A completed export belongs to the session that started it, including across
// A → B → A account changes while a native operation is still completing.
subscribeNavigationScope(() => {
  if (pending && pending.scope !== navigationScope()) {
    pending = null;
    notify();
  }
});

export function setPendingReactCapture(media: ReactExport, expectedScope: ReturnType<typeof navigationScope>): boolean {
  const scope = navigationScope();
  const owner = useAuthStore.getState().session?.user?.id;
  if (!owner || !expectedScope || expectedScope !== scope) return false;
  // Repeated handoff of the same file is safe. Another completed take must
  // stay with its capture screen until this one has been appended.
  if (pending) return pending.owner === owner && pending.scope === scope && pending.media.uri === media.uri;
  pending = { owner, scope, media: { ...media, source: { ...media.source } } };
  notify();
  return true;
}

export function peekPendingReactCapture(): ReactExport | null {
  const scope = navigationScope();
  return pending?.scope === scope && pending?.owner === useAuthStore.getState().session?.user?.id ? pending?.media ?? null : null;
}

/** Call only after the composer has committed this media to its draft. */
export function acknowledgePendingReactCapture(uri: string): boolean {
  if (peekPendingReactCapture()?.uri !== uri) return false;
  pending = null;
  notify();
  return true;
}

export function subscribePendingReactCapture(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
