'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import CreatorCommercePanel from '@/components/CreatorCommercePanel';
import IntoBankConnectionForm from '@/components/IntoBankConnectionForm';
import { createClient } from '@/lib/supabase/client';
import { readCreatorSnapshot, registerCreatorInterest, applyToCreatorProgram, readIntoBankLink, ENROLLMENT_LABELS, BALANCE_LABELS, PAYOUT_LABELS, formatMinor, payoutBlockReason, earningActivityLabel, withFinanceDeadline, type CreatorSnapshot } from '@/lib/monetization';

export default function MonetizationPage() {
  const [client] = useState(createClient);
  const [uid, setUid] = useState<string | null | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<CreatorSnapshot | null>(null);
  const [linked, setLinked] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const identity = useRef(0);
  const requests = useRef(0);
  const mutation = useRef(false);
  const linkRequest = useRef<AbortController | null>(null);
  const currentUser = useRef<string | null | undefined>(undefined);
  const reload = useCallback(async (owner: string, generation: number) => {
    const request = requests.current += 1;
    linkRequest.current?.abort();
    const controller = new AbortController(); linkRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    const current = () => identity.current === generation && currentUser.current === owner && requests.current === request;
    setLoading(true); setError(null); setLinkError(null);
    await Promise.all([
      readCreatorSnapshot(client, owner).then(value => { if (current()) { setSnapshot(value); setAccepted(false); } }, reason => { if (current()) { setSnapshot(null); setError(reason instanceof Error ? reason.message : 'Could not load monetization.'); } }),
      withFinanceDeadline(readIntoBankLink(client, owner, controller.signal), 'Could not confirm your IntoBank connection.').then(value => { if (current()) setLinked(value); }, () => { if (current()) { setLinked(null); setLinkError('Could not confirm your IntoBank connection. Refresh to try again.'); } }),
    ]);
    clearTimeout(timeout);
    if (current()) setLoading(false);
  }, [client]);
  useEffect(() => {
    let live = true;
    const update = (owner: string | null) => {
      if (!live || currentUser.current === owner) return;
      currentUser.current = owner; const generation = identity.current += 1;
      requests.current += 1; mutation.current = false; linkRequest.current?.abort();
      setUid(owner); setSnapshot(null); setLinked(null); setError(null); setLinkError(null); setBusy(false); setAccepted(false);
      if (owner) void reload(owner, generation); else setLoading(false);
    };
    const { data } = client.auth.onAuthStateChange((_event, session) => update(session?.user.id ?? null));
    const initialGeneration = identity.current;
    const sessionError = () => {
      if (!live || identity.current !== initialGeneration) return;
      update(null);
      setError('Could not verify your session. Reload this page to try again.');
    };
    void withFinanceDeadline(client.auth.getSession(), 'Session check timed out.').then(({ data, error }) => {
      if (!live || identity.current !== initialGeneration) return;
      if (error) sessionError(); else update(data.session?.user.id ?? null);
    }, sessionError);
    return () => { live = false; identity.current += 1; requests.current += 1; linkRequest.current?.abort(); data.subscription.unsubscribe(); };
  }, [client, reload]);
  async function enroll(apply: boolean) {
    if (!uid || mutation.current || !snapshot || (apply && (!accepted || !snapshot.program.terms_version))) return;
    const owner = uid, generation = identity.current;
    mutation.current = true; setBusy(true); setError(null);
    try {
      if (apply) await applyToCreatorProgram(client, owner, snapshot.program.terms_version!); else await registerCreatorInterest(client, owner);
      if (generation === identity.current && currentUser.current === owner) await reload(owner, generation);
    } catch (reason) { if (generation === identity.current) setError(reason instanceof Error ? reason.message : 'Could not confirm this change. Refresh before retrying.'); }
    finally { if (generation === identity.current) { mutation.current = false; setBusy(false); } }
  }
  const card = 'rounded-xl border border-ink/15 bg-surface p-5';
  const button = 'min-h-11 rounded-lg bg-pearl px-4 py-2 font-semibold text-on-pearl disabled:opacity-50';
  const visible = snapshot?.user_id === uid ? snapshot : null;
  return <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 text-ink">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="font-display text-2xl font-bold">Creator monetization</h1><p className="mt-2 text-sm text-muted">Your program status, earnings and payouts.</p></div>{uid && <button className="min-h-11 rounded-lg border border-ink/20 px-4" disabled={loading || busy} onClick={() => void reload(uid, identity.current)}>{loading ? 'Refreshing…' : 'Refresh'}</button>}</div>
    {visible?.environment === 'test' && <p role="status" className="text-sm text-muted">Sandbox account: these are test earnings and payments.</p>}
    {uid === undefined && <p role="status">Checking your account…</p>}
    {uid === null && <p><Link className="underline" href="/login">Sign in</Link> to view your creator account.</p>}
    {error && <p role="alert" className="rounded-lg border border-danger/30 p-3 text-danger">{error}</p>}
    {uid && <section className={card} aria-labelledby="payout-provider"><h2 id="payout-provider" className="text-lg font-bold">IntoBank connection</h2><p className="mt-2 text-sm">{linked === true ? 'Your IntoBank account is linked.' : linked === false ? 'Your IntoBank account is not linked.' : loading ? 'Checking your connection…' : 'Connection status unavailable.'}</p>{linkError && <p role="alert" className="mt-2 text-sm text-danger">{linkError}</p>}<p className="mt-2 text-sm text-muted">IntoBank is the primary payment provider. A linked wallet does not yet mean your account is approved to receive creator payouts.</p>{linked === false && <IntoBankConnectionForm key={uid} owner={uid} onChanged={() => void reload(uid, identity.current)} />}<Link href="/settings" className="mt-3 inline-flex min-h-11 items-center underline">Manage account settings</Link></section>}
    {loading && !visible && uid && <p role="status">Loading your creator account…</p>}
    {visible && <>
      <section className={card}><h2 className="text-lg font-bold">{ENROLLMENT_LABELS[visible.enrollment.status]}</h2>{visible.enrollment.reason && <p className="mt-2 text-sm">{visible.enrollment.reason}</p>}<p className="mt-2 text-sm text-muted">{visible.program.enrollment_open ? 'Applications are open. Approval is required before earning through the creator program.' : 'Program enrollment is not open yet. Registering interest does not enroll you or promise earnings.'}</p>{visible.enrollment.status === 'not_enrolled' && <button className={button + ' mt-4'} disabled={busy} onClick={() => void enroll(false)}>{busy ? 'Saving…' : 'Register interest'}</button>}{visible.enrollment.status === 'interested' && visible.program.enrollment_open && visible.program.terms_url && <div className="mt-4 space-y-3"><a className="underline" href={visible.program.terms_url} target="_blank" rel="noreferrer">Read the creator program terms</a><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />I accept the current creator program terms.</label><button className={button} disabled={busy || !accepted} onClick={() => void enroll(true)}>Submit application</button></div>}</section>
      <section className={card}><h2 className="text-lg font-bold">Earnings</h2><p className="mt-1 text-sm text-muted">Recorded creator earnings only. Your IntoBank wallet balance is separate.</p>{visible.balances.length === 0 ? <p className="mt-4">No creator earnings have been recorded.</p> : <dl className="mt-4 grid gap-4 sm:grid-cols-2">{visible.balances.map(balance => <div key={balance.currency + balance.bucket}><dt className="text-sm text-muted">{BALANCE_LABELS[balance.bucket]}</dt><dd className="font-semibold tabular-nums">{formatMinor(balance.amount_minor, balance.currency)}</dd></div>)}</dl>}<p className="mt-4 text-sm text-muted">Pending earnings are not available for payout. Amounts on hold and reversals remain visible here.</p></section>
      <section className={card}><h2 className="text-lg font-bold">Payouts</h2><p className="mt-2 text-sm">{payoutBlockReason(visible) || 'Your payout account is ready. Open Platinum Circles on your phone to request a payout.'}</p><p className="mt-2 text-sm text-muted">Payout account: {visible.payout_account.status.replaceAll('_', ' ')}. A payout is shown as paid only after provider confirmation.</p>{visible.recent_payouts.length === 0 ? <p className="mt-4">No payout requests recorded.</p> : <ul className="mt-4 space-y-3">{visible.recent_payouts.map(p => <li key={p.id}><strong>{formatMinor(p.amount_minor, p.currency)}</strong> · {PAYOUT_LABELS[p.status]}<p className="text-xs text-muted">{new Date(p.created_at).toLocaleString()} · {p.provider_id}{p.provider_reference ? ` · Reference ${p.provider_reference}` : ''}</p></li>)}</ul>}</section>
      {visible.recent_earnings.length > 0 && <section className={card}><h2 className="text-lg font-bold">Recent activity</h2><p className="mt-1 text-sm text-muted">Latest {visible.recent_earnings.length} transactions.</p><ul className="mt-4 space-y-3">{visible.recent_earnings.map(e => <li key={e.id}><strong>{formatMinor(e.amount_minor, e.currency)}</strong> · {earningActivityLabel(e.from, e.to)}<p className="text-xs text-muted">{new Date(e.created_at).toLocaleString()}</p></li>)}</ul></section>}
      <CreatorCommercePanel key={visible.user_id} owner={visible.user_id} approved={visible.enrollment.status === 'approved'} />
      <p className="text-xs text-muted">Updated {new Date(visible.as_of).toLocaleString()}.</p>
    </>}
    <Link href="/settings/support" className="inline-flex min-h-11 items-center underline">Get help with monetization</Link>
  </div>;
}
