'use client';

import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getNavigationStore } from '@/lib/navigationCache';
import { forgetAsyncBlockSize, readAsyncBlockHeight, rememberAsyncBlockSize } from '@/lib/asyncBlockGeometry';

/** Reserve a previously measured block while its own authorized read is pending. */
export function StableAsyncBlock({ blockKey, state, children }: {
  blockKey: string;
  state: 'pending' | 'ready' | 'empty';
  children?: ReactNode;
}) {
  const [store] = useState(getNavigationStore);
  const session = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const element = useRef<HTMLDivElement>(null);
  const [reserved, setReserved] = useState<{ scope: string; key: string; height: number } | null>(null);

  useLayoutEffect(() => {
    const node = element.current, scope = session.scope;
    if (!node) return;
    let active = true;
    const measure = () => {
      if (!active || store.getSnapshot().scope !== scope) return;
      const { width, height } = node.getBoundingClientRect();
      if (state === 'pending') {
        const previousHeight = readAsyncBlockHeight(store.cache, scope, blockKey, width);
        setReserved(previous => scope && previousHeight !== null
          ? previous?.scope === scope && previous.key === blockKey && previous.height === previousHeight
            ? previous : { scope, key: blockKey, height: previousHeight }
          : previous === null ? previous : null);
      } else {
        setReserved(previous => previous === null ? previous : null);
        if (state === 'ready') rememberAsyncBlockSize(store.cache, scope, blockKey, width, height);
        else forgetAsyncBlockSize(store.cache, scope, blockKey);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => { active = false; observer.disconnect(); };
  }, [blockKey, session.scope, state, store]);

  const height = state === 'pending' && reserved?.scope === session.scope && reserved.key === blockKey ? reserved.height : undefined;
  return <div ref={element} data-async-block={blockKey} data-async-state={state} aria-busy={state === 'pending' || undefined}
    style={{ display: 'flow-root', height }}>
    {state === 'pending' && height !== undefined ? <div aria-hidden className="h-full rounded-xl bg-surface/40" /> : children}
  </div>;
}
