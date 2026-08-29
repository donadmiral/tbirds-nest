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
  list: 'M4 5h16v2H4V5zm0 6h16v2H4v-2zm0 6h10v2H4v-2z',
  staff: 'M16 11c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3zm-8 0c1.7 0 3-1.3 3-3S9.7 5 8 5 5 6.3 5 8s1.3 3 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 1.9 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z',
  alert: 'M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z',
  clock: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 10.6V6h-2v7.4l5.2 3.1 1-1.7-4.2-2.2z',
  target: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 3a7 7 0 110 14 7 7 0 010-14zm0 2.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9z',
};

const SERIES = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];
const HEAVY = ['suspend', 'ban', 'remove', 'reject', 'deactivate', 'revoke', 'strike'];

function title(s: string) { return (s || '').replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function isHeavy(action: string) { return HEAVY.some(h => action.toLowerCase().includes(h)); }

export default async function AuditPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();

  const now = Date.now();
  const from30 = new Date(now - 30 * 86400000).toISOString();
  const today = new Date(now).toISOString().slice(0, 10);
  const days30 = Array.from({ length: 30 }, (_, i) => new Date(now - (29 - i) * 86400000).toISOString().slice(0, 10));

  const [{ data: rowsData, count }, { data: staff }, { data: authList }] = await Promise.all([
    svc.from('admin_audit_log').select('id, admin_id, action, target_kind, target_id, reason, before, after, created_at', { count: 'exact' })
      .order('created_at', { ascending: false }).limit(400),
    svc.from('admin_users').select('user_id, role'),
    svc.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ]);

  const rowsRaw = (rowsData ?? []) as {
    id: string; admin_id: string; action: string; target_kind: string | null; target_id: string | null;
    reason: string | null; before: unknown; after: unknown; created_at: string;
  }[];

  const roleOf: Record<string, string> = {};
  ((staff ?? []) as { user_id: string; role: string }[]).forEach(s => { roleOf[s.user_id] = s.role; });
  const emails: Record<string, string> = {};
  ((authList?.users ?? []) as { id: string; email?: string | null }[]).forEach(u => { emails[u.id] = u.email || ''; });
  const who = (id: string) => emails[id] || (id ? id.slice(0, 8) : 'system');

  const actionCount: Record<string, number> = {};
  const kindCount: Record<string, number> = {};
  rowsRaw.forEach(r => {
    const family = r.action.split('.')[0] || 'other';
    actionCount[family] = (actionCount[family] || 0) + 1;
    const k = r.target_kind || 'unspecified';
    kindCount[k] = (kindCount[k] || 0) + 1;
  });
  const familySlices: Slice[] = Object.keys(actionCount).sort((a, b) => actionCount[b] - actionCount[a]).slice(0, 6)
    .map((k, i) => ({ label: title(k), value: actionCount[k], color: SERIES[i % SERIES.length] }));

  const todayCount = rowsRaw.filter(r => r.created_at.slice(0, 10) === today).length;
  const heavy = rowsRaw.filter(r => isHeavy(r.action));
  const actors = new Set(rowsRaw.map(r => r.admin_id)).size;
  const last30 = rowsRaw.filter(r => r.created_at >= from30).length;

  const dayRows = days30.map(d => ({
    day: d,
    routine: rowsRaw.filter(r => r.created_at.slice(0, 10) === d && !isHeavy(r.action)).length,
    heavy: rowsRaw.filter(r => r.created_at.slice(0, 10) === d && isHeavy(r.action)).length,
  } as Record<string, number | string>));
  const spark = days30.map(d => rowsRaw.filter(r => r.created_at.slice(0, 10) === d).length);

  const cards = [
    { label: 'Actions on file', value: fmt(count ?? rowsRaw.length), note: 'admin_audit_log, immutable', icon: IC.list, color: 'var(--c1)', spark },
    { label: 'In the last 30 days', value: fmt(last30), note: 'of the newest 400 loaded', icon: IC.clock, color: 'var(--c2)', spark },
    { label: 'Today', value: fmt(todayCount), note: 'since midnight', icon: IC.clock, color: 'var(--c3)' },
    { label: 'Heavy actions', value: fmt(heavy.length), note: 'removals, suspensions, revocations', icon: IC.alert, color: 'var(--c5)' },
    { label: 'Staff involved', value: fmt(actors), note: 'distinct administrators', icon: IC.staff, color: 'var(--c4)' },
  ];

  const rows: DeskRow[] = rowsRaw.map(r => {
    const heavyOne = isHeavy(r.action);
    const family = r.action.split('.')[0] || 'other';
    const beforeText = r.before && Object.keys(r.before as object).length ? JSON.stringify(r.before, null, 2) : '';
    const afterText = r.after && Object.keys(r.after as object).length ? JSON.stringify(r.after, null, 2) : '';
    return {
      id: r.id,
      tabs: [heavyOne ? 'heavy' : 'routine', family],
      search: [r.action, r.reason, r.target_kind, r.target_id, who(r.admin_id)].map(x => String(x || '').toLowerCase()).join(' '),
      facets: { family: title(family), kind: title(r.target_kind || 'unspecified') },
      cells: [
        { t: 'mono', v: new Date(r.created_at).toLocaleString() },
        { t: 'text', v: title(r.action), strong: true },
        { t: 'text', v: who(r.admin_id) },
        { t: 'dim', v: title(r.target_kind || '-') },
        { t: 'dim', v: r.reason || '-' },
        { t: 'pill', v: heavyOne ? 'Heavy' : 'Routine', tone: (heavyOne ? 'bad' : 'neutral') as Tone },
      ],
      detail: {
        title: title(r.action),
        subtitle: 'by ' + who(r.admin_id) + ' \u00b7 ' + ago(r.created_at),
        pills: [
          { v: heavyOne ? 'Heavy action' : 'Routine', tone: (heavyOne ? 'bad' : 'neutral') as Tone },
          ...(roleOf[r.admin_id] ? [{ v: title(roleOf[r.admin_id]), tone: 'info' as Tone }] : []),
        ],
        fields: [
          { label: 'When', value: new Date(r.created_at).toLocaleString() },
          { label: 'Performed by', value: who(r.admin_id) },
          { label: 'Role at the time', value: roleOf[r.admin_id] ? title(roleOf[r.admin_id]) : 'not on the desk now' },
          { label: 'Target kind', value: title(r.target_kind || 'unspecified') },
          { label: 'Target id', value: r.target_id || 'none' },
          { label: 'Entry id', value: r.id },
        ],
        body: [
          ...(r.reason ? [{ label: 'Reason recorded', text: r.reason }] : []),
          ...(beforeText ? [{ label: 'Before', text: beforeText }] : []),
          ...(afterText ? [{ label: 'After', text: afterText }] : []),
        ],
        links: r.target_kind === 'profile' && r.target_id ? [{ label: 'Open the member', href: '/users/' + r.target_id }] : undefined,
      },
    };
  });

  const families = Object.keys(actionCount).sort((a, b) => actionCount[b] - actionCount[a]);
  const tabs = [
    { key: 'all', label: 'All actions', count: rows.length },
    { key: 'heavy', label: 'Heavy', count: heavy.length },
    { key: 'routine', label: 'Routine', count: rows.length - heavy.length },
    ...families.slice(0, 3).map(f => ({ key: f, label: title(f), count: actionCount[f] })),
  ];

  return (
    <Shell admin={admin} active="/audit" title="Audit log" sub="Every administrative action, immutable, newest first. Nothing on this desk can be edited or deleted, including by the person who did it.">
      <StatStrip cards={cards} />

      <div className="mt-4" style={PANEL}>
        <div style={HEAD}>
          <div style={H_TITLE}>Desk activity by day</div>
          <div style={H_SUB}>Routine against heavy actions, last 30 days</div>
        </div>
        <div style={{ padding: '18px 16px 14px' }}>
          <StackBars days={dayRows} height={140} series={[
            { key: 'routine', label: 'Routine', color: 'var(--c1)' },
            { key: 'heavy', label: 'Heavy', color: 'var(--bad)' },
          ]} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_320px]">
        <div>
          <Desk
            tabs={tabs}
            columns={[{ label: 'When' }, { label: 'Action' }, { label: 'By' }, { label: 'Target' }, { label: 'Reason' }, { label: 'Weight', align: 'right' }]}
            grid="150px minmax(150px,1.4fr) minmax(140px,1.2fr) 110px minmax(140px,1.6fr) 92px"
            rows={rows}
            filters={[
              { key: 'family', label: 'Area', options: families.map(title) },
              { key: 'kind', label: 'Target', options: Object.keys(kindCount).map(title) },
            ]}
            searchHint="Search actions, reasons, targets, staff"
            detailTitle="Action"
            minWidth={960}
            pageSize={14}
          />
        </div>

        <div>
          <div style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Where the work happens</div>
              <div style={H_SUB}>Actions grouped by area</div>
            </div>
            <div style={{ padding: 16 }}>
              {familySlices.length === 0 ? <Empty note="Nothing has been logged yet." /> : <Donut slices={familySlices} centerLabel="actions" size={148} />}
            </div>
          </div>

          <div className="mt-4" style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Most touched</div>
              <div style={H_SUB}>Target kinds by action count</div>
            </div>
            {Object.keys(kindCount).length === 0 ? <Empty note="No target recorded yet." /> : Object.entries(kindCount).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, n]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10.5px 16px', borderBottom: '1px solid rgba(var(--on),0.10)' }}>
                <span style={{ flex: 1, fontSize: 12, color: 'rgba(var(--on),0.62)' }}>{title(k)}</span>
                <span className="pc-num" style={{ fontSize: 11.6, fontWeight: 600, color: 'var(--txt)' }}>{n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}
