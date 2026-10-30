"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2, ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { BusinessAccessError, businessAccessMessage, businessAccessStep, confirmBusinessDestination, confirmBusinessViewer, getBusinessDevice, isBusinessSessionHandoff, requireBusinessSession, type BusinessSessionHandoff } from '@/lib/businessAccess';

type Phase = 'idle' | 'checking' | 'connecting' | 'opening';

export default function BusinessLoginPage() {
  const [supabase] = useState(createClient);
  const [handle, setHandle] = useState(''), [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>('idle'), [ready, setReady] = useState(false), [authAttempt, setAuthAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const live = useRef(false), account = useRef<string | null | undefined>(undefined), generation = useRef(0);
  const pending = useRef<AbortController | null>(null), handoff = useRef<BusinessSessionHandoff | null>(null);

  useEffect(() => {
    live.current = true;
    let active = true, authVersion = 0;
    const initial = new AbortController();
    const apply = (next: string | null) => {
      if (!active || !live.current) return;
      if (account.current !== next) {
        const changed = account.current !== undefined;
        generation.current++; pending.current?.abort(); pending.current = null; handoff.current = null;
        account.current = next; setCode(''); setPhase('idle'); setError(null);
        setNotice(changed ? 'Your account changed. Review your business sign-in details before continuing.' : null);
      }
      setReady(true);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active || !live.current || isBusinessSessionHandoff(handoff.current, session)) return;
      authVersion++; apply(session?.user.id ?? null);
    });
    const version = authVersion;
    void businessAccessStep(supabase.auth.getSession(), initial.signal).then(({ data, error }) => {
      if (!active || !live.current || version !== authVersion) return;
      if (error) throw error;
      apply(data.session?.user.id ?? null);
    }).catch(() => {
      if (active && live.current && version === authVersion) { setReady(false); setError('Your current account could not be checked. Try again before signing in to a business.'); }
    });
    return () => { active = false; live.current = false; generation.current++; initial.abort(); pending.current?.abort(); pending.current = null; handoff.current = null; subscription.unsubscribe(); };
  }, [supabase, authAttempt]);

  const cancel = () => {
    if (handoff.current || !pending.current) return;
    generation.current++; pending.current.abort(); pending.current = null;
    setPhase('idle'); setError(null); setNotice('Business sign-in cancelled. Your selected account is unchanged.');
  };

  const signIn = async () => {
    if (!ready || pending.current || !live.current || account.current === undefined) return;
    const business = handle.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(business) || !code.trim()) { setError('Enter a valid business handle and your personal access code.'); return; }
    const owner = account.current, version = generation.current, abort = new AbortController(); pending.current = abort;
    const current = () => live.current && version === generation.current && pending.current === abort && !abort.signal.aborted;
    setPhase('checking'); setError(null); setNotice(null);
    try {
      await confirmBusinessViewer(supabase, owner, current, abort.signal);
      if (!current()) return;
      const device = getBusinessDevice();
      setPhase('connecting');
      const response = await businessAccessStep(supabase.functions.invoke('business-signin', {
        body: { handle: business, code: code.trim(), ...device, device_label: 'Web browser' }, signal: abort.signal, timeout: 15_000,
      }), abort.signal);
      if (!current()) return;
      const destination = await requireBusinessSession(response.data, response.error, abort.signal);
      if (!current()) return;
      await confirmBusinessDestination(supabase, destination, abort.signal);
      if (!current()) return;
      await confirmBusinessViewer(supabase, owner, current, abort.signal);
      if (!current()) return;
      // All cancellable checks finish before Auth installs the exact session
      // that the server has already bound to this active member and device.
      handoff.current = { businessId: destination.business_id, accessToken: destination.session.access_token };
      setPhase('opening');
      const installed = await supabase.auth.setSession(destination.session);
      if (!current()) return;
      if (installed.error || installed.data.user?.id !== destination.business_id || installed.data.session?.user.id !== destination.business_id) throw new BusinessAccessError('SESSION_MISMATCH');
      const selected = await businessAccessStep(supabase.auth.getSession(), abort.signal);
      if (!current()) return;
      if (selected.error || selected.data.session?.user.id !== destination.business_id) throw new BusinessAccessError('SESSION_MISMATCH');
      setCode(''); window.location.assign('/studio');
    } catch (failure) { if (current()) setError(businessAccessMessage(failure)); }
    finally {
      if (pending.current === abort) {
        pending.current = null; handoff.current = null; abort.abort();
        if (live.current && version === generation.current) setPhase('idle');
      }
    }
  };

  const busy = phase !== 'idle';
  return <main className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-5 py-10">
    <section aria-labelledby="business-login-title" className="w-full max-w-md rounded-2xl border border-ink/10 bg-[var(--surface-raised)] p-6 shadow-sm sm:p-8">
      <Link href="/login" aria-disabled={phase === 'opening'} onClick={event => { if (handoff.current) event.preventDefault(); else cancel(); }} className="mb-7 inline-flex min-h-11 items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft size={17} aria-hidden />Personal sign-in</Link>
      <div className="mb-5 flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#0b1e3d] text-[#d6b77e]"><Building2 size={24} aria-hidden /></span><div><p className="text-[10px] font-semibold tracking-[.2em] text-muted">PLATINUM CIRCLES</p><h1 id="business-login-title" className="text-2xl font-semibold tracking-tight text-ink">Business sign-in</h1></div></div>
      <p className="mb-6 text-sm leading-relaxed text-muted">Use your business handle and your personal team access code. A business owner must approve this browser before you can open Studio.</p>
      <form aria-label="Business sign-in" aria-busy={busy} onSubmit={event => { event.preventDefault(); void signIn(); }}>
        <fieldset disabled={busy || !ready} className="space-y-4">
          <label htmlFor="business-login-handle" className="block text-sm font-semibold text-ink">Business handle<input id="business-login-handle" name="handle" value={handle} onChange={event => setHandle(event.target.value)} placeholder="@yourbusiness" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={31} pattern="@?[A-Za-z0-9_]{3,30}" required className="mt-2 min-h-12 w-full rounded-lg border border-ink/20 bg-[var(--canvas)] px-3.5 text-base font-normal text-ink outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-pearl)]" /></label>
          <label htmlFor="business-login-code" className="block text-sm font-semibold text-ink">Personal access code<input id="business-login-code" name="code" value={code} onChange={event => setCode(event.target.value)} type="password" autoComplete="current-password" maxLength={256} required className="mt-2 min-h-12 w-full rounded-lg border border-ink/20 bg-[var(--canvas)] px-3.5 text-base font-normal text-ink outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-pearl)]" /></label>
          <button type="submit" disabled={!handle.trim() || !code.trim()} className="min-h-12 w-full rounded-lg bg-[#0b1e3d] px-4 font-semibold text-white disabled:opacity-50">{phase === 'opening' ? 'Opening Studio…' : busy ? 'Checking business access…' : 'Open Business Studio'}</button>
        </fieldset>
        {error && <p role="alert" className="mt-4 rounded-lg border border-danger/25 bg-danger/5 p-3 text-sm leading-relaxed text-danger">{error}</p>}
        {notice && <p role="status" className="mt-4 text-sm leading-relaxed text-muted">{notice}</p>}
        {!ready && !error && <p role="status" className="mt-3 text-sm text-muted">Checking your current account…</p>}
        {!ready && error && <button type="button" onClick={() => { setError(null); setAuthAttempt(value => value + 1); }} className="mt-3 min-h-11 rounded-lg border border-ink/20 px-4 text-sm text-ink">Retry account check</button>}
        {busy && phase !== 'opening' && <button type="button" onClick={cancel} className="mt-3 min-h-11 w-full rounded-lg border border-ink/20 px-4 text-sm text-ink">Cancel sign-in</button>}
      </form>
      <div className="mt-6 flex items-start gap-2 border-t border-ink/10 pt-5 text-xs leading-relaxed text-muted"><ShieldCheck size={18} className="mt-0.5 shrink-0" aria-hidden /><p>Your access uses your active team role and this browser’s registration. Your business can revoke both.</p></div>
      <p className="mt-5 text-sm leading-relaxed text-muted">Business owner? <Link href="/businesses/apply" aria-disabled={phase === 'opening'} onClick={event => { if (handoff.current) event.preventDefault(); else cancel(); }} className="font-semibold text-ink underline underline-offset-4">Open your approved business</Link> from your personal account.</p>
    </section>
  </main>;
}
