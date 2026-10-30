'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Package, RefreshCw, MessageCircle, History, ShieldCheck, ArrowLeft } from 'lucide-react';
import { ProductDialog } from '@/components/ProductDialog';
import styles from '@/app/market/MarketWorkspace.module.css';
import { createOrderRequest, orderTimeout, orderRejected } from '../../shared/orderRequest';
import { createClient } from '@/lib/supabase/client';
import { orderActions, orderError, orderMoney, orderStatus, type MarketOrder, type OrderCursor, type OrderListing, type OrderPage, type OrderAction } from '../../shared/marketOrders';

export function MarketOrders({ listing }: { listing?: OrderListing & { title?: string; price?: number } }) {
  const [db] = useState(createClient); const [uid, setUid] = useState(''); const [rows, setRows] = useState<MarketOrder[]>([]);
  const [cursor, setCursor] = useState<OrderCursor | null>(null); const [more, setMore] = useState(false); const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [quantity, setQuantity] = useState('1');
  const [fulfilment, setFulfilment] = useState('pickup'); const [instructions, setInstructions] = useState('');
  const reading = useRef(false); const generation = useRef(0); const owner = useRef(''); const lock = useRef(false); const request = useRef(createOrderRequest<{p_expected_user:string;p_listing_id:string|undefined;p_quantity:number;p_fulfilment:string;p_instructions:string}>());
  const scope = useRef(0); const [pendingRequest, setPendingRequest] = useState(false);
  const listingId = listing?.id;
  const [reviewOrder, setReviewOrder] = useState(false);
  const [reviewAction, setReviewAction] = useState<{ order: MarketOrder; action: OrderAction } | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const load = useCallback(async (user: string, next?: OrderCursor | null) => {
    if(reading.current||owner.current!==user)return;reading.current=true;
    const run = ++generation.current; setLoading(true);
    try {
      const { data, error: err } = await orderTimeout(db.rpc('get_market_orders', { p_listing_id: listingId || null, p_before: next?.created_at || null, p_before_id: next?.id || null, p_limit: 20 }));
      if (err) throw err;
      if (run !== generation.current || owner.current !== user) return;
      const page = data as OrderPage;
      setRows(old => next ? [...old, ...page.rows.filter(r => !old.some(x => x.id === r.id))] : page.rows);
      setCursor(page.next_cursor); setMore(page.has_more); setError(''); if (!next) setExpanded(new Set());
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
      setReviewOrder(false); setReviewAction(null); setActionNote(''); setExpanded(new Set());
      if (id) void load(id); else setLoading(false);
    };
    const { data: subscription } = db.auth.onAuthStateChange((_event, session) => { apply(session?.user.id || ''); });
    void orderTimeout(db.auth.getSession()).then(({ data, error: err }) => { if (err) throw err; if (identity === undefined) apply(data.session?.user.id || ''); }).catch(() => { if (active && identity === undefined) { setLoading(false); setError('Your session could not be checked. Reload to try again.'); } });
    return () => { active = false; owner.current = ''; scope.current++; generation.current++; subscription.subscription.unsubscribe(); };
  }, [db, load, sessionAttempt]);
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
      setReviewOrder(false); setReviewAction(null); setActionNote('');
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
    if (expanded.has(order.id)) { setExpanded(previous => { const next = new Set(previous); next.delete(order.id); return next; }); return; }
    const epoch = scope.current, run = generation.current; lock.current = true; setBusy(true);
    try {
      const { data, error: err } = await orderTimeout(db.rpc('get_market_order', { p_id: order.id }));
      if (err) throw err;
      if (epoch === scope.current && run === generation.current) { setRows(old => old.map(o => o.id === order.id ? data as MarketOrder : o)); setExpanded(previous => new Set(previous).add(order.id)); }
    } catch (e) { if (epoch === scope.current) setError(orderError(e)); }
    finally { if (epoch === scope.current) { lock.current = false; setBusy(false); } }
  }
  const button = styles.button;
  return <section className={styles.orders} aria-label="Marketplace orders">
    <div className={styles.ordersHeading}><h2>{listing ? 'Order this item' : 'Your orders'}</h2>{uid ? <button className={button} onClick={() => void load(uid)} disabled={loading || busy}><RefreshCw size={16} aria-hidden />Refresh</button> : null}</div>
    {!uid && !loading && !error ? <div className={styles.panel}><p className={styles.help}>Sign in to request and manage orders.</p><Link href="/login" className={styles.primary + " mt-3"}>Sign in</Link></div> : null}
    {uid && listing && listing.seller_id !== uid && (pendingRequest || (listing.status === 'available' && (listing.stock_quantity ?? 1) > 0)) ? <form className={styles.form + " " + styles.panel} onSubmit={event => { event.preventDefault(); if (pendingRequest) void mutate(); else { setError(''); setReviewOrder(true); } }}>
      <p className={styles.help}>Request an order at the listing price. The seller confirms stock before payment.</p>
      <div className={styles.fields}><label>Quantity<input type="number" min="1" step="1" disabled={busy || pendingRequest} max={Math.min(100, listing.stock_quantity ?? 100)} required value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
        <label>Fulfilment<select aria-label="Fulfilment" disabled={busy || pendingRequest} value={fulfilment} onChange={event => setFulfilment(event.target.value)}><option value="pickup">Pickup</option>{listing.delivery_available ? <option value="delivery">Seller-arranged delivery</option> : null}</select></label></div>
      <label>{fulfilment === 'delivery' ? 'Delivery details (shared with the seller)' : 'Pickup notes (optional)'}<textarea aria-label={fulfilment === 'delivery' ? 'Delivery details (shared with the seller)' : 'Pickup notes (optional)'} disabled={busy || pendingRequest} maxLength={1000} minLength={fulfilment === 'delivery' ? 5 : undefined} required={fulfilment === 'delivery'} value={instructions} onChange={event => setInstructions(event.target.value)} rows={3} /></label>
      <button type="submit" disabled={busy || loading} className={styles.primary}>{pendingRequest ? 'Retry same order request' : 'Review order request'}</button>
      {pendingRequest ? <p className={styles.notice}>The result is being checked. Retry this same request to avoid creating a duplicate.</p> : null}
      <p className={styles.help}>Payment uses IntoBank on your phone. Delivery is arranged with the seller; requesting an order does not charge you.</p>
    </form> : null}
    {error && !reviewOrder && !reviewAction ? <div role="alert" className={styles.notice}><p className={styles.error}>{error}</p>{!uid ? <button className={button} onClick={() => setSessionAttempt(value => value + 1)}>Try again</button> : null}</div> : null}
    {loading ? <p role="status" className={styles.help}>Loading orders…</p> : null}
    {!loading && uid && !rows.length && !error ? <div className={styles.notice}><Package size={20} aria-hidden /><div><strong>No orders yet</strong><p className={styles.help}>Order requests and updates will appear here.</p>{!listing ? <Link href="/market" className={styles.button + " mt-3"}>Browse the market</Link> : null}</div></div> : null}
    {rows.map(order => <article key={order.id} className={styles.order}>
      <div className={styles.orderHeading}><Link href={'/market/' + order.listing_id}>{order.title} × {order.quantity}</Link><strong>{orderMoney(order.total_minor, order.currency)}</strong></div>
      <span className={styles.orderStatus} data-status={order.status}>{orderStatus[order.status]}</span>
      <p className={styles.help}>{order.fulfilment === 'pickup' ? 'Pickup' : 'Seller-arranged delivery'} · {uid === order.seller_id ? 'Selling' : 'Buying'}</p>
      <p className={styles.help}>Order {order.id.slice(0, 8)} · {new Date(order.created_at).toLocaleString()}</p>
      {order.instructions ? <p className={styles.description}>{order.instructions}</p> : null}
      {order.status === 'awaiting_payment' ? <p className={styles.notice}><ShieldCheck size={19} aria-hidden /><span>{order.payment_id ? 'Payment is being checked. Open Chat Pay on your phone to check its status.' : 'Open this order in Platinum Circles on your phone to review and pay with IntoBank.'}{order.expires_at && !order.payment_id ? ' Reservation expires ' + new Date(order.expires_at).toLocaleString() + '.' : ''}</span></p> : null}
      {['return_requested','return_approved','returned','disputed'].includes(order.status) ? <p className={styles.help}>This records the issue and return status. A refund is only complete when IntoBank confirms it. Keep delivery and payment evidence.</p> : null}
      <div className={styles.actions}>
        {order.conversation_id ? <Link className={button} href={'/market/messages?c=' + encodeURIComponent(order.conversation_id)}><MessageCircle size={16} aria-hidden />Message {uid === order.seller_id ? 'buyer' : 'seller'}</Link> : null}
        {orderActions(order, uid).map(action => <button key={action.id} className={button} disabled={busy || loading} onClick={() => { setError(''); setActionNote(''); setReviewAction({ order, action }); }}>{action.label}</button>)}
        <button className={button} disabled={busy || loading} aria-expanded={expanded.has(order.id)} onClick={() => void history(order)}><History size={16} aria-hidden />{expanded.has(order.id) ? 'Hide history' : 'History'}</button>
      </div>
      {expanded.has(order.id) && order.events ? <ol className={styles.orderHistory}>{order.events.length ? order.events.map(event => <li key={event.id}><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time><span>{event.kind.replaceAll('_', ' ')}{event.note ? ': ' + event.note : ''}</span></li>) : <li>No order history is available.</li>}</ol> : null}
    </article>)}
    {more ? <button className={button} disabled={loading || busy} onClick={() => void load(uid, cursor)}>Load more orders</button> : null}
    <ProductDialog open={reviewOrder} title="Review order request" description={listing?.title ?? 'Check the details before sending your request.'} busy={busy} onClose={() => setReviewOrder(false)}>
      <dl className={styles.review}><div><dt>Quantity</dt><dd>{quantity}</dd></div><div><dt>Fulfilment</dt><dd>{fulfilment === 'pickup' ? 'Pickup' : 'Seller-arranged delivery'}</dd></div>{instructions.trim() ? <div><dt>{fulfilment === 'delivery' ? 'Delivery details' : 'Pickup notes'}</dt><dd>{instructions.trim()}</dd></div> : null}</dl>
      <p className={styles.notice}><ShieldCheck size={20} aria-hidden />The seller confirms stock and the order total before payment. This request does not charge you. Payment is reviewed in Platinum Circles on your phone.</p>
      {error ? <p role="alert" className={styles.error + " mt-3"}>{error}</p> : null}
      <div className={styles.actions + " mt-5"}><button type="button" disabled={busy} onClick={() => setReviewOrder(false)} className={button}><ArrowLeft size={16} aria-hidden />{pendingRequest ? 'Back to order' : 'Edit request'}</button><button type="button" disabled={busy || loading} onClick={() => void mutate()} className={styles.primary}>{busy ? 'Sending…' : pendingRequest ? 'Retry same order request' : 'Request order'}</button></div>
    </ProductDialog>
    <ProductDialog open={reviewAction !== null} title={reviewAction?.action.label ?? 'Review order change'} description={reviewAction?.order.title} busy={busy} onClose={() => setReviewAction(null)}>
      {reviewAction ? <form className={styles.form} onSubmit={event => { event.preventDefault(); if (reviewAction.action.note && actionNote.trim().length < 5) { setError('Add at least five characters of detail.'); return; } void mutate(reviewAction.order, reviewAction.action.id, actionNote.trim()); }}>
        <p className={styles.help}>{['complete','returned'].includes(reviewAction.action.id) ? 'Only confirm when the item has been received. This records the order status; any refund must still be confirmed by IntoBank.' : 'Review this change before updating the order. The other person will see the new status.'}</p>
        {reviewAction.action.note ? <label>{reviewAction.action.note}<textarea aria-label={reviewAction.action.note} required minLength={5} maxLength={1000} rows={4} value={actionNote} onChange={event => setActionNote(event.target.value)} disabled={busy} /></label> : null}
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        <div className={styles.actions}><button type="button" disabled={busy} onClick={() => setReviewAction(null)} className={button}>Cancel</button><button type="submit" disabled={busy || loading} className={styles.primary}>{busy ? 'Saving…' : reviewAction.action.label}</button></div>
      </form> : null}
    </ProductDialog>
  </section>;
}
