'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { loadConversationWindow, loadMoreConversations, webInboxOptions, type Conv } from '@/lib/messages';
import { withTimeout } from '@/lib/withTimeout';
import type { InboxWindow } from '../../shared/inboxWindow';

/** Forwarding uses its own unfiltered, bounded collection. Searching the inbox
 * or viewing Unread must not hide valid forwarding destinations. */
export function ForwardConversationPicker({ owner, context, activeId, conversations, paged, busy, onSelect }: {
  owner: string; context: string; activeId: string | null; conversations: Conv[]; paged: boolean; busy: boolean;
  onSelect: (conversation: Conv) => void;
}) {
  const [supabase] = useState(createClient);
  const [collection, setCollection] = useState<InboxWindow<Conv>>({ items: paged ? [] : conversations, paging: null });
  const collectionRef = useRef(collection); collectionRef.current = collection;
  const [loading, setLoading] = useState(paged), [error, setError] = useState(false);
  const mounted = useRef(false), pending = useRef(false), generation = useRef(0);
  const abort = useRef<AbortController | null>(null), sentinel = useRef<HTMLDivElement | null>(null);
  const load = useCallback(async (more = false) => {
    if (pending.current || !paged) return;
    pending.current = true; setLoading(true); setError(false);
    const request = new AbortController(); abort.current = request;
    const version = generation.current;
    const current = () => mounted.current && generation.current === version && !request.signal.aborted;
    try {
      const { data, error: sessionError } = await withTimeout(supabase.auth.getSession(), 12000);
      if (sessionError || data.session?.user.id !== owner) throw sessionError ?? new Error('The account changed.');
      const scope = { viewer: owner, token: data.session.access_token, signal: request.signal, current };
      const options = { ...webInboxOptions(context), excludeCommunity: false };
      const result = await withTimeout(more
        ? loadMoreConversations(scope, options, collectionRef.current)
        : loadConversationWindow(scope, options), 12000);
      if (current()) { collectionRef.current = result; setCollection(result); }
    } catch { if (current()) setError(true); }
    finally { if (current()) { pending.current = false; setLoading(false); } request.abort(); }
  }, [supabase, owner, context, paged]);
  useEffect(() => {
    mounted.current = true; generation.current++; pending.current = false;
    if (paged) void load();
    return () => { mounted.current = false; generation.current++; abort.current?.abort(); };
  }, [load, paged]);
  useEffect(() => {
    const element = sentinel.current;
    if (!element || loading || error || !collection.paging?.cursor || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void load(true); }, { rootMargin: '120px' });
    observer.observe(element); return () => observer.disconnect();
  }, [collection.paging, loading, error, load]);
  const rows = (paged ? collection.items : conversations).filter(row => row.id !== activeId && !row.request_pending);
  return <div className="mt-2 max-h-40 overflow-y-auto">
    {rows.map(row => <button type="button" key={row.id} disabled={busy} className="block w-full rounded px-2 py-2 text-left hover:bg-surface-elevated" onClick={() => onSelect(row)}>{row.title}</button>)}
    {error ? <p role="alert">Conversations could not be loaded. <button type="button" className="underline" onClick={() => void load(!!collection.paging?.cursor)}>Try again</button></p>
      : loading && !rows.length ? <p>Loading</p> : !rows.length ? <p>No other conversations available.</p> : null}
    <div ref={sentinel} aria-hidden className="h-px" />
  </div>;
}
