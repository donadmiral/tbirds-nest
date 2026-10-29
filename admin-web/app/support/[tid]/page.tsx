import CommandForm from '@/components/CommandForm';
import PermissionGate from '@/components/PermissionGate';
import Shell from '@/components/Shell';
import { requireDesk } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { sendTicketReply, setTicketStatus } from '@/lib/actions';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { supportPage, SUPPORT_MESSAGE_PAGE_SIZE } from '@/lib/supportReporting';
import { readSupportTriage } from '@/lib/supportTriage';
import { updateSupportTriage } from '@/lib/supportTriageActions';

export const dynamic = 'force-dynamic';

const PILL: Record<string, string> = {
  open: 'bg-[#FBF2F2] text-[#B03A3A]',
  pending: 'bg-[#FDF6E9] text-[#B08D3F]',
  solved: 'bg-[#EBF3EE] text-[#1D7A38]',
};

export default async function TicketPage({ params, searchParams }: { params: Promise<{ tid: string }>; searchParams: Promise<{ page?: string | string[] }> }) {
  const { tid } = await params;
  const page = supportPage((await searchParams).page);
  const start = (page - 1) * SUPPORT_MESSAGE_PAGE_SIZE;
  const admin = await requireDesk('/support');
  const svc = serviceClient();
  const { data: t, error: ticketError } = await svc.from('support_tickets').select('*').eq('id', tid).maybeSingle();
  if (ticketError) throw new Error('Support ticket could not be loaded.');
  if (!t) redirect('/support');
  const [messages, profile, assignments] = await Promise.all([
    svc.from('support_messages').select('*', { count: 'exact' }).eq('ticket_id', t.id).order('created_at', { ascending: false }).order('id', { ascending: false }).range(start, start + SUPPORT_MESSAGE_PAGE_SIZE - 1),
    svc.from('profiles').select('id, full_name, username').eq('id', t.user_id).maybeSingle(),
    readSupportTriage([t.id]),
  ]);
  if (messages.error || messages.count === null || profile.error) throw new Error('Support conversation could not be loaded.');
  const triage = assignments.available ? assignments.tickets.get(t.id) : undefined;
  const supportCommandsAvailable = triage?.support_commands_available === true;
  const staff = triage ? await svc.from('admin_users').select('user_id,role').eq('active', true).in('role', ['super_admin', 'platform_admin', 'trust_safety', 'support_agent']).limit(100) : { data: [], error: null };
  if (staff.error) throw new Error('Support staff could not be loaded.');
  const staffIds = (staff.data ?? []).map(member => member.user_id as string);
  const staffProfiles = staffIds.length ? await svc.from('profiles').select('id,full_name,username').in('id', staffIds) : { data: [], error: null };
  if (staffProfiles.error) throw new Error('Support staff could not be loaded.');
  const staffNames = new Map((staffProfiles.data ?? []).map(member => [member.id, member.full_name || member.username || member.id]));
  const msgs = [...(messages.data ?? [])].reverse();
  const p = profile.data;
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
        <h2 className="text-sm font-bold">Case ownership and priority</h2>
        {triage ? <>
        <p className="my-2 text-xs text-[#5A5D64]">Internal response targets: urgent 15 minutes, high 1 hour, normal 24 hours, low 72 hours. These targets do not promise staffed coverage.</p>
        {triage.response_due_at ? <p className="mb-3 text-sm">Response due {new Date(triage.response_due_at).toLocaleString()}{Date.parse(triage.response_due_at) < Date.now() ? ' · Overdue' : ''}</p> : null}
        <PermissionGate role={admin.role} permission="support"><CommandForm scope="supportTriage" action={updateSupportTriage} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="ticket_id" value={t.id} /><input type="hidden" name="version" value={triage.version} />
          <label className="text-sm">Owner<select name="assigned_to" defaultValue={triage.assigned_to ?? ''} className="block rounded-lg border p-2"><option value="">Unassigned</option>{triage.assigned_to && !staffIds.includes(triage.assigned_to) ? <option value={triage.assigned_to}>Inactive staff: reassign this case</option> : null}{(staff.data ?? []).map(member => <option key={member.user_id} value={member.user_id}>{staffNames.get(member.user_id) ?? member.user_id} ({member.role})</option>)}</select></label>
          <label className="text-sm">Priority<select name="priority" defaultValue={triage.priority} className="block rounded-lg border p-2">{['urgent', 'high', 'normal', 'low'].map(priority => <option key={priority}>{priority}</option>)}</select></label>
          <label className="text-sm">Queue<select name="queue" defaultValue={triage.queue} className="block rounded-lg border p-2">{['general', 'account', 'payments', 'safety', 'marketplace'].map(queue => <option key={queue}>{queue}</option>)}</select></label>
          <label className="text-sm">Escalation<select name="escalated" defaultValue={String(triage.escalated)} className="block rounded-lg border p-2"><option value="false">Standard</option><option value="true">Escalated</option></select></label>
          <label className="w-full text-sm">Reason<input name="reason" required minLength={3} maxLength={2000} className="block w-full rounded-lg border p-2" placeholder="Why this owner, priority or escalation is appropriate" /></label>
          <button className="rounded-lg bg-[#0B1E3D] px-4 py-2 text-sm font-bold text-white">Save assignment</button>
        </CommandForm></PermissionGate>
        </> : <p role="status" className="mt-2 text-sm">Assignment tools are unavailable on this deployment. Ticket details and conversation history remain available.</p>}
      </div>

      <div className="mb-4 rounded-[12px] border border-[#E5E4E0] bg-white p-5">
        <p className="mb-3 text-[10.5px] font-bold uppercase tracking-wider text-[#9A9DA4]">Conversation</p>
        <nav aria-label="Conversation pages" className="mb-3 flex flex-wrap gap-4 text-sm">
          <span>{msgs.length} of {messages.count} messages · {page === 1 ? 'Latest messages' : `Page ${page}`}</span>
          {page > 1 ? <Link href={'/support/' + tid}>Latest</Link> : null}
          {page > 1 ? <Link href={'/support/' + tid + '?page=' + (page - 1)}>Newer</Link> : null}
          {messages.count > start + SUPPORT_MESSAGE_PAGE_SIZE ? <Link href={'/support/' + tid + '?page=' + (page + 1)}>Older</Link> : null}
        </nav>
        {msgs.length === 0 ? <p className="text-[12.5px] text-[#9A9DA4]">{messages.count === 0 ? 'No messages on this ticket.' : 'No messages on this page. Return to Latest.'}</p> : null}
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

      {supportCommandsAvailable ? <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-5">
        <p className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-[#9A9DA4]">Reply to the member</p>
        <PermissionGate role={admin.role} permission="support"><CommandForm scope="sendTicketReply" action={sendTicketReply}>
          <input type="hidden" name="tid" value={t.id} />
          <textarea name="body" aria-label="Reply to the member" required rows={3} placeholder="Write to the member - sending marks the ticket Pending until they answer"
            className="mb-2.5 w-full resize-y rounded-[10px] border border-[#E5E4E0] px-3.5 py-2.5 text-[13px] outline-none transition-colors duration-100 focus:border-[#B9BCC2]" />
          <div className="flex flex-wrap items-center gap-2">
            <button className="rounded-[10px] bg-[#0B1E3D] px-4 py-2 text-[12px] font-bold text-white transition-opacity duration-150 hover:opacity-90">Send reply</button>
          </div>
        </CommandForm></PermissionGate>
        <PermissionGate role={admin.role} permission="support"><CommandForm scope="setTicketStatus" action={setTicketStatus} className="mt-2.5 flex flex-wrap items-center gap-2">
          <input type="hidden" name="tid" value={t.id} />
          <input type="hidden" name="status" value={t.status !== 'solved' ? 'solved' : 'open'} />
          <button className={t.status !== 'solved'
            ? 'rounded-[10px] border border-[#DFE8E2] bg-[#EBF3EE] px-3.5 py-2 text-[11.5px] font-bold text-[#1D7A38] hover:bg-[#E0EDE5]'
            : 'rounded-[10px] border border-[#E5E4E0] bg-white px-3.5 py-2 text-[11.5px] font-bold text-[#43454B] hover:bg-[#FAFAF9]'}>
            {t.status !== 'solved' ? 'Mark solved' : 'Reopen'}
          </button>
        </CommandForm></PermissionGate>
      </div> : <p role="status" className="rounded-[12px] border border-[#E5E4E0] bg-white p-5 text-sm">Replies and ticket status changes are unavailable on this deployment. This conversation is read-only.</p>}
    </Shell>
  );
}
