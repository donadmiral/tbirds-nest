import Link from 'next/link';
import { MarketOrders } from '@/components/MarketOrders';
export default function OrdersPage() {
  return <main className="mx-auto max-w-3xl px-4 py-5"><Link href="/market" className="text-sm underline">Back to Market</Link><MarketOrders /></main>;
}
