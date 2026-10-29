'use client';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { linkIntoBankAccount } from '@/lib/monetization';

export default function IntoBankConnectionForm({ owner, onChanged }: { owner: string; onChanged: () => void }) {
  const [client] = useState(createClient);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort(); }; }, []);
  if (!open) return <button type="button" className="mt-4 min-h-11 rounded-lg bg-pearl px-4 py-2 font-semibold text-on-pearl" onClick={() => setOpen(true)}>Link IntoBank</button>;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    const timer = setTimeout(() => controller.abort(), 20000);
    setBusy(true); setError(null);
    try {
      await linkIntoBankAccount(client, owner, code, controller.signal);
      if (mounted.current) { setCode(''); setOpen(false); onChanged(); }
    } catch (reason) {
      if (mounted.current) { setError(reason instanceof Error ? reason.message : 'The connection could not be confirmed. Refresh its status.'); onChanged(); }
    } finally {
      clearTimeout(timer);
      if (pending.current === controller) pending.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  return <form onSubmit={submit} className="mt-4 space-y-3 rounded-lg border border-ink/15 p-4">
    <p className="text-sm text-muted">In IntoBank, open Profile, Connected apps, then Platinum Circles. Review the wallet access and payment permissions. Generate a connection code and enter it here.</p>
    <label className="block text-sm font-semibold" htmlFor="intobank-approval-code">IntoBank approval code</label>
    <input id="intobank-approval-code" value={code} onChange={event => setCode(event.target.value.toUpperCase())}
      autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={8} pattern="[A-Fa-f0-9]{8}" required disabled={busy}
      placeholder="8-character code" className="min-h-12 w-full rounded-lg border border-ink/20 bg-surface-elevated px-3 text-base text-ink outline-offset-2" />
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    <div className="flex flex-wrap gap-3">
      <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-pearl px-4 py-2 font-semibold text-on-pearl disabled:opacity-50">{busy ? 'Connecting…' : 'Connect approved account'}</button>
      <button type="button" onClick={() => { if (pending.current) { pending.current.abort(); return; } setCode(''); setError(null); setOpen(false); }} className="min-h-11 px-3 text-sm">{busy ? 'Stop waiting' : 'Cancel'}</button>
    </div>
  </form>;
}
