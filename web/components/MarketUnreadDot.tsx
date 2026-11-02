"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadConversationUnreadTotal } from "@/lib/messages";
import { withTimeout } from "@/lib/withTimeout";
import { getNavigationStore } from '@/lib/navigationCache';

export function MarketUnreadDot() {
  const [supabase] = useState(createClient);
  const [navigationStore] = useState(getNavigationStore);
  const [n, setN] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let on = true;
    let pending: AbortController | null = null;
    let revision = 0;
    async function check() {
      if (!on || pending || document.visibilityState === 'hidden') return;
      const request = new AbortController(), version = revision;
      pending = request;
      const current = () => on && version === revision && !request.signal.aborted;
      try {
        const { data, error } = await withTimeout(supabase.auth.getSession());
        if (error) throw error;
        if (!current()) return;
        const uid = data.session?.user.id;
        const total = uid ? await withTimeout(loadConversationUnreadTotal({ viewer: uid, token: data.session?.access_token,
          signal: request.signal, current }, 'market')) : 0;
        if (current()) { setN(total); setUnavailable(false); }
      } catch { if (current()) setUnavailable(true); }
      finally { request.abort(); if (pending === request) pending = null; }
    }
    const unsubscribe = navigationStore.subscribe(() => {
      revision++; pending?.abort(); pending = null; setN(0); setUnavailable(false);
      queueMicrotask(() => { if (on) void check(); });
    });
    const visibility = () => {
      if (document.visibilityState === 'hidden') { revision++; pending?.abort(); pending = null; }
      else void check();
    };
    void check();
    const t = setInterval(check, 30000);
    document.addEventListener('visibilitychange', visibility); window.addEventListener('focus', check); window.addEventListener('online', check);
    return () => { on = false; revision++; pending?.abort(); unsubscribe(); clearInterval(t);
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', check); window.removeEventListener('online', check); };
  }, [supabase, navigationStore]);

  if (unavailable) return <span role="status" aria-label="Message count unavailable" title="Message updates could not load. They will be checked again shortly." className="absolute -right-1 -top-1 text-xs text-muted">!</span>;
  if (n === 0) return null;
  return (
    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-pearl px-1 text-[9px] font-bold text-on-pearl">
      {n > 9 ? "9+" : n}
    </span>
  );
}
