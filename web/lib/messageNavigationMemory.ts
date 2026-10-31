import type { SupabaseClient } from '@supabase/supabase-js';
import type { Conv, Msg } from './messages';
import type { MessageCursor } from '../../shared/messageHistory';

export type MessageNavigationMemory = {
  owner: string; context: string; conversations: Conv[]; active: Conv | null; messages: Msg[];
  drafts: [string, string][]; draft: string; query: string; tab: 'chats' | 'groups' | 'unread';
  detailsOpen: boolean; cursor: MessageCursor | null; hasOlder: boolean; top: number; pinned: boolean;
};

/** Limited-view capabilities are never reusable navigation data. */
export function navigationMessages(rows: Msg[]): Msg[] {
  return rows.map(row => ({ ...row, _private_media_url: undefined, _private_thumbnail_url: undefined,
    ...(row.view_limit ? { media_url: null } : {}) }));
}

/** Revalidate retained pages instead of equating "not on page one" with deletion. */
export async function revalidateMessageWindow(client: SupabaseClient, conversationId: string, retained: Msg[], first: Msg[], signal: AbortSignal): Promise<Msg[]> {
  const fresh = new Map(first.map(row => [row.id, row]));
  const ids = [...new Set(retained.filter(row => !row._delivery && !fresh.has(row.id)).map(row => row.id))];
  for (let index = 0; index < ids.length; index += 200) {
    if (signal.aborted) throw new Error('The message refresh was cancelled.');
    const batches = [ids.slice(index, index + 100), ids.slice(index + 100, index + 200)].filter(batch => batch.length);
    const results = await Promise.all(batches.map(batch => client.from('messages').select('*')
      .eq('conversation_id', conversationId).in('id', batch).abortSignal(signal)));
    for (const result of results) {
      if (result.error) throw new Error('Loaded messages could not be refreshed.');
      for (const row of (result.data ?? []) as Msg[]) fresh.set(row.id, row);
    }
  }
  if (signal.aborted) throw new Error('The message refresh was cancelled.');
  return [...fresh.values()];
}
