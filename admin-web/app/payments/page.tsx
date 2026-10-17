import { requireDesk } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';
import { Desk, StatStrip, type DeskRow, type Tone } from '@/components/Desk';
import { Donut, StackBars, Empty, type Slice } from '@/components/Viz';
import { fmt, ago } from '@/lib/fmt';
import { isPaymentInFlight, paymentCurrency, paymentTotals } from '@/lib/paymentReporting';

export const dynamic = 'force-dynamic';

const PANEL: React.CSSProperties = { borderRadius: 13, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)', overflow: 'hidden' };
const HEAD: React.CSSProperties = { padding: '14px 16px 12px', borderBottom: '1px solid rgba(var(--on),0.10)' };
const H_TITLE: React.CSSProperties = { fontSize: 13.5, fontWeight: 700, color: 'var(--txt)' };
const H_SUB: React.CSSProperties = { fontSize: 11.3, color: 'rgba(var(--on),0.36)', marginTop: 3 };

const IC = {
  money: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 15.9V19h-2v-1.1c-1.6-.3-2.8-1.3-2.9-2.9h2c.1.7.8 1.2 1.9 1.2 1.2 0 1.8-.5 1.8-1.2 0-.6-.5-1-1.8-1.3-2.2-.5-3.7-1.2-3.7-3 0-1.5 1.2-2.5 2.7-2.8V7h2v1c1.5.3 2.6 1.2 2.7 2.7h-2c-.1-.7-.6-1.1-1.6-1.1-1.1 0-1.7.4-1.7 1.1 0 .6.6.9 2 1.2 2.2.5 3.5 1.2 3.5 3.1 0 1.6-1.2 2.6-2.9 2.9z',
  check: 'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z',
  x: 'M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
  card: 'M3 6a2 2 0 012-2h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6zm2 3h14V7H5v2zm0 3v5h14v-5H5z',
  clock: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 10.6V6h-2v7.4l5.2 3.1 1-1.7-4.2-2.2z',
};

const STATUS_TONE: Record<string, Tone> = { completed: 'ok', failed: 'bad', pending: 'warn', processing: 'warn', refunded: 'info', cancelled: 'neutral' };

function money(n: number, cur?: string) {
  return paymentCurrency(cur ?? null) + ' ' + n.toFixed(2);
}

