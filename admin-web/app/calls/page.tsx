import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';
import { Desk, StatStrip, type DeskRow, type Tone } from '@/components/Desk';
import { Donut, StackBars, Empty, type Slice } from '@/components/Viz';
import { fmt, ago } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

const PANEL: React.CSSProperties = { borderRadius: 13, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)', overflow: 'hidden' };
const HEAD: React.CSSProperties = { padding: '14px 16px 12px', borderBottom: '1px solid rgba(var(--on),0.10)' };
const H_TITLE: React.CSSProperties = { fontSize: 13.5, fontWeight: 700, color: 'var(--txt)' };
const H_SUB: React.CSSProperties = { fontSize: 11.3, color: 'rgba(var(--on),0.36)', marginTop: 3 };

const IC = {
  phone: 'M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z',
  video: 'M4 6h11a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1zm13 4.2l4-2.4v8.4l-4-2.4v-3.6z',
  check: 'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z',
  miss: 'M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
  clock: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 10.6V6h-2v7.4l5.2 3.1 1-1.7-4.2-2.2z',
  users: 'M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z',
};

const STATUS_TONE: Record<string, Tone> = { active: 'ok', ongoing: 'ok', ended: 'neutral', completed: 'neutral', missed: 'warn', declined: 'bad', failed: 'bad', ringing: 'info' };

