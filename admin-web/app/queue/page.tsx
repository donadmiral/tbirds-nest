import { redirect } from 'next/navigation';
import { getAdmin, VERIFICATION_ROLES } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { approveApplication, rejectApplication } from '@/lib/actions';
import Shell from '@/components/Shell';
import { Desk, StatStrip, type DeskRow, type Tone } from '@/components/Desk';
import { Donut, Empty, type Slice } from '@/components/Viz';
import { fmt, ago } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

const PANEL: React.CSSProperties = { borderRadius: 13, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)', overflow: 'hidden' };
const HEAD: React.CSSProperties = { padding: '14px 16px 12px', borderBottom: '1px solid rgba(var(--on),0.10)' };
const H_TITLE: React.CSSProperties = { fontSize: 13.5, fontWeight: 700, color: 'var(--txt)' };
const H_SUB: React.CSSProperties = { fontSize: 11.3, color: 'rgba(var(--on),0.36)', marginTop: 3 };

const TIER_LABEL: Record<string, string> = { public_figure: 'Green seal', business: 'Space grey seal', official: 'Platinum seal' };
const TIER_TONE: Record<string, Tone> = { public_figure: 'ok', business: 'neutral', official: 'warn' };

const IC = {
  seal: 'M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8L12 2z',
  clock: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 10.6V6h-2v7.4l5.2 3.1 1-1.7-4.2-2.2z',
  check: 'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z',
  x: 'M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
  users: 'M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z',
};

function medianHours(pairs: { created_at: string; decided_at: string }[]): number | null {
  if (pairs.length === 0) return null;
  const hrs = pairs.map(p => (new Date(p.decided_at).getTime() - new Date(p.created_at).getTime()) / 3600000).sort((a, b) => a - b);
  const mid = Math.floor(hrs.length / 2);
  return hrs.length % 2 ? hrs[mid] : (hrs[mid - 1] + hrs[mid]) / 2;
}

