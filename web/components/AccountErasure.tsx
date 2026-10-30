"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { erasureMessage, parseErasureReceipt, readAccountErasure, sendAccountErasure,
  type ErasureReceipt, type ErasureStatus } from '../../shared/accountErasure';
const KEY = 'pc:account-erasure-receipt:v1';
const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function AccountErasure({ allowRequest = false }: { allowRequest?: boolean }) {
  const client = useRef(createClient()).current;
  const guard = useRef({ busy: false, generation: 0, owner: null as string | null, alive: true });
  const [owner, setOwner] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ErasureReceipt | null>(null);
  const [status, setStatus] = useState<ErasureStatus | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async (saved: ErasureReceipt) => {
    if (guard.current.busy) return;
    guard.current.busy = true; setBusy(true); setError('');
    try {
      const next = await readAccountErasure(base, anon, saved);
      if (!guard.current.alive) return;
      setStatus(next);
      if (!next) setError('This request is not confirmed, or its status receipt has expired. Contact support with the request number if you need help.');
    } catch { if (guard.current.alive) setError('Status is unavailable. Your saved request is still here; refresh when connected.'); }
    finally { guard.current.busy = false; if (guard.current.alive) setBusy(false); }
  }, []);
  useEffect(() => {
    guard.current.alive = true;
    const watcher = client.auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id ?? null;
      if (guard.current.owner !== id) { guard.current.owner = id; guard.current.generation++; setOwner(id); }
    }).data.subscription;
    try {
      const saved = parseErasureReceipt(localStorage.getItem(KEY));
      if (saved) { setReceipt(saved); void refresh(saved); }
    } catch { setError('Your browser must allow local storage to save a deletion receipt before requesting deletion.'); }
    return () => { guard.current.alive = false; guard.current.generation++; watcher.unsubscribe(); };
  }, [client, refresh]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (guard.current.busy || confirmation !== 'DELETE' || !owner) return;
    guard.current.busy = true; setBusy(true); setError('');
    const generation = guard.current.generation, expectedOwner = owner;
    try {
      const session = (await client.auth.getSession()).data.session;
      if (!session || session.user.id !== expectedOwner) throw new Error('Your account changed. Reopen settings before requesting deletion.');
      const verified = await client.auth.getUser(session.access_token);
      if (verified.error || verified.data.user?.id !== expectedOwner || guard.current.generation !== generation) throw new Error('Sign in again before requesting deletion.');
      let saved = parseErasureReceipt(localStorage.getItem(`${KEY}:${expectedOwner}`));
      if (!saved) {
        saved = {
          requestId: crypto.randomUUID(), userId: expectedOwner, createdAt: new Date().toISOString(),
          token: Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join(''),
        };
        localStorage.setItem(`${KEY}:${expectedOwner}`, JSON.stringify(saved));
      }
      localStorage.setItem(KEY, JSON.stringify(saved));
      setReceipt(saved);
      if (guard.current.generation !== generation || !guard.current.alive) throw new Error('Your account changed. Reopen settings before requesting deletion.');
      const next = await sendAccountErasure(base, anon, session.access_token, saved);
      // The request uses the captured JWT, so a concurrent switch cannot target
      // the newly signed-in user. Do not sign that new user out on completion.
      if (guard.current.generation !== generation || !guard.current.alive) return;
      setStatus(next); setConfirmation('');
      await client.auth.signOut({ scope: 'local' });
    } catch (cause) {
      if (guard.current.alive) setError(cause instanceof Error ? cause.message : 'Deletion could not be confirmed. Check the saved request status.');
    } finally { guard.current.busy = false; if (guard.current.alive) setBusy(false); }
  };
  const copy = status ? erasureMessage(status) : null;
  return <div className="mx-auto max-w-[640px] px-4 py-6 text-ink">
    <h1 className="font-display text-2xl font-bold">{allowRequest && !status ? 'Delete your personal account' : 'Account deletion status'}</h1>
    {allowRequest && !status ? <>
      <p className="mt-3 text-sm leading-6 text-secondary">Your account will be disabled while your stored files and account records are erased. This cannot be undone. Payment records, shared accounts or files with unclear ownership may need a support review. Deletion is complete only when your request status confirms it.</p>
      <Link href="/settings/download" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold underline">Download your data first</Link>
      {owner ? <form onSubmit={submit} className="mt-5 space-y-3">
        <label htmlFor="account-erasure-confirmation" className="block text-sm font-semibold">Type DELETE to confirm</label>
        <input id="account-erasure-confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" autoCapitalize="characters" disabled={busy}
          className="min-h-12 w-full rounded-xl border border-ink/20 bg-surface px-4 text-ink focus-visible:outline-2" />
        <button type="submit" disabled={busy || confirmation !== 'DELETE'} className="min-h-12 rounded-full bg-red-700 px-6 text-sm font-bold text-white disabled:opacity-50">
          {busy ? 'Checking request…' : 'Request account deletion'}
        </button>
      </form> : <p className="mt-4 text-sm"><Link href="/login" className="underline">Sign in</Link> to request deletion of your personal account.</p>}
    </> : null}
    {copy ? <section aria-live="polite" className="mt-5 rounded-2xl border border-ink/10 bg-surface p-5">
      <h2 className="text-lg font-semibold">{copy.title}</h2><p className="mt-2 text-sm leading-6 text-secondary">{copy.detail}</p>
      {status!.filesTotal > 0 ? <p className="mt-3 text-sm">{status!.filesErased} of {status!.filesTotal} stored files erased</p> : null}
    </section> : null}
    {receipt ? <div className="mt-4">
      <p className="break-all text-xs text-secondary">Request {receipt.requestId}</p>
      <button type="button" onClick={() => void refresh(receipt)} disabled={busy} className="mt-2 min-h-11 rounded-full border border-ink/20 px-4 text-sm font-semibold disabled:opacity-50">{busy ? 'Checking…' : 'Refresh deletion status'}</button>
      <p className="mt-3 text-xs leading-5 text-secondary">The receipt is saved in this browser. Return from the sign-in page to check it without signing in.</p>
    </div> : !allowRequest ? <p className="mt-4 text-sm leading-6 text-secondary">There is no deletion receipt saved in this browser. Use the device where you requested deletion, or contact support with your request number.</p> : null}
    {error ? <p role="alert" className="mt-4 text-sm leading-6 text-red-700 dark:text-red-300">{error}</p> : null}
    {!allowRequest || status ? <Link href="/login" className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold underline">Return to sign in</Link> : null}
  </div>;
}
