import Link from 'next/link';
import { paymentSearch, paymentHref, paymentDecimal, paymentVolumes, PAYMENT_STATUSES, type PaymentSearch } from '@/lib/paymentPage';
import { requireDesk } from '@/lib/adminAuth';

import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';
import { Desk, StatStrip, type DeskRow, type Tone } from '@/components/Desk';
import { Donut, StackBars, Empty, type Slice } from '@/components/Viz';
import { fmt, ago } from '@/lib/fmt';
import { isPaymentInFlight, paymentCurrency } from '@/lib/paymentReporting';

export const dynamic = 'force-dynamic';

const PANEL: React.CSSProperties = { borderRadius: 13, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)', overflow: 'hidden' };
const HEAD: React.CSSProperties = { padding: '14px 16px 12px', borderBottom: '1px solid rgba(var(--on),0.10)' };
const H_TITLE: React.CSSProperties = { fontSize: 13.5, fontWeight: 700, color: 'var(--txt)' };
const H_SUB: React.CSSProperties = { fontSize: 11.3, color: 'var(--txt-muted)', marginTop: 3 };

const IC = {
  money: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 15.9V19h-2v-1.1c-1.6-.3-2.8-1.3-2.9-2.9h2c.1.7.8 1.2 1.9 1.2 1.2 0 1.8-.5 1.8-1.2 0-.6-.5-1-1.8-1.3-2.2-.5-3.7-1.2-3.7-3 0-1.5 1.2-2.5 2.7-2.8V7h2v1c1.5.3 2.6 1.2 2.7 2.7h-2c-.1-.7-.6-1.1-1.6-1.1-1.1 0-1.7.4-1.7 1.1 0 .6.6.9 2 1.2 2.2.5 3.5 1.2 3.5 3.1 0 1.6-1.2 2.6-2.9 2.9z',
  check: 'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z',
  x: 'M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
  card: 'M3 6a2 2 0 012-2h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6zm2 3h14V7H5v2zm0 3v5h14v-5H5z',
  clock: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 10.6V6h-2v7.4l5.2 3.1 1-1.7-4.2-2.2z',
};

const STATUS_TONE: Record<string, Tone> = { completed: 'ok', failed: 'bad', pending: 'warn', processing: 'warn', refunded: 'info', cancelled: 'neutral' };

