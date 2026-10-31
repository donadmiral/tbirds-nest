'use client';
import NextImage from "next/image";

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Mail, Search, UserRound } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { withTimeout } from '@/lib/withTimeout';
import { ProductDialog } from './ProductDialog';
import styles from './SocialWorkspace.module.css';

type Person = { id: string; full_name: string | null; username: string | null; avatar_url: string | null };

/** Starts an authorized conversation; it never sends a message automatically. */
type Props = { open: boolean; ownerId: string; onClose: () => void; onOpen: (id: string) => Promise<void> };
export function NewMessageDialog(props: Props) {
  return props.open ? <NewMessageContent key={props.ownerId} {...props} /> : null;
}
function NewMessageContent({ open, ownerId, onClose, onOpen }: Props) {
  const [client] = useState(createClient);
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Person | null>(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const scope = useRef(0), pending = useRef(false);
  useEffect(() => {
    scope.current += 1;
    return () => { scope.current += 1; };
  }, []);
  useEffect(() => {
    if (!open || selected) return;
    const version = scope.current, term = query.trim().replace(/^@/, '');
    let alive = true;
    if (term.length < 2) return;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const { data, error: cause } = await withTimeout(client.rpc('search_people_page', { p_q: term, p_limit: 20, p_offset: 0 }));
        if (!alive || version !== scope.current) return;
        if (cause || !Array.isArray(data)) throw new Error('People could not be loaded. Try again.');
        setPeople((data as Person[]).filter(person => person.id && person.id !== ownerId));
      } catch (cause) { if (alive && version === scope.current) setError(cause instanceof Error ? cause.message : 'People could not be loaded. Try again.'); }
      finally { if (alive && version === scope.current) setLoading(false); }
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [client, ownerId, open, query, selected, retry]);
  async function start() {
    if (!selected || !open || pending.current) return;
    const version = scope.current;
    pending.current = true; setBusy(true); setError('');
    try {
      const auth = await withTimeout(client.auth.getUser());
      if (version !== scope.current) return;
      if (auth.error || auth.data.user?.id !== ownerId) throw new Error('Your account changed. Close this window and try again.');
      const { data, error: cause } = await withTimeout(client.rpc('start_dm_ctx', { p_receiver_id: selected.id, p_context: 'personal' }));
      if (version !== scope.current) return;
      if (cause || typeof data !== 'string' || !data) throw new Error('This conversation could not open. Please try again.');
      await onOpen(data);
      if (version === scope.current) { setQuery(''); setSelected(null); onClose(); }
    } catch (cause) { if (version === scope.current) setError(cause instanceof Error ? cause.message : 'This conversation could not open. Please try again.'); }
    finally { if (version === scope.current) { pending.current = false; setBusy(false); } }
  }
  return <ProductDialog open={open} title="New message" description={selected ? 'Review who you are opening a conversation with.' : 'Search for a person by name or username.'} busy={busy} onClose={onClose}>
    {selected ? <div className={styles.form}><button type="button" className={styles.button} disabled={busy} onClick={() => { setSelected(null); setError(''); setLoading(true); }}><ArrowLeft size={16} aria-hidden />Choose someone else</button><div className={styles.card}>{selected.avatar_url ? <NextImage unoptimized width={70} height={70} src={selected.avatar_url} alt="" className={styles.icon} /> : <span className={styles.icon}><UserRound size={26} aria-hidden /></span>}<div><strong>{selected.full_name || 'Member'}</strong>{selected.username ? <p className={styles.meta}>@{selected.username}</p> : null}</div></div><p className={styles.hint}>You can write your message in the conversation. The recipient’s message settings apply.</p></div> : <div className={styles.form}><div className={styles.search}><Search size={18} aria-hidden /><input autoFocus value={query} onChange={event => { setQuery(event.target.value); setPeople([]); setError(''); setLoading(event.target.value.trim().replace(/^@/, '').length >= 2); }} aria-label="Search people to message" placeholder="Name or @username" /></div>{loading ? <p role="status" className={styles.hint}>Finding people…</p> : query.trim().replace(/^@/, '').length < 2 ? <p className={styles.hint}>Enter at least two characters to start.</p> : !people.length && !error ? <p className={styles.hint}>No people match this search. Try another name.</p> : <ul className="grid max-h-72 gap-2 overflow-y-auto">{people.map(person => <li key={person.id}><button type="button" className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-ink/10 px-3 py-3 text-left hover:bg-surface" onClick={() => setSelected(person)} aria-label={`Message ${person.full_name || person.username || 'member'}`}>{person.avatar_url ? <NextImage unoptimized width={40} height={40} src={person.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" /> : <span className="grid h-10 w-10 place-items-center rounded-full bg-surface"><UserRound size={20} aria-hidden /></span>}<span><strong className="block text-sm">{person.full_name || 'Member'}</strong>{person.username ? <small className="block text-xs text-muted">@{person.username}</small> : null}</span></button></li>)}</ul>}</div>}
    {error ? <p role="alert" className={`${styles.error} mt-4`}>{error}{!selected ? <button type="button" className="ml-2 underline" onClick={() => { setError(''); setLoading(true); setRetry(value => value + 1); }}>Try again</button> : null}</p> : null}
    <footer className={styles.footer}><button type="button" disabled={busy} onClick={onClose} className={styles.button}>Cancel</button>{selected ? <button type="button" disabled={busy} onClick={() => void start()} className={styles.primary}><Mail size={16} aria-hidden />{busy ? 'Opening…' : 'Open conversation'}</button> : null}</footer>
  </ProductDialog>;
}
