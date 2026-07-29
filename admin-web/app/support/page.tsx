import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { resolveTicket } from '@/lib/actions';
import Shell from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function SupportPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();
  const { data: open } = await svc.from('support_tickets')
    .select('*').eq('status', 'open').order('created_at', { ascending: true }).limit(50);
  const { data: done } = await svc.from('support_tickets')
    .select('id, user_id, kind, subject, resolution_note, resolved_at').eq('status', 'resolved')
    .order('resolved_at', { ascending: false }).limit(10);
  const uids = Array.from(new Set([...(open ?? []), ...(done ?? [])].map(t => t.user_id)));
  const people: Record<string, any> = {};
  if (uids.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username, deactivated_at').in('id', uids);
    (data ?? []).forEach(p => { people[p.id] = p; });
  }
  return (
    <Shell admin={admin} active="/support" title="Support" sub="Messages and appeals from members - your reply lands on their phone">
      {(open ?? []).length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-[#E5E4E0] bg-white p-10 text-center">
          <p className="text-[13px] font-semibold">The inbox is clear.</p>
          <p className="mt-1 text-[12px] text-[#9A9DA4]">Support messages and suspension appeals land here.</p>
        </div>
      ) : (open ?? []).map(t => {
        const p = people[t.user_id] || {};
        return (
          <div key={t.id} className="mb-4 rounded-[12px] border border-[#E5E4E0] bg-white p-5">
            <div className="flex items-center gap-2">
              {t.kind === 'appeal'
                ? <span className="rounded-full border border-[#F3E3C5] bg-[#FBF4E4] px-2 py-0.5 text-[10.5px] font-bold text-[#B45309]">Appeal</span>
                : <span className="rounded-full bg-[#EEF2FB] px-2 py-0.5 text-[10.5px] font-bold text-[#0B1E3D]">Support</span>}
              <p className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{t.subject}</p>
              <p className="shrink-0 text-[11.5px] tabular-nums text-[#9A9DA4]">{new Date(t.created_at).toLocaleString()}</p>
            </div>
            <p className="mt-2 whitespace-pre-wrap rounded-[10px] bg-[#F8F8F7] p-3 text-[13px] text-[#43454B]">{t.body}</p>
            <p className="mt-2 text-[11.5px] text-[#7A7D84]">From <Link href={'/users?q=' + encodeURIComponent(p.username || '')} className="font-semibold text-[#0B1E3D] hover:underline">{p.full_name || '@' + (p.username || '?')}</Link>{p.deactivated_at ? ' - account currently suspended' : ''}</p>
            <form action={resolveTicket} className="mt-3 flex items-start gap-2">
              <input type="hidden" name="rid" value={t.id} />
              <textarea name="note" required rows={2} placeholder={t.kind === 'appeal' ? 'Your decision and why - restoring the account happens on the user desk' : 'Your reply to the member'}
                className="flex-1 rounded-[10px] border border-[#E5E4E0] px-3 py-2 text-[13px] outline-none transition-colors duration-150 focus:border-[#B9BCC2]" />
              <button className="rounded-[10px] bg-[#0B1E3D] px-4 py-2 text-[12px] font-bold text-white transition-opacity duration-150 hover:opacity-90">Send and resolve</button>
            </form>
          </div>
        );
      })}
      {(done ?? []).length ? (
        <div className="mt-8">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Recently resolved</p>
          <div className="rounded-[12px] border border-[#E5E4E0] bg-white">
            {(done ?? []).map(t => {
              const p = people[t.user_id] || {};
              return (
                <div key={t.id} className="border-b border-[#F0EFEC] px-5 py-2.5 last:border-0">
                  <p className="truncate text-[12.5px]"><span className="font-semibold">{t.subject}</span> <span className="text-[#9A9DA4]">- {p.full_name || '@' + (p.username || '?')} - {t.resolved_at ? new Date(t.resolved_at).toLocaleDateString() : ''}</span></p>
                  {t.resolution_note ? <p className="mt-0.5 truncate text-[11.5px] text-[#7A7D84]">{t.resolution_note}</p> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </Shell>
  );
}