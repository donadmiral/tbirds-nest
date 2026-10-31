import { requestTime } from '@/lib/requestTime';
import { requireDesk } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';
import { Desk, StatStrip, type DeskRow, type Tone } from '@/components/Desk';
import { Donut, Empty, type Slice } from '@/components/Viz';
import { fmt, ago } from '@/lib/fmt';
import Link from 'next/link';
import RecordPages from '@/components/RecordPages';
import { DESK_PAGE_SIZE, exactCount, formatCount, jobTitlePattern, jobTitleQuery, recordPage, type DeskSearch } from '@/lib/deskReporting';

export const dynamic = 'force-dynamic';

const PANEL: React.CSSProperties = { borderRadius: 12, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)', overflow: 'hidden' };
const HEAD: React.CSSProperties = { padding: '14px 16px 12px', borderBottom: '1px solid rgba(var(--on),0.10)' };
const H_TITLE: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: 'var(--txt)' };
const H_SUB: React.CSSProperties = { fontSize: 12, color: 'var(--txt-muted)', marginTop: 3 };

const IC = {
  case: 'jobs',
  build: 'business',
  pin: 'location',
  clock: 'clock',
  user: 'users',
} as const;

const TYPE_TONE: Record<string, Tone> = { full_time: 'accent', part_time: 'info', contract: 'warn', internship: 'ok', temporary: 'neutral' };
const SERIES = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];

