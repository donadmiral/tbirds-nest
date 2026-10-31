'use client';

import { startTransition, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getNavigationStore } from '@/lib/navigationCache';

/** Owns the browser cache lifetime even while every protected route is hidden. */
export function NavigationSessionBoundary({ children }: { children: React.ReactNode }) {
  const [store] = useState(getNavigationStore);
  const session = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const path = usePathname();
  const router = useRouter();
  const visited = useRef(new Set<string>());
  const previousPath = useRef<string | null>(null);

  useEffect(() => {
    if (!session.changed) return;
    // Next's route payloads also contain private server-rendered data. A new
    // document discards those caches as well as our cleared in-memory values.
    // Routine token refresh preserves the stable Auth session ID and never
    // reaches this branch. Hide the old tree before requesting the document.
    const destination = /^\/(login|signup|auth)(\/|$)/.test(window.location.pathname) ? '/home' : window.location.pathname + window.location.search;
    window.location.replace(session.owner ? destination : '/login');
  }, [session.changed, session.owner]);

  useEffect(() => {
    if (!session.scope || session.changed || !path || previousPath.current === path) return;
    previousPath.current = path;
    const returning = visited.current.has(path);
    visited.current.add(path);
    if (visited.current.size > 32) visited.current.delete(visited.current.values().next().value!);
    // Home and Messages own their background reads. Server-rendered pages can
    // reuse the client payload immediately, then refresh without clearing UI.
    if (returning && path !== '/home' && path !== '/messages') startTransition(() => router.refresh());
  }, [path, router, session.scope, session.changed]);

  if (session.changed) return <main className="min-h-screen bg-canvas p-6" role="status">{session.owner ? 'Opening your account…' : 'Signing out…'}</main>;
  return children;
}
