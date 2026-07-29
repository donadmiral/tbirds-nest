import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();
  const [users, verified, pendingApps, openPosts, openListings, openUsers, audit] = await Promise.all([
    svc.from('profiles').select('id', { count: 'exact', head: true }),
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('is_verified', true),
    svc.from('verification_applications').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'under_review']),
    svc.from('post_reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    svc.from('listing_reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    svc.from('user_reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    svc.from('admin_audit_log').select('action, reason, created_at').order('created_at', { ascending: false }).limit(8),
  ]);
  const openReports = (openPosts.count || 0) + (openListings.count || 0) + (openUsers.count || 0);
  const stats = [
    { label: 'Members', value: users.count ?? 0, href: '/users' },
    { label: 'Verified', value: verified.count ?? 0, href: '/users' },
    { label: 'Pending verification', value: pendingApps.count ?? 0, href: '/queue', hot: (pendingApps.count ?? 0) > 0 },
    { label: 'Open reports', value: openReports, href: '/reports', hot: openReports > 0 },
  ];
  return (
    <Shell admin={admin} active="/dashboard" title="Overview" sub="The state of Platinum Circles right now">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map(s => (
          <Link key={s.label} href={s.href}
            className="rounded-xl border border-[#0B1E3D]/8 bg-white p-5 transition-shadow hover:shadow-md">
            <p className={'text-[26px] font-extrabold tracking-tight ' + (s.hot ? 'text-[#B08D3F]' : 'text-[#0B1E3D]')}>{s.value}</p>
            <p className="mt-1 text-[11.5px] font-semibold text-[#0B1E3D]/50">{s.label}</p>
          </Link>
        ))}
      </div>
      <div className="mt-8 rounded-xl border border-[#0B1E3D]/8 bg-white">
        <p className="border-b border-[#0B1E3D]/6 px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-[#0B1E3D]/40">Recent operations</p>
        {(audit.data ?? []).length === 0 ? (
          <p className="px-5 py-8 text-center text-[12px] text-[#0B1E3D]/40">No actions yet. Everything done here is recorded forever.</p>
        ) : (audit.data ?? []).map((a, i) => (
          <div key={i} className="flex items-baseline justify-between border-b border-[#0B1E3D]/4 px-5 py-3 last:border-0">
            <div className="min-w-0">
              <p className="text-[12.5px] font-bold text-[#0B1E3D]">{a.action.replace(/[._]/g, ' ')}</p>
              <p className="truncate text-[11.5px] text-[#0B1E3D]/50">{a.reason}</p>
            </div>
            <p className="ml-4 shrink-0 text-[11px] text-[#0B1E3D]/35">{new Date(a.created_at).toLocaleString()}</p>
          </div>
        ))}
      </div>
    </Shell>
  );
}