import 'server-only';
import { serviceClient } from './supabaseAdmin';
import { isMissingAdminRpc } from './adminRpcAvailability';

export type TicketTriage = {
  ticket_id: string; assigned_to: string | null; assigned_name: string | null;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  queue: 'general' | 'account' | 'payments' | 'safety' | 'marketplace';
  escalated: boolean; version: number; response_due_at: string | null;
  support_commands_available?: boolean;
};

export type SupportTriageRead = { available: true; tickets: Map<string, TicketTriage> } | { available: false };

export async function readSupportTriage(ids: string[]): Promise<SupportTriageRead> {
  const { data, error } = await serviceClient().rpc('admin_support_triage_read', { p_ids: ids });
  if (isMissingAdminRpc(error, 'admin_support_triage_read')) return { available: false };
  if (error || !Array.isArray(data) || data.length !== ids.length) throw new Error('Support assignments could not be loaded.');
  const tickets = new Map((data as TicketTriage[]).map(row => [row?.ticket_id, row]));
  if (tickets.size !== ids.length || ids.some(id => !tickets.has(id))) throw new Error('Support assignments could not be loaded.');
  return { available: true, tickets };
}