function title(s: string) { return (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

export default async function JobsPage({ searchParams }: { searchParams: Promise<DeskSearch> }) {
  const admin = await requireDesk('/jobs');
  const svc = serviceClient();
  const search = await searchParams;
  const query = jobTitleQuery(search.q);

  const now = await requestTime();
  const from30 = new Date(now - 30 * 86400000).toISOString();
  const from7 = new Date(now - 7 * 86400000).toISOString();
  const from14 = new Date(now - 14 * 86400000).toISOString();
  const [totalRes, weekRes, previousRes, monthRes, matchesRes] = await Promise.all([
    svc.from('jobs').select('id', { count: 'exact', head: true }),
    svc.from('jobs').select('id', { count: 'exact', head: true }).gte('created_at', from7),
    svc.from('jobs').select('id', { count: 'exact', head: true }).gte('created_at', from14).lt('created_at', from7),
    svc.from('jobs').select('id', { count: 'exact', head: true }).gte('created_at', from30),
    query ? svc.from('jobs').select('id', { count: 'exact', head: true }).filter('title', 'imatch', jobTitlePattern(query)) : null,
  ]);
  const failure = 'Job counts could not be loaded. Refresh before using this report.';
  const total = exactCount(totalRes, failure);
  const posted7 = exactCount(weekRes, failure);
  const postedPrev7 = exactCount(previousRes, failure);
  const posted30 = exactCount(monthRes, failure);
  const range = recordPage(search.page, matchesRes ? exactCount(matchesRes, failure) : total);
  let read = svc.from('jobs').select('*').order('created_at', { ascending: false }).order('id', { ascending: false });
  if (query) read = read.filter('title', 'imatch', jobTitlePattern(query));
  const jobsRes = await read.range(range.from, range.to);
  if (jobsRes.error || !Array.isArray(jobsRes.data)) throw new Error('Jobs could not be loaded.');

  const jobs = (jobsRes.data ?? []) as Record<string, unknown>[];
  const uids = Array.from(new Set(jobs.map(j => String(j.posted_by || '')).filter(Boolean)));
  const people: Record<string, { full_name: string | null; username: string | null; avatar_url: string | null }> = {};
  if (uids.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username, avatar_url').in('id', uids);
    (data ?? []).forEach((p: { id: string; full_name: string | null; username: string | null; avatar_url: string | null }) => { people[p.id] = p; });
  }

  const pct = (a: number, b: number) => b > 0 ? { text: (a >= b ? '+' : '') + (((a - b) / b) * 100).toFixed(1) + '%', tone: (a >= b ? 'ok' : 'bad') as Tone } : { text: a > 0 ? 'new' : 'flat', tone: (a > 0 ? 'ok' : 'neutral') as Tone };
  const d7 = pct(posted7, postedPrev7);

  const byType: Record<string, number> = {};
  const byCompany: Record<string, number> = {};
  const byLocation: Record<string, number> = {};
  jobs.forEach(j => {
    const t = String(j.job_type || 'unspecified');
    byType[t] = (byType[t] || 0) + 1;
    const c = String(j.company || '').trim();
    if (c) byCompany[c] = (byCompany[c] || 0) + 1;
    const l = String(j.location || '').replace(/\s+/g, ' ').trim();
    if (l) byLocation[l] = (byLocation[l] || 0) + 1;
  });
  const typeSlices: Slice[] = Object.keys(byType).map((k, i) => ({ label: title(k), value: byType[k], color: SERIES[i % SERIES.length] }));
  const topCompanies = Object.entries(byCompany).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topLocations = Object.entries(byLocation).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const companyMax = Math.max(1, ...topCompanies.map(c => c[1]));
  const locMax = Math.max(1, ...topLocations.map(l => l[1]));

  const remote = jobs.filter(j => /remote|hybrid/i.test(String(j.location || '') + ' ' + String(j.work_mode || ''))).length;

  const cards = [
    { label: 'Roles on the platform', value: formatCount(total), note: 'all posted roles', icon: IC.case, color: 'var(--c1)' },
    { label: 'Posted this week', value: formatCount(posted7), delta: d7.text, deltaTone: d7.tone, note: 'all roles, against the week before', icon: IC.clock, color: 'var(--c2)' },
    { label: 'Posted in 30 days', value: formatCount(posted30), note: 'all roles, by posting date', icon: IC.case, color: 'var(--c3)' },
    { label: 'Companies on this page', value: fmt(Object.keys(byCompany).length), note: 'distinct company names in these roles', icon: IC.build, color: 'var(--c4)' },
    { label: 'Remote or hybrid on this page', value: fmt(remote), note: 'mentions in location or work mode', icon: IC.pin, color: 'var(--c6)' },
  ];

  const typeOptions = Object.keys(byType).map(title);
  const locOptions = topLocations.map(l => l[0]);

  const rows: DeskRow[] = jobs.map(j => {
    const id = String(j.id);
    const p = people[String(j.posted_by || '')] || { full_name: null, username: null, avatar_url: null };
    const jtype = String(j.job_type || 'unspecified');
    const loc = String(j.location || '').replace(/\s+/g, ' ').trim();
    const createdAt = String(j.created_at);
    const fresh = createdAt >= from7;
    const fields = [
      { label: 'Company', value: String(j.company || 'not given') },
      { label: 'Location', value: loc || 'not given' },
      { label: 'Type', value: title(jtype) },
      { label: 'Posted', value: new Date(createdAt).toLocaleString() },
      { label: 'Posted by', value: p.full_name || '@' + (p.username || 'member') },
    ];
    ['salary_range', 'salary_min', 'salary_max', 'experience_level', 'category', 'department', 'work_mode', 'application_url', 'contact_email', 'deadline', 'status'].forEach(k => {
      const v = j[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') fields.push({ label: title(k), value: String(v) });
    });
    const desc = String(j.description || j.body || j.summary || '').trim();
    return {
      id,
      tabs: [fresh ? 'new' : 'older', jtype === 'full_time' ? 'full' : 'other'],
      search: [j.title, j.company, loc, jtype, p.full_name, p.username].map(x => String(x || '').toLowerCase()).join(' '),
      facets: { type: title(jtype), location: loc },
      cells: [
        { t: 'user', v: String(j.title || 'Untitled role'), sub: String(j.company || 'no company'), img: p.avatar_url },
        { t: 'dim', v: loc || '-' },
        { t: 'pill', v: title(jtype), tone: TYPE_TONE[jtype] || 'neutral' },
        { t: 'text', v: p.full_name || '@' + (p.username || 'member') },
        { t: 'mono', v: ago(createdAt) },
      ],
      detail: {
        title: String(j.title || 'Untitled role'),
        subtitle: String(j.company || 'no company') + (loc ? ' \u00b7 ' + loc : ''),
        img: p.avatar_url,
        pills: [{ v: title(jtype), tone: TYPE_TONE[jtype] || 'neutral' }, ...(fresh ? [{ v: 'Posted this week', tone: 'ok' as Tone }] : [])],
        fields,
        body: desc ? [{ label: 'Description', text: desc }] : undefined,
        links: [
          ...(j.posted_by ? [{ label: 'Open poster', href: '/users/' + String(j.posted_by) }] : []),
        ],
      },
    };
  });

  const tabs = [
    { key: 'all', label: 'Roles on this page', count: rows.length },
    { key: 'new', label: 'This week', count: rows.filter(r => r.tabs.includes('new')).length },
    { key: 'full', label: 'Full time', count: rows.filter(r => r.tabs.includes('full')).length },
    { key: 'other', label: 'Other types', count: rows.filter(r => r.tabs.includes('other')).length },
    { key: 'older', label: 'Older', count: rows.filter(r => r.tabs.includes('older')).length },
  ];

  return (
    <Shell admin={admin} active="/jobs" title="Jobs" sub="Every role posted across Platinum Circles, who posted it, and how hiring moves week to week.">
      <StatStrip cards={cards} />
      <form action="/jobs" method="get" className="mt-4 flex min-w-0 flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 text-sm">Search all job titles
          <input type="search" name="q" defaultValue={query} maxLength={120} className="mt-1 block min-h-11 w-full min-w-0 rounded-lg border bg-white px-3" />
        </label>
        <button className="min-h-11 rounded-lg border px-4 text-sm font-semibold">Search jobs</button>
        {query ? <Link href="/jobs" className="inline-flex min-h-11 items-center px-2 text-sm underline">Clear title search</Link> : null}
      </form>
      <RecordPages path="/jobs" range={range} loaded={rows.length} label={query ? 'Matching roles' : 'Roles'} query={query} />
      <p className="text-sm text-[var(--txt-muted)]">The filters and charts below describe the roles on this page.</p>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_340px]">
        <div>
          <Desk
            key={`${range.page}:${query}`}
            tabs={tabs}
            columns={[{ label: 'Role' }, { label: 'Location' }, { label: 'Type' }, { label: 'Posted by' }, { label: 'Posted', align: 'right' }]}
            grid="minmax(200px,2.2fr) minmax(120px,1.2fr) 110px minmax(120px,1.2fr) 96px"
            rows={rows}
            filters={[{ key: 'type', label: 'Type', options: typeOptions }, { key: 'location', label: 'Location', options: locOptions }]}
            searchHint="Filter this page by role, company or location"
            detailTitle="Role details"
            minWidth={760}
            pageSize={DESK_PAGE_SIZE}
          />
        </div>

        <div>
          <div style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Roles by type</div>
              <div style={H_SUB}>Job types on this page</div>
            </div>
            <div style={{ padding: 16 }}>
              <Donut slices={typeSlices} centerLabel="roles" size={150} />
            </div>
          </div>

          <div className="mt-4" style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Who is hiring</div>
              <div style={H_SUB}>Companies by role count on this page</div>
            </div>
            <div style={{ padding: 16 }}>
              {topCompanies.length === 0 ? <Empty note="No company named on this page." /> : topCompanies.map(([name, n]) => (
                <div key={name} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 5 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                    <span className="pc-num" style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>{n}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 4, background: 'rgba(var(--on),0.06)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: Math.max(2, (n / companyMax) * 100) + '%', borderRadius: 4, background: 'var(--c2)' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4" style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Where the work is</div>
              <div style={H_SUB}>Locations among the roles on this page</div>
            </div>
            <div style={{ padding: 16 }}>
              {topLocations.length === 0 ? <Empty note="No location set on this page." /> : topLocations.map(([name, n]) => (
                <div key={name} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 5 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                    <span className="pc-num" style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>{n}</span>
                    <span className="pc-num" style={{ fontSize: 11, color: 'var(--txt-muted)', width: 44, textAlign: 'right' }}>{jobs.length ? ((n / jobs.length) * 100).toFixed(1) + '%' : '-'}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 4, background: 'rgba(var(--on),0.06)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: Math.max(2, (n / locMax) * 100) + '%', borderRadius: 4, background: 'var(--c1)' }} />
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
