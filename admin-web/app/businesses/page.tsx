import Image from 'next/image';
import CommandForm from '@/components/CommandForm';
import PermissionGate from '@/components/PermissionGate';
import Link from 'next/link';
import { requireDesk } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';
import { approveBusinessApplication, rejectBusinessApplication } from '@/lib/actions';
import Seal from '@/components/Seal';
import { completeRead } from '@/lib/completeRead';
import RefreshDesk from '@/components/RefreshDesk';

export const dynamic = 'force-dynamic';

export default async function BusinessesPage({ searchParams }: { searchParams: Promise<{ page?: string; applications?: string }> }) {
  const admin = await requireDesk('/businesses');
  const svc = serviceClient();
  const params = await searchParams;
  const pageNumber = (value: unknown) => typeof value === 'string' && /^\d{1,4}$/.test(value) ? Math.max(1, Number(value)) : 1;
  const page = pageNumber(params.page);
  const applicationPage = pageNumber(params.applications);
  const pageSize = 25;
  const href = (businessPage: number, applications: number) => `/businesses?page=${businessPage}&applications=${applications}`;
  const [pendingResult, decidedResult, businessResult] = await Promise.all([
    svc.from('business_applications').select('*', { count: 'exact' }).eq('status', 'submitted').order('created_at', { ascending: true }).order('id').range((applicationPage - 1) * pageSize, applicationPage * pageSize - 1),
    svc.from('business_applications').select('id, company_name, desired_username, status, decision_reason, decided_at').neq('status', 'submitted').order('decided_at', { ascending: false }).limit(5),
    svc.from('profiles').select('id, full_name, username, avatar_url, is_verified, verified_tier, created_at, deactivated_at', { count: 'exact' }).eq('account_type', 'business').order('created_at', { ascending: false }).order('id').range((page - 1) * pageSize, page * pageSize - 1),
  ]);
  if (pendingResult.error || decidedResult.error || businessResult.error || pendingResult.count === null || businessResult.count === null) throw new Error('Business applications and accounts could not be loaded.');
  const pendingApps = pendingResult.data;
  const decidedApps = decidedResult.data;
  const bizs = businessResult.data;
  const aids = Array.from(new Set((pendingApps ?? []).map(application => application.applicant_id).filter((id): id is string => typeof id === 'string' && id.length > 0)));
  const applicants: Record<string, { id: string; full_name: string | null; username: string | null }> = {};
  if (aids.length) {
    const { data, error } = await svc.from('profiles').select('id, full_name, username').in('id', aids);
    if (error) throw new Error('Business applicant identities could not be loaded.');
    (data ?? []).forEach(p => { applicants[p.id] = p; });
  }
  const ids = (bizs ?? []).map(b => b.id);
  const counts: Record<string, number> = {};
  if (ids.length) {
    const memberResult = await svc.from('business_members').select('business_id', { count: 'exact' }).in('business_id', ids);
    completeRead(memberResult, 'Business team membership');
    (memberResult.data ?? []).forEach(m => { counts[m.business_id] = (counts[m.business_id] || 0) + 1; });
  }
  return (
    <Shell admin={admin} active="/businesses" title="Businesses" sub="Review business applications, inspect recent decisions and browse registered accounts." pageActions={<RefreshDesk />}>
      <p className="mb-4 text-[13px] text-[var(--txt-muted)]">{pendingResult.count} applications awaiting a decision · {businessResult.count} registered businesses</p>
      {(pendingApps ?? []).length ? (
        <div className="mb-6">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Applications · page {applicationPage}</p>
          {(pendingApps ?? []).map(a => {
            const p = applicants[a.applicant_id] || {};
            return (
              <div key={a.id} className="mb-4 rounded-[12px] border border-[#E5E4E0] bg-white p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{a.company_name} <span className="font-normal text-[#9A9DA4]">wants @{a.desired_username}</span></p>
                  <p className="shrink-0 text-[11.5px] tabular-nums text-[#9A9DA4]">{new Date(a.created_at).toLocaleString()}</p>
                </div>
                <p className="mt-2 whitespace-pre-wrap rounded-[10px] bg-[#F8F8F7] p-3 text-[13px] text-[#43454B]">{a.description}</p>
                <div className="mt-2 grid grid-cols-1 break-words gap-x-6 gap-y-1 text-[12px] text-[#5A5D64] sm:grid-cols-2">
                  <p>Category: <span className="font-medium">{a.category || '-'}</span></p>
                  <p>Email: <span className="font-medium">{a.contact_email}</span></p>
                  <p>Phone: <span className="font-medium">{a.contact_phone || '-'}</span></p>
                  <p>Website: <span className="font-medium">{a.website || '-'}</span></p>
                  <p className="sm:col-span-2">Registration: <span className="font-medium">{a.registration_info || '-'}</span></p>
                  {a.applicant_id ? (
                    <p className="sm:col-span-2">Applied by <a href={'/users/' + a.applicant_id} className="font-semibold text-[#17181C] hover:underline">{p.full_name || '@' + (p.username || '?')}</a></p>
                  ) : (
                    <p className="sm:col-span-2">A signed-in applicant must be linked before this business can be approved.</p>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <PermissionGate role={admin.role} permission="business_manage"><CommandForm scope="approveBusinessApplication" action={approveBusinessApplication}>
                    <input type="hidden" name="id" value={a.id} />
                    <button disabled={!a.applicant_id} className="rounded-[10px] bg-[#17181C] px-4 py-2 text-[12px] font-bold text-white transition-opacity duration-150 hover:opacity-90 disabled:opacity-50">Approve and create @{a.desired_username}</button>
                  </CommandForm></PermissionGate>
                  <PermissionGate role={admin.role} permission="business_manage"><CommandForm scope="rejectBusinessApplication" action={rejectBusinessApplication} className="flex flex-1 min-w-[260px] items-center gap-2">
                    <input type="hidden" name="id" value={a.id} />
                    <label className="min-w-0 flex-1 text-[12px] font-semibold text-[var(--txt-muted)]">Reason shown to applicant
                      <input name="reason" required maxLength={2000} placeholder="Explain the decision" className="mt-1 block w-full rounded-[10px] border border-[#E5E4E0] px-3 py-2 text-[12px] outline-none focus:border-[#B9BCC2]" />
                    </label>
                    <button className="rounded-[10px] border border-[#F0DEDE] bg-[#FBF2F2] px-3 py-2 text-[11px] font-bold text-[#B03A3A] hover:bg-[#F6E4E4]">Decline</button>
                  </CommandForm></PermissionGate>
                </div>
              </div>
            );
          })}
        </div>
      ) : <p className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 text-[13px]">{pendingResult.count ? 'No applications on this page. Return to an earlier page.' : 'No applications are awaiting a decision.'}</p>}
      <nav aria-label="Business application pages" className="mb-6 flex flex-wrap items-center gap-4 text-[13px]">
        <span>Page {applicationPage} of {Math.max(1, Math.ceil(pendingResult.count / pageSize))}</span>
        {applicationPage > 1 ? <Link className="underline" href={href(page, applicationPage - 1)}>Previous applications</Link> : null}
        {applicationPage * pageSize < pendingResult.count ? <Link className="underline" href={href(page, applicationPage + 1)}>Next applications</Link> : null}
      </nav>
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
              {a.status === 'rejected' && a.decision_reason ? <p className="mt-2 whitespace-pre-wrap rounded-[8px] bg-[#F8F8F7] p-2.5 text-[12px] text-[#43454B]">{a.decision_reason}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Registered businesses</p>
      <div className="rounded-[12px] border border-[#E8E6E1] bg-white">
        {(bizs ?? []).length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-[#9A9DA4]">{businessResult.count ? 'No business accounts on this page. Return to an earlier page.' : 'No business accounts yet. Approved accounts will appear here.'}</p>
        ) : (bizs ?? []).map(b => (
          <div key={b.id} className="flex items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 last:border-0">
            {b.avatar_url
              ? <Image unoptimized width={36} height={36} src={b.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
              : <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#ECEBE7] text-[12px] font-bold text-[#5A5D64]">{String(b.full_name || '?').slice(0, 1)}</div>}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 truncate text-[13px] font-semibold">{b.full_name || 'Unnamed'}{(b.verified_tier || b.is_verified) ? <Seal tier={b.verified_tier || 'business'} size={14} /> : null}<span className="font-normal text-[#9A9DA4]">@{b.username || '-'}</span></p>
              <p className="text-[11.5px] text-[#9A9DA4]">{counts[b.id] || 0} team member{(counts[b.id] || 0) === 1 ? '' : 's'} - joined {new Date(b.created_at).toLocaleDateString()}{b.deactivated_at ? ' - SUSPENDED' : ''}</p>
            </div>
            <Link href={'/users?q=' + encodeURIComponent(b.username || '')} className="shrink-0 rounded-[8px] border border-[#E8E6E1] px-3 py-1.5 text-[11.5px] font-semibold text-[#5A5D64] transition-colors duration-150 hover:bg-[#F0EFEC] hover:text-[#17181C]">Open</Link>
          </div>
        ))}
      </div>
      <nav aria-label="Registered business pages" className="mt-4 flex flex-wrap items-center gap-4 text-[13px]">
        <span>Page {page} of {Math.max(1, Math.ceil(businessResult.count / pageSize))}</span>
        {page > 1 ? <Link className="underline" href={href(page - 1, applicationPage)}>Previous businesses</Link> : null}
        {page * pageSize < businessResult.count ? <Link className="underline" href={href(page + 1, applicationPage)}>Next businesses</Link> : null}
      </nav>
    </Shell>
  );
}
