import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { suspendUser, restoreUser, revokeVerification, signOut } from '@/lib/actions';
import Seal from '@/components/Seal';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const { q } = await searchParams;
  const svc = serviceClient();
  let rows: any[] = [];
  if (q && q.trim()) {
    const term = '%' + q.trim() + '%';
    const { data } = await svc.from('profiles')
      .select('id, full_name, username, email, avatar_url, account_type, is_verified, verified_tier, verified_category, created_at, deactivated_at, suspended_reason')
      .or('full_name.ilike.' + term + ',username.ilike.' + term + ',email.ilike.' + term)
      .order('created_at', { ascending: false }).limit(25);
    rows = data ?? [];
  }
  return (
    <main className="min-h-screen bg-[#F5F6F8]">
      <header className="sticky top-0 z-10 border-b border-[#0B1E3D]/10 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <h1 className="text-base font-extrabold text-[#0B1E3D]">User desk</h1>
            <nav className="flex gap-4 text-xs font-semibold text-[#0B1E3D]/60">
              <Link href="/queue" className="hover:text-[#0B1E3D]">Verification queue</Link>
              <span className="text-[#0B1E3D]">Users</span>
              <Link href="/reports" className="hover:text-[#0B1E3D]">Reports</Link>
            </nav>
          </div>
          <form action={signOut}><button className="rounded-lg border border-[#0B1E3D]/15 px-3 py-1.5 text-xs font-semibold text-[#0B1E3D] hover:bg-[#0B1E3D]/5">Sign out</button></form>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-6 py-8">
        <form method="get" className="mb-6 flex gap-2">
          <input name="q" defaultValue={q || ''} placeholder="Search name, username, or email"
            className="flex-1 rounded-xl border border-[#0B1E3D]/15 bg-white px-4 py-2.5 text-sm text-[#0B1E3D] outline-none focus:border-[#0B1E3D]" />
          <button className="rounded-xl bg-[#0B1E3D] px-5 py-2.5 text-sm font-bold text-white hover:opacity-90">Search</button>
        </form>
        {!q ? (
          <p className="text-center text-xs text-[#0B1E3D]/40 py-12">Search for any account to see it whole and act on it. Every action writes the audit log.</p>
        ) : rows.length === 0 ? (
          <p className="text-center text-xs text-[#0B1E3D]/40 py-12">No accounts match.</p>
        ) : rows.map(u => {
          const suspended = !!u.deactivated_at;
          return (
            <div key={u.id} className="mb-4 rounded-2xl border border-[#0B1E3D]/10 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  {u.avatar_url
                    ? <img src={u.avatar_url} alt="" className="h-11 w-11 rounded-full object-cover" />
                    : <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0B1E3D]/10 text-sm font-bold text-[#0B1E3D]">{String(u.full_name || '?').slice(0, 1)}</div>}
                  <div>
                    <p className="flex items-center gap-1 text-sm font-extrabold text-[#0B1E3D]">
                      {u.full_name || 'Unnamed'}
                      {u.verified_tier || u.is_verified ? <Seal tier={u.verified_tier || 'business'} size={15} /> : null}
                      <span className="font-medium text-[#0B1E3D]/40">@{u.username || '-'}</span>
                    </p>
                    <p className="text-[11px] text-[#0B1E3D]/50">
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
                      className="flex-1 rounded-xl border border-[#0B1E3D]/15 px-3 py-2 text-xs text-[#0B1E3D] outline-none focus:border-[#0B1E3D]" />
                    <button className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-100">Suspend</button>
                  </form>
                ) : (
                  <form action={restoreUser}>
                    <input type="hidden" name="id" value={u.id} />
                    <button className="rounded-xl bg-[#0B1E3D] px-5 py-2 text-xs font-extrabold text-white hover:opacity-90">Restore account</button>
                  </form>
                )}
                {(u.verified_tier || u.is_verified) ? (
                  <form action={revokeVerification}>
                    <input type="hidden" name="id" value={u.id} />
                    <button className="rounded-xl border border-[#0B1E3D]/15 px-4 py-2 text-xs font-bold text-[#0B1E3D]/70 hover:bg-[#0B1E3D]/5">Revoke badge</button>
                  </form>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}