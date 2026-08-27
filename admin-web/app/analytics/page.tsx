import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();
  const { data: days } = await svc.from('daily_stats').select('*').order('day', { ascending: false }).limit(30);
  const rows = days ?? [];
  const maxDau = Math.max(1, ...rows.map(r => r.dau));
  const last7 = rows.slice(0, 7);
  const prev7 = rows.slice(7, 14);
  const sum = (xs: any[], k: string) => xs.reduce((a, r) => a + (r[k] || 0), 0);
  const avg7 = last7.length ? Math.round(sum(last7, 'dau') / last7.length) : 0;
  const avgPrev = prev7.length ? Math.round(sum(prev7, 'dau') / prev7.length) : 0;
  const delta = avgPrev > 0 ? Math.round(((avg7 - avgPrev) / avgPrev) * 100) : null;
  return (
    <Shell admin={admin} active="/analytics" title="Analytics" sub="Computed nightly from real activity - never invented">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-4">
          <p className="text-[24px] font-semibold tabular-nums tracking-tight">{avg7}</p>
          <p className="mt-0.5 text-[12px] font-medium text-[#7A7D84]">Daily actives, 7 day average</p>
        </div>
        <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-4">
          <p className={'text-[24px] font-semibold tabular-nums tracking-tight ' + (delta === null ? 'text-[#9A9DA4]' : delta >= 0 ? 'text-[#1D7A38]' : 'text-[#B03A3A]')}>{delta === null ? '-' : (delta >= 0 ? '+' : '') + delta + '%'}</p>
          <p className="mt-0.5 text-[12px] font-medium text-[#7A7D84]">Versus the prior week</p>
        </div>
        <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-4">
          <p className="text-[24px] font-semibold tabular-nums tracking-tight">{sum(last7, 'new_signups')}</p>
          <p className="mt-0.5 text-[12px] font-medium text-[#7A7D84]">Signups this week</p>
        </div>
        <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-4">
          <p className="text-[24px] font-semibold tabular-nums tracking-tight">{sum(last7, 'posts') + sum(last7, 'stories')}</p>
          <p className="mt-0.5 text-[12px] font-medium text-[#7A7D84]">Posts and stories this week</p>
        </div>
      </div>
      <div className="mt-6 overflow-hidden rounded-[12px] border border-[#E5E4E0] bg-white">
        <div className="grid grid-cols-[110px_1fr_70px_70px_70px_70px_70px_70px_70px_70px] gap-2 border-b border-[#E5E4E0] bg-[#FAFAF9] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#9A9DA4]">
          <p>Day</p><p>Actives</p><p className="text-right">Signups</p><p className="text-right">Posts</p><p className="text-right">Comments</p><p className="text-right">Likes</p><p className="text-right">Messages</p><p className="text-right">Stories</p><p className="text-right">Listings</p><p className="text-right">Jobs</p>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-[#9A9DA4]">The first nightly computation lands after midnight.</p>
        ) : rows.map(r => (
          <div key={r.day} className="grid grid-cols-[110px_1fr_70px_70px_70px_70px_70px_70px_70px_70px] items-center gap-2 border-b border-[#F0EFEC] px-5 py-2 text-[12px] tabular-nums last:border-0">
            <p className="text-[#5A5D64]">{r.day}</p>
            <div className="flex items-center gap-2">
              <div className="h-[8px] rounded-full bg-[#17181C]" style={{ width: Math.max(2, Math.round((r.dau / maxDau) * 100)) + '%', opacity: 0.85 }} />
              <p className="w-8 shrink-0 font-semibold">{r.dau}</p>
            </div>
            <p className="text-right">{r.new_signups}</p>
            <p className="text-right">{r.posts}</p>
            <p className="text-right">{r.comments}</p>
            <p className="text-right">{r.likes}</p>
            <p className="text-right">{r.messages}</p>
            <p className="text-right">{r.stories}</p>
            <p className="text-right">{r.listings}</p>
            <p className="text-right">{r.jobs}</p>
          </div>
        ))}
      </div>
    </Shell>
  );
}