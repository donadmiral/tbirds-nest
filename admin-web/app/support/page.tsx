import Link from 'next/link';
import { supportSearch, supportSubjectPattern, supportHref, supportMap, SUPPORT_PAGE_SIZE, type SupportSearch } from '@/lib/supportReporting';
import { requireDesk } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';
import { Desk, StatStrip, type DeskRow, type Tone } from '@/components/Desk';
import { Donut, StackBars, Empty, type Slice } from '@/components/Viz';
import { fmt, ago } from '@/lib/fmt';
import { readSupportTriage } from '@/lib/supportTriage';

export const dynamic = 'force-dynamic';

const PANEL: React.CSSProperties = { borderRadius: 12, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)', overflow: 'hidden' };
const HEAD: React.CSSProperties = { padding: '14px 16px 12px', borderBottom: '1px solid rgba(var(--on),0.10)' };
const H_TITLE: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: 'var(--txt)' };
const H_SUB: React.CSSProperties = { fontSize: 12, color: 'var(--txt-muted)', marginTop: 3 };

const IC = {
  life: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 4a6 6 0 016 6h-3a3 3 0 00-6 0H6a6 6 0 016-6zm-3 8h6a3 3 0 01-6 0z',
  clock: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 10.6V6h-2v7.4l5.2 3.1 1-1.7-4.2-2.2z',
  check: 'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z',
  shield: 'M12 2l8 3v7c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10V5l8-3z',
  chat: 'M4 4h16v12H5.2L4 17.2V4zm2 3h12v2H6V7zm0 4h8v2H6v-2z',
};

const STATUS_TONE: Record<string, Tone> = { open: 'bad', pending: 'warn', solved: 'ok', closed: 'neutral' };
const SERIES = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];

