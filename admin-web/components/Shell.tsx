/**
 * Operations shell v2 - to the founder's brief: warm neutral ground, white
 * surfaces, 1px borders, no shadows, charcoal type, the real pearl mark,
 * a command bar with working global search, and a rail that tells the
 * truth about what exists versus what is coming.
 */
import Link from 'next/link';
import { signOut } from '@/lib/actions';

const DESKS = [
  { href: '/dashboard', label: 'Overview', icon: 'M4 5h7v7H4V5zm9 0h7v4h-7V5zm0 6h7v8h-7v-8zm-9 3h7v5H4v-5z' },
  { href: '/queue', label: 'Verification', icon: 'M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8L12 2z' },
  { href: '/users', label: 'Users', icon: 'M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z' },
  { href: '/reports', label: 'Reports', icon: 'M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z' },
  { href: '/content', label: 'Content', icon: 'M4 4h16v12H5.2L4 17.2V4zm2 3h12v2H6V7zm0 4h8v2H6v-2z' },
  { href: '/market', label: 'Market', icon: 'M4 7l2-4h12l2 4v2a3 3 0 01-1 2.2V20H5v-8.8A3 3 0 014 9V7zm3 6h4v5H7v-5z' },
  { href: '/jobs', label: 'Jobs', icon: 'M9 4h6a2 2 0 012 2v1h3a1 1 0 011 1v10a2 2 0 01-2 2H5a2 2 0 01-2-2V8a1 1 0 011-1h3V6a2 2 0 012-2zm1 3h4V6h-4v1z' },
  { href: '/businesses', label: 'Businesses', icon: 'M4 21V5a2 2 0 012-2h7a2 2 0 012 2v16h-4v-4H8v4H4zm13-9h3a1 1 0 011 1v8h-4v-9z' },
  { href: '/audit', label: 'Audit log', icon: 'M4 5h16v2H4V5zm0 6h16v2H4v-2zm0 6h10v2H4v-2z' },
];
const COMING = ['Calls', 'Analytics'];

export default function Shell({ admin, active, title, sub, children }: {
  admin: { email: string; role: string }; active: string; title: string; sub?: string; children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-[#F6F6F4] text-[#17181C]">
      <aside className="fixed inset-y-0 left-0 flex w-56 flex-col border-r border-[#E8E6E1] bg-[#FBFBFA]">
        <div className="flex items-center gap-2.5 px-4 pb-5 pt-5">
          <img src="/pearl.png" alt="" className="h-8 w-8 rounded-[8px]" />
          <div>
            <p className="text-[13px] font-bold leading-tight">Platinum Circles</p>
            <p className="text-[10.5px] font-medium tracking-wide text-[#8A8D94]">Operations</p>
          </div>
        </div>
        <nav className="flex-1 px-2.5">
          {DESKS.map(d => {
            const on = active === d.href;
            return (
              <Link key={d.href} href={d.href}
                className={'mb-0.5 flex items-center gap-2.5 rounded-[10px] px-2.5 py-[7px] text-[13px] transition-colors duration-150 ' + (on ? 'bg-[#ECEBE7] font-semibold text-[#17181C]' : 'font-medium text-[#5A5D64] hover:bg-[#F0EFEC] hover:text-[#17181C]')}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className={on ? 'text-[#0B1E3D]' : 'text-[#9A9DA4]'}><path d={d.icon} /></svg>
                {d.label}
              </Link>
            );
          })}
          <p className="mb-1 mt-6 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-[#B4B6BB]">Coming</p>
          {COMING.map(c => (
            <p key={c} className="flex items-center gap-2.5 px-2.5 py-[6px] text-[13px] font-medium text-[#C0C2C7]">
              <span className="inline-block h-[5px] w-[5px] rounded-full bg-[#D8D9DC]" />{c}
            </p>
          ))}
        </nav>
        <div className="border-t border-[#E8E6E1] px-4 py-3.5">
          <p className="truncate text-[11.5px] font-semibold text-[#43454B]">{admin.email}</p>
          <p className="text-[10.5px] text-[#9A9DA4]">{admin.role.replace(/_/g, ' ')}</p>
        </div>
      </aside>
      <div className="ml-56 flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b border-[#E8E6E1] bg-white px-6">
          <form method="get" action="/users" className="max-w-md flex-1">
            <div className="flex items-center gap-2 rounded-[10px] border border-[#E8E6E1] bg-[#FAFAF9] px-3 py-[7px] focus-within:border-[#B9BCC2]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9A9DA4" strokeWidth="2.4"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <input name="q" placeholder="Search members, usernames, emails" className="w-full bg-transparent text-[13px] text-[#17181C] outline-none placeholder:text-[#A9ABB1]" />
            </div>
          </form>
          <div className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1.5 rounded-full border border-[#E1EFE4] bg-[#F2F9F3] px-2.5 py-1 text-[11px] font-semibold text-[#1D7A38]"><span className="h-[6px] w-[6px] rounded-full bg-[#2BA84A]" />Production</span>
            <form action={signOut}><button className="rounded-[8px] border border-[#E8E6E1] px-3 py-1.5 text-[12px] font-semibold text-[#5A5D64] transition-colors duration-150 hover:bg-[#F0EFEC] hover:text-[#17181C]">Sign out</button></form>
          </div>
        </header>
        <div className="px-7 pb-10 pt-6">
          <h1 className="text-[20px] font-semibold tracking-[-0.01em]">{title}</h1>
          {sub ? <p className="mt-0.5 text-[13px] text-[#7A7D84]">{sub}</p> : null}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}