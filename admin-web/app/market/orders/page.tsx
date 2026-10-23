import Link from 'next/link';
import { requireDesk } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';
import { marketOrderSearch, marketOrdersHref, MARKET_ORDER_STATUSES, type MarketOrderSearch } from '@/lib/marketOrders';
import { orderMoney, orderStatus, type MarketOrder, type OrderPage } from '../../../../shared/marketOrders';
export const dynamic = 'force-dynamic';
export default async function MarketOrdersPage({ searchParams }: { searchParams: Promise<MarketOrderSearch> }) {
  const admin = await requireDesk('/market');
  const search = marketOrderSearch(await searchParams);
  const { data, error } = await serviceClient().rpc('admin_market_orders', { p_status: search.status, p_before: search.before, p_before_id: search.id, p_limit: 50 });
  if (error || !data) throw new Error('Orders could not be loaded. Please retry.');
  const page = data as Omit<OrderPage, 'rows'> & { rows: (MarketOrder & {buyer_name: string|null; seller_name: string|null})[] };
  return <Shell admin={admin} active="/market" title="Marketplace orders" sub="Investigate fulfillment, returns, disputes and verified payment receipts.">
    <div className="mb-5 flex flex-wrap gap-3"><Link href="/market" className="underline">Listings</Link><Link href={marketOrdersHref(search.status)} className="underline">Refresh orders</Link></div>
    <form className="mb-5 flex flex-wrap items-end gap-3"><label className="text-sm">Order status<select name="status" defaultValue={search.status} className="ml-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3">{MARKET_ORDER_STATUSES.map(status=><option key={status} value={status}>{status==='any'?'All statuses':orderStatus[status]}</option>)}</select></label><button className="rounded-lg border border-[var(--line)] px-4 py-3">Apply</button></form>
    <p className="mb-3 text-sm text-[var(--txt-muted)]">Newest first. Showing {page.rows.length} orders on this page. Payment is complete only when a verified IntoBank receipt is present.</p>
    <div className="overflow-x-auto rounded-xl border border-[var(--line)]"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b border-[var(--line)]">{['Order','Buyer / seller','Status','Total','Created'].map(label=><th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{page.rows.map(order=><tr className="border-b border-[var(--line)]" key={order.id}>
      <td className="p-3"><Link className="font-semibold underline" href={'/market/orders/'+order.id}>{order.title} × {order.quantity}</Link><div className="text-xs text-[var(--txt-muted)]">{order.id}</div></td>
      <td className="p-3"><Link href={'/users/'+order.buyer_id}>{order.buyer_name||order.buyer_id}</Link><div className="text-[var(--txt-muted)]"><Link href={'/users/'+order.seller_id}>{order.seller_name||order.seller_id}</Link></div></td>
      <td className="p-3">{orderStatus[order.status]}</td><td className="p-3 whitespace-nowrap">{orderMoney(order.total_minor,order.currency)}</td><td className="p-3">{new Date(order.created_at).toLocaleString('en-GB',{timeZone:'UTC'})} UTC</td>
    </tr>)}</tbody></table>{!page.rows.length&&<p className="p-6 text-sm">No orders match this status.</p>}</div>
    <div className="mt-5 flex gap-4">{search.before&&<Link className="underline" href={marketOrdersHref(search.status)}>Newest orders</Link>}{page.has_more&&page.next_cursor&&<Link className="underline" href={marketOrdersHref(search.status,page.next_cursor)}>Older orders</Link>}</div>
  </Shell>;
}
