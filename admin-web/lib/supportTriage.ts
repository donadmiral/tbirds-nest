import 'server-only';
import { serviceClient } from './supabaseAdmin';

export type TicketTriage = {
  ticket_id: string; assigned_to: string | null; assigned_name: string | null;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  queue: 'general' | 'account' | 'payments' | 'safety' | 'marketplace';
  escalated: boolean; version: number; response_due_at: string | null;
};

export async function readSupportTriage(ids: string[]): Promise<Map<string, TicketTriage>> {
  if (!ids.length) return new Map();
  const { data, error } = await serviceClient().rpc('admin_support_triage_read', { p_ids: ids });
  if (error || !Array.isArray(data) || data.length !== ids.length) throw new Error('Support assignments could not be loaded.');
  return new Map((data as TicketTriage[]).map(row => [row.ticket_id, row]));
}
