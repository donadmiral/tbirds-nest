import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';
import UsersDesk from '@/components/UsersDesk';

export const dynamic = 'force-dynamic';

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const { q } = await searchParams;
  const svc = serviceClient();
  const cols = 'id, full_name, username, email, avatar_url, account_type, is_verified, verified_tier, verified_category, created_at, deactivated_at, suspended_reason, restricted_until';

  let profilesQuery = svc.from('profiles').select(cols).order('created_at', { ascending: false }).limit(25);
  if (q && q.trim()) {
    const term = '%' + q.trim() + '%';
    profilesQuery = svc.from('profiles').select(cols)
      .or('full_name.ilike.' + term + ',username.ilike.' + term + ',email.ilike.' + term)
      .order('created_at', { ascending: false }).limit(25);
  }

  const dayAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const [profilesRes, totalRes, verifiedRes, activeRes, restrictedRes, appealsRes] = await Promise.all([
    profilesQuery,
    svc.from('profiles').select('id', { count: 'exact', head: true }),
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('is_verified', true),
    svc.from('profiles').select('id', { count: 'exact', head: true }).gte('last_seen', dayAgo),
    svc.from('profiles').select('id', { count: 'exact', head: true }).gt('restricted_until', new Date().toISOString()),
    svc.from('support_tickets').select('id, user_id, subject, created_at').eq('kind', 'appeal').eq('status', 'open').order('created_at', { ascending: true }).limit(20),
  ]);

  const baseRows = profilesRes.data ?? [];
  const ids = baseRows.map(u => u.id);

  const perUser = await Promise.all(ids.map(async id => {
    const [followers, following, strikes] = await Promise.all([
      svc.from('follows').select('id', { count: 'exact', head: true }).eq('following_id', id),
      svc.from('follows').select('id', { count: 'exact', head: true }).eq('follower_id', id),
      svc.from('member_strikes').select('id', { count: 'exact', head: true }).eq('user_id', id),
    ]);
    return { id, followers: followers.count ?? 0, following: following.count ?? 0, strikes: strikes.count ?? 0 };
  }));
  const perUserMap = new Map(perUser.map(p => [p.id, p]));

  const rows = baseRows.map(u => ({
    ...u,
    followers: perUserMap.get(u.id)?.followers ?? 0,
    following: perUserMap.get(u.id)?.following ?? 0,
    strikes: perUserMap.get(u.id)?.strikes ?? 0,
  }));

  const stats = [
    { label: 'Total members', value: totalRes.count ?? 0 },
    { label: 'Verified', value: verifiedRes.count ?? 0 },
    { label: 'Active today', value: activeRes.count ?? 0 },
    { label: 'Restricted', value: restrictedRes.count ?? 0 },
    { label: 'Open appeals', value: (appealsRes.data ?? []).length },
  ];

  return (
    <Shell admin={admin} active="/users" title="Users" sub="Every member on Platinum Circles \u2014 verification tier, strikes, restriction state and account standing.">
      <form method="get" className="mb-4 flex gap-2">
        <input name="q" defaultValue={q || ''} placeholder="Search name, username, or email"
          className="flex-1 rounded-[12px] border border-[#17181C]/15 bg-white px-4 py-2.5 text-sm text-[#17181C] outline-none transition-colors duration-150 focus:border-[#17181C]/40" />
        <button className="rounded-[12px] bg-[#17181C] px-5 py-2.5 text-sm font-bold text-white transition-opacity duration-150 hover:opacity-90">Search</button>
      </form>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map(s => (
          <div key={s.label} className="rounded-[12px] border border-[#E5E4E0] bg-white p-3.5">
            <p className="text-[20px] font-semibold tabular-nums tracking-tight text-[#17181C]">{s.value.toLocaleString()}</p>
            <p className="mt-0.5 text-[11px] text-[#9A9DA4]">{s.label}</p>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="py-16 text-center text-[13px] text-[#9A9DA4]">No accounts match.</p>
      ) : (
        <UsersDesk rows={rows as any} appeals={appealsRes.data ?? []} />
      )}
    </Shell>
  );
}