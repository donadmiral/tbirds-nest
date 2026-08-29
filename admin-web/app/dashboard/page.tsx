import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';
import Seal from '@/components/Seal';
import PlatformActivityChart from '@/components/PlatformActivityChart';

export const dynamic = 'force-dynamic';

const TIER_LABEL: Record<string, string> = { public_figure: 'Green', business: 'Space grey', official: 'Platinum' };
const ACTIVE_WINDOW_MIN = 5;

export default async function DashboardPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();
  const activeSince = new Date(Date.now() - ACTIVE_WINDOW_MIN * 60_000).toISOString();

  const [users, verified, active, apps, pr, lr, ur, audit, tickets, bizApps, flags, daily] = await Promise.all([
    svc.from('profiles').select('id', { count: 'exact', head: true }),
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('is_verified', true),
    svc.from('profiles').select('id', { count: 'exact', head: true }).gte('last_seen', activeSince),
    svc.from('verification_applications').select('id, applicant_id, tier, category, created_at').in('status', ['submitted', 'under_review']).order('created_at', { ascending: true }).limit(6),
    svc.from('post_reports').select('id, reason, created_at').eq('status', 'open').order('created_at', { ascending: true }).limit(4),
    svc.from('listing_reports').select('id, reason, created_at').eq('status', 'open').order('created_at', { ascending: true }).limit(4),
    svc.from('user_reports').select('id, reason, created_at').eq('status', 'open').order('created_at', { ascending: true }).limit(4),
    svc.from('admin_audit_log').select('action, reason, created_at').order('created_at', { ascending: false }).limit(10),
    svc.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    svc.from('business_applications').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    svc.from('feature_flags').select('key, enabled, note').order('key'),
    svc.from('daily_stats').select('day, dau, new_signups, posts, comments, likes, messages, stories, listings, jobs').order('day', { ascending: true }).limit(30),
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
    { label: 'Active now', value: active.count ?? 0, href: '/users', sub: 'last_seen within ' + ACTIVE_WINDOW_MIN + ' min' },
    { label: 'Pending verification', value: appRows.length, href: '/queue', hot: appRows.length > 0 },
    { label: 'Open reports', value: openReports.length, href: '/reports', hot: openReports.length > 0 },
  ];

  const needs = [
    { label: 'Verification applications', sub: 'submitted + under_review', count: appRows.length, href: '/queue' },
    { label: 'Open reports', sub: 'posts, listings and accounts', count: openReports.length, href: '/reports' },
    { label: 'Support tickets', sub: 'status = open', count: tickets.count ?? 0, href: '/support' },
    { label: 'Business applications', sub: 'status = submitted', count: bizApps.count ?? 0, href: '/businesses' },
  ].filter(n => n.count > 0);
  const attention = needs.reduce((s, n) => s + n.count, 0);

  const [vAll, vReview, vApproved, vRejected] = await Promise.all([
    svc.from('verification_applications').select('id', { count: 'exact', head: true }),
    svc.from('verification_applications').select('id', { count: 'exact', head: true }).in('status', ['under_review', 'approved', 'rejected']),
    svc.from('verification_applications').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    svc.from('verification_applications').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
  ]);
  const funnel = [
    { label: 'Applications received', value: vAll.count ?? 0 },
    { label: 'Reached review', value: vReview.count ?? 0 },
    { label: 'Approved', value: vApproved.count ?? 0 },
    { label: 'Rejected', value: vRejected.count ?? 0 },
  ];
  const funnelMax = Math.max(1, funnel[0].value);

  return (
    <Shell admin={admin} active="/dashboard" title="Overview" sub="Real-time platform health across Platinum Circles, and the work waiting on this desk.">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {metrics.map(m => (
          <Link key={m.label} href={m.href} className="rounded-[14px] border border-[#E5E4E0] bg-white p-5 transition-colors duration-150 hover:border-[#D6D4CE]">
            <p className="text-[12.5px] text-[#7A7D84]">{m.label}</p>
            <p className={'mt-1.5 text-[30px] font-semibold tabular-nums tracking-tight ' + (m.hot ? 'text-[#B45309]' : 'text-[#17181C]')}>{m.value.toLocaleString()}</p>
            <p className="mt-1 text-[11px] text-[#9A9DA4]">{m.sub ?? '\u00A0'}</p>
          </Link>
        ))}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-5">
        <div className="rounded-[14px] border border-[#E5E4E0] bg-white p-5 lg:col-span-3">
          <p className="mb-1 text-[14.5px] font-semibold text-[#17181C]">Platform activity</p>
          <p className="mb-4 text-[12px] text-[#9A9DA4]">Rebuilt nightly from daily_stats.</p>
          <PlatformActivityChart rows={(daily.data ?? []) as any} />
        </div>
        <div className="rounded-[14px] border border-[#E5E4E0] bg-white p-5 lg:col-span-2">
          <p className="mb-1 text-[14.5px] font-semibold text-[#17181C]">Needs attention{attention ? ' \u2014 ' + attention : ''}</p>
          {needs.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-[#9A9DA4]">Nothing waiting. Quiet is the goal.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-0.5">
              {needs.map(n => (
                <Link key={n.label} href={n.href} className="flex items-center justify-between rounded-[9px] px-2 py-2.5 transition-colors duration-150 hover:bg-[#FAFAF9]">
                  <span>
                    <span className="block text-[13px] font-semibold text-[#17181C]">{n.label}</span>
                    <span className="block text-[11px] text-[#9A9DA4]">{n.sub}</span>
                  </span>
                  <span className="text-[15px] font-bold tabular-nums text-[#B45309]">{n.count}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2 rounded-[14px] border border-[#E5E4E0] bg-white p-5">
          <p className="mb-3 text-[14.5px] font-semibold text-[#17181C]">Verification funnel</p>
          <div className="flex flex-col gap-3">
            {funnel.map(f => (
              <div key={f.label}>
                <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
                  <span className="text-[#7A7D84]">{f.label}</span>
                  <span className="font-semibold tabular-nums text-[#17181C]">{f.value.toLocaleString()}</span>
                </div>
                <div className="h-[6px] rounded-full bg-[#F0EFEC]">
                  <div className="h-full rounded-full bg-[#5B4BD1]" style={{ width: Math.max(2, (f.value / funnelMax) * 100) + '%' }} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-[#9A9DA4]">All-time counts from verification_applications.</p>
        </div>

        <div className="lg:col-span-3 rounded-[14px] border border-[#E5E4E0] bg-white">
          <div className="flex items-center justify-between px-5 pt-5">
            <p className="text-[14.5px] font-semibold text-[#17181C]">Recent desk activity</p>
            <Link href="/audit" className="text-[12px] font-semibold text-[#17181C] hover:opacity-70">Audit log \u2192</Link>
          </div>
          <div className="mt-2">
            {(audit.data ?? []).length === 0 ? (
              <p className="px-5 py-10 text-center text-[13px] text-[#9A9DA4]">Every action lands here, permanently.</p>
            ) : (audit.data ?? []).map((a, i) => (
              <div key={i} className="flex items-baseline justify-between border-t border-[#F0EFEC] px-5 py-3">
                <span>
                  <span className="block text-[12.5px] font-semibold text-[#17181C]">{a.action.replace(/[._]/g, ' ')}</span>
                  <span className="block truncate text-[11.5px] text-[#7A7D84]">{a.reason}</span>
                </span>
                <span className="shrink-0 pl-3 text-[10.5px] tabular-nums text-[#9A9DA4]">{new Date(a.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {(flags.data ?? []).length > 0 && (
        <div className="mt-4 rounded-[14px] border border-[#E5E4E0] bg-white p-5">
          <p className="mb-3 text-[14.5px] font-semibold text-[#17181C]">Feature flags</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(flags.data ?? []).map(f => (
              <div key={f.key} className="rounded-[10px] border border-[#EFEDE8] px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-semibold text-[#17181C]">{f.key}</span>
                  <span className={'h-[8px] w-[8px] rounded-full ' + (f.enabled ? 'bg-[#2BA84A]' : 'bg-[#C6C4BE]')} />
                </div>
                {f.note && <p className="mt-0.5 truncate text-[10.5px] text-[#9A9DA4]">{f.note}</p>}
              </div>
            ))}
          </div>
          <Link href="/system" className="mt-3 inline-block text-[12px] font-semibold text-[#17181C] hover:opacity-70">Manage in Controls \u2192</Link>
        </div>
      )}

      {appRows.length + openReports.length > 0 && (
        <div className="mt-4 rounded-[14px] border border-[#E5E4E0] bg-white">
          <p className="px-5 pt-5 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Waiting applications and reports</p>
          <div className="mt-2">
            {appRows.map(a => {
              const p = names[a.applicant_id] || {};
              return (
                <Link key={a.id} href="/queue" className="flex items-center gap-3 border-t border-[#F0EFEC] px-5 py-3.5 transition-colors duration-150 hover:bg-[#FAFAF9]">
                  <Seal tier={a.tier} size={16} />
                  <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{p.full_name || '@' + (p.username || '?')} <span className="font-normal text-[#7A7D84]">applied for {TIER_LABEL[a.tier] || a.tier}{a.category ? ' - ' + a.category : ''}</span></p>
                  <p className="shrink-0 text-[11.5px] tabular-nums text-[#9A9DA4]">{new Date(a.created_at).toLocaleDateString()}</p>
                </Link>
              );
            })}
            {openReports.map((r: any) => (
              <Link key={r.kind + r.id} href="/reports" className="flex items-center gap-3 border-t border-[#F0EFEC] px-5 py-3.5 transition-colors duration-150 hover:bg-[#FAFAF9]">
                <span className="shrink-0 rounded-full border border-[#F3E3C5] bg-[#FBF4E4] px-2 py-0.5 text-[10.5px] font-bold text-[#B45309]">{r.kind}</span>
                <p className="min-w-0 flex-1 truncate text-[13px]"><span className="font-semibold">Reported</span> <span className="text-[#7A7D84]">- {r.reason}</span></p>
                <p className="shrink-0 text-[11.5px] tabular-nums text-[#9A9DA4]">{new Date(r.created_at).toLocaleDateString()}</p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}