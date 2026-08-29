import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';
import ReportsDesk from '@/components/ReportsDesk';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();

  const { data: postReports } = await svc.from('post_reports').select('*').eq('status', 'open').order('created_at', { ascending: true }).limit(50);
  const { data: listingReports } = await svc.from('listing_reports').select('*').eq('status', 'open').order('created_at', { ascending: true }).limit(50);
  const { data: userReports } = await svc.from('user_reports').select('*').eq('status', 'open').order('created_at', { ascending: true }).limit(50);

  const pids = Array.from(new Set((postReports ?? []).map(r => r.post_id)));
  const posts: Record<string, any> = {};
  if (pids.length) {
    const { data } = await svc.from('posts').select('id, user_id, content, created_at').in('id', pids);
    (data ?? []).forEach(p => { posts[p.id] = p; });
  }
  const lids = Array.from(new Set((listingReports ?? []).map(r => r.listing_id)));
  const listings: Record<string, any> = {};
  if (lids.length) {
    const { data } = await svc.from('marketplace_listings').select('id, seller_id, title, price, status').in('id', lids);
    (data ?? []).forEach(l => { listings[l.id] = l; });
  }
  const uidSet = new Set<string>();
  (postReports ?? []).forEach(r => uidSet.add(r.reporter_id));
  (listingReports ?? []).forEach(r => uidSet.add(r.reporter_id));
  (userReports ?? []).forEach(r => { uidSet.add(r.reporter_id); uidSet.add(r.reported_id); });
  Object.values(posts).forEach((p: any) => uidSet.add(p.user_id));
  Object.values(listings).forEach((l: any) => uidSet.add(l.seller_id));
  const people: Record<string, any> = {};
  if (uidSet.size) {
    const { data } = await svc.from('profiles').select('id, full_name, username').in('id', Array.from(uidSet));
    (data ?? []).forEach(p => { people[p.id] = p; });
  }
  const name = (id?: string | null) => id && people[id] ? (people[id].full_name || '@' + people[id].username) : 'Unknown';

  const unified = [
    ...(postReports ?? []).map(r => {
      const p = posts[r.post_id];
      return {
        id: r.id, kind: 'Post' as const, reason: r.reason, created_at: r.created_at,
        reporterName: name(r.reporter_id), targetLabel: p ? (p.content || '(no text)') : '', targetGone: !p,
        postId: r.post_id, reportedUsername: p ? people[p.user_id]?.username ?? null : null,
      };
    }),
    ...(listingReports ?? []).map(r => {
      const l = listings[r.listing_id];
      return {
        id: r.id, kind: 'Listing' as const, reason: r.reason, created_at: r.created_at,
        reporterName: name(r.reporter_id), targetLabel: l ? (l.title + ' \u2014 $' + l.price + ' \u2014 ' + l.status) : '', targetGone: !l,
        listingId: r.listing_id, detail: r.detail,
      };
    }),
    ...(userReports ?? []).map(r => ({
      id: r.id, kind: 'Account' as const, reason: r.reason, created_at: r.created_at,
      reporterName: name(r.reporter_id), targetLabel: name(r.reported_id), targetGone: false,
      reportedId: r.reported_id, reportedUsername: people[r.reported_id]?.username ?? null, detail: r.details,
    })),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at));

  const total = unified.length;
  const [rp, rl, ru] = await Promise.all([
    svc.from('post_reports').select('id, reason, status, resolved_at').neq('status', 'open').order('resolved_at', { ascending: false }).limit(5),
    svc.from('listing_reports').select('id, reason, status, resolved_at').neq('status', 'open').order('resolved_at', { ascending: false }).limit(5),
    svc.from('user_reports').select('id, reason, status, resolved_at').neq('status', 'open').order('resolved_at', { ascending: false }).limit(5),
  ]);
  const resolved = [
    ...(rp.data ?? []).map(r => ({ ...r, kind: 'Post' })),
    ...(rl.data ?? []).map(r => ({ ...r, kind: 'Listing' })),
    ...(ru.data ?? []).map(r => ({ ...r, kind: 'Account' })),
  ].sort((a, b) => String(b.resolved_at || '').localeCompare(String(a.resolved_at || ''))).slice(0, 10);

  return (
    <Shell admin={admin} active="/reports" title="Reports" sub="What members flagged \u2014 posts, listings, and accounts awaiting judgment.">
      {total === 0 ? (
        <div className="rounded-[12px] border border-dashed border-[#17181C]/15 bg-white p-12 text-center">
          <p className="text-sm font-bold text-[#17181C]">Nothing reported.</p>
          <p className="mt-1 text-xs text-[#17181C]/50">When users flag posts, listings, or accounts, the cases land here.</p>
        </div>
      ) : (
        <ReportsDesk reports={unified as any} />
      )}

      {resolved.length ? (
        <div className="mt-6">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Recently resolved</p>
          <div className="rounded-[12px] border border-[#E8E6E1] bg-white">
            {resolved.map((r: any) => (
              <div key={r.kind + r.id} className="flex items-center gap-3 border-b border-[#F0EFEC] px-5 py-2.5 last:border-0">
                <span className="shrink-0 rounded-full bg-[#F4F3F0] px-2 py-0.5 text-[10.5px] font-bold text-[#7A7D84]">{r.kind}</span>
                <p className="min-w-0 flex-1 truncate text-[12.5px] text-[#5A5D64]">{r.reason}</p>
                {r.status === 'actioned'
                  ? <span className="shrink-0 rounded-full border border-[#DCEFE0] bg-[#F2F9F3] px-2 py-0.5 text-[10.5px] font-bold text-[#1D7A38]">Actioned</span>
                  : <span className="shrink-0 rounded-full bg-[#F4F3F0] px-2 py-0.5 text-[10.5px] font-bold text-[#7A7D84]">No violation</span>}
                <p className="shrink-0 text-[11px] tabular-nums text-[#9A9DA4]">{r.resolved_at ? new Date(r.resolved_at).toLocaleDateString() : ''}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Shell>
  );
}