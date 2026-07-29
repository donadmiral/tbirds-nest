import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { adminRemovePost, adminRemoveStory } from '@/lib/actions';
import Shell from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function ContentPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();
  const { data: posts } = await svc.from('posts')
    .select('id, user_id, content, body, media_url, likes_count, comments_count, created_at')
    .order('created_at', { ascending: false }).limit(25);
  const { data: trend } = await svc.from('trending_snapshot')
    .select('kind, ref_id, user_id, rank, heat, uniq_engagers')
    .order('kind', { ascending: true }).order('rank', { ascending: true });
  const trendPostIds = (trend ?? []).filter(t => t.kind === 'post').map(t => t.ref_id);
  const trendPosts: Record<string, any> = {};
  if (trendPostIds.length) {
    const { data } = await svc.from('posts').select('id, content, body').in('id', trendPostIds);
    (data ?? []).forEach(p => { trendPosts[p.id] = p; });
  }
  const trendStoryIds = (trend ?? []).filter(t => t.kind === 'story').map(t => t.ref_id);
  const trendStories: Record<string, any> = {};
  if (trendStoryIds.length) {
    const { data } = await svc.from('stories').select('id, caption, media_type').in('id', trendStoryIds);
    (data ?? []).forEach(s => { trendStories[s.id] = s; });
  }
  const uids = Array.from(new Set([...(posts ?? []).map(p => p.user_id), ...(trend ?? []).map(t => t.user_id)]));
  const people: Record<string, any> = {};
  if (uids.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username').in('id', uids);
    (data ?? []).forEach(p => { people[p.id] = p; });
  }
  return (
    <Shell admin={admin} active="/content" title="Content" sub="The newest posts across the platform - remove only what violates">
      {(trend ?? []).length ? (
        <div className="mb-6">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Trending right now - what the snapshot promotes</p>
          <div className="rounded-[12px] border border-[#E8E6E1] bg-white">
            {(trend ?? []).map(tr => {
              const a = people[tr.user_id] || {};
              const preview = tr.kind === 'post'
                ? (trendPosts[tr.ref_id]?.content || trendPosts[tr.ref_id]?.body || '(post gone)')
                : ((trendStories[tr.ref_id]?.caption || '(story)') + ' - ' + (trendStories[tr.ref_id]?.media_type || ''));
              return (
                <div key={tr.kind + tr.ref_id} className="flex items-center gap-3 border-b border-[#F0EFEC] px-5 py-2.5 text-[12.5px] last:border-0">
                  <span className="w-6 shrink-0 text-right font-bold tabular-nums text-[#B08D3F]">#{tr.rank}</span>
                  <span className={'shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ' + (tr.kind === 'post' ? 'bg-[#EEF2FB] text-[#0B1E3D]' : 'bg-[#FBF4E4] text-[#B45309]')}>{tr.kind}</span>
                  <Link href={'/users/' + tr.user_id} className="shrink-0 font-semibold text-[#0B1E3D] hover:underline">{a.full_name || '@' + (a.username || '?')}</Link>
                  <p className="min-w-0 flex-1 truncate text-[#5A5D64]">{preview}</p>
                  <p className="shrink-0 tabular-nums text-[11px] text-[#9A9DA4]">{tr.uniq_engagers} engagers</p>
                  {tr.kind === 'post' && trendPosts[tr.ref_id] ? (
                    <form action={adminRemovePost}><input type="hidden" name="pid" value={tr.ref_id} /><button className="rounded-[8px] border border-[#F0DEDE] bg-[#FBF2F2] px-2.5 py-1 text-[10.5px] font-bold text-[#B03A3A] hover:bg-[#F6E4E4]">Remove</button></form>
                  ) : tr.kind === 'story' && trendStories[tr.ref_id] ? (
                    <form action={adminRemoveStory}><input type="hidden" name="sid" value={tr.ref_id} /><button className="rounded-[8px] border border-[#F0DEDE] bg-[#FBF2F2] px-2.5 py-1 text-[10.5px] font-bold text-[#B03A3A] hover:bg-[#F6E4E4]">Remove</button></form>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-[#9A9DA4]">Removing deletes the content everywhere - the snapshot rebuilds within three minutes and it falls out of trending.</p>
        </div>
      ) : null}
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Newest posts</p>
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
                <Link href={'/users/' + p.user_id} className="text-[11.5px] font-semibold text-[#0B1E3D] hover:underline">Open author</Link>
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