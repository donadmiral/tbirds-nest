import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { dismissReport, removeReportedPost, removeReportedListing, resolveUserReport, signOut } from '@/lib/actions';
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

  return (
    <main className="min-h-screen bg-[#F5F6F8]">
      <header className="sticky top-0 z-10 border-b border-[#0B1E3D]/10 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <h1 className="text-base font-extrabold text-[#0B1E3D]">Reports</h1>
            <nav className="flex gap-4 text-xs font-semibold text-[#0B1E3D]/60">
              <Link href="/queue" className="hover:text-[#0B1E3D]">Verification queue</Link>
              <Link href="/users" className="hover:text-[#0B1E3D]">Users</Link>
              <span className="text-[#0B1E3D]">Reports</span>
            </nav>
          </div>
          <form action={signOut}><button className="rounded-lg border border-[#0B1E3D]/15 px-3 py-1.5 text-xs font-semibold text-[#0B1E3D] hover:bg-[#0B1E3D]/5">Sign out</button></form>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-6 py-8">
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
      </div>
    </main>
  );
}