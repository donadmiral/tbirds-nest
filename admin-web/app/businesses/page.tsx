import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';
import { approveBusinessApplication, rejectBusinessApplication } from '@/lib/actions';
import Seal from '@/components/Seal';

export const dynamic = 'force-dynamic';

export default async function BusinessesPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();
  const { data: pendingApps } = await svc.from('business_applications')
    .select('*').eq('status', 'submitted').order('created_at', { ascending: true });
  const aids = Array.from(new Set((pendingApps ?? []).map(a => a.applicant_id)));
  const applicants: Record<string, any> = {};
  if (aids.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username').in('id', aids);
    (data ?? []).forEach(p => { applicants[p.id] = p; });
  }
  const { data: decidedApps } = await svc.from('business_applications')
    .select('id, company_name, desired_username, status, decision_reason, decided_at')
    .neq('status', 'submitted').order('decided_at', { ascending: false }).limit(5);
  const { data: bizs } = await svc.from('profiles')
    .select('id, full_name, username, avatar_url, is_verified, verified_tier, created_at, deactivated_at')
    .eq('account_type', 'business')
    .order('created_at', { ascending: false }).limit(50);
  const ids = (bizs ?? []).map(b => b.id);
  const counts: Record<string, number> = {};
  if (ids.length) {
    const { data: members } = await svc.from('business_members').select('business_id').in('business_id', ids);
    (members ?? []).forEach(m => { counts[m.business_id] = (counts[m.business_id] || 0) + 1; });
  }
  return (
    <Shell admin={admin} active="/businesses" title="Businesses" sub="Applications first, then every business on the platform">
      {(pendingApps ?? []).length ? (
        <div className="mb-6">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Applications - {(pendingApps ?? []).length} awaiting a decision</p>
          {(pendingApps ?? []).map(a => {
            const p = applicants[a.applicant_id] || {};
            return (
              <div key={a.id} className="mb-4 rounded-[12px] border border-[#E5E4E0] bg-white p-5">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{a.company_name} <span className="font-normal text-[#9A9DA4]">wants @{a.desired_username}</span></p>
                  <p className="shrink-0 text-[11.5px] tabular-nums text-[#9A9DA4]">{new Date(a.created_at).toLocaleString()}</p>
                </div>
                <p className="mt-2 whitespace-pre-wrap rounded-[10px] bg-[#F8F8F7] p-3 text-[13px] text-[#43454B]">{a.description}</p>
                <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] text-[#5A5D64]">
                  <p>Category: <span className="font-medium">{a.category || '-'}</span></p>
                  <p>Email: <span className="font-medium">{a.contact_email}</span></p>
                  <p>Phone: <span className="font-medium">{a.contact_phone || '-'}</span></p>
                  <p>Website: <span className="font-medium">{a.website || '-'}</span></p>
                  <p className="col-span-2">Registration: <span className="font-medium">{a.registration_info || '-'}</span></p>
                  {a.applicant_id ? (
                    <p className="col-span-2">Applied by <a href={'/users/' + a.applicant_id} className="font-semibold text-[#0B1E3D] hover:underline">{p.full_name || '@' + (p.username || '?')}</a></p>
                  ) : (
                    <p className="col-span-2">Public application - no personal account attached; the business will own itself</p>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <form action={approveBusinessApplication}>
                    <input type="hidden" name="id" value={a.id} />
                    <button className="rounded-[10px] bg-[#0B1E3D] px-4 py-2 text-[12px] font-bold text-white transition-opacity duration-150 hover:opacity-90">Approve - create @{a.desired_username} with space grey</button>
                  </form>
                  <form action={rejectBusinessApplication} className="flex flex-1 min-w-[260px] items-center gap-2">
                    <input type="hidden" name="id" value={a.id} />
                    <input name="reason" required placeholder="Reason if declining - the applicant sees this" className="flex-1 rounded-[10px] border border-[#E5E4E0] px-3 py-2 text-[12px] outline-none focus:border-[#B9BCC2]" />
                    <button className="rounded-[10px] border border-[#F0DEDE] bg-[#FBF2F2] px-3 py-2 text-[11px] font-bold text-[#B03A3A] hover:bg-[#F6E4E4]">Decline</button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {(decidedApps ?? []).length ? (
        <div className="mb-6">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Recent decisions</p>
          {(decidedApps ?? []).map(a => (
            <div key={a.id} className="mb-2 rounded-[12px] border border-[#E5E4E0] bg-white p-4">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{a.company_name} <span className="font-normal text-[#9A9DA4]">@{a.desired_username}</span></p>
                <span className={a.status === 'approved' ? 'rounded-full bg-[#EBF3EE] px-2 py-0.5 text-[10.5px] font-bold text-[#1D7A38]' : 'rounded-full bg-[#FBF2F2] px-2 py-0.5 text-[10.5px] font-bold text-[#B03A3A]'}>{a.status === 'approved' ? 'Approved' : 'Declined'}</span>
                <p className="shrink-0 text-[11px] tabular-nums text-[#9A9DA4]">{a.decided_at ? new Date(a.decided_at).toLocaleString() : ''}</p>
              </div>
              {a.decision_reason ? <p className="mt-2 whitespace-pre-wrap rounded-[8px] bg-[#F8F8F7] p-2.5 text-[12px] text-[#43454B]">{a.decision_reason}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Registered businesses</p>
      <div className="rounded-[12px] border border-[#E8E6E1] bg-white">
        {(bizs ?? []).length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-[#9A9DA4]">No business accounts yet. When one registers in the app, it appears here.</p>
        ) : (bizs ?? []).map(b => (
          <div key={b.id} className="flex items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 last:border-0">
            {b.avatar_url
              ? <img src={b.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
              : <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#ECEBE7] text-[12px] font-bold text-[#5A5D64]">{String(b.full_name || '?').slice(0, 1)}</div>}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 truncate text-[13px] font-semibold">{b.full_name || 'Unnamed'}{(b.verified_tier || b.is_verified) ? <Seal tier={b.verified_tier || 'business'} size={14} /> : null}<span className="font-normal text-[#9A9DA4]">@{b.username || '-'}</span></p>
              <p className="text-[11.5px] text-[#9A9DA4]">{counts[b.id] || 0} team member{(counts[b.id] || 0) === 1 ? '' : 's'} - joined {new Date(b.created_at).toLocaleDateString()}{b.deactivated_at ? ' - SUSPENDED' : ''}</p>
            </div>
            <Link href={'/users?q=' + encodeURIComponent(b.username || '')} className="shrink-0 rounded-[8px] border border-[#E8E6E1] px-3 py-1.5 text-[11.5px] font-semibold text-[#5A5D64] transition-colors duration-150 hover:bg-[#F0EFEC] hover:text-[#17181C]">Open</Link>
          </div>
        ))}
      </div>
    </Shell>
  );
}