import Link from 'next/link';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { MarketOrders } from '@/components/MarketOrders';
import styles from '../MarketWorkspace.module.css';
export default function OrdersPage() {
  return <div className={styles.workspace}><Link href="/market" className={styles.back}><ArrowLeft size={17} aria-hidden />Back to Market</Link><header className={styles.header}><div><h1>Orders</h1><p>Track requests, fulfilment and conversations with buyers and sellers.</p></div><Link href="/market/messages" className={styles.button}><MessageCircle size={17} aria-hidden />Market messages</Link></header><MarketOrders /></div>;
}
