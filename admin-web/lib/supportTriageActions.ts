'use server';
import { revalidatePath } from 'next/cache';
import { requirePermission } from './adminAuth';
import { serviceClient } from './supabaseAdmin';
import { isMissingAdminRpc } from './adminRpcAvailability';

export async function updateSupportTriage(form: FormData) {
  const admin = await requirePermission('support');
  const value = (name: string) => {
    const fields = form.getAll(name);
    if (fields.length !== 1 || typeof fields[0] !== 'string') throw new Error('Invalid support form.');
    return fields[0];
  };
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const key = value('command_key'), ticket = value('ticket_id'), assigned = value('assigned_to');
  const version = Number(value('version'));
  const escalated = value('escalated');
  if (!uuid.test(key) || !uuid.test(ticket) || (assigned && !uuid.test(assigned)) || !Number.isSafeInteger(version) || version < 0 || !['true', 'false'].includes(escalated)) throw new Error('Reload the support form and try again.');
  const { data, error } = await serviceClient().rpc('admin_support_triage_update', {
    p_actor_id: admin.id, p_session_id: admin.sessionId, p_key: key, p_ticket_id: ticket,
    p_version: version, p_assigned_to: assigned || null, p_priority: value('priority'),
    p_queue: value('queue'), p_escalated: escalated === 'true', p_reason: value('reason'),
  });
  if (isMissingAdminRpc(error, 'admin_support_triage_update')) {
    return { success: false, error: 'Assignment tools are unavailable on this deployment. No assignment was changed. Contact the platform administrator.' };
  }
  if (error || data?.success !== true || data?.command_key !== key) {
    if (error?.message?.includes('TRIAGE_CHANGED')) return { success: false, error: 'Another staff member updated this case. Reload to review their changes.' };
    if (error?.message?.includes('INVALID_ASSIGNEE')) return { success: false, error: 'Select an active support staff member.' };
    return { success: false, error: 'The support assignment was not confirmed. Retry with the same details.' };
  }
  revalidatePath('/support');
  revalidatePath('/support/' + ticket);
  return { success: true };
}
