import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireDesk } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { isOrderId } from '@/lib/marketOrders';
import { paymentDecimal } from '@/lib/paymentPage';
import { orderMoney, orderStatus, type MarketOrder } from '../../../../../shared/marketOrders';
import Shell from '@/components/Shell';
export const dynamic = 'force-dynamic';
export default async function MarketOrderPage({ params }: {params: Promise<{id:string}>}) {
  const admin = await requireDesk('/market');
  const {id} = await params; if (!isOrderId(id)) notFound();
  const {data,error} = await serviceClient().rpc('admin_market_order_detail',{p_id:id});
  if(error) throw new Error('The order could not be loaded. Please retry.');
  if(!data) notFound();
  const order = data as MarketOrder & {payment:{id:string;status:string;tx_id:string|null;amount:string;currency:string}|null};
  const fields = [
    ['Order ID',order.id],['Status',orderStatus[order.status]],['Quantity',String(order.quantity)],
    ['Item price',orderMoney(order.unit_minor,order.currency)],['Delivery',orderMoney(order.delivery_minor,order.currency)],['Total',orderMoney(order.total_minor,order.currency)],
    ['Fulfillment',order.fulfilment==='pickup'?'Pickup':'Seller-arranged delivery'],['Stock reservation',order.reservation],['Version',String(order.version)],
    ['Created',order.created_at],['Last updated',order.updated_at],['Reservation expires',order.expires_at||'Not applicable'],
  ];
  return <Shell admin={admin} active="/market" title={order.title} sub="Order evidence and payment status. Returns and disputes do not themselves issue a refund.">
    <Link className="underline" href="/market/orders">All orders</Link>
    <div className="mt-5 grid gap-5 lg:grid-cols-2"><section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5"><h2 className="mb-4 font-semibold">Order details</h2><dl className="grid gap-3">{fields.map(([label,value])=><div key={label} className="flex flex-wrap justify-between gap-2 text-sm"><dt className="text-[var(--txt-muted)]">{label}</dt><dd className="break-all">{value}</dd></div>)}</dl><p className="mt-4 whitespace-pre-wrap text-sm">{order.instructions||'No delivery or pickup instructions.'}</p><div className="mt-4 flex flex-wrap gap-4 text-sm"><Link className="underline" href={'/users/'+order.buyer_id}>Buyer</Link><Link className="underline" href={'/users/'+order.seller_id}>Seller</Link><Link className="underline" href="/market">Listings desk</Link></div></section>
    <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5"><h2 className="mb-4 font-semibold">IntoBank payment</h2>{order.payment?<dl className="space-y-3 text-sm">{[['Payment ID',order.payment.id],['Status',order.payment.status],['Amount',order.payment.currency+' '+paymentDecimal(order.payment.amount)],['Verified transaction',order.payment.tx_id||'No confirmed receipt']].map(([label,value])=><div key={label}><dt className="text-[var(--txt-muted)]">{label}</dt><dd className="break-all">{value}</dd></div>)}</dl>:<p className="text-sm">No payment is attached to this order.</p>}<p className="mt-5 text-sm text-[var(--txt-muted)]">Use the order ID and transaction reference when escalating payment issues. Confirm a refund with IntoBank before communicating that money has been returned.</p></section></div>
    <section className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5"><h2 className="mb-4 font-semibold">Order history</h2>{order.events?.length?<ol className="space-y-4">{order.events.map(event=><li key={event.id} className="border-l-2 border-[var(--line)] pl-4 text-sm"><p className="font-semibold">{event.kind.replaceAll('_',' ')}</p><p className="text-[var(--txt-muted)]">{event.created_at}</p>{event.note&&<p className="mt-1 whitespace-pre-wrap">{event.note}</p>}</li>)}</ol>:<p className="text-sm">No history is available.</p>}</section>
  </Shell>;
}
