"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Briefcase, Plus, ShieldCheck } from 'lucide-react';
import { displayImageUrl } from '@/lib/media';
import { createClient } from '@/lib/supabase/client';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { BusinessAccessError, businessAccessMessage, businessAccessStep, isBusinessSessionHandoff, prepareBusinessOwnerSession, type BusinessSessionHandoff } from '@/lib/businessAccess';

type Row = { business_id: string; full_name: string | null; username: string | null; avatar_url: string | null; role: string; category: string | null; is_verified: boolean; member_count: number; post_count: number };
type Confirmation = { businessId: string; owner: string; version: number };

export default function BusinessesPage() {
  const [supabase] = useState(createClient);
  const [rows, setRows] = useState<Row[]>([]), [uid, setUid] = useState<string | null>(null);
  const [ready, setReady] = useState(false), [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null), [actionError, setActionError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null), [installing, setInstalling] = useState(false), [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const live = useRef(false), account = useRef<string | null | undefined>(undefined), generation = useRef(0), reads = useRef(0);
  const pending = useRef<AbortController | null>(null), readRequest = useRef<AbortController | null>(null), handoff = useRef<BusinessSessionHandoff | null>(null);
  const confirmationRef = useRef<Confirmation | null>(null);

  const applyAccount = useCallback((next: string | null) => {
    if (next === account.current) return;
    account.current = next; generation.current++; pending.current?.abort(); pending.current = null; handoff.current = null; confirmationRef.current = null;
    setUid(next); setRows([]); setOpening(null); setInstalling(false); setConfirmation(null); setActionError(null); setNotice(null);
  }, []);

  const load = useCallback(async () => {
    if (!live.current) return;
    const request = ++reads.current, abort = new AbortController(); readRequest.current?.abort(); readRequest.current = abort;
    const current = () => live.current && request === reads.current && !abort.signal.aborted;
    setLoading(true); setReadError(null);
    try {
      const auth = await businessAccessStep(supabase.auth.getUser(), abort.signal);
      if (!current()) return;
      if (auth.error && auth.error.name !== 'AuthSessionMissingError') throw auth.error;
      const owner = auth.data.user?.id ?? null; applyAccount(owner); setReady(true);
      if (!owner) return;
      // This invoker RPC filters memberships by auth.uid(). The launch endpoint
      // independently verifies current ownership and the registered device.
      const result = await businessAccessStep(supabase.rpc('get_my_businesses'), abort.signal);
      if (!current()) return;
      if (result.error || !Array.isArray(result.data)) throw result.error || new Error('Business list unavailable');
      setRows(result.data as Row[]);
    } catch { if (current()) setReadError('Your businesses could not be loaded. Confirm your personal account and try again.'); }
    finally {
      if (current()) { setReady(true); setLoading(false); }
      if (readRequest.current === abort) readRequest.current = null;
      abort.abort();
    }
  }, [supabase, applyAccount]);

  useEffect(() => {
    live.current = true;
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active || !live.current || isBusinessSessionHandoff(handoff.current, session)) return;
      const next = session?.user.id ?? null;
      if (next === account.current) return;
      reads.current++; readRequest.current?.abort(); readRequest.current = null;
      applyAccount(next); setReady(true); setReadError(null); setLoading(!!next);
      const version = generation.current;
      queueMicrotask(() => { if (active && live.current && version === generation.current && next) void load(); });
    });
    queueMicrotask(() => { if (active && live.current) void load(); });
    return () => {
      active = false; live.current = false; generation.current++; reads.current++;
      pending.current?.abort(); pending.current = null; readRequest.current?.abort(); readRequest.current = null; handoff.current = null; confirmationRef.current = null;
      subscription.unsubscribe();
    };
  }, [supabase, applyAccount, load]);

  const openStudio = async (businessId: string, approved?: Confirmation) => {
    const owner = account.current;
    if (!owner || !live.current || pending.current || !rows.some(row => row.business_id === businessId && row.role === 'owner')) return;
    if (approved && (confirmationRef.current !== approved || approved.owner !== owner || approved.version !== generation.current || approved.businessId !== businessId)) return;
    const version = generation.current, abort = new AbortController(); pending.current = abort;
    const current = () => live.current && version === generation.current && pending.current === abort && !abort.signal.aborted;
    confirmationRef.current = null; setOpening(businessId); setActionError(null); setNotice(null); setConfirmation(null);
    try {
      const destination = await prepareBusinessOwnerSession(supabase, { businessId }, owner, current, abort.signal, !!approved);
      if (!current()) return;
      handoff.current = { businessId: destination.business_id, accessToken: destination.session.access_token }; setInstalling(true);
      const installed = await supabase.auth.setSession(destination.session);
      if (!current()) return;
      if (installed.error || installed.data.user?.id !== businessId || installed.data.session?.user.id !== businessId) throw new BusinessAccessError('SESSION_MISMATCH');
      const selected = await businessAccessStep(supabase.auth.getSession(), abort.signal);
      if (!current()) return;
      if (selected.error || selected.data.session?.user.id !== businessId) throw new BusinessAccessError('SESSION_MISMATCH');
      window.location.assign('/studio');
    } catch (error) {
      if (!current()) return;
      if (error instanceof BusinessAccessError && error.code === 'OWNER_BOOTSTRAP_REQUIRED') { const next = { businessId, owner, version }; confirmationRef.current = next; setConfirmation(next); }
      else setActionError(businessAccessMessage(error));
    } finally {
      if (pending.current === abort) {
        pending.current = null; handoff.current = null; abort.abort();
        if (live.current && version === generation.current) { setOpening(null); setInstalling(false); }
      }
    }
  };

  const cancel = () => {
    if (handoff.current || !pending.current) return;
    generation.current++; pending.current.abort(); pending.current = null; confirmationRef.current = null;
    setOpening(null); setInstalling(false); setConfirmation(null); setActionError(null); setNotice('Business sign-in cancelled. Your personal account is unchanged.');
  };

  return <div className="mx-auto max-w-[720px] px-1">
    <div className="flex items-center justify-between gap-3 pb-2">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-ink"><Briefcase size={22} className="text-accent" aria-hidden />Businesses</h1>
      <Link href="/businesses/new" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-navy px-4 text-sm font-semibold text-white"><Plus size={16} aria-hidden />New business</Link>
    </div>
    <p className="pb-5 text-sm leading-relaxed text-muted">Your business profiles and team roles. Open Studio to switch into a business account after its owner and device access are verified.</p>
    {readError && <div role="alert" className="mb-4 rounded-xl border border-danger/20 bg-danger/5 p-4 text-sm text-ink"><p>{readError}</p><button type="button" onClick={() => void load()} disabled={loading || !!opening} className="mt-2 min-h-11 rounded-lg border border-ink/20 px-4 font-semibold disabled:opacity-50">Retry</button></div>}
    {actionError && <p role="alert" className="mb-4 rounded-xl border border-danger/20 bg-danger/5 p-4 text-sm text-ink">{actionError}</p>}
    {notice && <p role="status" className="mb-4 text-sm text-muted">{notice}</p>}
    {opening && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink/10 p-4"><p role="status" className="text-sm text-muted">{installing ? 'Opening Studio…' : 'Checking owner and browser access…'}</p>{!installing && <button type="button" onClick={cancel} className="min-h-11 rounded-lg border border-ink/20 px-4 text-sm font-semibold text-ink">Cancel sign-in</button>}</div>}
    {loading || !ready ? <p role="status" className="py-6 text-center text-sm text-muted">Loading your businesses…</p> : null}
    {ready && !uid && !readError && <p className="rounded-xl border border-ink/10 p-5 text-sm text-muted"><Link href="/login" className="font-semibold text-ink underline">Sign in to your personal account</Link> to see the businesses you own or work with.</p>}
    {ready && uid && !loading && !readError && rows.length === 0 && <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-ink/15 px-6 py-12 text-center"><Briefcase size={30} className="text-muted" aria-hidden /><p className="text-base font-semibold text-ink">No businesses yet</p><p className="max-w-md text-sm leading-relaxed text-muted">A business gets its own profile, followers, posts and messages. Owners open its separate account from here. Staff use personal team access codes on approved devices.</p><Link href="/businesses/apply" className="min-h-11 rounded-lg bg-navy px-5 py-3 text-sm font-semibold text-white">Apply for a business account</Link></div>}
    <div className="space-y-3">{rows.map(row => <section key={row.business_id} aria-label={row.full_name || 'Business'} className="rounded-xl border border-ink/10 bg-[var(--surface-raised)] p-4">
      <div className="flex items-center gap-3">
        {row.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={displayImageUrl(row.avatar_url, 200) ?? row.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover" />
        ) : <span className="flex h-12 w-12 items-center justify-center rounded-full bg-navy text-sm font-semibold text-white">{(row.full_name || 'B').charAt(0)}</span>}
        <div className="min-w-0 flex-1"><h2 className="flex items-center gap-1.5 text-base font-semibold text-ink"><span className="truncate">{row.full_name || 'Business'}</span><VerifiedBadge userId={row.business_id} size={14} /></h2><p className="mt-1 text-xs text-muted">{row.category || 'Business'} · {row.member_count} team {row.member_count === 1 ? 'member' : 'members'} · {row.post_count} posts</p></div>
        <span className="rounded-full bg-pearl/15 px-2.5 py-1 text-xs font-semibold capitalize text-accent">{row.role}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink/10 pt-3">
        {row.username && <Link href={'/' + encodeURIComponent(row.username)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink/15 px-3 text-sm font-semibold text-ink">View profile<ArrowRight size={15} aria-hidden /></Link>}
        {row.role === 'owner' ? <button type="button" onClick={() => void openStudio(row.business_id)} disabled={!!opening} aria-label={'Open ' + (row.full_name || 'business') + ' Studio'} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-navy px-4 text-sm font-semibold text-white disabled:opacity-50"><ShieldCheck size={16} aria-hidden />Open Studio</button> : <Link href="/business-login" className="min-h-11 rounded-lg border border-ink/15 px-3 py-3 text-sm font-semibold text-ink">Team sign-in</Link>}
      </div>
      {confirmation?.businessId === row.business_id && <div role="group" aria-label="Set up owner access" className="mt-4 rounded-lg border border-pearl/30 bg-pearl/10 p-4"><h3 className="text-sm font-semibold text-ink">Set up your owner access</h3><p className="mt-1 text-sm leading-relaxed text-muted">This creates your owner seat and registers this browser as approved for {row.full_name || 'your business'}. You can then add staff and review their devices in Studio → Team.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void openStudio(row.business_id, confirmation)} disabled={!!opening} className="min-h-11 rounded-lg bg-navy px-4 text-sm font-semibold text-white">Create my owner access</button><button type="button" onClick={() => { confirmationRef.current = null; setConfirmation(null); }} className="min-h-11 rounded-lg border border-ink/20 px-4 text-sm text-ink">Cancel setup</button></div></div>}
    </section>)}</div>
  </div>;
}
