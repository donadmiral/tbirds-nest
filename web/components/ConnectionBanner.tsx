'use client';

import { useEffect, useRef, useState } from 'react';
import { CloudOff, RotateCcw, Wifi } from 'lucide-react';

type State = 'online' | 'offline' | 'checking' | 'restored';

/** Check our origin without reloading the page or discarding an in-progress draft. */
export function ConnectionBanner() {
  const [state, setState] = useState<State>('online');
  const retry = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true, generation = 0, controller: AbortController | null = null;
    let hadFailure = navigator.onLine === false;
    const offline = () => {
      generation++; controller?.abort(); hadFailure = true;
      if (active) setState('offline');
    };
    const verify = async () => {
      if (!active) return;
      const request = ++generation;
      controller?.abort(); controller = new AbortController();
      const currentController = controller;
      const timer = window.setTimeout(() => currentController.abort(), 5000);
      if (hadFailure) setState('checking');
      try {
        const response = await fetch('/favicon.ico', { method: 'HEAD', cache: 'no-store', signal: currentController.signal });
        if (!active || request !== generation) return;
        if (!response.ok || navigator.onLine === false) { hadFailure = true; setState('offline'); return; }
        setState(hadFailure ? 'restored' : 'online'); hadFailure = false;
      } catch { if (active && request === generation) { hadFailure = true; setState('offline'); } }
      finally { clearTimeout(timer); }
    };
    const online = () => { void verify(); };
    const visible = () => { if (hadFailure && document.visibilityState === 'visible') void verify(); };
    retry.current = online;
    window.addEventListener('offline', offline); window.addEventListener('online', online); document.addEventListener('visibilitychange', visible);
    if (hadFailure) offline();
    return () => { active = false; generation++; controller?.abort(); retry.current = () => {}; window.removeEventListener('offline', offline); window.removeEventListener('online', online); document.removeEventListener('visibilitychange', visible); };
  }, []);
  useEffect(() => {
    if (state !== 'restored') return;
    const timer = window.setTimeout(() => setState(value => value === 'restored' ? 'online' : value), 4000);
    return () => clearTimeout(timer);
  }, [state]);
  if (state === 'online') return null;
  const lost = state === 'offline' || state === 'checking';
  return <div role="status" aria-live="polite" className="fixed bottom-[calc(86px+env(safe-area-inset-bottom))] left-3 right-3 z-[55] mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-2.5 rounded-xl border border-white/20 bg-[#10213d] px-4 py-3 text-[12px] font-medium text-[#fff] shadow-xl md:bottom-5">
    {lost ? <CloudOff size={17} aria-hidden /> : <Wifi size={17} aria-hidden />}
    <span>{state === 'checking' ? 'Checking your connection…' : lost ? 'Connection unavailable. Keep this page open to preserve your work.' : 'Connection restored. You can retry any unsaved changes.'}</span>
    {lost ? <button type="button" disabled={state === 'checking'} onClick={() => retry.current()} className="flex min-h-10 items-center gap-2 rounded-lg border border-white/25 px-3 text-xs font-semibold disabled:opacity-50"><RotateCcw size={14} aria-hidden />Check connection</button> : null}
  </div>;
}
