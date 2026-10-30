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
import { GROUPS, ACTIONS } from '@/lib/navigation';

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

  const groups = GROUPS.map(g => ({ ...g, items: g.items.filter(d => allow.has(d.href)) })).filter(g => g.items.length > 0);
  const paletteItems = groups.flatMap(g => g.items.map(d => ({ href: d.href, label: d.label, group: g.label, key: d.key })));
  const actions = ACTIONS.filter(a => allow.has(a.href));
  const local = (admin.email || '').split('@')[0] || 'desk';
  const initial = (admin.email || '?').slice(0, 1).toUpperCase();
  const roleLabel = admin.role.replace(/_/g, ' ');
  const roleShort = admin.role.split('_').map(w => w[0]).join('').toUpperCase();
  const environment = deploymentEnvironment(process.env.VERCEL_ENV, process.env.NODE_ENV);

  return (
    <div data-pc-staff={`${admin.id}:${admin.role}`} style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)', color: 'var(--txt)' }}>

      <SideRail groups={groups} counts={counts} active={active} email={admin.email} roleLabel={roleLabel} />

      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>

        <header className="pc-topbar" style={{ position: 'sticky', top: 0, zIndex: 30, background: 'var(--topbar)', borderBottom: '1px solid var(--line)' }}>

          <div className="pc-breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
            <Link href="/dashboard" className="pc-crumb" style={{ color: 'var(--txt-muted)', fontWeight: 500, textDecoration: 'none' }}>Operations</Link>
            <span style={{ color: 'var(--txt-muted)' }}>/</span>
            <span style={{ fontWeight: 600, color: 'var(--txt)' }}>{crumb ?? title}</span>
          </div>

          <CommandPalette items={paletteItems} actions={actions} />

          <div className="pc-topbar-actions">

            <ShareMenu path={active} label={crumb ?? (typeof title === 'string' ? title : '')} />

            <ThemeControls />

            <div title="Deployment environment; not a service-health indicator" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4.5px 9px', borderRadius: 999, background: `rgba(var(--${environment.tone}-rgb),0.09)`, border: `1px solid rgba(var(--${environment.tone}-rgb),0.22)` }}>
              <span aria-hidden style={{ width: 5.5, height: 5.5, borderRadius: '50%', background: `var(--${environment.tone})` }} />
              <span style={{ fontSize: 10.5, fontWeight: 600, color: `var(--${environment.tone})`, letterSpacing: '0.02em' }}>{environment.label}</span>
            </div>

            <Link href={['/queue', '/reports', '/support'].find(d => allow.has(d)) || '/dashboard'} aria-label={alerts === null ? 'Work queues; counts unavailable' : `${alerts} items waiting for review`} title="Work waiting" className="pc-icon-btn" style={{ position: 'relative', width: 38, height: 38, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" style={{ fill: 'rgba(var(--on),0.6)' }}><path d="M12 22a2.5 2.5 0 002.4-2h-4.8a2.5 2.5 0 002.4 2zm7-5v-1l-1.5-1.7V10a5.5 5.5 0 00-4-5.3V4a1.5 1.5 0 00-3 0v.7a5.5 5.5 0 00-4 5.3v4.3L5 16v1h14z" /></svg>
              {alerts !== null && alerts > 0 ? (
                <span className="pc-num" style={{ position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, padding: '0 3.5px', borderRadius: 999, background: 'var(--alert)', color: 'var(--alert-ink)', fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--bg)' }}>{alerts}</span>
              ) : null}
            </Link>

            <div className="pc-staff-chip" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px 4px 4px', borderRadius: 9, border: '1px solid rgba(var(--on),0.10)' }}>
              <span style={{ width: 25, height: 25, borderRadius: 6, background: 'var(--chip-bg)', color: 'var(--chip-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 700 }}>{initial}</span>
              <span className="pc-staff-name" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--txt)' }}>{local}</span>
              <span style={{ fontSize: 9.5, fontWeight: 600, padding: '1.5px 5px', borderRadius: 4, background: 'rgba(var(--accent-rgb),0.13)', color: 'var(--accent)', letterSpacing: '0.02em' }}>{roleShort}</span>
              <form action={signOut}>
                <button className="pc-seg" title="Sign out" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 10.5, fontWeight: 600, color: 'var(--txt-muted)', padding: 0 }}>Exit</button>
              </form>
            </div>
          </div>
        </header>

        <Workspace>
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
