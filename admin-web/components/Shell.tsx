/** Permission-shaped navigation and live queue counts for every operations desk. */
import Link from 'next/link';
import { signOut } from '@/lib/actions';
import { serviceClient } from '@/lib/supabaseAdmin';
import { allowedDesks, canOpen, canPerform } from '@/lib/permissions';
import { notFound } from 'next/navigation';
import ThemeControls from '@/components/ThemeControls';
import SideRail from '@/components/SideRail';
import CommandPalette from '@/components/CommandPalette';
import Workspace from '@/components/Workspace';
import ShareMenu from '@/components/ShareMenu';
import PresentTray from '@/components/PresentTray';
import { deploymentEnvironment } from '@/lib/operationsReporting';
import { navigationForRole, toolsForRole, actionsForRole } from '@/lib/navigation';
import AdminIcon from '@/components/AdminIcon';
import WorkspaceLauncher from '@/components/WorkspaceLauncher';
import StaffAccountMenu from '@/components/StaffAccountMenu';
import { WorkspaceBreadcrumbs, WorkspaceContext } from '@/components/WorkspaceNavigation';
import WorkspaceConnection from '@/components/WorkspaceConnection';

export default async function Shell({ admin, active, title, crumb, sub, children, pageActions }: {
  admin: { id: string; email: string; role: string }; active: string; title: React.ReactNode; crumb?: string; sub?: string; children: React.ReactNode; pageActions?: React.ReactNode;
}) {
  if (!canOpen(admin.role, active)) notFound();
  const allow = allowedDesks(admin.role);
  const none = { count: 0, error: null };
  const svc = serviceClient();
  const [apps, p1, p2, p3, tk] = await Promise.all([
    allow.has('/queue') ? svc.from('verification_applications').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'under_review']) : none,
    canPerform(admin.role, 'report_post') ? svc.from('post_reports').select('id', { count: 'exact', head: true }).eq('status', 'open') : none,
    canPerform(admin.role, 'report_listing') ? svc.from('listing_reports').select('id', { count: 'exact', head: true }).eq('status', 'open') : none,
    canPerform(admin.role, 'report_user') ? svc.from('user_reports').select('id', { count: 'exact', head: true }).eq('status', 'open') : none,
    allow.has('/support') ? svc.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open') : none,
  ]);
  const countError = [apps, p1, p2, p3, tk].some(result => result.error || result.count === null);
  const queueCount = apps.error ? null : apps.count;
  const reportCount = [p1, p2, p3].some(result => result.error || result.count === null) ? null : (p1.count ?? 0) + (p2.count ?? 0) + (p3.count ?? 0);
  const supportCount = tk.error ? null : tk.count;
  const alerts = countError ? null : (queueCount ?? 0) + (reportCount ?? 0) + (supportCount ?? 0);
  const counts: Record<string, number | null> = { '/queue': queueCount, '/reports': reportCount, '/support': supportCount };

  const groups = navigationForRole(admin.role);
  const workspaceTools = toolsForRole(admin.role);
  const destinations = groups.flatMap(group => group.items);
  const paletteItems = [...groups.flatMap(g => g.items.map(d => ({ ...d, group: g.label }))), ...workspaceTools.map(d => ({ ...d, group: 'Your workspace' }))];
  const actions = actionsForRole(admin.role);
  const roleLabel = admin.role.replace(/_/g, ' ');
  const environment = deploymentEnvironment(process.env.VERCEL_ENV, process.env.NODE_ENV);

  return (
    <div data-pc-staff={`${admin.id}:${admin.role}`} style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)', color: 'var(--txt)' }}>

      <SideRail groups={groups} counts={counts} active={active} email={admin.email} roleLabel={roleLabel} tools={workspaceTools} />

      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>

        <header className="pc-topbar" style={{ position: 'sticky', top: 0, zIndex: 30, background: 'var(--topbar)', borderBottom: '1px solid var(--line)' }}>

          <WorkspaceBreadcrumbs items={destinations} active={active} label={crumb ?? (typeof title === 'string' ? title : 'Workspace')} />

          <CommandPalette items={paletteItems} actions={actions} />

          <div className="pc-topbar-actions">

            <WorkspaceLauncher groups={groups} tools={workspaceTools} />

            <ShareMenu path={active} label={crumb ?? (typeof title === 'string' ? title : '')} />

            <ThemeControls />

            <div title="Deployment environment; not a service-health indicator" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4.5px 9px', borderRadius: 999, background: `rgba(var(--${environment.tone}-rgb),0.09)`, border: `1px solid rgba(var(--${environment.tone}-rgb),0.22)` }}>
              <span aria-hidden style={{ width: 5.5, height: 5.5, borderRadius: '50%', background: `var(--${environment.tone})` }} />
              <span style={{ fontSize: 10.5, fontWeight: 600, color: `var(--${environment.tone})`, letterSpacing: '0.02em' }}>{environment.label}</span>
            </div>

            <Link href={['/queue', '/reports', '/support'].find(d => allow.has(d)) || '/dashboard'} aria-label={alerts === null ? 'Work queues; counts unavailable' : `${alerts} items waiting for review`} title="Work waiting" className="pc-icon-btn" style={{ position: 'relative', width: 38, height: 38, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)' }}>
              <AdminIcon name="bell" size={19} />
              {alerts !== null && alerts > 0 ? (
                <span className="pc-num" style={{ position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, padding: '0 3.5px', borderRadius: 999, background: 'var(--alert)', color: 'var(--alert-ink)', fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--bg)' }}>{alerts}</span>
              ) : null}
            </Link>

            <StaffAccountMenu email={admin.email} role={admin.role} signOut={signOut} />
          </div>
        </header>

        <Workspace>
          <WorkspaceConnection />
          <WorkspaceContext items={destinations} active={active} />
          <div className="pc-page-heading">
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="pc-page-kicker">{groups.find(group => group.items.some(item => item.href === active))?.label || 'Operations'}</p>
              <h1 className="pc-page-title">{title}</h1>
              {sub ? <p className="pc-page-subtitle">{sub}</p> : null}
            </div>
            {pageActions ? <div className="pc-page-actions">{pageActions}</div> : null}
          </div>
          {countError ? <p role="status" className="pc-service-notice">Some queue counts could not be loaded. Open the relevant desk or refresh to try again.</p> : null}
          {children}
        </Workspace>
        <PresentTray />
      </main>
    </div>
  );
}
