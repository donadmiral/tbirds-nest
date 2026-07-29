import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';
import Seal from '@/components/Seal';

export const dynamic = 'force-dynamic';

const TIER_LABEL: Record<string, string> = { public_figure: 'Green', business: 'Space grey', official: 'Platinum' };

export default async function DashboardPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();
  const [users, verified, apps, pr, lr, ur, audit] = await Promise.all([
    svc.from('profiles').select('id', { count: 'exact', head: true }),
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('is_verified', true),
    svc.from('verification_applications').select('id, applicant_id, tier, category, created_at').in('status', ['submitted', 'under_review']).order('created_at', { ascending: true }).limit(6),
    svc.from('post_reports').select('id, reason, created_at').eq('status', 'open').order('created_at', { ascending: true }).limit(4),
    svc.from('listing_reports').select('id, reason, created_at').eq('status', 'open').order('created_at', { ascending: true }).limit(4),
    svc.from('user_reports').select('id, reason, created_at').eq('status', 'open').order('created_at', { ascending: true }).limit(4),
    svc.from('admin_audit_log').select('action, reason, created_at').order('created_at', { ascending: false }).limit(10),
  ]);
  const appRows = apps.data ?? [];
  const names: Record<string, any> = {};
  if (appRows.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username').in('id', appRows.map(a => a.applicant_id));
    (data ?? []).forEach(p => { names[p.id] = p; });
  }
  const openReports = [
    ...(pr.data ?? []).map(r => ({ ...r, kind: 'Post' })),
    ...(lr.data ?? []).map(r => ({ ...r, kind: 'Listing' })),
    ...(ur.data ?? []).map(r => ({ ...r, kind: 'Account' })),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, 6);
  const metrics = [
    { label: 'Members', value: users.count ?? 0, href: '/users' },
    { label: 'Verified', value: verified.count ?? 0, href: '/users' },
    { label: 'Pending verification', value: appRows.length, href: '/queue', hot: appRows.length > 0 },
    { label: 'Open reports', value: openReports.length, href: '/reports', hot: openReports.length > 0 },
  ];
  const attention = appRows.length + openReports.length;
  return (
    <Shell admin={admin} active="/dashboard" title="Overview" sub="The state of Platinum Circles right now">
      <div className="flex items-center gap-2.5 rounded-[12px] border border-[#E8E6E1] bg-white px-4 py-3">
        <span className="h-[7px] w-[7px] rounded-full bg-[#2BA84A]" />
        <p className="text-[13px] font-semibold">All systems operational</p>
        <p className="ml-auto text-[11.5px] tabular-nums text-[#9A9DA4]">live - {new Date().toLocaleTimeString()}</p>
      </div>
      <div className="mt-4 grid grid-cols-2 divide-x divide-[#EEEDE9] rounded-[12px] border border-[#E8E6E1] bg-white lg:grid-cols-4">
        {metrics.map(m => (
          <Link key={m.label} href={m.href} className="group px-5 py-4 transition-colors duration-150 hover:bg-[#FAFAF9]">
            <p className={'text-[22px] font-semibold tabular-nums tracking-tight ' + (m.hot ? 'text-[#B45309]' : 'text-[#17181C]')}>{m.value}</p>
            <p className="mt-0.5 text-[12px] font-medium text-[#7A7D84] group-hover:text-[#43454B]">{m.label}</p>
          </Link>
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Needs attention{attention ? ' - ' + attention : ''}</p>
          <div className="rounded-[12px] border border-[#E8E6E1] bg-white">
            {attention === 0 ? (
              <p className="px-5 py-10 text-center text-[13px] text-[#9A9DA4]">Nothing waiting. Quiet is the goal.</p>
            ) : (
              <>
                {appRows.map(a => {
                  const p = names[a.applicant_id] || {};
                  return (
                    <Link key={a.id} href="/queue" className="flex items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 transition-colors duration-150 last:border-0 hover:bg-[#FAFAF9]">
                      <Seal tier={a.tier} size={16} />
                      <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{p.full_name || '@' + (p.username || '?')} <span className="font-normal text-[#7A7D84]">applied for {TIER_LABEL[a.tier] || a.tier}{a.category ? ' - ' + a.category : ''}</span></p>
                      <p className="shrink-0 text-[11.5px] tabular-nums text-[#9A9DA4]">{new Date(a.created_at).toLocaleDateString()}</p>
                    </Link>
                  );
                })}
                {openReports.map((r: any) => (
                  <Link key={r.kind + r.id} href="/reports" className="flex items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 transition-colors duration-150 last:border-0 hover:bg-[#FAFAF9]">
                    <span className="shrink-0 rounded-full border border-[#F3E3C5] bg-[#FBF4E4] px-2 py-0.5 text-[10.5px] font-bold text-[#B45309]">{r.kind}</span>
                    <p className="min-w-0 flex-1 truncate text-[13px]"><span className="font-semibold">Reported</span> <span className="text-[#7A7D84]">- {r.reason}</span></p>
                    <p className="shrink-0 text-[11.5px] tabular-nums text-[#9A9DA4]">{new Date(r.created_at).toLocaleDateString()}</p>
                  </Link>
                ))}
              </>
            )}
          </div>
        </div>
        <div className="lg:col-span-2">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Recent administrator actions</p>
          <div className="rounded-[12px] border border-[#E8E6E1] bg-white">
            {(audit.data ?? []).length === 0 ? (
              <p className="px-5 py-10 text-center text-[13px] text-[#9A9DA4]">Every action lands here, permanently.</p>
            ) : (audit.data ?? []).map((a, i) => (
              <div key={i} className="border-b border-[#F0EFEC] px-4 py-2.5 last:border-0">
                <p className="text-[12.5px] font-semibold">{a.action.replace(/[._]/g, ' ')}</p>
                <p className="truncate text-[11.5px] text-[#7A7D84]">{a.reason}</p>
                <p className="mt-0.5 text-[10.5px] tabular-nums text-[#B4B6BB]">{new Date(a.created_at).toLocaleString()}</p>
              </div>
            ))}
            <Link href="/audit" className="block border-t border-[#F0EFEC] px-4 py-2.5 text-[12px] font-semibold text-[#0B1E3D] transition-colors duration-150 hover:bg-[#FAFAF9]">Full audit log</Link>
          </div>
        </div>
      </div>
    </Shell>
  );
}