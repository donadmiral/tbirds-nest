import Link from 'next/link';
import { requireDesk } from '@/lib/adminAuth';
import { canPerform } from '@/lib/permissions';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';
import ReportsDesk from '@/components/ReportsDesk';

export const dynamic = 'force-dynamic';

const SIZE = 25;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const admin = await requireDesk('/reports');
  const input = (await searchParams).page;
  const page = typeof input === 'string' && /^\d{1,6}$/.test(input) ? Math.max(1, Number(input)) : 1;
  const start = (page - 1) * SIZE;
  const allowPosts = canPerform(admin.role, 'report_post');
  const allowListings = canPerform(admin.role, 'report_listing');
  const allowUsers = canPerform(admin.role, 'report_user');
  const svc = serviceClient();

  const empty = { data: [], error: null, count: 0 };
  const [postResult, listingResult, userResult] = await Promise.all([
    allowPosts ? svc.from('post_reports').select('id, post_id, reporter_id, reason, created_at', { count: 'exact' }).eq('status', 'open').order('created_at', { ascending: true }).order('id').range(start, start + SIZE - 1) : empty,
    allowListings ? svc.from('listing_reports').select('id, listing_id, reporter_id, reason, detail, created_at', { count: 'exact' }).eq('status', 'open').order('created_at', { ascending: true }).order('id').range(start, start + SIZE - 1) : empty,
    allowUsers ? svc.from('user_reports').select('id, reported_id, reporter_id, reason, details, created_at', { count: 'exact' }).eq('status', 'open').order('created_at', { ascending: true }).order('id').range(start, start + SIZE - 1) : empty,
  ]);
  if (postResult.error || listingResult.error || userResult.error) throw new Error('Reports could not be loaded.');
  const postReports = postResult.data;
  const listingReports = listingResult.data;
  const userReports = userResult.data;

  const pids = Array.from(new Set((postReports ?? []).map(r => r.post_id).filter(Boolean)));
  const posts: Record<string, any> = {};
  if (pids.length) {
    const { data, error } = await svc.from('posts').select('id, user_id, content, created_at').in('id', pids);
    if (error) throw new Error('Reported posts could not be loaded.');
    (data ?? []).forEach(p => { posts[p.id] = p; });
  }
  const lids = Array.from(new Set((listingReports ?? []).map(r => r.listing_id).filter(Boolean)));
  const listings: Record<string, any> = {};
  if (lids.length) {
    const { data, error } = await svc.from('marketplace_listings').select('id, seller_id, title, price, status').in('id', lids);
    if (error) throw new Error('Reported listings could not be loaded.');
    (data ?? []).forEach(l => { listings[l.id] = l; });
  }
  const uidSet = new Set<string>();
  (postReports ?? []).forEach(r => uidSet.add(r.reporter_id));
  (listingReports ?? []).forEach(r => uidSet.add(r.reporter_id));
  (userReports ?? []).forEach(r => { uidSet.add(r.reporter_id); uidSet.add(r.reported_id); });
  Object.values(posts).forEach((p: any) => uidSet.add(p.user_id));
  Object.values(listings).forEach((l: any) => uidSet.add(l.seller_id));
  const profileIds = Array.from(uidSet).filter(Boolean);
  const people: Record<string, any> = {};
  if (profileIds.length) {
    const { data, error } = await svc.from('profiles').select('id, full_name, username').in('id', profileIds);
    if (error) throw new Error('Report participants could not be loaded.');
    (data ?? []).forEach(p => { people[p.id] = p; });
  }
  const name = (id?: string | null) => id && people[id] ? (people[id].full_name || (people[id].username ? '@' + people[id].username : 'Unknown')) : 'Unknown';

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
      reporterName: name(r.reporter_id), targetLabel: name(r.reported_id), targetGone: !people[r.reported_id],
      reportedId: r.reported_id, reportedUsername: people[r.reported_id]?.username ?? null, detail: r.details,
    })),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

  const total = (postResult.count ?? 0) + (listingResult.count ?? 0) + (userResult.count ?? 0);
  const more = [postResult, listingResult, userResult].some(r => (r.count ?? 0) > start + SIZE);
  const [rp, rl, ru] = await Promise.all([
    allowPosts ? svc.from('post_reports').select('id, reason, status, resolved_at').neq('status', 'open').order('resolved_at', { ascending: false, nullsFirst: false }).order('id').limit(10) : empty,
    allowListings ? svc.from('listing_reports').select('id, reason, status, resolved_at').neq('status', 'open').order('resolved_at', { ascending: false, nullsFirst: false }).order('id').limit(10) : empty,
    allowUsers ? svc.from('user_reports').select('id, reason, status, resolved_at').neq('status', 'open').order('resolved_at', { ascending: false, nullsFirst: false }).order('id').limit(10) : empty,
  ]);
  if (rp.error || rl.error || ru.error) throw new Error('Resolved reports could not be loaded.');
  const resolved = [
    ...(rp.data ?? []).map(r => ({ ...r, kind: 'Post' })),
    ...(rl.data ?? []).map(r => ({ ...r, kind: 'Listing' })),
    ...(ru.data ?? []).map(r => ({ ...r, kind: 'Account' })),
  ].sort((a, b) => String(b.resolved_at || '').localeCompare(String(a.resolved_at || '')) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)).slice(0, 10);

  return (
    <Shell admin={admin} active="/reports" title="Reports" sub={`${total} open reports in your assigned categories. Up to ${SIZE} per category on each page.`}>
      {unified.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-[#17181C]/15 bg-white p-12 text-center">
          <p className="text-sm font-bold text-[#17181C]">{total === 0 ? 'Nothing reported.' : 'No reports on this page.'}</p>
          <p className="mt-1 text-xs text-[#17181C]/50">{total === 0 ? 'New reports in your assigned categories will appear here.' : 'Use Previous or First page to return to open reports.'}</p>
        </div>
      ) : (
        <ReportsDesk key={page} reports={unified} role={admin.role} />
      )}

      <nav className="mt-5 flex items-center gap-4" aria-label="Report pages">
        {page > 1 ? <Link href="/reports">First page</Link> : null}
        {page > 1 ? <Link href={'/reports?page=' + (page - 1)}>Previous</Link> : null}
        <span>Page {page}</span>
        {more ? <Link href={'/reports?page=' + (page + 1)}>Next</Link> : null}
      </nav>

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