function title(s: string) { return (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

export default async function SupportPage({ searchParams }: { searchParams: Promise<SupportSearch> }) {
  const { page, q, status } = supportSearch(await searchParams);
  const start = (page - 1) * SUPPORT_PAGE_SIZE;
  const admin = await requireDesk('/support');
  const svc = serviceClient();

  const now = Date.now();
  const days30 = Array.from({ length: 30 }, (_, i) => new Date(now - (29 - i) * 86400000).toISOString().slice(0, 10));

  let ticketQuery = svc.from('support_tickets')
    .select('id, user_id, kind, subject, status, created_at, updated_at', { count: 'exact' });
  if (status === 'appeal') ticketQuery = ticketQuery.eq('kind', 'appeal');
  else if (status !== 'all') ticketQuery = ticketQuery.eq('status', status);
  if (q) ticketQuery = ticketQuery.ilike('subject', supportSubjectPattern(q));
  const [tickets, openCount, pendingCount, solvedCount, appealCount, totalCount, oldest] = await Promise.all([
    ticketQuery.order('created_at', { ascending: true }).order('id').range(start, start + SUPPORT_PAGE_SIZE - 1),
    svc.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    svc.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    svc.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'solved'),
    svc.from('support_tickets').select('id', { count: 'exact', head: true }).eq('kind', 'appeal'),
    svc.from('support_tickets').select('id', { count: 'exact', head: true }),
    svc.from('support_tickets').select('created_at').eq('status', 'open').order('created_at').order('id').limit(1),
  ]);
  if ([tickets, openCount, pendingCount, solvedCount, appealCount, totalCount, oldest].some(result => result.error)) throw new Error('Support inbox could not be loaded.');
  if ([tickets, openCount, pendingCount, solvedCount, appealCount, totalCount].some(result => result.count === null)) throw new Error('Support counts could not be confirmed.');
  const all = (tickets.data ?? []) as { id: string; user_id: string; kind: string | null; subject: string; status: string; created_at: string; updated_at: string | null }[];
  const triage = await readSupportTriage(all.map(ticket => ticket.id));

  const uids = Array.from(new Set(all.map(t => t.user_id).filter(Boolean)));
  const people: Record<string, { full_name: string | null; username: string | null; avatar_url: string | null; location: string | null; created_at: string }> = {};
  if (uids.length) {
    const { data: ppl, error: peopleError } = await svc.from('profiles').select('id, full_name, username, avatar_url, location, created_at').in('id', uids);
    if (peopleError) throw new Error('Support participants could not be loaded.');
    (ppl ?? []).forEach((p: { id: string; full_name: string | null; username: string | null; avatar_url: string | null; location: string | null; created_at: string }) => { people[p.id] = p; });
  }

  const msgCount: Record<string, number> = {};
  const lastMsg: Record<string, string> = {};
  await supportMap(all, async ticket => {
    const result = await svc.from('support_messages').select('body', { count: 'exact' })
      .eq('ticket_id', ticket.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1);
    if (result.error || result.count === null) throw new Error('Support messages could not be loaded.');
    msgCount[ticket.id] = result.count;
    lastMsg[ticket.id] = result.data?.[0]?.body || '';
  });

  const ticketsPerMember: Record<string, number> = {};
  all.forEach(t => { ticketsPerMember[t.user_id] = (ticketsPerMember[t.user_id] || 0) + 1; });

  const counts = { open: openCount.count!, pending: pendingCount.count!, solved: solvedCount.count!, appeals: appealCount.count! };
  const oldestOpen = oldest.data?.[0] || null;

  const kindCount: Record<string, number> = {};
  all.forEach(t => { const k = t.kind || 'general'; kindCount[k] = (kindCount[k] || 0) + 1; });
  const kindSlices: Slice[] = Object.keys(kindCount).map((k, i) => ({ label: title(k), value: kindCount[k], color: SERIES[i % SERIES.length] }));

  const dayRows = days30.map(d => ({
    day: d,
    opened: all.filter(t => t.created_at.slice(0, 10) === d).length,
    solved: all.filter(t => t.status === 'solved' && (t.updated_at || t.created_at).slice(0, 10) === d).length,
  } as Record<string, number | string>));

  const cards = [
    { label: 'Open, member waiting', value: fmt(counts.open), note: oldestOpen ? 'oldest opened ' + ago(oldestOpen.created_at) : 'nothing waiting', icon: IC.life, color: 'var(--c5)' },
    { label: 'Pending on the member', value: fmt(counts.pending), note: 'answered, awaiting reply', icon: IC.clock, color: 'var(--c3)' },
    { label: 'Solved', value: fmt(counts.solved), note: 'closed by this desk', icon: IC.check, color: 'var(--c2)' },
    { label: 'Suspension appeals', value: fmt(counts.appeals), note: 'open and historical appeals', icon: IC.shield, color: 'var(--c4)' },
    { label: 'Tickets on file', value: fmt(totalCount.count!), note: 'all tickets', icon: IC.chat, color: 'var(--c1)' },
  ];

  const rows: DeskRow[] = all.map(t => {
    const assignment = triage.available ? triage.tickets.get(t.id) : undefined;
    const p = people[t.user_id] || { full_name: null, username: null, avatar_url: null, location: null, created_at: t.created_at };
    const tone = STATUS_TONE[t.status] || 'neutral';
    const last = t.updated_at || t.created_at;
    return {
      id: t.id,
      tabs: [t.status, ...(t.kind === 'appeal' ? ['appeal'] : [])],
      search: [t.subject, p.full_name, p.username, t.kind, t.status].map(x => String(x || '').toLowerCase()).join(' '),
      facets: { status: t.status, kind: title(t.kind || 'general') },
      cells: [
        { t: 'pill', v: title(t.status), tone },
        { t: 'text', v: t.subject || 'No subject', strong: true },
        { t: 'user', v: p.full_name || '@' + (p.username || 'member'), sub: p.location || '@' + (p.username || 'member'), img: p.avatar_url },
        { t: 'dim', v: title(t.kind || 'general') },
        { t: 'mono', v: ago(last) },
      ],
      detail: {
        title: t.subject || 'No subject',
        subtitle: (p.full_name || '@' + (p.username || 'member')) + (p.location ? ' \u00b7 ' + p.location : ''),
        img: p.avatar_url,
        pills: [{ v: title(t.status), tone }, ...(t.kind === 'appeal' ? [{ v: 'Suspension appeal', tone: 'warn' as Tone }] : [])],
        stats: [
          { label: 'Messages', value: String(msgCount[t.id] || 0) },
          { label: 'Their tickets on this page', value: String(ticketsPerMember[t.user_id] || 1) },
          { label: 'Member since', value: new Date(p.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) },
        ],
        fields: [
          ...(assignment ? [
          { label: 'Owner', value: assignment.assigned_name || assignment.assigned_to || 'Unassigned' },
          { label: 'Priority / queue', value: assignment.priority + ' / ' + assignment.queue + (assignment.escalated ? ' / escalated' : '') },
          { label: 'Response due', value: assignment.response_due_at ? new Date(assignment.response_due_at).toLocaleString() : 'No pending response target' },
          ] : [{ label: 'Assignment tools', value: 'Unavailable on this deployment' }]),
          { label: 'Opened', value: new Date(t.created_at).toLocaleString() },
          { label: 'Last activity', value: new Date(last).toLocaleString() },
          { label: 'Kind', value: title(t.kind || 'general') },
          { label: 'Ticket id', value: t.id },
        ],
        body: lastMsg[t.id] ? [{ label: 'Latest message on the thread', text: lastMsg[t.id] }] : undefined,
        links: [
          { label: 'Open conversation', href: '/support/' + t.id },
          { label: 'Open member', href: '/users/' + t.user_id },
        ],
      },
    };
  });

  const ordered = [
    ...rows.filter(r => r.tabs.includes('open')),
    ...rows.filter(r => r.tabs.includes('pending')),
    ...rows.filter(r => !r.tabs.includes('open') && !r.tabs.includes('pending')),
  ];

  const tabs = [{ key: 'all', label: 'This page', count: rows.length }];

  return (
    <Shell admin={admin} active="/support" title="Support inbox" sub="Open cases are shown first by default, oldest first. Counts cover the full inbox; charts and exports cover this page.">
      <StatStrip cards={cards} />
      {!triage.available ? <p role="status" className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 text-sm">Assignment tools are unavailable on this deployment. Ticket details and conversation history remain available.</p> : null}
      <form action="/support" className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">Search subjects<input name="q" defaultValue={q} className="ml-2 rounded-lg border px-3 py-2" /></label>
        <label className="text-sm">Status<select name="status" defaultValue={status} className="ml-2 rounded-lg border px-3 py-2">
          <option value="open">Open</option><option value="pending">Pending</option><option value="solved">Solved</option><option value="appeal">Appeals</option><option value="all">All tickets</option>
        </select></label>
        <button type="submit" className="rounded-lg border px-3 py-2 text-sm">Apply</button>
      </form>
      <nav aria-label="Support pages" className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        {page > 1 ? <Link href={supportHref(1, q, status)}>First page</Link> : null}
        {page > 1 ? <Link href={supportHref(page - 1, q, status)}>Previous</Link> : null}
        <span>Page {page} · {tickets.count} matching tickets</span>
        {(tickets.count ?? 0) > start + SUPPORT_PAGE_SIZE ? <Link href={supportHref(page + 1, q, status)}>Next</Link> : null}
      </nav>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_340px]">
        <div>
          <Desk
            key={`${page}:${status}:${q}`}
            tabs={tabs}
            columns={[{ label: 'Status' }, { label: 'Ticket' }, { label: 'Member' }, { label: 'Kind' }, { label: 'Last activity', align: 'right' }]}
            grid="92px minmax(190px,2fr) minmax(160px,1.4fr) 110px 96px"
            rows={ordered}
            filters={[{ key: 'status', label: 'Status', options: Array.from(new Set(all.map(t => t.status))) }, { key: 'kind', label: 'Kind', options: Object.keys(kindCount).map(title) }]}
            searchHint="Search within this page"
            detailTitle="Ticket"
            minWidth={800}
            pageSize={SUPPORT_PAGE_SIZE}
          />
        </div>

        <div>
          <div style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>What members write about</div>
              <div style={H_SUB}>Categories on this page</div>
            </div>
            <div style={{ padding: 16 }}>
              {kindSlices.length === 0 ? <Empty note="No ticket has been opened yet." /> : <Donut slices={kindSlices} centerLabel="tickets" size={150} />}
            </div>
          </div>

          <div className="mt-4" style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Created / last updated while solved</div>
              <div style={H_SUB}>Last 30 days, tickets on this page</div>
            </div>
            <div style={{ padding: '18px 16px 14px' }}>
              <StackBars days={dayRows} height={130} series={[
                { key: 'opened', label: 'Opened', color: 'var(--c5)' },
                { key: 'solved', label: 'Solved', color: 'var(--ok)' },
              ]} />
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
