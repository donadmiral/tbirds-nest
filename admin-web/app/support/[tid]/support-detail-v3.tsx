import Shell from '@/components/Shell';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { sendTicketReply, setTicketStatus } from '@/lib/actions';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const PILL: Record<string, string> = {
  open: 'bg-[#FBF2F2] text-[#B03A3A]',
  pending: 'bg-[#FDF6E9] text-[#B08D3F]',
  solved: 'bg-[#EBF3EE] text-[#1D7A38]',
};

export default async function TicketPage({ params }: { params: Promise<{ tid: string }> }) {
  const { tid } = await params;
  const admin = await getAdmin();
  if (!admin) redirect('/signin');
  const svc = serviceClient();
  const { data: t } = await svc.from('support_tickets').select('*').eq('id', tid).maybeSingle();
  if (!t) redirect('/support');
  const [{ data: msgs }, { data: p }] = await Promise.all([
    svc.from('support_messages').select('*').eq('ticket_id', t.id).order('created_at', { ascending: true }),
    svc.from('profiles').select('id, full_name, username').eq('id', t.user_id).maybeSingle(),
  ]);
  return (
    <Shell admin={admin} active="/support" title="Ticket" sub={t.kind === 'appeal' ? 'Suspension appeal' : 'Support conversation'}>
      <div className="mb-4"><Link href="/support" className="text-[12.5px] font-semibold text-[#0B1E3D] hover:underline">&larr; All tickets</Link></div>

      <div className="mb-4 rounded-[12px] border border-[#E5E4E0] bg-white p-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold text-[#26282E]">{t.subject}</p>
            <p className="mt-1 text-[12.5px] text-[#5A5D64]">
              From <Link href={'/users/' + t.user_id} className="font-semibold text-[#0B1E3D] hover:underline">{p?.full_name || '@' + (p?.username || '?')}</Link>
              {' '}&middot; opened {new Date(t.created_at).toLocaleString()}
              {t.kind === 'appeal' ? <span className="ml-2 rounded-full bg-[#EFEFF4] px-2 py-0.5 text-[10.5px] font-bold text-[#5B6470]">Appeal</span> : null}
            </p>
          </div>
          <span className={'shrink-0 rounded-full px-3 py-1 text-[11px] font-bold ' + (PILL[t.status] || PILL.open)}>{t.status}</span>
        </div>
      </div>

      <div className="mb-4 rounded-[12px] border border-[#E5E4E0] bg-white p-5">
        <p className="mb-3 text-[10.5px] font-bold uppercase tracking-wider text-[#9A9DA4]">Conversation</p>
        {(msgs ?? []).length === 0 ? <p className="text-[12.5px] text-[#9A9DA4]">No messages on this ticket.</p> : null}
        {(msgs ?? []).map(m => (
          <div key={m.id} className={'mb-2.5 flex ' + (m.sender === 'ops' ? 'justify-end' : 'justify-start')}>
            <div className={'max-w-[72%] rounded-[13px] px-3.5 py-2.5 ' + (m.sender === 'ops' ? 'bg-[#0B1E3D] text-white' : 'bg-[#F4F5F7] text-[#26282E]')}>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{m.body}</p>
              <p className={'mt-1.5 text-[10px] ' + (m.sender === 'ops' ? 'text-white/55' : 'text-[#9A9DA4]')}>
                {m.sender === 'ops' ? 'Operations' : (p?.full_name || 'Member')} &middot; {new Date(m.created_at).toLocaleString()}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-5">
        <p className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-[#9A9DA4]">Reply to the member</p>
        <form action={sendTicketReply}>
          <input type="hidden" name="tid" value={t.id} />
          <textarea name="body" required rows={3} placeholder="Write to the member - sending marks the ticket Pending until they answer"
            className="mb-2.5 w-full resize-y rounded-[10px] border border-[#E5E4E0] px-3.5 py-2.5 text-[13px] outline-none transition-colors duration-100 focus:border-[#B9BCC2]" />
          <div className="flex flex-wrap items-center gap-2">
            <button className="rounded-[10px] bg-[#0B1E3D] px-4 py-2 text-[12px] font-bold text-white transition-opacity duration-150 hover:opacity-90">Send reply</button>
            {t.status !== 'solved' ? (
              <button formNoValidate formAction={setTicketStatus} name="status" value="solved" className="rounded-[10px] border border-[#DFE8E2] bg-[#EBF3EE] px-3.5 py-2 text-[11.5px] font-bold text-[#1D7A38] hover:bg-[#E0EDE5]">Mark solved</button>
            ) : (
              <button formNoValidate formAction={setTicketStatus} name="status" value="open" className="rounded-[10px] border border-[#E5E4E0] bg-white px-3.5 py-2 text-[11.5px] font-bold text-[#43454B] hover:bg-[#FAFAF9]">Reopen</button>
            )}
          </div>
        </form>
      </div>
    </Shell>
  );
}
