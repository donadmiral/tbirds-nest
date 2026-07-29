import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { adminRemoveStory } from '@/lib/actions';
import Shell from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function StoriesPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();
  const { data: active } = await svc.from('stories')
    .select('id, user_id, media_type, caption, views_count, created_at, expires_at')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(50);
  const { count: expired24 } = await svc.from('stories')
    .select('id', { count: 'exact', head: true })
    .lt('expires_at', new Date().toISOString())
    .gt('created_at', new Date(Date.now() - 86400000).toISOString());
  const uids = Array.from(new Set((active ?? []).map(s => s.user_id)));
  const people: Record<string, any> = {};
  if (uids.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username').in('id', uids);
    (data ?? []).forEach(p => { people[p.id] = p; });
  }
  const hoursLeft = (iso: string) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3600000));
  return (
    <Shell admin={admin} active="/stories" title="Stories" sub="Every story currently live - they vanish on their own, violations vanish now">
      <p className="mb-3 text-[12px] text-[#9A9DA4]">{(active ?? []).length} live now - {expired24 ?? 0} expired in the last day</p>
      <div className="rounded-[12px] border border-[#E5E4E0] bg-white">
        {(active ?? []).length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-[#9A9DA4]">No live stories right now.</p>
        ) : (active ?? []).map(s => {
          const p = people[s.user_id] || {};
          return (
            <div key={s.id} className="flex items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 text-[12.5px] last:border-0">
              <span className="shrink-0 rounded-full bg-[#EEF2FB] px-2 py-0.5 text-[10.5px] font-bold text-[#0B1E3D]">{s.media_type}</span>
              <Link href={'/users/' + s.user_id} className="shrink-0 font-semibold text-[#0B1E3D] hover:underline">{p.full_name || '@' + (p.username || '?')}</Link>
              <p className="min-w-0 flex-1 truncate text-[#5A5D64]">{s.caption || '(no caption)'}</p>
              <p className="shrink-0 tabular-nums text-[#9A9DA4]">{s.views_count} views</p>
              <p className="shrink-0 tabular-nums text-[#9A9DA4]">{hoursLeft(s.expires_at)}h left</p>
              <form action={adminRemoveStory}>
                <input type="hidden" name="sid" value={s.id} />
                <button className="rounded-[8px] border border-[#F0DEDE] bg-[#FBF2F2] px-3 py-1 text-[11px] font-bold text-[#B03A3A] hover:bg-[#F6E4E4]">Remove</button>
              </form>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}