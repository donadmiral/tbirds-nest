import Shell from '@/components/Shell';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { sendTicketReply, setTicketStatus } from '@/lib/actions';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function TicketPage({ params }: { params: { tid: string } }) {
  const admin = await getAdmin();
  if (!admin) redirect('/signin');
  const svc = serviceClient();
  const { data: t } = await svc.from('support_tickets').select('*').eq('id', params.tid).maybeSingle();
  if (!t) redirect('/support');
  const { data: msgs } = await svc.from('support_messages')
    .select('*').eq('ticket_id', t.id).order('created_at', { ascending: true });
  const { data: p } = await svc.from('profiles').select('id, full_name, username').eq('id', t.user_id).maybeSingle();
  return (
    <Shell admin={admin} active="/support" title={t.subject} sub={(t.kind === 'appeal' ? 'Appeal from ' : 'Ticket from ') + (p?.full_name || '@' + (p?.username || '?')) + ' - ' + t.status}>
      <div className="mb-4"><Link href="/support" className="text-[12.5px] font-semibold text-[#0B1E3D] hover:underline">&larr; All tickets</Link></div>
      <div className="mb-5 rounded-[12px] border border-[#E5E4E0] bg-white p-5">
        {(msgs ?? []).map(m => (
          <div key={m.id} className={'mb-3 max-w-[80%] rounded-[12px] p-3 text-[13px] leading-relaxed ' + (m.sender === 'ops' ? 'ml-auto bg-[#0B1E3D] text-white' : 'bg-[#F4F5F7] text-[#26282E]')}>
            <p className="whitespace-pre-wrap">{m.body}</p>
            <p className={'mt-1 text-[10.5px] ' + (m.sender === 'ops' ? 'text-white/60' : 'text-[#9A9DA4]')}>{m.sender === 'ops' ? 'Operations' : (p?.full_name || 'Member')} - {new Date(m.created_at).toLocaleString()}</p>
          </div>
        ))}
        {(msgs ?? []).length === 0 ? <p className="text-[12.5px] text-[#9A9DA4]">No messages on this ticket yet.</p> : null}
      </div>
      <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-5">
        <form action={sendTicketReply} className="mb-3">
          <input type="hidden" name="tid" value={t.id} />
          <textarea name="body" required rows={3} placeholder="Write to the customer - sending marks the ticket Pending"
            className="mb-2 w-full rounded-[10px] border border-[#E5E4E0] px-3 py-2 text-[13px] outline-none focus:border-[#B9BCC2]" />
          <button className="rounded-[10px] bg-[#0B1E3D] px-4 py-2 text-[12px] font-bold text-white transition-opacity duration-150 hover:opacity-90">Send reply</button>
        </form>
        <div className="flex flex-wrap gap-2">
          {t.status !== 'solved' ? (
            <form action={setTicketStatus}><input type="hidden" name="tid" value={t.id} /><input type="hidden" name="status" value="solved" />
              <button className="rounded-[10px] border border-[#DFE8E2] bg-[#EBF3EE] px-3 py-2 text-[11.5px] font-bold text-[#1D7A38] hover:bg-[#E0EDE5]">Mark solved</button></form>
          ) : (
            <form action={setTicketStatus}><input type="hidden" name="tid" value={t.id} /><input type="hidden" name="status" value="open" />
              <button className="rounded-[10px] border border-[#E5E4E0] bg-white px-3 py-2 text-[11.5px] font-bold text-[#43454B] hover:bg-[#FAFAF9]">Reopen</button></form>
          )}
          {t.status === 'open' ? (
            <form action={setTicketStatus}><input type="hidden" name="tid" value={t.id} /><input type="hidden" name="status" value="pending" />
              <button className="rounded-[10px] border border-[#F2E8D5] bg-[#FDF6E9] px-3 py-2 text-[11.5px] font-bold text-[#B08D3F] hover:bg-[#FAF0DD]">Mark pending</button></form>
          ) : null}
        </div>
      </div>
    </Shell>
  );
}
