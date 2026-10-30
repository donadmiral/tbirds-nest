import { allowedDesks } from '@/lib/permissions';
import { staffIdentities } from '@/lib/staffDirectory';
import { completeRead } from '@/lib/completeRead';
import CommandForm from '@/components/CommandForm';
import PermissionGate from '@/components/PermissionGate';
import { redirect } from 'next/navigation';
import { requireDesk } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { inviteStaff, setStaffRole, deactivateStaff } from '@/lib/actions';
import Shell from '@/components/Shell';
import { Desk, StatStrip, type DeskRow, type Tone } from '@/components/Desk';
import { Donut, Empty, type Slice } from '@/components/Viz';
import { fmt, ago } from '@/lib/fmt';
import Link from 'next/link';
import AdminIcon from '@/components/AdminIcon';
import StaffRoleGuide from '@/components/StaffRoleGuide';
import RefreshDesk from '@/components/RefreshDesk';

export const dynamic = 'force-dynamic';

const PANEL: React.CSSProperties = { borderRadius: 12, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)', overflow: 'hidden' };
const HEAD: React.CSSProperties = { padding: '14px 16px 12px', borderBottom: '1px solid rgba(var(--on),0.10)' };
const H_TITLE: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: 'var(--txt)' };
const H_SUB: React.CSSProperties = { fontSize: 12, color: 'var(--txt-muted)', marginTop: 3 };
const FIELD: React.CSSProperties = { padding: '9px 11px', borderRadius: 9, background: 'rgba(var(--on),0.035)', border: '1px solid rgba(var(--on),0.12)', fontSize: 13, color: 'var(--txt)', outline: 'none' };

const ROLES = ['super_admin', 'platform_admin', 'trust_safety', 'support_agent', 'ops_engineer', 'market_reviewer', 'jobs_reviewer', 'verification_reviewer', 'finance_admin', 'analyst', 'auditor_readonly'];


const IC = {
  staff: 'staff',
  check: 'check',
  shield: 'security',
  x: 'close',
  gear: 'controls',
} as const;

const SERIES = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];

function title(s: string) { return (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

export default async function StaffPage() {
  const admin = await requireDesk('/staff');
  const svc = serviceClient();

  const [staffResult, auditResult] = await Promise.all([
    svc.from('admin_users').select('user_id, role, active, created_at', { count: 'exact' }).order('created_at', { ascending: true }),
    svc.from('admin_audit_log').select('admin_id, action, created_at').order('created_at', { ascending: false }).limit(500),
  ]);

  completeRead(staffResult, 'Staff directory');
  const staff = staffResult.data;
  if (auditResult.error) throw new Error('Staff activity could not be loaded. Retry the directory.');
  const recentActions = auditResult.data;
  const authUsers = await staffIdentities(staff ?? [], id => svc.auth.admin.getUserById(id));
  const rowsRaw = (staff ?? []) as { user_id: string; role: string; active: boolean; created_at: string }[];
  const emails: Record<string, string> = {};
  const lastSignIn: Record<string, string | null> = {};
  (authUsers as { id: string; email?: string | null; last_sign_in_at?: string | null }[]).forEach(u => {
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
    { label: 'Staff on the desk', value: fmt(rowsRaw.length), note: 'accounts with operations access', icon: IC.staff, color: 'var(--c1)' },
    { label: 'Active', value: fmt(active.length), note: 'staff access enabled', icon: IC.check, color: 'var(--c2)' },
    { label: 'Administrators', value: fmt(admins.length), note: 'super admin and platform admin', icon: IC.shield, color: 'var(--c4)' },
    { label: 'Reviewers', value: fmt(reviewers.length), note: 'trust, market, jobs, verification', icon: IC.gear, color: 'var(--c3)' },
    { label: 'Deactivated', value: fmt(rowsRaw.length - active.length), note: 'staff access disabled', icon: IC.x, color: 'var(--c5)' },
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
          { label: 'Desks', value: String(allowedDesks(s.role).size) },
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
        links: [{ label: 'Their audit trail', href: '/audit?actor=' + encodeURIComponent(s.user_id) }],
      },
      actions: isYou ? ['role'] : (s.active ? ['role', 'deactivate'] : ['role']),
      actionId: s.user_id,
      actionDefaults: { role: { role: s.role } },
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
    <Shell admin={admin} active="/staff" title="Staff & access" sub="Manage operations access, role permissions and recorded staff activity." pageActions={<><RefreshDesk /><StaffRoleGuide /><Link href="#staff-invite" className="pc-button pc-button-primary"><AdminIcon name="plus" size={18} />Add staff member</Link></>}>
      <StatStrip cards={cards} />

      <section id="staff-invite" tabIndex={-1} className="pc-anchor pc-staff-invite mt-4" style={PANEL}>
        <div style={HEAD}>
          <h2 style={{ ...H_TITLE, margin: 0 }}>Add a staff member</h2>
          <div style={H_SUB}>Create a staff login and choose the access it needs. New staff profiles stay outside the social graph.</div>
        </div>
        <PermissionGate role={admin.role} permission="staff_manage"><CommandForm scope="inviteStaff" action={inviteStaff} resetOnSuccess style={{ display: 'flex', flexWrap: 'wrap', gap: 14, padding: 20 }}>
          <label className="pc-staff-field">Staff email<input name="email" type="email" autoComplete="off" aria-label="Staff email" required placeholder="name@company.com" style={FIELD} /></label>
          <label className="pc-staff-field">Temporary password<input name="password" type="password" autoComplete="new-password" aria-label="Temporary password, at least 12 characters" required minLength={12} placeholder="12 characters or more" style={FIELD} /></label>
          <label className="pc-staff-field">Staff role<select name="role" aria-label="Staff role" defaultValue="auditor_readonly" style={{ ...FIELD, cursor: 'pointer' }}>
            {ROLES.map(r => <option key={r} value={r}>{title(r)}</option>)}
          </select></label>
          <button type="submit" className="pc-button pc-button-primary" style={{ alignSelf: 'end' }}>Create staff account</button>
          <p className="pc-staff-form-help">New accounts start with read-only access unless you choose another role. This creates the login; it does not send an invitation email.</p>
        </CommandForm></PermissionGate>
      </section>

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
              { key: 'role', label: 'Save role', tone: 'neutral', action: setStaffRole, idName: 'uid', inputs: [{ name: 'role', label: 'Staff role', options: ROLES, help: 'The current role is selected. Review access before changing it. Saving a role also enables the staff account.' }] },
              { key: 'deactivate', label: 'Deactivate staff access', tone: 'bad', action: deactivateStaff, idName: 'uid' },
            ]}
          />
        </div>

        <div>
          <div style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Roles in use</div>
              <div style={H_SUB}>Assigned access across staff accounts</div>
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
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--txt-muted)', marginTop: 2 }}>{title(s.role)}</span>
                </span>
                <span className="pc-num" style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>{actionCount[s.user_id]}</span>
              </div>
            ))}
            {rowsRaw.every(s => !actionCount[s.user_id]) ? <Empty note="No action has been logged yet." /> : null}
          </div>
        </div>
      </div>
    </Shell>
  );
}