function title(s: string) { return (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function dur(s: number | null | undefined) {
  const n = Number(s) || 0;
  if (n <= 0) return '-';
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = n % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0');
}

export default async function CallsPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();

  const now = Date.now();
  const from7 = new Date(now - 7 * 86400000).toISOString();
  const from14 = new Date(now - 14 * 86400000).toISOString();
  const days30 = Array.from({ length: 30 }, (_, i) => new Date(now - (29 - i) * 86400000).toISOString().slice(0, 10));

  const [callsRes, totalRes] = await Promise.all([
    svc.from('call_sessions').select('*').order('created_at', { ascending: false }).limit(400),
    svc.from('call_sessions').select('id', { count: 'exact', head: true }),
  ]);

  const calls = (callsRes.data ?? []) as Record<string, unknown>[];

  const uids = Array.from(new Set(calls.flatMap(r => [String(r.initiator_id || ''), String(r.receiver_id || '')]).filter(Boolean)));
  const people: Record<string, { full_name: string | null; username: string | null; avatar_url: string | null; is_verified: boolean }> = {};
  if (uids.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username, avatar_url, is_verified').in('id', uids);
    (data ?? []).forEach((p: { id: string; full_name: string | null; username: string | null; avatar_url: string | null; is_verified: boolean }) => { people[p.id] = p; });
  }
  const nameOf = (id: string) => id ? (people[id]?.full_name || '@' + (people[id]?.username || 'member')) : 'group members';

  const durOf = (r: Record<string, unknown>) => Number(r.duration_sec) || 0;
  const connectedOf = (r: Record<string, unknown>) => !!r.started_at || durOf(r) > 0;
  const kindOf = (r: Record<string, unknown>) => r.is_group_call ? 'Group' : (r.is_video ? 'Video' : 'Voice');
  const statusOf = (r: Record<string, unknown>) => String(r.status || 'unknown').toLowerCase();

  const week = calls.filter(r => String(r.created_at) >= from7);
  const prevWeek = calls.filter(r => String(r.created_at) >= from14 && String(r.created_at) < from7);
  const connectedWeek = week.filter(connectedOf);
  const answerRate = week.length ? (connectedWeek.length / week.length) * 100 : 0;
  const answerPrev = prevWeek.length ? (prevWeek.filter(connectedOf).length / prevWeek.length) * 100 : 0;
  const talked = week.filter(r => durOf(r) > 0);
  const avgDur = talked.length ? Math.round(talked.reduce((a, r) => a + durOf(r), 0) / talked.length) : 0;
  const minutes = calls.reduce((a, r) => a + durOf(r), 0) / 60;
  const live = calls.filter(r => ['active', 'ongoing', 'ringing'].includes(statusOf(r)));
  const missed = calls.filter(r => ['missed', 'declined', 'failed'].includes(statusOf(r)));

  const pct = (a: number, b: number) => b > 0 ? { text: (a >= b ? '+' : '') + (((a - b) / b) * 100).toFixed(1) + '%', tone: (a >= b ? 'ok' : 'bad') as Tone } : { text: a > 0 ? 'new' : 'flat', tone: (a > 0 ? 'ok' : 'neutral') as Tone };
  const weekDelta = pct(week.length, prevWeek.length);
  const answerDelta = pct(answerRate, answerPrev);

  const spark = days30.map(d => calls.filter(r => String(r.created_at).slice(0, 10) === d).length);
  const dayRows = days30.map(d => ({
    day: d,
    connected: calls.filter(r => String(r.created_at).slice(0, 10) === d && connectedOf(r)).length,
    missed: calls.filter(r => String(r.created_at).slice(0, 10) === d && !connectedOf(r)).length,
  } as Record<string, number | string>));

  const kindCount: Record<string, number> = {};
  const statusCount: Record<string, number> = {};
  calls.forEach(r => {
    const k = kindOf(r);
    kindCount[k] = (kindCount[k] || 0) + 1;
    const s = statusOf(r);
    statusCount[s] = (statusCount[s] || 0) + 1;
  });
  const KIND_COLOR: Record<string, string> = { Video: 'var(--c1)', Voice: 'var(--c2)', Group: 'var(--c4)' };
  const kindSlices: Slice[] = Object.keys(kindCount).map(k => ({ label: k, value: kindCount[k], color: KIND_COLOR[k] || 'var(--c3)' }));
  const STATUS_COLOR: Record<string, string> = { ended: 'rgba(var(--on),0.24)', completed: 'var(--ok)', active: 'var(--ok)', missed: 'var(--warn)', declined: 'var(--bad)', failed: 'var(--bad)', ringing: 'var(--info)' };
  const statusSlices: Slice[] = Object.keys(statusCount).map((k, i) => ({ label: title(k), value: statusCount[k], color: STATUS_COLOR[k] || 'var(--c' + ((i % 6) + 1) + ')' }));

  const talkByUser: Record<string, number> = {};
  calls.forEach(r => {
    const d = durOf(r);
    if (d <= 0) return;
    const a = String(r.initiator_id || '');
    if (a) talkByUser[a] = (talkByUser[a] || 0) + d;
  });
  const topTalkers = Object.entries(talkByUser).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const talkMax = Math.max(1, ...topTalkers.map(t => t[1]));

  const cards = [
    { label: 'Sessions on file', value: fmt(totalRes.count ?? calls.length), note: 'call_sessions, all time', icon: IC.phone, color: 'var(--c1)', spark },
    { label: 'This week', value: fmt(week.length), delta: weekDelta.text, deltaTone: weekDelta.tone, note: 'against the week before', icon: IC.phone, color: 'var(--c2)', spark: spark.slice(-14) },
    { label: 'Answer rate', value: answerRate.toFixed(1) + '%', delta: answerDelta.text, deltaTone: answerDelta.tone, note: 'connected against attempted, this week', icon: IC.check, color: 'var(--c6)' },
    { label: 'Average talk time', value: dur(avgDur), note: fmt(Math.round(minutes)) + ' minutes on file', icon: IC.clock, color: 'var(--c3)' },
    { label: 'Live right now', value: fmt(live.length), note: fmt(missed.length) + ' missed or declined on file', icon: IC.video, color: live.length ? 'var(--ok)' : 'var(--c5)' },
  ];

  const rows: DeskRow[] = calls.map(r => {
    const id = String(r.id);
    const from = String(r.initiator_id || '');
    const to = String(r.receiver_id || '');
    const kind = kindOf(r);
    const status = statusOf(r);
    const connected = connectedOf(r);
    const seconds = durOf(r);
    const fields = [
      { label: 'Call id', value: id },
      { label: 'Type', value: kind + (r.is_video ? ', video' : ', voice') },
      { label: 'Status', value: title(status) },
      { label: 'From', value: nameOf(from) },
      { label: 'To', value: r.is_group_call ? 'group members' : nameOf(to) },
      { label: 'Talked', value: seconds > 0 ? dur(seconds) : 'never connected' },
      { label: 'Created', value: new Date(String(r.created_at)).toLocaleString() },
    ];
    if (r.started_at) fields.push({ label: 'Answered', value: new Date(String(r.started_at)).toLocaleString() });
    ['ended_at', 'call_type', 'room_name', 'channel', 'end_reason', 'quality', 'participants_count'].forEach(k => {
      const v = r[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') fields.push({ label: title(k), value: String(v) });
    });

    return {
      id,
      tabs: [
        connected ? 'connected' : 'missed',
        kind.toLowerCase(),
        ...(['active', 'ongoing', 'ringing'].includes(status) ? ['live'] : []),
      ],
      search: [nameOf(from), nameOf(to), kind, status, id].map(x => String(x || '').toLowerCase()).join(' '),
      facets: { type: kind, status: title(status) },
      cells: [
        { t: 'user', v: nameOf(from), sub: kind + ' call', img: people[from]?.avatar_url },
        { t: 'text', v: r.is_group_call ? 'group members' : nameOf(to) },
        { t: 'pill', v: kind, tone: kind === 'Video' ? 'info' : kind === 'Group' ? 'accent' : 'neutral' },
        { t: 'pill', v: title(status), tone: STATUS_TONE[status] || 'neutral' },
        { t: 'mono', v: dur(seconds) },
        { t: 'mono', v: ago(String(r.created_at)) },
      ],
      detail: {
        title: nameOf(from) + (r.is_group_call ? ' to a group' : ' to ' + nameOf(to)),
        subtitle: kind + ' call \u00b7 ' + ago(String(r.created_at)),
        img: people[from]?.avatar_url,
        pills: [
          { v: kind, tone: kind === 'Video' ? 'info' : kind === 'Group' ? 'accent' : 'neutral' },
          { v: title(status), tone: STATUS_TONE[status] || 'neutral' },
          ...(connected ? [] : [{ v: 'Never connected', tone: 'warn' as Tone }]),
        ],
        stats: [
          { label: 'Talked', value: seconds > 0 ? dur(seconds) : '-' },
          { label: 'Connected', value: connected ? 'yes' : 'no' },
          { label: 'Type', value: kind },
        ],
        fields,
        links: [
          ...(from ? [{ label: 'Open caller', href: '/users/' + from }] : []),
          ...(to && !r.is_group_call ? [{ label: 'Open receiver', href: '/users/' + to }] : []),
        ],
      },
    };
  });

  const tabs = [
    { key: 'all', label: 'All calls', count: rows.length },
    { key: 'live', label: 'Live', count: rows.filter(r => r.tabs.includes('live')).length },
    { key: 'connected', label: 'Connected', count: rows.filter(r => r.tabs.includes('connected')).length },
    { key: 'missed', label: 'Never connected', count: rows.filter(r => r.tabs.includes('missed')).length },
    { key: 'video', label: 'Video', count: rows.filter(r => r.tabs.includes('video')).length },
    { key: 'voice', label: 'Voice', count: rows.filter(r => r.tabs.includes('voice')).length },
    { key: 'group', label: 'Group', count: rows.filter(r => r.tabs.includes('group')).length },
  ];

  return (
    <Shell admin={admin} active="/calls" title="Calls" sub="Every session the calls system created, read straight from its own records. Nothing here is sampled or estimated.">
      <StatStrip cards={cards} />

      <div className="mt-4" style={PANEL}>
        <div style={HEAD}>
          <div style={H_TITLE}>Call activity</div>
          <div style={H_SUB}>Connected against never connected, last 30 days</div>
        </div>
        <div style={{ padding: '18px 16px 14px' }}>
          <StackBars days={dayRows} height={150} series={[
            { key: 'connected', label: 'Connected', color: 'var(--c1)' },
            { key: 'missed', label: 'Never connected', color: 'var(--bad)' },
          ]} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_336px]">
        <div>
          <Desk
            tabs={tabs}
            columns={[{ label: 'From' }, { label: 'To' }, { label: 'Type' }, { label: 'Status' }, { label: 'Talked', align: 'right' }, { label: 'When', align: 'right' }]}
            grid="minmax(180px,1.6fr) minmax(150px,1.3fr) 100px 108px 90px 92px"
            rows={rows}
            filters={[
              { key: 'type', label: 'Type', options: ['Voice', 'Video', 'Group'] },
              { key: 'status', label: 'Status', options: Object.keys(statusCount).map(title) },
            ]}
            searchHint="Search callers, receivers, call id"
            detailTitle="Call session"
            minWidth={900}
            pageSize={12}
          />
        </div>

        <div>
          <div style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>How people call</div>
              <div style={H_SUB}>Voice, video and group across every session</div>
            </div>
            <div style={{ padding: 16 }}>
              {kindSlices.length === 0 ? <Empty note="No call session recorded yet." /> : <Donut slices={kindSlices} centerLabel="calls" size={148} />}
            </div>
          </div>

          <div className="mt-4" style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>How calls end</div>
              <div style={H_SUB}>call_sessions.status</div>
            </div>
            <div style={{ padding: 16 }}>
              {statusSlices.length === 0 ? <Empty note="Nothing recorded yet." /> : <Donut slices={statusSlices} centerLabel="sessions" size={148} />}
            </div>
          </div>

          <div className="mt-4" style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Who talks most</div>
              <div style={H_SUB}>Total connected time as the caller</div>
            </div>
            <div style={{ padding: 16 }}>
              {topTalkers.length === 0 ? <Empty note="No call has connected yet." /> : topTalkers.map(([id, secs]) => (
                <div key={id} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 5 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameOf(id)}</span>
                    <span className="pc-num" style={{ fontSize: 11.4, fontWeight: 600, color: 'var(--txt)' }}>{dur(secs)}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 4, background: 'rgba(var(--on),0.06)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: Math.max(2, (secs / talkMax) * 100) + '%', borderRadius: 4, background: 'var(--c1)' }} />
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
