/**
 * Operations shell v8 - the design system shell.
 * 236px translucent rail with grouped desks and live count chips, 58px topbar
 * with breadcrumb, search, appearance control, production pill, alert bell and
 * identity chip. Every number here is a real head-count query, never decoration.
 * Props are unchanged from v4, so every desk keeps working untouched.
 */
import Link from 'next/link';
import { signOut } from '@/lib/actions';
import { serviceClient } from '@/lib/supabaseAdmin';
import { allowedDesks } from '@/lib/adminAuth';
import ThemeControls from '@/components/ThemeControls';
import SideRail from '@/components/SideRail';
import CommandPalette from '@/components/CommandPalette';
import Workspace from '@/components/Workspace';
import ShareMenu from '@/components/ShareMenu';
import PresentTray from '@/components/PresentTray';

const GROUPS: { label: string; items: { href: string; label: string; icon: string; key: string }[] }[] = [
  { label: 'Overview', items: [
    { href: '/dashboard', label: 'Dashboard', key: 'D', icon: 'M4 5h7v7H4V5zm9 0h7v4h-7V5zm0 6h7v8h-7v-8zm-9 3h7v5H4v-5z' },
    { href: '/analytics', label: 'Analytics', key: 'A', icon: 'M4 20V10h3v10H4zm6.5 0V4h3v16h-3zM17 20v-7h3v7h-3z' },
    { href: '/calls', label: 'Calls', key: 'C', icon: 'M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z' },
  ]},
  { label: 'Community', items: [
    { href: '/users', label: 'Users', key: 'U', icon: 'M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z' },
    { href: '/businesses', label: 'Businesses', key: 'B', icon: 'M4 21V5a2 2 0 012-2h7a2 2 0 012 2v16h-4v-4H8v4H4zm13-9h3a1 1 0 011 1v8h-4v-9z' },
  ]},
  { label: 'Commerce', items: [
    { href: '/market', label: 'Market', key: 'M', icon: 'M4 7l2-4h12l2 4v2a3 3 0 01-1 2.2V20H5v-8.8A3 3 0 014 9V7zm3 6h4v5H7v-5z' },
    { href: '/jobs', label: 'Jobs', key: 'J', icon: 'M9 4h6a2 2 0 012 2v1h3a1 1 0 011 1v10a2 2 0 01-2 2H5a2 2 0 01-2-2V8a1 1 0 011-1h3V6a2 2 0 012-2zm1 3h4V6h-4v1z' },
    { href: '/payments', label: 'Payments', key: 'Y', icon: 'M3 6a2 2 0 012-2h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6zm2 3h14V7H5v2zm0 3v5h14v-5H5z' },
    { href: '/ads', label: 'Ads Manager', key: 'V', icon: 'M3 10a2 2 0 012-2h2l7-4v16l-7-4H5a2 2 0 01-2-2v-4zm14-4.8a7 7 0 010 9.6V5.2z' },
  ]},
  { label: 'Content', items: [
    { href: '/content', label: 'Posts', key: 'P', icon: 'M4 4h16v12H5.2L4 17.2V4zm2 3h12v2H6V7zm0 4h8v2H6v-2z' },
    { href: '/stories', label: 'Stories', key: 'O', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 3a7 7 0 110 14 7 7 0 010-14zm0 2.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9z' },
  ]},
  { label: 'Moderation', items: [
    { href: '/reports', label: 'Reports', key: 'R', icon: 'M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z' },
    { href: '/queue', label: 'Verification', key: 'Q', icon: 'M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8L12 2z' },
    { href: '/support', label: 'Support', key: 'S', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 4a6 6 0 016 6h-3a3 3 0 00-6 0H6a6 6 0 016-6zm-3 8h6a3 3 0 01-6 0z' },
    { href: '/audit', label: 'Audit log', key: 'L', icon: 'M4 5h16v2H4V5zm0 6h16v2H4v-2zm0 6h10v2H4v-2z' },
  ]},
  { label: 'System', items: [
    { href: '/staff', label: 'Staff', key: 'F', icon: 'M16 11c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3zm-8 0c1.7 0 3-1.3 3-3S9.7 5 8 5 5 6.3 5 8s1.3 3 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 1.9 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z' },
    { href: '/system', label: 'Controls', key: 'W', icon: 'M12 8a4 4 0 100 8 4 4 0 000-8zm8.6 4a6.6 6.6 0 00-.1-1.1l2-1.6-2-3.4-2.4 1a6.9 6.9 0 00-1.9-1.1L15.8 3h-4l-.4 2.8a6.9 6.9 0 00-1.9 1.1l-2.4-1-2 3.4 2 1.6a6.6 6.6 0 000 2.2l-2 1.6 2 3.4 2.4-1a6.9 6.9 0 001.9 1.1l.4 2.8h4l.4-2.8a6.9 6.9 0 001.9-1.1l2.4 1 2-3.4-2-1.6c.1-.4.1-.7.1-1.1z' },
  ]},
];

// Quick actions are permission-shaped: a desk you cannot open never offers its action.
const ACTIONS: { href: string; label: string }[] = [
  { href: '/queue', label: 'Review verification queue' },
  { href: '/reports', label: 'Review open reports' },
  { href: '/support', label: 'Answer support tickets' },
  { href: '/users', label: 'Find a member' },
  { href: '/system', label: 'Publish an announcement' },
  { href: '/staff', label: 'Invite a staff member' },
];

export default async function Shell({ admin, active, title, crumb, sub, children }: {
  admin: { email: string; role: string }; active: string; title: React.ReactNode; crumb?: string; sub?: string; children: React.ReactNode;
}) {
  const svc = serviceClient();
  const [apps, p1, p2, p3, tk] = await Promise.all([
    svc.from('verification_applications').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'under_review']),
    svc.from('post_reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    svc.from('listing_reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    svc.from('user_reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    svc.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
  ]);
  const queueCount = apps.count || 0;
  const reportCount = (p1.count || 0) + (p2.count || 0) + (p3.count || 0);
  const supportCount = tk.count || 0;
  const alerts = queueCount + reportCount + supportCount;
  const counts: Record<string, number> = { '/queue': queueCount, '/reports': reportCount, '/support': supportCount };

  const allow = allowedDesks(admin.role);
  const groups = GROUPS.map(g => ({ ...g, items: g.items.filter(d => allow.has(d.href)) })).filter(g => g.items.length > 0);
  const paletteItems = groups.flatMap(g => g.items.map(d => ({ href: d.href, label: d.label, group: g.label, key: d.key })));
  const actions = ACTIONS.filter(a => allow.has(a.href));
  const local = (admin.email || '').split('@')[0] || 'desk';
  const initial = (admin.email || '?').slice(0, 1).toUpperCase();
  const roleLabel = admin.role.replace(/_/g, ' ');
  const roleShort = admin.role.split('_').map(w => w[0]).join('').toUpperCase();

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)', color: 'var(--txt)' }}>

      <SideRail groups={groups} counts={counts} active={active} email={admin.email} roleLabel={roleLabel} />

      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>

        <header style={{ position: 'sticky', top: 0, zIndex: 30, display: 'flex', alignItems: 'center', gap: 14, height: 58, padding: '0 22px', background: 'var(--topbar)', backdropFilter: 'blur(26px) saturate(1.2)', WebkitBackdropFilter: 'blur(26px) saturate(1.2)', borderBottom: '1px solid rgba(var(--on),0.10)' }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
            <Link href="/dashboard" className="pc-crumb" style={{ color: 'rgba(var(--on),0.4)', fontWeight: 500, textDecoration: 'none' }}>Operations</Link>
            <span style={{ color: 'rgba(var(--on),0.2)' }}>/</span>
            <span style={{ fontWeight: 600, color: 'var(--txt)' }}>{crumb ?? title}</span>
          </div>

          <CommandPalette items={paletteItems} actions={actions} />

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 9 }}>

            <ShareMenu path={active} label={crumb ?? (typeof title === 'string' ? title : '')} />

            <ThemeControls />

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4.5px 9px', borderRadius: 999, background: 'rgba(var(--ok-rgb),0.09)', border: '1px solid rgba(var(--ok-rgb),0.22)' }}>
              <span className="pc-pulse" style={{ width: 5.5, height: 5.5, borderRadius: '50%', background: 'var(--ok)' }} />
              <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ok)', letterSpacing: '0.02em' }}>Production</span>
            </div>

            <Link href="/queue" title="Work waiting" className="pc-icon-btn" style={{ position: 'relative', width: 33, height: 33, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(var(--on),0.10)' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" style={{ fill: 'rgba(var(--on),0.6)' }}><path d="M12 22a2.5 2.5 0 002.4-2h-4.8a2.5 2.5 0 002.4 2zm7-5v-1l-1.5-1.7V10a5.5 5.5 0 00-4-5.3V4a1.5 1.5 0 00-3 0v.7a5.5 5.5 0 00-4 5.3v4.3L5 16v1h14z" /></svg>
              {alerts > 0 ? (
                <span className="pc-num" style={{ position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, padding: '0 3.5px', borderRadius: 999, background: 'var(--alert)', color: '#fff', fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--bg)' }}>{alerts}</span>
              ) : null}
            </Link>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px 4px 4px', borderRadius: 9, border: '1px solid rgba(var(--on),0.10)' }}>
              <span style={{ width: 25, height: 25, borderRadius: 6, background: 'var(--chip-bg)', color: 'var(--chip-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 700 }}>{initial}</span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--txt)', whiteSpace: 'nowrap' }}>{local}</span>
              <span style={{ fontSize: 9.5, fontWeight: 600, padding: '1.5px 5px', borderRadius: 4, background: 'rgba(var(--accent-rgb),0.13)', color: 'var(--accent)', letterSpacing: '0.02em' }}>{roleShort}</span>
              <form action={signOut}>
                <button className="pc-seg" title="Sign out" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 10.5, fontWeight: 600, color: 'rgba(var(--on),0.4)', padding: 0 }}>Exit</button>
              </form>
            </div>
          </div>
        </header>

        <Workspace>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, marginBottom: 19 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: 25, fontWeight: 400, letterSpacing: '0.005em', color: 'var(--txt-strong)' }}>{title}</h1>
              {sub ? <p style={{ margin: '5px 0 0', fontSize: 12.8, color: 'rgba(var(--on),0.44)', maxWidth: 640, textWrap: 'pretty' }}>{sub}</p> : null}
            </div>
          </div>
          {children}
        </Workspace>
        <PresentTray />
      </main>
    </div>
  );
}
