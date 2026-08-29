import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { inviteStaff, setStaffRole, deactivateStaff } from '@/lib/actions';
import Shell from '@/components/Shell';
import { Desk, StatStrip, type DeskRow, type Tone } from '@/components/Desk';
import { Donut, Empty, type Slice } from '@/components/Viz';
import { fmt, ago } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

const PANEL: React.CSSProperties = { borderRadius: 13, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)', overflow: 'hidden' };
const HEAD: React.CSSProperties = { padding: '14px 16px 12px', borderBottom: '1px solid rgba(var(--on),0.10)' };
const H_TITLE: React.CSSProperties = { fontSize: 13.5, fontWeight: 700, color: 'var(--txt)' };
const H_SUB: React.CSSProperties = { fontSize: 11.3, color: 'rgba(var(--on),0.36)', marginTop: 3 };
const FIELD: React.CSSProperties = { padding: '9px 11px', borderRadius: 9, background: 'rgba(var(--on),0.035)', border: '1px solid rgba(var(--on),0.12)', fontSize: 12.3, color: 'var(--txt)', outline: 'none' };

const ROLES = ['super_admin', 'platform_admin', 'trust_safety', 'support_agent', 'ops_engineer', 'market_reviewer', 'jobs_reviewer', 'verification_reviewer', 'finance_admin', 'analyst', 'auditor_readonly'];

const DESK_COUNT: Record<string, number> = { super_admin: 17, platform_admin: 16, trust_safety: 8, support_agent: 4, ops_engineer: 5, market_reviewer: 6, jobs_reviewer: 3, verification_reviewer: 4, finance_admin: 4, analyst: 3, auditor_readonly: 3 };

const IC = {
  staff: 'M16 11c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3zm-8 0c1.7 0 3-1.3 3-3S9.7 5 8 5 5 6.3 5 8s1.3 3 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 1.9 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z',
  check: 'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z',
  shield: 'M12 2l8 3v7c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10V5l8-3z',
  x: 'M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
  gear: 'M12 8a4 4 0 100 8 4 4 0 000-8zm8.6 4a6.6 6.6 0 00-.1-1.1l2-1.6-2-3.4-2.4 1a6.9 6.9 0 00-1.9-1.1L15.8 3h-4l-.4 2.8a6.9 6.9 0 00-1.9 1.1l-2.4-1-2 3.4 2 1.6a6.6 6.6 0 000 2.2l-2 1.6 2 3.4 2.4-1a6.9 6.9 0 001.9 1.1l.4 2.8h4l.4-2.8a6.9 6.9 0 001.9-1.1l2.4 1 2-3.4-2-1.6c.1-.4.1-.7.1-1.1z',
};

const SERIES = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];

