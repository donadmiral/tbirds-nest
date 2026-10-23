'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createOrderRequest, orderTimeout, orderRejected } from '../../shared/orderRequest';
import { createClient } from '@/lib/supabase/client';
import { orderActions, orderError, orderMoney, orderStatus, type MarketOrder, type OrderCursor, type OrderListing, type OrderPage } from '../../shared/marketOrders';

export function MarketOrders({ listing }: { listing?: OrderListing }) {
  const [db] = useState(createClient); const [uid, setUid] = useState(''); const [rows, setRows] = useState<MarketOrder[]>([]);
  const [cursor, setCursor] = useState<OrderCursor | null>(null); const [more, setMore] = useState(false); const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [quantity, setQuantity] = useState('1');
  const [fulfilment, setFulfilment] = useState('pickup'); const [instructions, setInstructions] = useState('');
  const reading = useRef(false); const generation = useRef(0); const owner = useRef(''); const lock = useRef(false); const request = useRef(createOrderRequest<{p_expected_user:string;p_listing_id:string|undefined;p_quantity:number;p_fulfilment:string;p_instructions:string}>());
  const scope = useRef(0); const [pendingRequest, setPendingRequest] = useState(false);
  const listingId = listing?.id;
  const load = useCallback(async (user: string, next?: OrderCursor | null) => {
    if(reading.current||owner.current!==user)return;reading.current=true;
    const run = ++generation.current; setLoading(true);
    try {
      const { data, error: err } = await orderTimeout(db.rpc('get_market_orders', { p_listing_id: listingId || null, p_before: next?.created_at || null, p_before_id: next?.id || null, p_limit: 20 }));
      if (err) throw err;
      if (run !== generation.current || owner.current !== user) return;
      const page = data as OrderPage;
      setRows(old => next ? [...old, ...page.rows.filter(r => !old.some(x => x.id === r.id))] : page.rows);
      setCursor(page.next_cursor); setMore(page.has_more); setError('');
    } catch (e) { if (run === generation.current && owner.current === user) setError(orderError(e)); }
    finally { if (run === generation.current && owner.current === user) {reading.current=false;setLoading(false);} }
  }, [db, listingId]);
  useEffect(() => {
    let active = true; let identity: string | undefined;
    const apply = (id: string) => {
      if (!active || identity === id) return;
      identity = id; owner.current = id; scope.current++; generation.current++; lock.current = false;reading.current=false;
      request.current.clear(); setPendingRequest(false); setBusy(false); setUid(id); setRows([]); setCursor(null); setMore(false); setError('');
      setQuantity('1'); setFulfilment('pickup'); setInstructions('');
      if (id) void load(id); else setLoading(false);
    };
    const { data: subscription } = db.auth.onAuthStateChange((_event, session) => { apply(session?.user.id || ''); });
    void orderTimeout(db.auth.getSession()).then(({ data, error: err }) => { if (err) throw err; if (identity === undefined) apply(data.session?.user.id || ''); }).catch(() => { if (active && identity === undefined) { setLoading(false); setError('Your session could not be checked. Reload to try again.'); } });
    return () => { active = false; owner.current = ''; scope.current++; generation.current++; subscription.subscription.unsubscribe(); };
  }, [db, load]);
  async function mutate(order?: MarketOrder, action?: string, note = '') {
    if (lock.current || !uid || owner.current !== uid) return;
    const user = uid, epoch = scope.current; lock.current = true; setBusy(true); setError('');
    try {
      const { data: auth, error: authError } = await orderTimeout(db.auth.getSession());
      if (authError) throw authError;
      if (auth.session?.user.id !== user || scope.current !== epoch) throw new Error('ACCOUNT_CHANGED');
      const args = order ? null : request.current.get({ p_expected_user: user, p_listing_id: listingId, p_quantity: Number(quantity), p_fulfilment: fulfilment, p_instructions: instructions }, () => crypto.randomUUID());
      if (args) setPendingRequest(true);
      const { error: err } = order
        ? await orderTimeout(db.rpc('market_order_action', { p_expected_user: user, p_id: order.id, p_version: order.version, p_action: action, p_note: note }))
        : await orderTimeout(db.rpc('create_market_order', args!));
      if (err) throw err;
      if (scope.current !== epoch) return;
      if (!order) { request.current.clear(); setPendingRequest(false); }
      await load(user);
    } catch (e) {
      if (scope.current === epoch) {
        if (!order && orderRejected(e)) { request.current.clear(); setPendingRequest(false); }
        setError(orderError(e));
      }
    } finally { if (scope.current === epoch) { lock.current = false; setBusy(false); } }
  }
  async function history(order: MarketOrder) {
    if (lock.current || !uid) return;
    const epoch = scope.current, run = generation.current; lock.current = true; setBusy(true);
    try {
      const { data, error: err } = await orderTimeout(db.rpc('get_market_order', { p_id: order.id }));
      if (err) throw err;
      if (epoch === scope.current && run === generation.current) setRows(old => old.map(o => o.id === order.id ? data as MarketOrder : o));
    } catch (e) { if (epoch === scope.current) setError(orderError(e)); }
    finally { if (epoch === scope.current) { lock.current = false; setBusy(false); } }
  }
  const button = 'min-h-11 rounded-xl border border-ink/10 px-3 py-2 text-sm font-semibold disabled:opacity-50';
  return <section className="space-y-3 py-5" aria-label="Marketplace orders">
    <div className="flex items-center justify-between gap-3"><h2 className="font-bold text-lg">Orders</h2>{uid && <button className={button} onClick={() => void load(uid)} disabled={loading || busy}>Refresh</button>}</div>
    {!uid && !loading && <Link href="/login" className="text-sm underline">Sign in to request and manage orders</Link>}
    {uid && listing && listing.seller_id !== uid && (pendingRequest || (listing.status === 'available' && (listing.stock_quantity ?? 1) > 0)) && <form className="space-y-3 rounded-xl border border-ink/10 p-4" onSubmit={e => { e.preventDefault(); void mutate(); }}>
      <p className="text-sm">Request an order at the listing price. The seller confirms stock before payment.</p>
      <div className="flex flex-wrap gap-3"><label className="text-sm">Quantity <input aria-label="Quantity" type="number" min="1" disabled={busy || pendingRequest} max={Math.min(100, listing.stock_quantity ?? 100)} required value={quantity} onChange={e => { setQuantity(e.target.value); }} className="ml-2 w-20 rounded-lg border border-ink/10 bg-transparent p-2" /></label>
        <label className="text-sm">Fulfilment <select disabled={busy || pendingRequest} value={fulfilment} onChange={e => { setFulfilment(e.target.value); }} className="ml-2 rounded-lg border border-ink/10 bg-white p-2"><option value="pickup">Pickup</option>{listing.delivery_available && <option value="delivery">Seller-arranged delivery</option>}</select></label></div>
      <label className="block text-sm">{fulfilment === 'delivery' ? 'Delivery details (shared with the seller)' : 'Pickup notes (optional)'}<textarea disabled={busy || pendingRequest} className="mt-1 w-full rounded-lg border border-ink/10 bg-transparent p-2" maxLength={1000} minLength={fulfilment === 'delivery' ? 5 : undefined} required={fulfilment === 'delivery'} value={instructions} onChange={e => { setInstructions(e.target.value); }} /></label>
      <button type="submit" disabled={busy || loading} className={button}>{pendingRequest ? 'Retry same order request' : 'Request order'}</button>{pendingRequest && <p className="text-xs text-muted">The result is being checked. Retry this same request to avoid creating a duplicate.</p>}
      <p className="text-xs text-muted">Payment uses IntoBank on your phone. Delivery is arranged with the seller; requesting an order does not charge you.</p>
    </form>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {loading && <p role="status" className="text-sm text-muted">Loading orders…</p>}
    {!loading && uid && !rows.length && !error && <p className="text-sm text-muted">No orders yet.</p>}
    {rows.map(order => <article key={order.id} className="space-y-3 rounded-xl border border-ink/10 p-4">
      <div className="flex justify-between gap-3"><Link className="font-semibold" href={'/market/' + order.listing_id}>{order.title} × {order.quantity}</Link><span className="shrink-0 text-sm font-semibold">{orderMoney(order.total_minor, order.currency)}</span></div>
      <p className="text-sm">{orderStatus[order.status]} · {order.fulfilment === 'pickup' ? 'Pickup' : 'Seller-arranged delivery'}</p>
      <p className="text-xs text-muted">Order {order.id.slice(0, 8)} · {new Date(order.created_at).toLocaleString()}</p>
      {order.instructions && <p className="whitespace-pre-wrap text-sm">{order.instructions}</p>}
      {order.status === 'awaiting_payment' && <p className="text-sm">{order.payment_id ? 'Payment is being checked. Open Chat Pay on your phone to check its status.' : 'Open this order in Platinum Circles on your phone to review and pay with IntoBank.'}{order.expires_at && !order.payment_id && ' Reservation expires ' + new Date(order.expires_at).toLocaleString() + '.'}</p>}
      {['return_requested','return_approved','returned','disputed'].includes(order.status) && <p className="text-xs text-muted">This records the issue and return status. A refund is only complete when IntoBank confirms it. Keep delivery and payment evidence.</p>}
      <div className="flex flex-wrap gap-2">{order.conversation_id && <Link className={button} href={'/market/messages?c=' + order.conversation_id}>Message {uid === order.seller_id ? 'buyer' : 'seller'}</Link>}
        {orderActions(order, uid).map(action => <button key={action.id} className={button} disabled={busy || loading} onClick={() => { const note = action.note ? window.prompt(action.note) : ''; if (note === null) return; if (action.note && note.trim().length < 5) { setError('Add at least five characters of detail.'); return; } if (['complete','returned'].includes(action.id) && !window.confirm(action.label + '? Only confirm when the item has been received.')) return; void mutate(order, action.id, note); }}>{action.label}</button>)}
        <button className={button} disabled={busy || loading} onClick={() => void history(order)}>History</button></div>
      {order.events && <ol className="space-y-1 border-t border-ink/10 pt-2 text-xs text-muted">{order.events.map(event => <li key={event.id}>{new Date(event.created_at).toLocaleString()} · {event.kind.replaceAll('_', ' ')}{event.note && ': ' + event.note}</li>)}</ol>}
    </article>)}
    {more && <button className={button} disabled={loading || busy} onClick={() => void load(uid, cursor)}>Load more orders</button>}
  </section>;
}
