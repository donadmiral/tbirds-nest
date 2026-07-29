import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { toggleFlag, publishAnnouncement, retireAnnouncement, addBlockedWord, removeBlockedWord } from '@/lib/actions';
import Shell from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function SystemPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();
  const { data: flags } = await svc.from('feature_flags').select('*').order('key');
  const { data: notes } = await svc.from('announcements').select('*').order('created_at', { ascending: false }).limit(10);
  const { data: words } = await svc.from('blocked_words').select('*').order('word');
  return (
    <Shell admin={admin} active="/system" title="Controls" sub="Kill switches and the platform's voice - use both sparingly">
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Feature flags</p>
      <div className="rounded-[12px] border border-[#E5E4E0] bg-white">
        {(flags ?? []).map(f => (
          <div key={f.key} className="flex items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 text-[13px] last:border-0">
            <p className="w-24 font-semibold capitalize">{f.key}</p>
            <p className="min-w-0 flex-1 truncate text-[#7A7D84]">{f.note}</p>
            {f.enabled
              ? <span className="rounded-full border border-[#DCEFE0] bg-[#F2F9F3] px-2 py-0.5 text-[10.5px] font-bold text-[#1D7A38]">On</span>
              : <span className="rounded-full border border-[#F0DEDE] bg-[#FBF2F2] px-2 py-0.5 text-[10.5px] font-bold text-[#B03A3A]">Off</span>}
            <form action={toggleFlag}>
              <input type="hidden" name="key" value={f.key} />
              <input type="hidden" name="to" value={f.enabled ? 'off' : 'on'} />
              <button className={'rounded-[8px] px-3 py-1 text-[11px] font-bold ' + (f.enabled ? 'border border-[#F0DEDE] bg-[#FBF2F2] text-[#B03A3A] hover:bg-[#F6E4E4]' : 'bg-[#0B1E3D] text-white hover:opacity-90')}>{f.enabled ? 'Switch off' : 'Switch on'}</button>
            </form>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-[#9A9DA4]">The app reads these live - switching off hides the surface for every member within a minute. App wiring lands per surface.</p>

      <p className="mb-2 mt-8 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Announcements</p>
      <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-5">
        <form action={publishAnnouncement} className="space-y-2">
          <input name="title" required placeholder="Title" className="w-full rounded-[10px] border border-[#E5E4E0] px-3 py-2 text-[13px] outline-none focus:border-[#B9BCC2]" />
          <textarea name="body" required rows={2} placeholder="The message every member sees at the top of their feed" className="w-full rounded-[10px] border border-[#E5E4E0] px-3 py-2 text-[13px] outline-none focus:border-[#B9BCC2]" />
          <button className="rounded-[10px] bg-[#0B1E3D] px-4 py-2 text-[12px] font-bold text-white hover:opacity-90">Publish to the platform</button>
        </form>
      </div>
      {(notes ?? []).length ? (
        <div className="mt-4 rounded-[12px] border border-[#E5E4E0] bg-white">
          {(notes ?? []).map(n => (
            <div key={n.id} className="flex items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 text-[12.5px] last:border-0">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{n.title}</p>
                <p className="truncate text-[#7A7D84]">{n.body}</p>
              </div>
              <p className="shrink-0 tabular-nums text-[11px] text-[#9A9DA4]">{new Date(n.created_at).toLocaleDateString()}</p>
              {n.active ? (
                <form action={retireAnnouncement}>
                  <input type="hidden" name="id" value={n.id} />
                  <button className="rounded-[8px] border border-[#E5E4E0] px-3 py-1 text-[11px] font-bold text-[#5A5D64] hover:bg-[#F0EFEC]">Retire</button>
                </form>
              ) : <span className="rounded-full bg-[#F4F3F0] px-2 py-0.5 text-[10.5px] font-bold text-[#7A7D84]">Retired</span>}
            </div>
          ))}
        </div>
      ) : null}

      <p className="mb-2 mt-8 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Blocked words</p>
      <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-5">
        <form action={addBlockedWord} className="flex items-center gap-2">
          <input name="word" required minLength={2} placeholder="Word or phrase to refuse in posts and comments" className="flex-1 rounded-[10px] border border-[#E5E4E0] px-3 py-2 text-[13px] outline-none focus:border-[#B9BCC2]" />
          <button className="rounded-[10px] bg-[#0B1E3D] px-4 py-2 text-[12px] font-bold text-white hover:opacity-90">Block</button>
        </form>
        {(words ?? []).length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {(words ?? []).map(w => (
              <form key={w.word} action={removeBlockedWord} className="flex items-center gap-1.5 rounded-full border border-[#E5E4E0] bg-[#FAFAF9] py-1 pl-3 pr-1.5">
                <span className="text-[12px] font-semibold text-[#43454B]">{w.word}</span>
                <input type="hidden" name="word" value={w.word} />
                <button className="flex h-5 w-5 items-center justify-center rounded-full text-[13px] font-bold text-[#9A9DA4] hover:bg-[#F0DEDE] hover:text-[#B03A3A]" title="Remove">&times;</button>
              </form>
            ))}
          </div>
        ) : <p className="mt-3 text-[12px] text-[#9A9DA4]">Nothing blocked yet. The database refuses matching posts and comments the moment a word lands here.</p>}
      </div>
    </Shell>
  );
}