import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { adminRemovePost } from '@/lib/actions';
import Shell from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function ContentPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();
  const { data: posts } = await svc.from('posts')
    .select('id, user_id, content, body, media_url, likes_count, comments_count, created_at')
    .order('created_at', { ascending: false }).limit(25);
  const uids = Array.from(new Set((posts ?? []).map(p => p.user_id)));
  const people: Record<string, any> = {};
  if (uids.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username').in('id', uids);
    (data ?? []).forEach(p => { people[p.id] = p; });
  }
  return (
    <Shell admin={admin} active="/content" title="Content" sub="The newest posts across the platform - remove only what violates">
      <div className="rounded-[12px] border border-[#E8E6E1] bg-white">
        {(posts ?? []).length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-[#9A9DA4]">No posts yet.</p>
        ) : (posts ?? []).map(p => {
          const a = people[p.user_id] || {};
          const text = p.content || p.body || (p.media_url ? '(media post)' : '(empty)');
          return (
            <div key={p.id} className="border-b border-[#F0EFEC] px-5 py-3.5 last:border-0">
              <div className="flex items-baseline gap-2">
                <p className="text-[13px] font-semibold">{a.full_name || 'Unknown'}</p>
                <p className="text-[12px] text-[#9A9DA4]">@{a.username || '-'}</p>
                <p className="ml-auto shrink-0 text-[11px] tabular-nums text-[#9A9DA4]">{new Date(p.created_at).toLocaleString()}</p>
              </div>
              <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[13px] text-[#43454B]">{text}</p>
              <div className="mt-2 flex items-center gap-3">
                <p className="text-[11.5px] tabular-nums text-[#9A9DA4]">{p.likes_count} likes - {p.comments_count} comments</p>
                <Link href={'/users?q=' + encodeURIComponent(a.username || '')} className="text-[11.5px] font-semibold text-[#0B1E3D] hover:underline">Open author</Link>
                <form action={adminRemovePost} className="ml-auto">
                  <input type="hidden" name="pid" value={p.id} />
                  <button className="rounded-[8px] border border-[#F0DEDE] bg-[#FBF2F2] px-3 py-1 text-[11px] font-bold text-[#B03A3A] transition-colors duration-150 hover:bg-[#F6E4E4]">Remove</button>
                </form>
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}