import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { suspendUser, restoreUser, revokeVerification } from '@/lib/actions';
import Seal from '@/components/Seal';
import Shell from '@/components/Shell';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const { q } = await searchParams;
  const svc = serviceClient();
  let rows: any[] = [];
  if (!q || !q.trim()) {
    const { data } = await svc.from('profiles')
      .select('id, full_name, username, email, avatar_url, account_type, is_verified, verified_tier, verified_category, created_at, deactivated_at, suspended_reason')
      .order('created_at', { ascending: false }).limit(25);
    rows = data ?? [];
  }
  if (q && q.trim()) {
    const term = '%' + q.trim() + '%';
    const { data } = await svc.from('profiles')
      .select('id, full_name, username, email, avatar_url, account_type, is_verified, verified_tier, verified_category, created_at, deactivated_at, suspended_reason')
      .or('full_name.ilike.' + term + ',username.ilike.' + term + ',email.ilike.' + term)
      .order('created_at', { ascending: false }).limit(25);
    rows = data ?? [];
  }
  return (
    <Shell admin={admin} active="/users" title="User desk" sub="Search any account, see it whole, act with the audit log watching">
        <form method="get" className="mb-6 flex gap-2">
          <input name="q" defaultValue={q || ''} placeholder="Search name, username, or email"
            className="flex-1 rounded-[12px] border border-[#17181C]/15 bg-white px-4 py-2.5 text-sm text-[#17181C] outline-none transition-colors duration-150 focus:border-[#17181C]/40" />
          <button className="rounded-[12px] bg-[#17181C] px-5 py-2.5 text-sm font-bold text-white transition-opacity duration-150 hover:opacity-90">Search</button>
        </form>
        {!q ? <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Newest members</p> : null}
        {rows.length === 0 ? (
          <p className="text-center text-xs text-[#17181C]/40 py-12">No accounts match.</p>
        ) : rows.map(u => {
          const suspended = !!u.deactivated_at;
          return (
            <div key={u.id} className="mb-4 rounded-[12px] border border-[#17181C]/10 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  {u.avatar_url
                    ? <img src={u.avatar_url} alt="" className="h-11 w-11 rounded-full object-cover" />
                    : <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#17181C]/10 text-sm font-bold text-[#17181C]">{String(u.full_name || '?').slice(0, 1)}</div>}
                  <div>
                    <Link href={'/users/' + u.id} className="flex items-center gap-1 text-sm font-extrabold text-[#17181C] hover:underline">
                      {u.full_name || 'Unnamed'}
                      {u.verified_tier || u.is_verified ? <Seal tier={u.verified_tier || 'business'} size={15} /> : null}
                      <span className="font-medium text-[#17181C]/40">@{u.username || '-'}</span>
                    </Link>
                    <p className="text-[11px] text-[#17181C]/50">
                      {u.email || 'no email'} - {u.account_type || 'personal'} - joined {new Date(u.created_at).toLocaleDateString()}
                      {u.verified_category ? ' - ' + u.verified_category : ''}
                    </p>
                    {suspended ? <p className="mt-1 text-[11px] font-bold text-red-700">SUSPENDED{u.suspended_reason ? ': ' + u.suspended_reason : ''}</p> : null}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {!suspended ? (
                  <form action={suspendUser} className="flex flex-1 min-w-[280px] items-center gap-2">
                    <input type="hidden" name="id" value={u.id} />
                    <input name="reason" required placeholder="Reason for suspension (required)"
                      className="flex-1 rounded-[12px] border border-[#17181C]/15 px-3 py-2 text-xs text-[#17181C] outline-none transition-colors duration-150 focus:border-[#17181C]/40" />
                    <button className="rounded-[12px] border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700 transition-colors duration-150 hover:bg-red-100">Suspend</button>
                  </form>
                ) : (
                  <form action={restoreUser}>
                    <input type="hidden" name="id" value={u.id} />
                    <button className="rounded-[12px] bg-[#17181C] px-5 py-2 text-xs font-extrabold text-white transition-opacity duration-150 hover:opacity-90">Restore account</button>
                  </form>
                )}
                {(u.verified_tier || u.is_verified) ? (
                  <form action={revokeVerification}>
                    <input type="hidden" name="id" value={u.id} />
                    <button className="rounded-[12px] border border-[#17181C]/15 px-4 py-2 text-xs font-bold text-[#17181C]/70 transition-colors duration-150 hover:bg-[#17181C]/5">Revoke badge</button>
                  </form>
                ) : null}
              </div>
            </div>
          );
        })}
    </Shell>
  );
}