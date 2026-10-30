'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { readCreatorCommerce, saveCreatorProduct, type CreatorCommerce, type CreatorProduct } from '../../shared/monetization/commerce';
import { formatMinor, usdToMinor } from '../../shared/monetization/domain';
import { withFinanceDeadline } from '../../shared/monetization/client';
import { REVENUE_SHARES, REVENUE_LABELS, REVENUE_POLICY_VERSION } from '../../shared/monetization/policy';
import { CREATOR_COMMERCE_ENABLED, CREATOR_COMMERCE_UNAVAILABLE } from '../../shared/monetization/availability';

/** Keyed by authenticated owner by the parent; every response also checks it. */
export default function CreatorCommercePanel({ owner, approved }: { owner: string; approved: boolean }) {
  const [client] = useState(createClient);
  const [data, setData] = useState<CreatorCommerce | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(''), [price, setPrice] = useState('');
  const [kind, setKind] = useState<CreatorProduct['kind']>('subscription');
  const [days, setDays] = useState('30');
  const live = useRef(false), lock = useRef(false), generation = useRef(0), draftId = useRef<string | null>(null);
  const load = useCallback(() => {
    const run = ++generation.current;
    return readCreatorCommerce(client, owner).then(result => { if (live.current && run === generation.current) { setData(result); setError(''); } })
      .catch((e: unknown) => { if (live.current && run === generation.current) { setData(null); setError(e instanceof Error ? e.message : 'Could not load creator products.'); } })
      .finally(() => { if (live.current && run === generation.current) setLoading(false); });
  }, [client, owner]);
  useEffect(() => { if (!CREATOR_COMMERCE_ENABLED) return; const requests = generation; live.current = true; void load(); return () => { live.current = false; requests.current++; }; }, [load]);
  async function save(existing?: CreatorProduct) {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try {
      const { data: session, error: sessionError } = await withFinanceDeadline(client.auth.getSession(), 'Your session could not be checked. Refresh to try again.');
      if (sessionError || session.session?.user.id !== owner) throw new Error('Your account changed. Reopen monetization.');
      const product = existing || { id: draftId.current ||= crypto.randomUUID(), title, amount_minor: usdToMinor(price), kind, active: false, period_days: kind === 'subscription' ? Number(days) : null };
      await saveCreatorProduct(client, owner, product);
      if (!live.current) return;
      if (!existing) { draftId.current = null; setTitle(''); setPrice(''); }
      await load();
    } catch (e) { if (live.current) setError(e instanceof Error ? e.message : 'Could not save this product.'); }
    finally { if (live.current) { lock.current = false; setBusy(false); } }
  }
  const input = 'min-h-11 w-full rounded-lg border border-ink/20 bg-surface px-3';
  if (!CREATOR_COMMERCE_ENABLED) return <section className="rounded-xl border border-ink/15 bg-surface p-5" aria-labelledby="creator-products-title"><h2 id="creator-products-title" className="text-lg font-bold">Products and purchases</h2><p className="mt-2 text-sm text-muted">{CREATOR_COMMERCE_UNAVAILABLE}</p></section>;
  return <section className="rounded-xl border border-ink/15 bg-surface p-5" aria-labelledby="creator-products-title">
    <div className="flex items-center justify-between gap-3"><h2 id="creator-products-title" className="text-lg font-bold">Products and purchases</h2><button className="min-h-11 px-2 underline" disabled={loading || busy} onClick={() => { setLoading(true); void load(); }}>Refresh</button></div>
    {error && <p role="alert" className="my-3 text-danger">{error}</p>}
    {loading && !data && <p role="status">Loading products and purchases…</p>}
    {data && <>
      <p className="mt-2 text-sm text-muted">{data.capabilities.purchases_enabled ? 'Sandbox purchases are enabled. These do not transfer real money.' : 'Purchases are not open yet. You can prepare your products below; saving a product does not charge anyone.'} Subscriptions provide prepaid access. Automatic renewal is not enabled.</p>
      {data.refund_balance_minor !== '0' && <p role="status" className="mt-3 text-sm">Refund balance: {formatMinor(data.refund_balance_minor, 'USD')}. Future earnings cover this balance before another payout.</p>}
      <details className="mt-4"><summary className="min-h-11 cursor-pointer py-2">Program revenue shares</summary><dl className="space-y-2 text-sm">{Object.entries(REVENUE_SHARES).map(([key, bps]) => <div key={key} className="flex justify-between gap-3"><dt>{REVENUE_LABELS[key as keyof typeof REVENUE_LABELS]}</dt><dd>{bps / 100}% to creator</dd></div>)}</dl><p className="mt-2 text-xs text-muted">Policy {REVENUE_POLICY_VERSION}. Shares use eligible net revenue after disclosed deductions. Genuine tips go fully to the recipient, without Platinum commission or a benefit attached. No rate guarantees earnings.</p></details>
      {approved && <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
        <h3 className="font-semibold">Prepare a product</h3>
        <label className="block text-sm">Type<select className={input} disabled={busy} value={kind} onChange={e => setKind(e.target.value as CreatorProduct['kind'])}><option value="subscription">Prepaid subscription</option><option value="tip">Genuine tip</option><option value="gift">Digital gift</option></select></label>
        <label className="block text-sm">Name<input className={input} disabled={busy} maxLength={120} required value={title} onChange={e => setTitle(e.target.value)} /></label>
        <label className="block text-sm">Price in USD<input className={input} disabled={busy} inputMode="decimal" required value={price} onChange={e => setPrice(e.target.value)} /></label>
        {kind === 'subscription' && <label className="block text-sm">Access period in days<input className={input} disabled={busy} type="number" min={1} max={366} required value={days} onChange={e => setDays(e.target.value)} /></label>}
        <button disabled={busy} className="min-h-11 rounded-lg bg-pearl px-4 font-semibold text-on-pearl disabled:opacity-50">{busy ? 'Saving…' : 'Save draft product'}</button>
      </form>}
      {data.products.length > 0 && <ul className="mt-4 space-y-3">{data.products.map(p => <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-3"><div><strong>{p.title}</strong><p className="text-sm text-muted">{formatMinor(p.amount_minor, 'USD')}{p.period_days ? ` / ${p.period_days} days` : ''} · {p.active ? 'Listed' : 'Draft'}</p></div>{approved && <button disabled={busy} className="min-h-11 px-3 underline" onClick={() => void save({ ...p, active: !p.active })}>{p.active ? 'Unlist' : 'List product'}</button>}</li>)}</ul>}
      {data.purchases.length > 0 && <><h3 className="mt-5 font-semibold">Recent purchases</h3><ul className="mt-2 space-y-3">{data.purchases.map(p => <li key={p.id}><strong>{p.title}</strong> · {formatMinor(p.amount_minor, 'USD')}<p className="text-sm text-muted">{p.state.replaceAll('_', ' ')} · {new Date(p.created_at).toLocaleString()}{p.refunded_minor !== '0' ? ` · Refunded ${formatMinor(p.refunded_minor, 'USD')}` : ''}</p></li>)}</ul></>}
      {data.subscriptions.length > 0 && <><h3 className="mt-5 font-semibold">Paid access periods</h3><ul className="mt-2 space-y-3">{data.subscriptions.map(s => <li key={s.creator_id + s.starts_at} className="text-sm">{new Date(s.starts_at).toLocaleDateString()}–{new Date(s.ends_at).toLocaleDateString()} · No automatic renewal</li>)}</ul></>}
    </>}
  </section>;
}
