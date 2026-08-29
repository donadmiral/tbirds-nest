import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';
import { Desk, StatStrip, type DeskRow, type Tone } from '@/components/Desk';
import { Donut, Empty, type Slice } from '@/components/Viz';
import { fmt, ago } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

const PANEL: React.CSSProperties = { borderRadius: 13, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)', overflow: 'hidden' };
const HEAD: React.CSSProperties = { padding: '14px 16px 12px', borderBottom: '1px solid rgba(var(--on),0.10)' };
const H_TITLE: React.CSSProperties = { fontSize: 13.5, fontWeight: 700, color: 'var(--txt)' };
const H_SUB: React.CSSProperties = { fontSize: 11.3, color: 'rgba(var(--on),0.36)', marginTop: 3 };

const IC = {
  case: 'M9 4h6a2 2 0 012 2v1h3a1 1 0 011 1v10a2 2 0 01-2 2H5a2 2 0 01-2-2V8a1 1 0 011-1h3V6a2 2 0 012-2zm1 3h4V6h-4v1z',
  build: 'M4 21V5a2 2 0 012-2h7a2 2 0 012 2v16h-4v-4H8v4H4zm13-9h3a1 1 0 011 1v8h-4v-9z',
  pin: 'M12 2a7 7 0 00-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z',
  clock: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 10.6V6h-2v7.4l5.2 3.1 1-1.7-4.2-2.2z',
  user: 'M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z',
};

const TYPE_TONE: Record<string, Tone> = { full_time: 'accent', part_time: 'info', contract: 'warn', internship: 'ok', temporary: 'neutral' };
const SERIES = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];

function title(s: string) { return (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

export default async function JobsPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();

  const now = Date.now();
  const from30 = new Date(now - 30 * 86400000).toISOString();
  const from7 = new Date(now - 7 * 86400000).toISOString();
  const from14 = new Date(now - 14 * 86400000).toISOString();
  const days30 = Array.from({ length: 30 }, (_, i) => new Date(now - (29 - i) * 86400000).toISOString().slice(0, 10));

  const [jobsRes, allRes] = await Promise.all([
    svc.from('jobs').select('*').order('created_at', { ascending: false }).limit(300),
    svc.from('jobs').select('created_at').gte('created_at', from30).limit(3000),
  ]);

  const jobs = (jobsRes.data ?? []) as Record<string, unknown>[];
  const uids = Array.from(new Set(jobs.map(j => String(j.posted_by || '')).filter(Boolean)));
  const people: Record<string, { full_name: string | null; username: string | null; avatar_url: string | null }> = {};
  if (uids.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username, avatar_url').in('id', uids);
    (data ?? []).forEach((p: { id: string; full_name: string | null; username: string | null; avatar_url: string | null }) => { people[p.id] = p; });
  }

  const created = (allRes.data ?? []) as { created_at: string }[];
  const dayMap: Record<string, number> = {};
  days30.forEach(d => { dayMap[d] = 0; });
  created.forEach(r => { const k = r.created_at.slice(0, 10); if (k in dayMap) dayMap[k] += 1; });
  const postedSeries = days30.map(d => dayMap[d]);
  const posted7 = created.filter(r => r.created_at >= from7).length;
  const postedPrev7 = created.filter(r => r.created_at >= from14 && r.created_at < from7).length;
  const posted30 = created.length;

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

  const remote = jobs.filter(j => /remote/i.test(String(j.location || '') + ' ' + String(j.work_mode || ''))).length;

  const cards = [
    { label: 'Roles on the platform', value: fmt(jobs.length), note: 'every row in jobs', icon: IC.case, color: 'var(--c1)', spark: postedSeries },
    { label: 'Posted this week', value: fmt(posted7), delta: d7.text, deltaTone: d7.tone, note: 'against the week before', icon: IC.clock, color: 'var(--c2)', spark: postedSeries.slice(-14) },
    { label: 'Posted in 30 days', value: fmt(posted30), note: 'jobs.created_at', icon: IC.case, color: 'var(--c3)', spark: postedSeries },
    { label: 'Hiring companies', value: fmt(Object.keys(byCompany).length), note: 'distinct company names', icon: IC.build, color: 'var(--c4)' },
    { label: 'Remote or hybrid', value: fmt(remote), note: 'location mentions remote', icon: IC.pin, color: 'var(--c6)' },
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
    { key: 'all', label: 'All roles', count: rows.length },
    { key: 'new', label: 'This week', count: rows.filter(r => r.tabs.includes('new')).length },
    { key: 'full', label: 'Full time', count: rows.filter(r => r.tabs.includes('full')).length },
    { key: 'other', label: 'Other types', count: rows.filter(r => r.tabs.includes('other')).length },
    { key: 'older', label: 'Older', count: rows.filter(r => r.tabs.includes('older')).length },
  ];

  return (
    <Shell admin={admin} active="/jobs" title="Jobs" sub="Every role posted across Platinum Circles, who posted it, and how hiring moves week to week.">
      <StatStrip cards={cards} />

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_340px]">
        <div>
          <Desk
            tabs={tabs}
            columns={[{ label: 'Role' }, { label: 'Location' }, { label: 'Type' }, { label: 'Posted by' }, { label: 'Posted', align: 'right' }]}
            grid="minmax(200px,2.2fr) minmax(120px,1.2fr) 110px minmax(120px,1.2fr) 96px"
            rows={rows}
            filters={[{ key: 'type', label: 'Type', options: typeOptions }, { key: 'location', label: 'Location', options: locOptions }]}
            searchHint="Search roles, companies, locations"
            detailTitle="Role details"
            minWidth={760}
          />
        </div>

        <div>
          <div style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Roles by type</div>
              <div style={H_SUB}>jobs.job_type across every row</div>
            </div>
            <div style={{ padding: 16 }}>
              <Donut slices={typeSlices} centerLabel="roles" size={150} />
            </div>
          </div>

          <div className="mt-4" style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Who is hiring</div>
              <div style={H_SUB}>Companies by open role count</div>
            </div>
            <div style={{ padding: 16 }}>
              {topCompanies.length === 0 ? <Empty note="No company named on any role yet." /> : topCompanies.map(([name, n]) => (
                <div key={name} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 5 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                    <span className="pc-num" style={{ fontSize: 11.4, fontWeight: 600, color: 'var(--txt)' }}>{n}</span>
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
              <div style={H_SUB}>jobs.location, as posted</div>
            </div>
            <div style={{ padding: 16 }}>
              {topLocations.length === 0 ? <Empty note="No location set on any role yet." /> : topLocations.map(([name, n]) => (
                <div key={name} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 5 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                    <span className="pc-num" style={{ fontSize: 11.4, fontWeight: 600, color: 'var(--txt)' }}>{n}</span>
                    <span className="pc-num" style={{ fontSize: 10.5, color: 'rgba(var(--on),0.34)', width: 44, textAlign: 'right' }}>{jobs.length ? ((n / jobs.length) * 100).toFixed(1) + '%' : '-'}</span>
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
