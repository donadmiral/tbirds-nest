import { supabase } from './supabase';
import type { Conversation } from './navigationInbox';

/** Confirm ephemeral settings omitted by the inbox RPC before saving previews. */
export async function readInboxStartup(rows: Conversation[]): Promise<Conversation[]> {
  const selected = rows.slice(0, 30);
  if (!selected.length) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const { data, error } = await supabase.from('conversations').select('id,disappearing_seconds')
      .in('id', [...new Set(selected.map(row => row.id))]).abortSignal(controller.signal);
    if (error || !Array.isArray(data)) throw error || new Error('Conversation settings unavailable.');
    const ordinary = new Set(data.filter(row => row.disappearing_seconds === null).map(row => row.id));
    return selected.filter(row => ordinary.has(row.id));
  } finally { clearTimeout(timeout); }
}
