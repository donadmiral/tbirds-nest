'use client';

import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { getNavigationStore } from '@/lib/navigationCache';

/** Route offsets live in the same account/session-scoped memory as route data. */
export function ScrollMemory() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [store] = useState(getNavigationStore);
  const session = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  useLayoutEffect(() => {
    const scope = session.scope;
    if (!scope || session.changed) return;
    const key = `scroll:${pathname}?${search}`;
    const stored = store.cache.read<number>(scope, key);
    const saved = typeof stored === 'number' && Number.isFinite(stored) && stored >= 0 ? stored : 0;
    let lastTop = saved, active = true, restoring = saved > 0, frame = 0;
    const started = performance.now();
    const sameRoute = () => window.location.pathname === pathname && new URLSearchParams(window.location.search).toString() === search;
    const stop = () => { restoring = false; cancelAnimationFrame(frame); };
    const intentEvents = ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const;
    intentEvents.forEach(event => window.addEventListener(event, stop, { capture: true, passive: true }));
    const restore = () => {
      if (!active || !restoring || !sameRoute() || store.getSnapshot().scope !== scope) return;
      const available = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      if (available >= saved || performance.now() - started > 2000) {
        stop();
        window.scrollTo({ top: Math.min(saved, available), left: window.scrollX, behavior: 'instant' });
        lastTop = window.scrollY;
      } else frame = requestAnimationFrame(restore);
    };
    // A resolved page restores before paint; only a genuinely shorter/loading
    // page needs another frame. A gesture cancels those pending restorations.
    if (restoring) restore();
    const onScroll = () => {
      if (!active || restoring || !sameRoute()) return;
      lastTop = window.scrollY;
      store.cache.save(scope, key, lastTop);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      store.cache.save(scope, key, lastTop);
      active = false; stop();
      intentEvents.forEach(event => window.removeEventListener(event, stop, true));
      window.removeEventListener('scroll', onScroll);
    };
  }, [pathname, search, session.scope, session.changed, store]);

  return null;
}