function title(s: string) { return (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

export default async function StaffPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  if (admin.role !== 'super_admin') redirect('/dashboard');
  const svc = serviceClient();

  const [{ data: staff }, { data: authList }, { data: recentActions }] = await Promise.all([
    svc.from('admin_users').select('user_id, role, active, created_at').order('created_at', { ascending: true }),
    svc.auth.admin.listUsers({ page: 1, perPage: 200 }),
    svc.from('admin_audit_log').select('admin_id, action, created_at').order('created_at', { ascending: false }).limit(500),
  ]);

  const rowsRaw = (staff ?? []) as { user_id: string; role: string; active: boolean; created_at: string }[];
  const emails: Record<string, string> = {};
  const lastSignIn: Record<string, string | null> = {};
  ((authList?.users ?? []) as { id: string; email?: string | null; last_sign_in_at?: string | null }[]).forEach(u => {
    emails[u.id] = u.email || '';
    lastSignIn[u.id] = u.last_sign_in_at || null;
  });

  const actionCount: Record<string, number> = {};
  const lastAction: Record<string, string> = {};
  ((recentActions ?? []) as { admin_id: string; action: string; created_at: string }[]).forEach(a => {
    actionCount[a.admin_id] = (actionCount[a.admin_id] || 0) + 1;
    if (!lastAction[a.admin_id]) lastAction[a.admin_id] = a.created_at;
  });

  const active = rowsRaw.filter(s => s.active);
  const admins = rowsRaw.filter(s => s.role === 'super_admin' || s.role === 'platform_admin');
  const reviewers = rowsRaw.filter(s => ['trust_safety', 'market_reviewer', 'jobs_reviewer', 'verification_reviewer'].includes(s.role));

  const roleCount: Record<string, number> = {};
  rowsRaw.forEach(s => { roleCount[s.role] = (roleCount[s.role] || 0) + 1; });
  const roleSlices: Slice[] = Object.keys(roleCount).map((k, i) => ({ label: title(k), value: roleCount[k], color: SERIES[i % SERIES.length] }));

  const cards = [
    { label: 'Staff on the desk', value: fmt(rowsRaw.length), note: 'rows in admin_users', icon: IC.staff, color: 'var(--c1)' },
    { label: 'Active', value: fmt(active.length), note: 'holding keys right now', icon: IC.check, color: 'var(--c2)' },
    { label: 'Administrators', value: fmt(admins.length), note: 'super admin and platform admin', icon: IC.shield, color: 'var(--c4)' },
    { label: 'Reviewers', value: fmt(reviewers.length), note: 'trust, market, jobs, verification', icon: IC.gear, color: 'var(--c3)' },
    { label: 'Deactivated', value: fmt(rowsRaw.length - active.length), note: 'keys withdrawn', icon: IC.x, color: 'var(--c5)' },
  ];

  const rows: DeskRow[] = rowsRaw.map(s => {
    const email = emails[s.user_id] || '';
    const isYou = s.user_id === admin.id;
    const seen = lastSignIn[s.user_id];
    return {
      id: s.user_id,
      tabs: [s.active ? 'active' : 'inactive', s.role === 'super_admin' || s.role === 'platform_admin' ? 'admins' : 'other'],
      search: [email, s.role, s.user_id].map(x => String(x || '').toLowerCase()).join(' '),
      facets: { role: title(s.role), status: s.active ? 'Active' : 'Deactivated' },
      cells: [
        { t: 'user', v: email || s.user_id.slice(0, 8), sub: isYou ? 'this is you' : title(s.role) },
        { t: 'pill', v: title(s.role), tone: s.role === 'super_admin' ? 'accent' : s.role === 'platform_admin' ? 'info' : 'neutral' },
        { t: 'pill', v: s.active ? 'Active' : 'Deactivated', tone: s.active ? 'ok' : 'neutral' },
        { t: 'mono', v: String(actionCount[s.user_id] || 0) },
        { t: 'mono', v: seen ? ago(seen) : 'never' },
        { t: 'mono', v: new Date(s.created_at).toLocaleDateString() },
      ],
      detail: {
        title: email || s.user_id.slice(0, 12),
        subtitle: title(s.role) + (isYou ? ' \u00b7 this is you' : ''),
        pills: [
          { v: title(s.role), tone: s.role === 'super_admin' ? 'accent' : 'neutral' },
          { v: s.active ? 'Active' : 'Deactivated', tone: s.active ? 'ok' : 'neutral' },
        ],
        stats: [
          { label: 'Desks', value: String(DESK_COUNT[s.role] ?? 1) },
          { label: 'Actions logged', value: String(actionCount[s.user_id] || 0) },
          { label: 'Last action', value: lastAction[s.user_id] ? ago(lastAction[s.user_id]).replace(' ago', '') : 'none' },
        ],
        fields: [
          { label: 'Email', value: email || 'not on file' },
          { label: 'Role', value: title(s.role) },
          { label: 'Status', value: s.active ? 'Active' : 'Deactivated' },
          { label: 'Joined the desk', value: new Date(s.created_at).toLocaleString() },
          { label: 'Last sign in', value: seen ? new Date(seen).toLocaleString() : 'never signed in' },
          { label: 'User id', value: s.user_id },
        ],
        links: [{ label: 'Their audit trail', href: '/audit' }],
      },
      actions: isYou ? ['role'] : (s.active ? ['role', 'deactivate'] : ['role']),
      actionId: s.user_id,
    };
  });

  const tabs = [
    { key: 'all', label: 'All staff', count: rows.length },
    { key: 'active', label: 'Active', count: active.length },
    { key: 'admins', label: 'Administrators', count: admins.length },
    { key: 'other', label: 'Specialists', count: rows.length - admins.length },
    { key: 'inactive', label: 'Deactivated', count: rows.length - active.length },
  ];

  return (
    <Shell admin={admin} active="/staff" title="Staff" sub="Who holds keys to this desk, what each role can reach, and everything they have done. Staff identities are never social accounts.">
      <StatStrip cards={cards} />

      <div className="mt-4" style={PANEL}>
        <div style={HEAD}>
          <div style={H_TITLE}>Invite an administrator</div>
          <div style={H_SUB}>A deactivated shell profile is created automatically, so staff never appear in the social graph</div>
        </div>
        <form action={inviteStaff} style={{ display: 'flex', flexWrap: 'wrap', gap: 9, padding: 16 }}>
          <input name="email" type="email" required placeholder="Email" style={{ ...FIELD, flex: '1 1 220px', minWidth: 200 }} />
          <input name="password" type="text" required minLength={10} placeholder="Temporary password, 10 characters or more" style={{ ...FIELD, flex: '1 1 240px', minWidth: 220 }} />
          <select name="role" style={{ ...FIELD, cursor: 'pointer' }}>
            {ROLES.map(r => <option key={r} value={r}>{title(r)}</option>)}
          </select>
          <button type="submit" style={{ padding: '9px 16px', borderRadius: 9, cursor: 'pointer', fontSize: 12.3, fontWeight: 600, background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none' }}>Invite</button>
        </form>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_320px]">
        <div>
          <Desk
            tabs={tabs}
            columns={[{ label: 'Staff member' }, { label: 'Role' }, { label: 'Status' }, { label: 'Actions', align: 'right' }, { label: 'Last sign in', align: 'right' }, { label: 'Joined', align: 'right' }]}
            grid="minmax(190px,2fr) 140px 118px 84px 104px 100px"
            rows={rows}
            filters={[{ key: 'role', label: 'Role', options: ROLES.map(title) }, { key: 'status', label: 'Status', options: ['Active', 'Deactivated'] }]}
            searchHint="Search staff by email or role"
            detailTitle="Staff member"
            minWidth={860}
            pageSize={12}
            actions={[
              { key: 'role', label: 'Set role', tone: 'neutral', action: setStaffRole, idName: 'uid', inputs: [{ name: 'role', options: ROLES }] },
              { key: 'deactivate', label: 'Deactivate and withdraw the keys', tone: 'bad', action: deactivateStaff, idName: 'uid' },
            ]}
          />
        </div>

        <div>
          <div style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Roles in use</div>
              <div style={H_SUB}>admin_users.role</div>
            </div>
            <div style={{ padding: 16 }}>
              {roleSlices.length === 0 ? <Empty note="No staff on file." /> : <Donut slices={roleSlices} centerLabel="staff" size={148} />}
            </div>
          </div>

          <div className="mt-4" style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Who is working</div>
              <div style={H_SUB}>Actions logged in the last 500 audit entries</div>
            </div>
            {rowsRaw.filter(s => actionCount[s.user_id]).sort((a, b) => (actionCount[b.user_id] || 0) - (actionCount[a.user_id] || 0)).slice(0, 8).map(s => (
              <div key={s.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10.5px 16px', borderBottom: '1px solid rgba(var(--on),0.10)' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emails[s.user_id] || s.user_id.slice(0, 8)}</span>
                  <span style={{ display: 'block', fontSize: 10.4, color: 'rgba(var(--on),0.32)', marginTop: 2 }}>{title(s.role)}</span>
                </span>
                <span className="pc-num" style={{ fontSize: 11.6, fontWeight: 600, color: 'var(--txt)' }}>{actionCount[s.user_id]}</span>
              </div>
            ))}
            {rowsRaw.every(s => !actionCount[s.user_id]) ? <Empty note="No action has been logged yet." /> : null}
          </div>
        </div>
      </div>
    </Shell>
  );
}
