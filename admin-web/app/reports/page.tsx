import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { dismissReport, removeReportedPost, removeReportedListing, resolveUserReport } from '@/lib/actions';
import Shell from '@/components/Shell';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();

  const { data: postReports } = await svc.from('post_reports')
    .select('*').eq('status', 'open').order('created_at', { ascending: true }).limit(50);
  const { data: listingReports } = await svc.from('listing_reports')
    .select('*').eq('status', 'open').order('created_at', { ascending: true }).limit(50);
  const { data: userReports } = await svc.from('user_reports')
    .select('*').eq('status', 'open').order('created_at', { ascending: true }).limit(50);

  const pids = Array.from(new Set((postReports ?? []).map(r => r.post_id)));
  const posts: Record<string, any> = {};
  if (pids.length) {
    const { data } = await svc.from('posts').select('id, user_id, content, created_at').in('id', pids);
    (data ?? []).forEach(p => { posts[p.id] = p; });
  }
  const lids = Array.from(new Set((listingReports ?? []).map(r => r.listing_id)));
  const listings: Record<string, any> = {};
  if (lids.length) {
    const { data } = await svc.from('listings').select('id, seller_id, title, price, status').in('id', lids);
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
  const total = (postReports?.length || 0) + (listingReports?.length || 0) + (userReports?.length || 0);
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
    <Shell admin={admin} active="/reports" title="Reports" sub="What members flagged - posts, listings, and accounts awaiting judgment">
        {total === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#0B1E3D]/15 bg-white p-12 text-center">
            <p className="text-sm font-bold text-[#0B1E3D]">Nothing reported.</p>
            <p className="mt-1 text-xs text-[#0B1E3D]/50">When users flag posts, listings, or accounts, the cases land here.</p>
          </div>
        ) : null}

        {(postReports ?? []).map(r => {
          const p = posts[r.post_id];
          return (
            <div key={r.id} className="mb-4 rounded-2xl border border-[#0B1E3D]/10 bg-white p-5 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#0B1E3D]/40">Reported post - {r.reason}</p>
              <p className="mt-2 whitespace-pre-wrap rounded-xl bg-[#0B1E3D]/[0.03] p-3 text-sm text-[#0B1E3D]/85">{p ? (p.content || '(no text)') : '(post already deleted)'}</p>
              <p className="mt-2 text-[11px] text-[#0B1E3D]/50">By {p ? name(p.user_id) : '-'} - reported by {name(r.reporter_id)} - {new Date(r.created_at).toLocaleString()}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {p ? (
                  <form action={removeReportedPost}>
                    <input type="hidden" name="rid" value={r.id} /><input type="hidden" name="pid" value={r.post_id} />
                    <button className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-100">Remove post</button>
                  </form>
                ) : null}
                <form action={dismissReport}>
                  <input type="hidden" name="rid" value={r.id} /><input type="hidden" name="table" value="post_reports" />
                  <button className="rounded-xl border border-[#0B1E3D]/15 px-4 py-2 text-xs font-bold text-[#0B1E3D]/70 hover:bg-[#0B1E3D]/5">No violation</button>
                </form>
                {p ? <Link href={'/users?q=' + encodeURIComponent(people[p.user_id]?.username || '')} className="rounded-xl border border-[#0B1E3D]/15 px-4 py-2 text-xs font-bold text-[#0B1E3D]/70 hover:bg-[#0B1E3D]/5">Open author</Link> : null}
              </div>
            </div>
          );
        })}

        {(listingReports ?? []).map(r => {
          const l = listings[r.listing_id];
          return (
            <div key={r.id} className="mb-4 rounded-2xl border border-[#0B1E3D]/10 bg-white p-5 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#0B1E3D]/40">Reported listing - {r.reason}</p>
              <p className="mt-2 rounded-xl bg-[#0B1E3D]/[0.03] p-3 text-sm font-semibold text-[#0B1E3D]/85">{l ? (l.title + ' - $' + l.price + ' - ' + l.status) : '(listing already removed)'}</p>
              {r.detail ? <p className="mt-1 text-xs italic text-[#0B1E3D]/60">{r.detail}</p> : null}
              <p className="mt-2 text-[11px] text-[#0B1E3D]/50">Seller {l ? name(l.seller_id) : '-'} - reported by {name(r.reporter_id)} - {new Date(r.created_at).toLocaleString()}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {l ? (
                  <form action={removeReportedListing}>
                    <input type="hidden" name="rid" value={r.id} /><input type="hidden" name="lid" value={r.listing_id} />
                    <button className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-100">Remove listing</button>
                  </form>
                ) : null}
                <form action={dismissReport}>
                  <input type="hidden" name="rid" value={r.id} /><input type="hidden" name="table" value="listing_reports" />
                  <button className="rounded-xl border border-[#0B1E3D]/15 px-4 py-2 text-xs font-bold text-[#0B1E3D]/70 hover:bg-[#0B1E3D]/5">No violation</button>
                </form>
              </div>
            </div>
          );
        })}

        {(userReports ?? []).map(r => (
          <div key={r.id} className="mb-4 rounded-2xl border border-[#0B1E3D]/10 bg-white p-5 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#0B1E3D]/40">Reported account - {r.reason}</p>
            <p className="mt-2 rounded-xl bg-[#0B1E3D]/[0.03] p-3 text-sm font-semibold text-[#0B1E3D]/85">{name(r.reported_id)}</p>
            {r.details ? <p className="mt-1 text-xs italic text-[#0B1E3D]/60">{r.details}</p> : null}
            <p className="mt-2 text-[11px] text-[#0B1E3D]/50">Reported by {name(r.reporter_id)} - {new Date(r.created_at).toLocaleString()}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={'/users?q=' + encodeURIComponent(people[r.reported_id]?.username || '')} className="rounded-xl bg-[#0B1E3D] px-4 py-2 text-xs font-extrabold text-white hover:opacity-90">Open on the user desk</Link>
              <form action={resolveUserReport}>
                <input type="hidden" name="rid" value={r.id} /><input type="hidden" name="outcome" value="actioned" />
                <button className="rounded-xl border border-[#0B1E3D]/15 px-4 py-2 text-xs font-bold text-[#0B1E3D]/70 hover:bg-[#0B1E3D]/5">Mark actioned</button>
              </form>
              <form action={resolveUserReport}>
                <input type="hidden" name="rid" value={r.id} /><input type="hidden" name="outcome" value="dismissed" />
                <button className="rounded-xl border border-[#0B1E3D]/15 px-4 py-2 text-xs font-bold text-[#0B1E3D]/70 hover:bg-[#0B1E3D]/5">No violation</button>
              </form>
            </div>
          </div>
        ))}
        {resolved.length ? (
          <div className="mt-8">
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