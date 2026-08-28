import { redirect } from 'next/navigation';
import { getAdmin, VERIFICATION_ROLES } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { approveApplication, rejectApplication } from '@/lib/actions';
import Seal from '@/components/Seal';
import Shell from '@/components/Shell';

export const dynamic = 'force-dynamic';

const TIER_LABEL: Record<string, string> = { public_figure: 'Green', business: 'Space grey', official: 'Platinum' };

export default async function QueuePage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  if (!VERIFICATION_ROLES.has(admin.role)) redirect('/');
  const svc = serviceClient();
  const { data: appsRaw } = await svc.from('verification_applications')
    .select('*').in('status', ['submitted', 'under_review'])
    .order('created_at', { ascending: true });
  const refByApp: Record<string, any[]> = {};
  const refNames: Record<string, any> = {};
  if ((appsRaw ?? []).length) {
    const { data: refs } = await svc.from('verification_referrals')
      .select('application_id, referrer_id, note').in('application_id', (appsRaw ?? []).map(a => a.id));
    (refs ?? []).forEach(r => { (refByApp[r.application_id] = refByApp[r.application_id] || []).push(r); });
    const rids = Array.from(new Set((refs ?? []).map(r => r.referrer_id)));
    if (rids.length) {
      const { data: rp } = await svc.from('profiles').select('id, full_name, username').in('id', rids);
      (rp ?? []).forEach(p => { refNames[p.id] = p; });
    }
  }
  const apps = (appsRaw ?? []).slice().sort((a, b) =>
    ((refByApp[b.id]?.length || 0) - (refByApp[a.id]?.length || 0)) || a.created_at.localeCompare(b.created_at));
  const ids = Array.from(new Set((apps ?? []).map(a => a.applicant_id)));
  const profiles: Record<string, any> = {};
  if (ids.length) {
    const { data: profs } = await svc.from('profiles')
      .select('id, full_name, username, avatar_url, account_type, created_at').in('id', ids);
    (profs ?? []).forEach(p => { profiles[p.id] = p; });
  }
  const { data: decided } = await svc.from('verification_applications')
    .select('id, applicant_id, tier, category, status, decided_at, decision_reason').not('decided_at', 'is', null)
    .order('decided_at', { ascending: false }).limit(15);
  const dids = Array.from(new Set((decided ?? []).map(d => d.applicant_id)));
  const dnames: Record<string, any> = {};
  if (dids.length) {
    const { data: dp } = await svc.from('profiles').select('id, full_name, username').in('id', dids);
    (dp ?? []).forEach(p => { dnames[p.id] = p; });
  }

  return (
    <Shell admin={admin} active="/queue" title="Verification queue" sub="Badges are earned here, never bought - every case gets a human decision">
        {(apps ?? []).length === 0 ? (
          <div className="rounded-[12px] border border-dashed border-[#17181C]/15 bg-white p-12 text-center">
            <p className="text-sm font-bold text-[#17181C]">The queue is empty.</p>
            <p className="mt-1 text-xs text-[#17181C]/50">When someone applies in the app, their case appears here for a human decision.</p>
          </div>
        ) : (apps ?? []).map(app => {
          const p = profiles[app.applicant_id] || {};
          const ev = app.evidence || {};
          return (
            <div key={app.id} className="mb-5 rounded-[12px] border border-[#17181C]/10 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  {p.avatar_url
                    ? <img src={p.avatar_url} alt="" className="h-14 w-14 rounded-full object-cover" />
                    : <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#17181C]/10 text-base font-bold text-[#17181C]">{String(p.full_name || '?').slice(0, 1)}</div>}
                  <div>
                    <p className="text-sm font-extrabold text-[#17181C]">{p.full_name || 'Unknown'} <span className="font-medium text-[#17181C]/40">@{p.username || '-'}</span></p>
                    <p className="text-[11px] text-[#17181C]/50">{p.account_type || 'personal'} account - applied {new Date(app.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <span className="flex items-center gap-1.5 rounded-full bg-[#17181C]/5 px-3 py-1.5 text-xs font-bold text-[#17181C]">
                  <Seal tier={app.tier} size={16} /> {TIER_LABEL[app.tier] || app.tier}{app.category ? ' - ' + app.category : ''}
                </span>
              </div>
              <div className="mt-4 rounded-[12px] bg-[#17181C]/[0.03] p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#17181C]/40">Their case</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[#17181C]/85">{ev.statement || '-'}</p>
                {ev.office ? <p className="mt-2 text-xs font-semibold text-[#17181C]/70">Office: {ev.office}</p> : null}
                {Array.isArray(ev.links) && ev.links.length ? (
                  <ul className="mt-2 space-y-1">
                    {ev.links.map((l: string, i: number) => (
                      <li key={i}><a href={l.startsWith('http') ? l : 'https://' + l} target="_blank" rel="noreferrer" className="text-xs text-blue-700 underline break-all">{l}</a></li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {(refByApp[app.id] || []).length ? (
                <div className="mt-3 rounded-[12px] border border-[#DCEFE0] bg-[#F2F9F3] p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[#1D7A38]">Vouched by {(refByApp[app.id] || []).length} verified member{(refByApp[app.id] || []).length === 1 ? '' : 's'}</p>
                  <p className="mt-1 text-xs text-[#1D7A38]">{(refByApp[app.id] || []).map((r: any) => (refNames[r.referrer_id]?.full_name || '@' + (refNames[r.referrer_id]?.username || '?'))).join(', ')}</p>
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <form action={approveApplication}>
                  <input type="hidden" name="id" value={app.id} />
                  <button className="rounded-[12px] bg-[#17181C] px-5 py-2 text-xs font-extrabold text-white transition-opacity duration-150 hover:opacity-90">Approve - grant the {TIER_LABEL[app.tier]?.toLowerCase()} seal</button>
                </form>
                <form action={rejectApplication} className="flex flex-1 min-w-[260px] items-center gap-2">
                  <input type="hidden" name="id" value={app.id} />
                  <input name="reason" placeholder="Reason if rejecting" className="flex-1 rounded-[12px] border border-[#17181C]/15 px-3 py-2 text-xs text-[#17181C] outline-none transition-colors duration-150 focus:border-[#17181C]/40" />
                  <button className="rounded-[12px] border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700 transition-colors duration-150 hover:bg-red-100">Reject</button>
                </form>
              </div>
            </div>
          );
        })}
        {(decided ?? []).length ? (
          <div className="mt-8">
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Decided</p>
            <div className="rounded-[12px] border border-[#E8E6E1] bg-white">
              {(decided ?? []).map(d => {
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