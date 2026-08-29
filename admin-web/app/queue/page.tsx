import { redirect } from 'next/navigation';
import { getAdmin, VERIFICATION_ROLES } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Seal from '@/components/Seal';
import Shell from '@/components/Shell';
import VerificationDesk from '@/components/VerificationDesk';

export const dynamic = 'force-dynamic';

const TIER_LABEL: Record<string, string> = { public_figure: 'Green', business: 'Space grey', official: 'Platinum' };

function medianHours(pairs: { created_at: string; decided_at: string }[]): number | null {
  if (pairs.length === 0) return null;
  const hrs = pairs.map(p => (new Date(p.decided_at).getTime() - new Date(p.created_at).getTime()) / 3600000).sort((a, b) => a - b);
  const mid = Math.floor(hrs.length / 2);
  return hrs.length % 2 ? hrs[mid] : (hrs[mid - 1] + hrs[mid]) / 2;
}

export default async function QueuePage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  if (!VERIFICATION_ROLES.has(admin.role)) redirect('/');
  const svc = serviceClient();

  const [appsRes, decidedRes, approved30Res] = await Promise.all([
    svc.from('verification_applications').select('*').in('status', ['submitted', 'under_review']).order('created_at', { ascending: true }),
    svc.from('verification_applications').select('id, applicant_id, tier, category, status, created_at, decided_at, decision_reason').not('decided_at', 'is', null).order('decided_at', { ascending: false }).limit(15),
    svc.from('verification_applications').select('id', { count: 'exact', head: true }).eq('status', 'approved').gte('decided_at', new Date(Date.now() - 30 * 86400000).toISOString()),
  ]);
  const appsRaw = appsRes.data ?? [];
  const decided = decidedRes.data ?? [];

  const refByApp: Record<string, any[]> = {};
  const refNames: Record<string, any> = {};
  if (appsRaw.length) {
    const { data: refs } = await svc.from('verification_referrals').select('application_id, referrer_id, note').in('application_id', appsRaw.map(a => a.id));
    (refs ?? []).forEach(r => { (refByApp[r.application_id] = refByApp[r.application_id] || []).push(r); });
    const rids = Array.from(new Set((refs ?? []).map(r => r.referrer_id)));
    if (rids.length) {
      const { data: rp } = await svc.from('profiles').select('id, full_name, username').in('id', rids);
      (rp ?? []).forEach(p => { refNames[p.id] = p; });
    }
  }

  const sortedApps = appsRaw.slice().sort((a, b) => ((refByApp[b.id]?.length || 0) - (refByApp[a.id]?.length || 0)) || a.created_at.localeCompare(b.created_at));
  const ids = Array.from(new Set(sortedApps.map(a => a.applicant_id)));
  const profiles: Record<string, any> = {};
  const strikeCounts: Record<string, number> = {};
  if (ids.length) {
    const [{ data: profs }, strikeRows] = await Promise.all([
      svc.from('profiles').select('id, full_name, username, avatar_url, account_type, created_at').in('id', ids),
      Promise.all(ids.map(async id => ({ id, n: (await svc.from('member_strikes').select('id', { count: 'exact', head: true }).eq('user_id', id)).count ?? 0 }))),
    ]);
    (profs ?? []).forEach(p => { profiles[p.id] = p; });
    strikeRows.forEach(r => { strikeCounts[r.id] = r.n; });
  }

  const apps = sortedApps.map(a => {
    const p = profiles[a.applicant_id] || {};
    const vouches = refByApp[a.id] || [];
    return {
      ...a, full_name: p.full_name ?? null, username: p.username ?? null, avatar_url: p.avatar_url ?? null, account_type: p.account_type ?? null,
      vouches: vouches.length,
      voucherNames: vouches.map((r: any) => refNames[r.referrer_id]?.full_name || '@' + (refNames[r.referrer_id]?.username || '?')).join(', '),
      strikes: strikeCounts[a.applicant_id] ?? 0,
    };
  });

  const dids = Array.from(new Set(decided.map(d => d.applicant_id)));
  const dnames: Record<string, any> = {};
  if (dids.length) {
    const { data: dp } = await svc.from('profiles').select('id, full_name, username').in('id', dids);
    (dp ?? []).forEach(p => { dnames[p.id] = p; });
  }

  const median = medianHours(decided.filter(d => d.decided_at).map(d => ({ created_at: d.created_at, decided_at: d.decided_at as string })));
  const stats = [
    { label: 'In queue', value: apps.length },
    { label: 'Submitted', value: apps.filter(a => a.status === 'submitted').length },
    { label: 'Under review', value: apps.filter(a => a.status === 'under_review').length },
    { label: 'Approved 30d', value: approved30Res.count ?? 0 },
    { label: 'Median decision', value: median === null ? '\u2014' : (median < 1 ? Math.round(median * 60) + 'm' : median.toFixed(1) + 'h') },
  ];

  return (
    <Shell admin={admin} active="/queue" title="Verification queue" sub="Badges are earned here, never bought \u2014 every case gets a human decision.">
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map(s => (
          <div key={s.label} className="rounded-[12px] border border-[#E5E4E0] bg-white p-3.5">
            <p className="text-[20px] font-semibold tabular-nums tracking-tight text-[#17181C]">{s.value}</p>
            <p className="mt-0.5 text-[11px] text-[#9A9DA4]">{s.label}</p>
          </div>
        ))}
      </div>

      {apps.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-[#17181C]/15 bg-white p-12 text-center">
          <p className="text-sm font-bold text-[#17181C]">The queue is empty.</p>
          <p className="mt-1 text-xs text-[#17181C]/50">When someone applies in the app, their case appears here for a human decision.</p>
        </div>
      ) : (
        <VerificationDesk apps={apps as any} />
      )}

      {decided.length ? (
        <div className="mt-6">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Decided</p>
          <div className="rounded-[12px] border border-[#E8E6E1] bg-white">
            {decided.map(d => {
              const p = dnames[d.applicant_id] || {};
              return (
                <div key={d.id} className="flex items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 last:border-0">
                  <Seal tier={d.tier} size={15} />
                  <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{p.full_name || '@' + (p.username || '?')} <span className="font-normal text-[#7A7D84]">{TIER_LABEL[d.tier] || d.tier}{d.category ? ' - ' + d.category : ''}</span></p>
                  {d.status === 'approved'
                    ? <span className="shrink-0 rounded-full border border-[#DCEFE0] bg-[#F2F9F3] px-2 py-0.5 text-[10.5px] font-bold text-[#1D7A38]">Granted</span>
                    : <span className="shrink-0 rounded-full border border-[#F0DEDE] bg-[#FBF2F2] px-2 py-0.5 text-[10.5px] font-bold text-[#B03A3A]">Declined</span>}
                  <p className="shrink-0 text-[11.5px] tabular-nums text-[#9A9DA4]">{d.decided_at ? new Date(d.decided_at).toLocaleDateString() : ''}</p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </Shell>
  );
}