export default async function QueuePage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  if (!VERIFICATION_ROLES.has(admin.role)) redirect('/');
  const svc = serviceClient();

  const from30 = new Date(Date.now() - 30 * 86400000).toISOString();

  const [appsRes, decidedRes, approvedAllRes, rejectedAllRes, approved30Res, totalRes] = await Promise.all([
    svc.from('verification_applications').select('*').in('status', ['submitted', 'under_review']).order('created_at', { ascending: true }),
    svc.from('verification_applications').select('id, applicant_id, tier, category, status, created_at, decided_at, decision_reason').not('decided_at', 'is', null).order('decided_at', { ascending: false }).limit(60),
    svc.from('verification_applications').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    svc.from('verification_applications').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
    svc.from('verification_applications').select('id', { count: 'exact', head: true }).eq('status', 'approved').gte('decided_at', from30),
    svc.from('verification_applications').select('id', { count: 'exact', head: true }),
  ]);

  const appsRaw = (appsRes.data ?? []) as Record<string, unknown>[];
  const decided = (decidedRes.data ?? []) as { id: string; applicant_id: string; tier: string; category: string | null; status: string; created_at: string; decided_at: string; decision_reason: string | null }[];

  const refByApp: Record<string, { referrer_id: string; note: string | null }[]> = {};
  const refNames: Record<string, { full_name: string | null; username: string | null }> = {};
  if (appsRaw.length) {
    const { data: refs } = await svc.from('verification_referrals').select('application_id, referrer_id, note').in('application_id', appsRaw.map(a => String(a.id)));
    (refs ?? []).forEach((r: { application_id: string; referrer_id: string; note: string | null }) => { (refByApp[r.application_id] = refByApp[r.application_id] || []).push(r); });
    const rids = Array.from(new Set((refs ?? []).map((r: { referrer_id: string }) => r.referrer_id)));
    if (rids.length) {
      const { data: rp } = await svc.from('profiles').select('id, full_name, username').in('id', rids);
      (rp ?? []).forEach((p: { id: string; full_name: string | null; username: string | null }) => { refNames[p.id] = p; });
    }
  }

  const sortedApps = appsRaw.slice().sort((a, b) =>
    ((refByApp[String(b.id)]?.length || 0) - (refByApp[String(a.id)]?.length || 0)) || String(a.created_at).localeCompare(String(b.created_at)));

  const ids = Array.from(new Set([...sortedApps.map(a => String(a.applicant_id)), ...decided.map(d => d.applicant_id)]));
  const profiles: Record<string, { full_name: string | null; username: string | null; avatar_url: string | null; account_type: string | null; created_at: string; location: string | null }> = {};
  const strikeCounts: Record<string, number> = {};
  if (ids.length) {
    const [{ data: profs }, strikeRows] = await Promise.all([
      svc.from('profiles').select('id, full_name, username, avatar_url, account_type, created_at, location').in('id', ids),
      Promise.all(sortedApps.map(async a => ({ id: String(a.applicant_id), n: (await svc.from('member_strikes').select('id', { count: 'exact', head: true }).eq('user_id', String(a.applicant_id))).count ?? 0 }))),
    ]);
    (profs ?? []).forEach((p: { id: string; full_name: string | null; username: string | null; avatar_url: string | null; account_type: string | null; created_at: string; location: string | null }) => { profiles[p.id] = p; });
    strikeRows.forEach(r => { strikeCounts[r.id] = r.n; });
  }

  const median = medianHours(decided.filter(d => d.decided_at).map(d => ({ created_at: d.created_at, decided_at: d.decided_at })));
  const total = totalRes.count ?? 0;
  const approvedAll = approvedAllRes.count ?? 0;
  const rejectedAll = rejectedAllRes.count ?? 0;

  const tierCount: Record<string, number> = {};
  sortedApps.forEach(a => { const t = String(a.tier || 'unspecified'); tierCount[t] = (tierCount[t] || 0) + 1; });
  const tierSlices: Slice[] = Object.keys(tierCount).map(k => ({ label: TIER_LABEL[k] || k, value: tierCount[k], color: k === 'public_figure' ? 'var(--ok)' : k === 'official' ? 'var(--pearl)' : 'rgba(var(--on),0.34)' }));

  const cards = [
    { label: 'All requests', value: fmt(total), note: 'verification_applications, all time', icon: IC.seal, color: 'var(--c1)' },
    { label: 'Pending review', value: fmt(sortedApps.length), note: 'submitted and under review', icon: IC.clock, color: 'var(--c3)' },
    { label: 'Approved', value: fmt(approvedAll), note: fmt(approved30Res.count ?? 0) + ' in the last 30 days', icon: IC.check, color: 'var(--c2)' },
    { label: 'Rejected', value: fmt(rejectedAll), note: 'with a written reason', icon: IC.x, color: 'var(--c5)' },
    { label: 'Median decision', value: median === null ? '-' : (median < 48 ? median.toFixed(1) + 'h' : (median / 24).toFixed(1) + 'd'), note: 'measured on decided applications', icon: IC.clock, color: 'var(--c6)' },
  ];

  const pendingRows: DeskRow[] = sortedApps.map(a => {
    const id = String(a.id);
    const uid = String(a.applicant_id);
    const p = profiles[uid] || { full_name: null, username: null, avatar_url: null, account_type: null, created_at: String(a.created_at), location: null };
    const tier = String(a.tier || 'unspecified');
    const vouches = refByApp[id] || [];
    const strikes = strikeCounts[uid] || 0;
    const fields = [
      { label: 'Tier requested', value: TIER_LABEL[tier] || tier },
      { label: 'Category', value: String(a.category || 'not given') },
      { label: 'Account type', value: String(p.account_type || 'personal') },
      { label: 'Applied', value: new Date(String(a.created_at)).toLocaleString() },
      { label: 'Member since', value: new Date(p.created_at).toLocaleDateString() },
      { label: 'Status', value: String(a.status) },
      { label: 'Request id', value: id },
    ];
    if (p.location) fields.splice(3, 0, { label: 'Location', value: p.location });
    ['evidence', 'evidence_url', 'links', 'website', 'contact_email', 'phone', 'notes', 'real_name', 'id_document', 'followers'].forEach(k => {
      const v = a[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') fields.push({ label: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), value: String(v) });
    });
    const vouchText = vouches.length
      ? vouches.map(v => (refNames[v.referrer_id]?.full_name || '@' + (refNames[v.referrer_id]?.username || 'member')) + (v.note ? ' - ' + v.note : '')).join('\n')
      : '';
    return {
      id,
      tabs: ['pending', tier === 'public_figure' ? 'people' : tier === 'business' ? 'business' : 'official', ...(vouches.length ? ['vouched'] : []), ...(strikes > 0 ? ['risky'] : [])],
      search: [p.full_name, p.username, a.category, tier].map(x => String(x || '').toLowerCase()).join(' '),
      facets: { tier: TIER_LABEL[tier] || tier },
      cells: [
        { t: 'user', v: p.full_name || 'Unnamed', sub: '@' + (p.username || 'member'), img: p.avatar_url },
        { t: 'pill', v: TIER_LABEL[tier] || tier, tone: TIER_TONE[tier] || 'neutral' },
        { t: 'dim', v: String(a.category || '-') },
        { t: 'mono', v: String(vouches.length) },
        { t: 'mono', v: String(strikes), tone: strikes > 0 ? 'bad' : undefined },
        { t: 'mono', v: ago(String(a.created_at)) },
      ],
      detail: {
        title: p.full_name || 'Unnamed applicant',
        subtitle: '@' + (p.username || 'member') + ' \u00b7 waiting ' + ago(String(a.created_at)),
        img: p.avatar_url,
        pills: [
          { v: TIER_LABEL[tier] || tier, tone: TIER_TONE[tier] || 'neutral' },
          ...(vouches.length ? [{ v: vouches.length + ' vouches', tone: 'info' as Tone }] : []),
          ...(strikes > 0 ? [{ v: strikes + ' strikes', tone: 'bad' as Tone }] : []),
        ],
        stats: [
          { label: 'Vouches', value: String(vouches.length) },
          { label: 'Strikes', value: String(strikes) },
          { label: 'Waiting', value: ago(String(a.created_at)).replace(' ago', '') },
        ],
        fields,
        body: vouchText ? [{ label: 'Who vouched', text: vouchText }] : undefined,
        links: [{ label: 'Open profile', href: '/users/' + uid }],
      },
      actions: ['approve', 'reject'],
    };
  });

  const decidedRows: DeskRow[] = decided.map(d => {
    const p = profiles[d.applicant_id] || { full_name: null, username: null, avatar_url: null, account_type: null, created_at: d.created_at, location: null };
    const ok = d.status === 'approved';
    return {
      id: 'decided-' + d.id,
      tabs: ['decided'],
      search: [p.full_name, p.username, d.category, d.tier, d.status].map(x => String(x || '').toLowerCase()).join(' '),
      facets: { tier: TIER_LABEL[d.tier] || d.tier },
      cells: [
        { t: 'user', v: p.full_name || 'Unnamed', sub: '@' + (p.username || 'member'), img: p.avatar_url },
        { t: 'pill', v: ok ? 'Approved' : 'Rejected', tone: ok ? 'ok' : 'bad' },
        { t: 'dim', v: d.category || '-' },
        { t: 'mono', v: '-' },
        { t: 'mono', v: '-' },
        { t: 'mono', v: ago(d.decided_at) },
      ],
      detail: {
        title: p.full_name || 'Unnamed applicant',
        subtitle: (ok ? 'Approved ' : 'Rejected ') + ago(d.decided_at),
        img: p.avatar_url,
        pills: [{ v: ok ? 'Approved' : 'Rejected', tone: ok ? 'ok' : 'bad' }, { v: TIER_LABEL[d.tier] || d.tier, tone: TIER_TONE[d.tier] || 'neutral' }],
        fields: [
          { label: 'Applied', value: new Date(d.created_at).toLocaleString() },
          { label: 'Decided', value: new Date(d.decided_at).toLocaleString() },
          { label: 'Turnaround', value: ((new Date(d.decided_at).getTime() - new Date(d.created_at).getTime()) / 3600000).toFixed(1) + ' hours' },
          { label: 'Category', value: d.category || 'not given' },
        ],
        body: d.decision_reason ? [{ label: 'Reason given to the member', text: d.decision_reason }] : undefined,
        links: [{ label: 'Open profile', href: '/users/' + d.applicant_id }],
      },
    };
  });

  const rows = [...pendingRows, ...decidedRows];

  const tabs = [
    { key: 'pending', label: 'Pending review', count: pendingRows.length },
    { key: 'people', label: 'People', count: rows.filter(r => r.tabs.includes('people')).length },
    { key: 'business', label: 'Businesses', count: rows.filter(r => r.tabs.includes('business')).length },
    { key: 'vouched', label: 'Vouched', count: rows.filter(r => r.tabs.includes('vouched')).length },
    { key: 'risky', label: 'Carrying strikes', count: rows.filter(r => r.tabs.includes('risky')).length },
    { key: 'decided', label: 'Decided', count: decidedRows.length },
  ];

  return (
    <Shell admin={admin} active="/queue" title="Verification" sub="Review and decide every verification request. Vouched applications rise to the top, then the ones that have waited longest.">
      <StatStrip cards={cards} />

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_320px]">
        <div>
          <Desk
            tabs={tabs}
            columns={[{ label: 'Account' }, { label: 'Tier' }, { label: 'Category' }, { label: 'Vouches', align: 'right' }, { label: 'Strikes', align: 'right' }, { label: 'Waiting', align: 'right' }]}
            grid="minmax(180px,2fr) 130px minmax(110px,1fr) 80px 74px 92px"
            rows={rows}
            filters={[{ key: 'tier', label: 'Tier', options: Array.from(new Set(rows.map(r => r.facets?.tier || ''))).filter(Boolean) }]}
            searchHint="Search by name, username or category"
            detailTitle="Request"
            minWidth={800}
            pageSize={12}
            actions={[
              { key: 'approve', label: 'Approve and grant the seal', tone: 'ok', action: approveApplication, idName: 'id' },
              { key: 'reject', label: 'Reject', tone: 'bad', action: rejectApplication, idName: 'id', inputs: [{ name: 'reason', placeholder: 'Reason the member will see', required: true }] },
            ]}
          />
        </div>

        <div>
          <div style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>What is waiting</div>
              <div style={H_SUB}>Pending requests by tier</div>
            </div>
            <div style={{ padding: 16 }}>
              {tierSlices.length === 0 ? <Empty note="Nothing is waiting for a decision." /> : <Donut slices={tierSlices} centerLabel="waiting" size={148} />}
            </div>
          </div>

          <div className="mt-4" style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Recent decisions</div>
              <div style={H_SUB}>Newest first, with turnaround</div>
            </div>
            {decided.length === 0 ? <Empty note="No application has been decided yet." /> : decided.slice(0, 8).map(d => {
              const p = profiles[d.applicant_id];
              const ok = d.status === 'approved';
              return (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10.5px 16px', borderBottom: '1px solid rgba(var(--on),0.10)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', flex: '0 0 6px', background: ok ? 'var(--ok)' : 'var(--bad)' }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p?.full_name || '@' + (p?.username || 'member')}</span>
                    <span style={{ display: 'block', fontSize: 10.4, color: 'rgba(var(--on),0.32)', marginTop: 2 }}>{TIER_LABEL[d.tier] || d.tier}</span>
                  </span>
                  <span className="pc-num" style={{ fontSize: 10.5, color: 'rgba(var(--on),0.3)' }}>{ago(d.decided_at)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Shell>
  );
}
