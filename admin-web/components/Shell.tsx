/**
 * Operations shell v4 - the full admin anatomy: dark grouped rail,
 * top navbar with breadcrumb, live alert bell, identity chip, footer.
 * Counts in the bell are real head-count queries, never decoration.
 */
import Link from 'next/link';
import { signOut } from '@/lib/actions';
import { serviceClient } from '@/lib/supabaseAdmin';
import { allowedDesks } from '@/lib/adminAuth';

const GROUPS: { label: string; items: { href: string; label: string; icon: string }[] }[] = [
  { label: 'Platform', items: [
    { href: '/dashboard', label: 'Overview', icon: 'M4 5h7v7H4V5zm9 0h7v4h-7V5zm0 6h7v8h-7v-8zm-9 3h7v5H4v-5z' },
    { href: '/analytics', label: 'Analytics', icon: 'M4 20V10h3v10H4zm6.5 0V4h3v16h-3zM17 20v-7h3v7h-3z' },
  ]},
  { label: 'Trust and safety', items: [
    { href: '/queue', label: 'Verification', icon: 'M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8L12 2z' },
    { href: '/reports', label: 'Reports', icon: 'M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z' },
    { href: '/users', label: 'Users', icon: 'M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z' },
    { href: '/support', label: 'Support', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 4a6 6 0 016 6h-3a3 3 0 00-6 0H6a6 6 0 016-6zm-3 8h6a3 3 0 01-6 0z' },
  ]},
  { label: 'Commerce', items: [
    { href: '/market', label: 'Market', icon: 'M4 7l2-4h12l2 4v2a3 3 0 01-1 2.2V20H5v-8.8A3 3 0 014 9V7zm3 6h4v5H7v-5z' },
    { href: '/jobs', label: 'Jobs', icon: 'M9 4h6a2 2 0 012 2v1h3a1 1 0 011 1v10a2 2 0 01-2 2H5a2 2 0 01-2-2V8a1 1 0 011-1h3V6a2 2 0 012-2zm1 3h4V6h-4v1z' },
    { href: '/businesses', label: 'Businesses', icon: 'M4 21V5a2 2 0 012-2h7a2 2 0 012 2v16h-4v-4H8v4H4zm13-9h3a1 1 0 011 1v8h-4v-9z' },
  ]},
  { label: 'Content', items: [
    { href: '/content', label: 'Posts', icon: 'M4 4h16v12H5.2L4 17.2V4zm2 3h12v2H6V7zm0 4h8v2H6v-2z' },
    { href: '/stories', label: 'Stories', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 3a7 7 0 110 14 7 7 0 010-14zm0 2.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9z' },
  ]},
  { label: 'System', items: [
    { href: '/audit', label: 'Audit log', icon: 'M4 5h16v2H4V5zm0 6h16v2H4v-2zm0 6h10v2H4v-2z' },
    { href: '/system', label: 'Controls', icon: 'M12 8a4 4 0 100 8 4 4 0 000-8zm8.6 4a6.6 6.6 0 00-.1-1.1l2-1.6-2-3.4-2.4 1a6.9 6.9 0 00-1.9-1.1L15.8 3h-4l-.4 2.8a6.9 6.9 0 00-1.9 1.1l-2.4-1-2 3.4 2 1.6a6.6 6.6 0 000 2.2l-2 1.6 2 3.4 2.4-1a6.9 6.9 0 001.9 1.1l.4 2.8h4l.4-2.8a6.9 6.9 0 001.9-1.1l2.4 1 2-3.4-2-1.6c.1-.4.1-.7.1-1.1z' },
    { href: '/staff', label: 'Staff', icon: 'M16 11c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3zm-8 0c1.7 0 3-1.3 3-3S9.7 5 8 5 5 6.3 5 8s1.3 3 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 1.9 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z' },
  ]},
];
const COMING = ['Calls'];

export default async function Shell({ admin, active, title, sub, children }: {
  admin: { email: string; role: string }; active: string; title: string; sub?: string; children: React.ReactNode;
}) {
  const svc = serviceClient();
  const [apps, p1, p2, p3, tk] = await Promise.all([
    svc.from('verification_applications').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'under_review']),
    svc.from('post_reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    svc.from('listing_reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    svc.from('user_reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    svc.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
  ]);
  const alerts = (apps.count || 0) + (p1.count || 0) + (p2.count || 0) + (p3.count || 0) + (tk.count || 0);
  const allow = allowedDesks(admin.role);
  const groups = GROUPS.map(g => ({ ...g, items: g.items.filter(d => allow.has(d.href)) })).filter(g => g.items.length > 0);
  const initial = (admin.email || '?').slice(0, 1).toUpperCase();
  return (
    <div className="flex min-h-screen bg-[#F4F5F7] text-[#17181C]">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-60 flex-col bg-[#191C22]">
        <div className="flex items-center gap-2.5 border-b border-white/8 px-4 py-4">
          <img src="/pearl.png" alt="" className="h-8 w-8 rounded-[8px]" />
          <div>
            <p className="text-[13.5px] font-bold leading-tight text-white">Platinum Circles</p>
            <p className="text-[10px] font-medium tracking-[0.08em] text-white/35">OPERATIONS</p>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {groups.map(g => (
            <div key={g.label} className="mb-4">
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/30">{g.label}</p>
              {g.items.map(d => {
                const on = active === d.href;
                return (
                  <Link key={d.href} href={d.href}
                    className={'mb-0.5 flex items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-[13px] transition-colors duration-150 ' + (on ? 'bg-white/12 font-semibold text-white' : 'font-medium text-white/55 hover:bg-white/6 hover:text-white')}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className={on ? 'text-[#E7C878]' : 'text-white/35'}><path d={d.icon} /></svg>
                    {d.label}
                  </Link>
                );
              })}
            </div>
          ))}
          <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/30">Coming</p>
          {COMING.map(c => (
            <p key={c} className="flex items-center gap-2.5 px-2.5 py-[6px] text-[13px] font-medium text-white/25">
              <span className="inline-block h-[5px] w-[5px] rounded-full bg-white/15" />{c}
            </p>
          ))}
        </nav>
        <div className="border-t border-white/8 px-4 py-3 text-[10px] text-white/30">Signed in as {admin.role.replace(/_/g, ' ')}</div>
      </aside>
      <div className="ml-60 flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b border-[#E5E4E0] bg-white px-6">
          <nav className="flex items-center gap-1.5 text-[12.5px]">
            <Link href="/dashboard" className="font-medium text-[#7A7D84] hover:text-[#17181C]">Operations</Link>
            <span className="text-[#C6C8CC]">/</span>
            <span className="font-semibold text-[#17181C]">{title}</span>
          </nav>
          <form method="get" action="/users" className="ml-4 hidden max-w-sm flex-1 md:block">
            <div className="flex items-center gap-2 rounded-[9px] border border-[#E5E4E0] bg-[#F8F8F7] px-3 py-[6px] transition-colors duration-150 focus-within:border-[#B9BCC2] focus-within:bg-white">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9A9DA4" strokeWidth="2.4"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <input name="q" placeholder="Search members" className="w-full bg-transparent text-[13px] outline-none placeholder:text-[#A9ABB1]" />
            </div>
          </form>
          <div className="ml-auto flex items-center gap-2.5">
            <Link href="/queue" className="relative flex h-9 w-9 items-center justify-center rounded-[9px] transition-colors duration-150 hover:bg-[#F0EFEC]" title="Work waiting">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#5A5D64"><path d="M12 22a2.5 2.5 0 002.4-2h-4.8a2.5 2.5 0 002.4 2zm7-5v-1l-1.5-1.7V10a5.5 5.5 0 00-4-5.3V4a1.5 1.5 0 00-3 0v.7a5.5 5.5 0 00-4 5.3v4.3L5 16v1h14z" /></svg>
              {alerts > 0 ? <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#C2410C] px-1 text-[9.5px] font-bold text-white">{alerts}</span> : null}
            </Link>
            <span className="hidden items-center gap-1.5 rounded-full border border-[#E1EFE4] bg-[#F2F9F3] px-2.5 py-1 text-[11px] font-semibold text-[#1D7A38] sm:flex"><span className="h-[6px] w-[6px] rounded-full bg-[#2BA84A]" />Production</span>
            <div className="flex items-center gap-2 rounded-[9px] border border-[#E5E4E0] py-1 pl-1 pr-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#0B1E3D] text-[12px] font-bold text-white">{initial}</span>
              <span className="hidden text-[12px] font-semibold text-[#43454B] lg:block">{admin.email.split('@')[0]}</span>
              <form action={signOut}><button className="text-[11.5px] font-semibold text-[#9A9DA4] transition-colors duration-150 hover:text-[#B03A3A]" title="Sign out">Exit</button></form>
            </div>
          </div>
        </header>
        <div className="flex-1 px-7 pb-8 pt-6">
          <h1 className="text-[20px] font-semibold tracking-[-0.01em]">{title}</h1>
          {sub ? <p className="mt-0.5 text-[13px] text-[#7A7D84]">{sub}</p> : null}
          <div className="mt-5">{children}</div>
        </div>
        <footer className="flex items-center justify-between border-t border-[#E5E4E0] bg-white px-7 py-3 text-[11.5px] text-[#9A9DA4]">
          <p>Platinum Circles Operations - Pearl Group</p>
          <p className="tabular-nums">2026</p>
        </footer>
      </div>
    </div>
  );
}