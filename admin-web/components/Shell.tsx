/** The operations room shell: navy rail, paper workspace, one gold accent. */
import Link from 'next/link';
import { signOut } from '@/lib/actions';

const DESKS = [
  { href: '/dashboard', label: 'Overview', icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z' },
  { href: '/queue', label: 'Verification', icon: 'M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8L12 2z' },
  { href: '/users', label: 'Users', icon: 'M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z' },
  { href: '/reports', label: 'Reports', icon: 'M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z' },
];

export default function Shell({ admin, active, title, sub, children }: {
  admin: { email: string; role: string }; active: string; title: string; sub?: string; children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-[#FAFAF8]">
      <aside className="fixed inset-y-0 left-0 flex w-56 flex-col bg-[#0B1E3D]">
        <div className="flex items-center gap-2.5 px-5 pb-6 pt-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-[#C9BFB0]">
            <div className="h-2.5 w-2.5 rounded-full bg-[#F3EFE7]" />
          </div>
          <div>
            <p className="text-[13px] font-extrabold leading-tight text-white">Platinum Circles</p>
            <p className="text-[10px] font-medium tracking-wide text-white/40">OPERATIONS</p>
          </div>
        </div>
        <nav className="flex-1 px-3">
          {DESKS.map(d => {
            const on = active === d.href;
            return (
              <Link key={d.href} href={d.href}
                className={'mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors ' + (on ? 'bg-white/10 text-[#E7C878]' : 'text-white/60 hover:bg-white/5 hover:text-white')}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d={d.icon} /></svg>
                {d.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-5 py-4">
          <p className="truncate text-[11px] font-semibold text-white/80">{admin.email}</p>
          <p className="text-[10px] text-white/40">{admin.role.replace(/_/g, ' ')}</p>
          <form action={signOut}><button className="mt-2 text-[11px] font-semibold text-white/50 hover:text-white">Sign out</button></form>
        </div>
      </aside>
      <div className="ml-56 flex-1">
        <header className="sticky top-0 z-10 border-b border-[#0B1E3D]/8 bg-[#FAFAF8]/90 px-8 py-5 backdrop-blur">
          <h1 className="text-[17px] font-extrabold tracking-tight text-[#0B1E3D]">{title}</h1>
          {sub ? <p className="mt-0.5 text-[12px] text-[#0B1E3D]/45">{sub}</p> : null}
        </header>
        <div className="px-8 py-6">{children}</div>
      </div>
    </div>
  );
}