function money(n: string, cur?: string) {
  return paymentCurrency(cur ?? null) + ' ' + paymentDecimal(n);
}

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<PaymentSearch> }) {
  const search = paymentSearch(await searchParams);
  const admin = await requireDesk('/payments');
  const svc = serviceClient();

  const now = Date.now();
  const from7 = new Date(now - 7 * 86400000).toISOString();
  const from14 = new Date(now - 14 * 86400000).toISOString();
  const days30 = Array.from({ length: 30 }, (_, i) => new Date(now - (29 - i) * 86400000).toISOString().slice(0, 10));

  const [page, report] = await Promise.all([
    svc.rpc('admin_payment_report', { p_status: search.status, p_query: search.q, p_before: search.before, p_before_id: search.id, p_limit: 50 }),
    svc.rpc('admin_payment_summary'),
  ]);
  if (page.error || report.error || !page.data || !report.data) throw new Error('Payment records could not be loaded. Please retry.');
  const summary = report.data as { status_counts: Record<string, number>; completed_week: number; failed_week: number; failed_previous_week: number;
    volume_week: {currency:string; amount:string; average:string}[]; volume_all: {currency:string;amount:string}[];
    days: {day:string;completed:number;failed:number;other:number}[]; top_recipients: {id:string;full_name:string|null;username:string|null;total:number}[] };
  const rowsRaw = page.data.rows as {
    id: string; sender_id: string; recipient_id: string; amount: string; currency: string | null;
    status: string; tx_id: string | null; note: string | null; error: string | null; listing_id: string | null;
    created_at: string; completed_at: string | null;
    sender_name: string|null; sender_username:string|null; sender_avatar:string|null;
    recipient_name:string|null;recipient_username:string|null;recipient_avatar:string|null;
  }[];

  const people: Record<string, { full_name: string|null; username: string|null; avatar_url: string|null }> = {};
  rowsRaw.forEach(row => {
    people[row.sender_id] = { full_name: row.sender_name, username: row.sender_username, avatar_url: row.sender_avatar };
    people[row.recipient_id] = { full_name: row.recipient_name, username: row.recipient_username, avatar_url: row.recipient_avatar };
  });
  summary.top_recipients.forEach(row => { people[row.id] = {full_name:row.full_name,username:row.username,avatar_url:null}; });
  const nameOf = (id: string) => people[id]?.full_name || '@' + (people[id]?.username || 'member');
  const amt = (r: { amount: string }) => r.amount;
  const volWeek = paymentVolumes(summary.volume_week);
  const volAll = paymentVolumes(summary.volume_all);
  const avgTicket = paymentVolumes(summary.volume_week, true);
  const statusCount = summary.status_counts;
  const totalTransfers = Object.values(statusCount).reduce((a,b)=>a+b,0);
  const inFlight = (statusCount.pending ?? 0) + (statusCount.processing ?? 0);
  const settled = (statusCount.completed ?? 0) + (statusCount.failed ?? 0);
  const successRate = settled ? (statusCount.completed ?? 0) / settled * 100 : 0;
  const dayRows = days30.map(day => ({day,completed:0,failed:0,other:0,...summary.days.find(row=>row.day===day)}));
  const STATUS_COLOR: Record<string, string> = { completed: 'var(--ok)', failed: 'var(--bad)', pending: 'var(--warn)', processing: 'var(--c3)', refunded: 'var(--info)', cancelled: 'rgba(var(--on),0.2)' };
  const statusSlices: Slice[] = Object.keys(statusCount).map((k) => ({ label: k.charAt(0).toUpperCase() + k.slice(1), value: statusCount[k], color: STATUS_COLOR[k] || 'var(--c4)' }));

  const topReceivers = summary.top_recipients.map(row => [row.id,row.total] as const);
  const recMax = Math.max(1, ...topReceivers.map(row => row[1]));
  const cards = [
    { label: 'Completed volume, 7 days', value: volWeek, note: 'All completed transfers, by currency', icon: IC.money, color: 'var(--c2)' },
    { label: 'Completed, 7 days', value: fmt(summary.completed_week), note: 'By completion date', icon: IC.check, color: 'var(--c1)' },
    { label: 'Failed, 7 days', value: fmt(summary.failed_week), note: 'By creation date', icon: IC.x, color: 'var(--c5)' },
    { label: 'Success rate', value: settled ? successRate.toFixed(1) + '%' : '—', note: 'Completed ÷ (completed + failed)', icon: IC.card, color: 'var(--c6)' },
    { label: 'Average transfer', value: avgTicket, note: 'By currency, completed in 7 days', icon: IC.clock, color: 'var(--c3)' },
  ];

  const rows: DeskRow[] = rowsRaw.map(r => {
    const tone = STATUS_TONE[r.status] || 'neutral';
    const fields = [
      { label: 'Amount', value: money(amt(r), r.currency || undefined) },
      { label: 'Status', value: r.status },
      { label: 'From', value: nameOf(r.sender_id) },
      { label: 'To', value: nameOf(r.recipient_id) },
      { label: 'Created', value: new Date(r.created_at).toLocaleString() },
    ];
    if (r.completed_at) fields.push({ label: 'Completed', value: new Date(r.completed_at).toLocaleString() });
    if (r.tx_id) fields.push({ label: 'Reference', value: r.tx_id });
    if (r.currency) fields.push({ label: 'Currency', value: r.currency.toUpperCase() });
    if (r.listing_id) fields.push({ label: 'Against listing', value: r.listing_id });
    return {
      id: r.id,
      tabs: [r.status === 'completed' ? 'completed' : r.status === 'failed' ? 'failed' : isPaymentInFlight(r.status) ? 'pending' : 'other', r.listing_id ? 'listing' : 'direct'],
      search: [nameOf(r.sender_id), nameOf(r.recipient_id), r.tx_id, r.status, r.note, String(amt(r))].map(x => String(x || '').toLowerCase()).join(' '),
      facets: { status: r.status },
      cells: [
        { t: 'mono', v: money(amt(r), r.currency || undefined), tone: r.status === 'failed' ? 'bad' : undefined },
        { t: 'user', v: nameOf(r.sender_id), sub: 'sender', img: people[r.sender_id]?.avatar_url },
        { t: 'user', v: nameOf(r.recipient_id), sub: 'recipient', img: people[r.recipient_id]?.avatar_url },
        { t: 'pill', v: r.status.charAt(0).toUpperCase() + r.status.slice(1), tone },
        { t: 'mono', v: r.error ? 'error' : (r.tx_id ? r.tx_id.slice(0, 12) : '-') },
        { t: 'mono', v: ago(r.created_at) },
      ],
      detail: {
        title: money(amt(r), r.currency || undefined),
        subtitle: nameOf(r.sender_id) + ' to ' + nameOf(r.recipient_id),
        pills: [{ v: r.status.charAt(0).toUpperCase() + r.status.slice(1), tone }, ...(r.listing_id ? [{ v: 'Marketplace', tone: 'info' as Tone }] : [])],
        fields,
        body: [
          ...(r.note ? [{ label: 'Note from the sender', text: r.note }] : []),
          ...(r.error ? [{ label: 'Failure reported by the rail', text: r.error }] : []),
        ],
        links: [
          { label: 'Open sender', href: '/users/' + r.sender_id },
          { label: 'Open recipient', href: '/users/' + r.recipient_id },
        ],
      },
    };
  });

  const tabs = [
    { key: 'all', label: 'This page', count: rows.length },
    { key: 'completed', label: 'Completed', count: rows.filter(r => r.tabs.includes('completed')).length },
    { key: 'failed', label: 'Failed', count: rows.filter(r => r.tabs.includes('failed')).length },
    { key: 'pending', label: 'In flight', count: rows.filter(r => r.tabs.includes('pending')).length },
    { key: 'other', label: 'Other outcomes', count: rows.filter(r => r.tabs.includes('other')).length },
    { key: 'listing', label: 'Marketplace', count: rows.filter(r => r.tabs.includes('listing')).length },
  ];

  return (
    <Shell admin={admin} active="/payments" title="Payments" sub={fmt(totalTransfers) + ' transfers. Completed value: ' + volAll + '. ' + fmt(inFlight) + ' pending or processing. Reporting dates use UTC.'}>
      <StatStrip cards={cards} />
      {['super_admin','platform_admin','finance_admin'].includes(admin.role) && <Link href="/payments/creators" className="inline-flex min-h-11 items-center underline">Creator finance and reviews</Link>}
      <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
        <label>Search all transfers<input name="q" defaultValue={search.q} maxLength={100} placeholder="Member, reference or amount" className="block rounded border p-2" /></label>
        <label>Status<select name="status" defaultValue={search.status} className="block rounded border p-2">{PAYMENT_STATUSES.map(status=><option key={status} value={status}>{status.replaceAll('_',' ')}</option>)}</select></label>
        <button type="submit" className="rounded border px-4 py-2">Search</button>
        <Link href="/payments/creators" className="rounded border px-4 py-2">Creator finance</Link>
      </form>
      <nav aria-label="Payment pages" className="mt-3 flex justify-between text-sm">
        <Link href={paymentHref(search.status,search.q)}>Newest</Link>
        <span>{rowsRaw.length} transfers on this page</span>
        {page.data.has_more ? <Link href={paymentHref(search.status,search.q,page.data.next_cursor)}>Older transfers →</Link> : <span>End of results</span>}
      </nav>

      <div className="mt-4" style={PANEL}>
        <div style={HEAD}>
          <div style={H_TITLE}>Transfers created by day</div>
          <div style={H_SUB}>Transfer counts by current status, last 30 days (UTC), all matching dates</div>
        </div>
        <div style={{ padding: '18px 16px 14px' }}>
          <StackBars days={dayRows} series={[
            { key: 'completed', label: 'Completed', color: 'var(--ok)' },
            { key: 'failed', label: 'Failed', color: 'var(--bad)' },
            { key: 'other', label: 'In flight', color: 'var(--warn)' },
          ]} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_340px]">
        <div>
          <Desk
            tabs={tabs}
            columns={[{ label: 'Amount' }, { label: 'From' }, { label: 'To' }, { label: 'Status' }, { label: 'Reference' }, { label: 'When', align: 'right' }]}
            grid="96px minmax(150px,1.3fr) minmax(150px,1.3fr) 110px 110px 92px"
            rows={rows}
            filters={[{ key: 'status', label: 'Status', options: Object.keys(statusCount) }]}
            searchHint="Filter this page"
            detailTitle="Transfer details"
            minWidth={860}
          />
        </div>

        <div>
          <div style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Where transfers end up</div>
              <div style={H_SUB}>Status across all transfers</div>
            </div>
            <div style={{ padding: 16 }}>
              <Donut slices={statusSlices} centerLabel="transfers" size={150} />
            </div>
          </div>

          <div className="mt-4" style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Who is being paid</div>
              <div style={H_SUB}>Most completed transfers received across all records</div>
            </div>
            <div style={{ padding: 16 }}>
              {topReceivers.length === 0 ? <Empty note="No completed transfer yet." /> : topReceivers.map(([id, total]) => (
                <div key={id} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 5 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameOf(id)}</span>
                    <span className="pc-num" style={{ fontSize: 11.4, fontWeight: 600, color: 'var(--txt)' }}>{fmt(total)} transfers</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 4, background: 'rgba(var(--on),0.06)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: Math.max(2, (total / recMax) * 100) + '%', borderRadius: 4, background: 'var(--ok)' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
