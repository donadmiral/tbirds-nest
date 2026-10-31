/** Permission-shaped navigation and live queue counts for every operations desk. */
import { signOut } from '@/lib/actions';
import { allowedDesks, canOpen } from '@/lib/permissions';
import { notFound } from 'next/navigation';
import ThemeControls from '@/components/ThemeControls';
import SideRail from '@/components/SideRail';
import CommandPalette from '@/components/CommandPalette';
import Workspace from '@/components/Workspace';
import ShareMenu from '@/components/ShareMenu';
import PresentTray from '@/components/PresentTray';
import { deploymentEnvironment } from '@/lib/operationsReporting';
import { navigationForRole, toolsForRole, actionsForRole } from '@/lib/navigation';
import WorkspaceLauncher from '@/components/WorkspaceLauncher';
import StaffAccountMenu from '@/components/StaffAccountMenu';
import { WorkspaceBreadcrumbs, WorkspaceContext } from '@/components/WorkspaceNavigation';
import WorkspaceConnection from '@/components/WorkspaceConnection';
import { loadQueueCounts } from '@/lib/queueCounts';
import { QueueBell, QueueCountNotice, QueueCountsProvider } from '@/components/QueueCounts';

export default function Shell({ admin, active, title, crumb, sub, children, pageActions }: {
  admin: { id: string; email: string; role: string; sessionId: string }; active: string; title: React.ReactNode; crumb?: string; sub?: string; children: React.ReactNode; pageActions?: React.ReactNode;
}) {
  if (!canOpen(admin.role, active)) notFound();
  const allow = allowedDesks(admin.role);
  const counts = loadQueueCounts(admin.role);

  const groups = navigationForRole(admin.role);
  const workspaceTools = toolsForRole(admin.role);
  const destinations = groups.flatMap(group => group.items);
  const paletteItems = [...groups.flatMap(g => g.items.map(d => ({ ...d, group: g.label }))), ...workspaceTools.map(d => ({ ...d, group: 'Your workspace' }))];
  const actions = actionsForRole(admin.role);
  const roleLabel = admin.role.replace(/_/g, ' ');
  const environment = deploymentEnvironment(process.env.VERCEL_ENV, process.env.NODE_ENV);

  return (
    <QueueCountsProvider key={`${admin.id}:${admin.sessionId}:${admin.role}`} value={counts}>
    <div data-pc-staff={`${admin.id}:${admin.role}`} style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)', color: 'var(--txt)' }}>

      <SideRail groups={groups} active={active} email={admin.email} roleLabel={roleLabel} tools={workspaceTools} />

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

            <QueueBell href={['/queue', '/reports', '/support'].find(d => allow.has(d)) || '/dashboard'} />

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
          <QueueCountNotice />
          {children}
        </Workspace>
        <PresentTray />
      </main>
    </div>
    </QueueCountsProvider>
  );
}