export default async function PaymentsPage() {
  const admin = await requireDesk('/payments');
  const svc = serviceClient();

  const now = Date.now();
  const from7 = new Date(now - 7 * 86400000).toISOString();
  const from14 = new Date(now - 14 * 86400000).toISOString();
  const days30 = Array.from({ length: 30 }, (_, i) => new Date(now - (29 - i) * 86400000).toISOString().slice(0, 10));

  const { data, error } = await svc.from('chat_payments')
    .select('id, sender_id, recipient_id, amount, currency, status, tx_id, note, error, listing_id, created_at, completed_at')
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(500);
  if (error) return <Shell admin={admin} active="/payments" title="Payments" sub="Payment records could not be loaded."><p role="alert">Please refresh this page to try again.</p></Shell>;
  const rowsRaw = (data ?? []) as {
    id: string; sender_id: string; recipient_id: string; amount: number | string; currency: string | null;
    status: string; tx_id: string | null; note: string | null; error: string | null; listing_id: string | null;
    created_at: string; completed_at: string | null;
  }[];

  const uids = Array.from(new Set(rowsRaw.flatMap(r => [r.sender_id, r.recipient_id]).filter(Boolean)));
  const people: Record<string, { full_name: string | null; username: string | null; avatar_url: string | null }> = {};
  if (uids.length) {
    const { data: ppl, error: peopleError } = await svc.from('profiles').select('id, full_name, username, avatar_url').in('id', uids);
    if (peopleError) throw new Error("Payment participants could not be loaded.");
    (ppl ?? []).forEach((p: { id: string; full_name: string | null; username: string | null; avatar_url: string | null }) => { people[p.id] = p; });
  }
  const nameOf = (id: string) => people[id]?.full_name || '@' + (people[id]?.username || 'member');

  const amt = (r: { amount: number | string }) => Number(r.amount) || 0;
  const week = rowsRaw.filter(r => r.created_at >= from7);
  const prevWeek = rowsRaw.filter(r => r.created_at >= from14 && r.created_at < from7);
  const doneWeek = rowsRaw.filter(r => r.status === 'completed' && (r.completed_at || r.created_at) >= from7);
  const failedWeek = week.filter(r => r.status === 'failed');
  const pendingAll = rowsRaw.filter(r => isPaymentInFlight(r.status));
  const volWeek = paymentTotals(doneWeek);
  const volAll = paymentTotals(rowsRaw.filter(r => r.status === 'completed'));
  const settled = rowsRaw.filter(r => r.status === 'completed' || r.status === 'failed').length;
  const successRate = settled ? (rowsRaw.filter(r => r.status === 'completed').length / settled) * 100 : 0;
  const avgTicket = paymentTotals(doneWeek, true);

  const pct = (a: number, b: number) => b > 0 ? { text: (a >= b ? '+' : '') + (((a - b) / b) * 100).toFixed(1) + '%', tone: (a >= b ? 'ok' : 'bad') as Tone } : { text: a > 0 ? 'new' : 'flat', tone: (a > 0 ? 'ok' : 'neutral') as Tone };

  const dayRows = days30.map(d => {
    const inDay = rowsRaw.filter(r => r.created_at.slice(0, 10) === d);
    return {
      day: d,
      completed: inDay.filter(r => r.status === 'completed').length,
      failed: inDay.filter(r => r.status === 'failed').length,
      other: inDay.filter(r => isPaymentInFlight(r.status)).length,
    } as Record<string, number | string>;
  });
  const spark = (key: string) => days30.map(d => rowsRaw.filter(r => (key === 'completed' ? r.completed_at || r.created_at : r.created_at).slice(0, 10) === d && (key === 'all' || r.status === key)).length);

  const statusCount: Record<string, number> = {};
  rowsRaw.forEach(r => { statusCount[r.status] = (statusCount[r.status] || 0) + 1; });
  const STATUS_COLOR: Record<string, string> = { completed: 'var(--ok)', failed: 'var(--bad)', pending: 'var(--warn)', processing: 'var(--c3)', refunded: 'var(--info)', cancelled: 'rgba(var(--on),0.2)' };
  const statusSlices: Slice[] = Object.keys(statusCount).map((k) => ({ label: k.charAt(0).toUpperCase() + k.slice(1), value: statusCount[k], color: STATUS_COLOR[k] || 'var(--c4)' }));

  const byRecipient: Record<string, number> = {};
  rowsRaw.filter(r => r.status === 'completed').forEach(r => {
    byRecipient[r.recipient_id] = (byRecipient[r.recipient_id] || 0) + 1;
  });
  const topReceivers = Object.entries(byRecipient).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const recMax = Math.max(1, ...topReceivers.map(r => r[1]));

  const failDelta = pct(failedWeek.length, prevWeek.filter(r => r.status === 'failed').length);

  const cards = [
    { label: 'Completed volume, 7 days', value: volWeek, note: 'by currency, loaded records only', icon: IC.money, color: 'var(--c2)' },
    { label: 'Completed, 7 days', value: fmt(doneWeek.length), note: 'completion date, loaded records only', icon: IC.check, color: 'var(--c1)', spark: spark('completed') },
    { label: 'Failed, 7 days', value: fmt(failedWeek.length), delta: failDelta.text, deltaTone: (failedWeek.length > 0 ? 'bad' : 'neutral') as Tone, note: 'creation date, loaded records only', icon: IC.x, color: 'var(--c5)', spark: spark('failed') },
    { label: 'Success rate', value: settled ? successRate.toFixed(1) + '%' : '—', note: 'completed ÷ (completed + failed), loaded records', icon: IC.card, color: 'var(--c6)' },
    { label: 'Average transfer', value: avgTicket, note: 'by currency, completed in 7 days', icon: IC.clock, color: 'var(--c3)' },
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
    { key: 'all', label: 'All transfers', count: rows.length },
    { key: 'completed', label: 'Completed', count: rows.filter(r => r.tabs.includes('completed')).length },
    { key: 'failed', label: 'Failed', count: rows.filter(r => r.tabs.includes('failed')).length },
    { key: 'pending', label: 'In flight', count: rows.filter(r => r.tabs.includes('pending')).length },
    { key: 'other', label: 'Other outcomes', count: rows.filter(r => r.tabs.includes('other')).length },
    { key: 'listing', label: 'Marketplace', count: rows.filter(r => r.tabs.includes('listing')).length },
  ];

  return (
    <Shell admin={admin} active="/payments" title="Payments" sub={'Latest ' + fmt(rowsRaw.length) + ' loaded transfers, up to 500. Completed value: ' + volAll + '. ' + fmt(pendingAll.length) + ' pending or processing. Figures cover this loaded sample; reporting dates use UTC.'}>
      <StatStrip cards={cards} />

      <div className="mt-4" style={PANEL}>
        <div style={HEAD}>
          <div style={H_TITLE}>Transfers created by day</div>
          <div style={H_SUB}>Transfer counts by current status, last 30 days (UTC), loaded records only</div>
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
            searchHint="Search by member, reference or amount"
            detailTitle="Transfer details"
            minWidth={860}
          />
        </div>

        <div>
          <div style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Where transfers end up</div>
              <div style={H_SUB}>Status across the loaded transfers</div>
            </div>
            <div style={{ padding: 16 }}>
              <Donut slices={statusSlices} centerLabel="transfers" size={150} />
            </div>
          </div>

          <div className="mt-4" style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Who is being paid</div>
              <div style={H_SUB}>Most completed transfers received in the loaded records</div>
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
