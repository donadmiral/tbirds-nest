import { readPagedReaderCapabilities, type ReaderCursor } from '../../shared/pagedReaders';
import { navigationScope } from '../lib/navigationCache';
import { useAuthStore } from '../stores/authStore';
import { supabase } from './supabase';

export type ContextInboxKind = 'market' | 'jobs';
export type ContextConversation = {
  id: string; conversation_id: string; is_group: boolean;
  other_id: string | null; other_name: string | null; other_username: string | null; other_avatar: string | null;
  last_message: string | null; last_message_time: string | null; last_message_sender_id: string | null;
  unread_count: number; context: string; context_ref_id: string | null;
  ref_title: string | null; ref_subtitle: string | null; ref_image: string | null;
};
export type ContextInboxWindow = {
  scope: string; context: ContextInboxKind;
  rows: ContextConversation[];
  paging: { version: 2; context: ContextInboxKind; cursor: ReaderCursor | null } | null;
};
const PAGE_SIZE = 30;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const unavailable = (error: unknown) => object(error) && ['PGRST202', '42883'].includes(String(error.code));

/** ISO output has microsecond precision. Date loses the last three digits,
 * which can move tied rows across a keyset boundary when refreshing a tail. */
function activity(value: string | null): number | null {
  if (!value) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const fraction = value.match(/\.(\d+)/)?.[1] ?? '';
  return milliseconds * 1000 + Number((fraction.padEnd(6, '0').slice(3, 6)) || 0);
}
export function compareContextConversations(a: ContextConversation, b: ContextConversation) {
  const left = activity(a.last_message_time), right = activity(b.last_message_time);
  if (left === null || right === null) {
    if (left !== right) return left === null ? 1 : -1;
  } else if (left !== right) return right - left;
  return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
}

/** This reader deliberately does not reuse the personal inbox's unread or
 * request rules: those older product contracts differ. No page sum becomes a
 * global badge, and the existing unread store retains its own canonical RPC. */
export async function readContextInboxWindow(owner: string, context: ContextInboxKind,
  previous: ContextInboxWindow | null = null, append = false, signal?: AbortSignal,
  current?: () => boolean): Promise<ContextInboxWindow> {
  const scope = navigationScope(), session = useAuthStore.getState().session;
  if (!scope || session?.user.id !== owner) throw new Error('Sign in to load conversations.');
  const valid = () => navigationScope() === scope && current?.() !== false && !signal?.aborted;
  const check = () => { if (!valid()) throw Object.assign(new Error('The conversation read was cancelled.'), { name: 'AbortError' }); };
  const readerScope = { viewer: owner, token: session.access_token, signal, current: valid };
  const request = async (name: string, args: Record<string, unknown>) => {
    check();
    let query = supabase.rpc(name, args).setHeader('Authorization', `Bearer ${session.access_token}`);
    if (signal) query = query.abortSignal(signal);
    const result = await query;
    check();
    return result;
  };
  const readPage = async (cursor: ReaderCursor | null, ids: string[] | null = null, allowMissing = false) => {
    const { data, error } = await request('get_context_inbox_page_v2', {
      p_context: context, p_cursor: cursor, p_limit: ids ? 50 : PAGE_SIZE, p_ids: ids,
    });
    if (error) {
      if (allowMissing && unavailable(error)) return null;
      throw error;
    }
    if (!object(data) || data.version !== 2 || !Array.isArray(data.items) || data.items.length > (ids ? 50 : PAGE_SIZE)
      || typeof data.has_more !== 'boolean' || (data.has_more ? !object(data.next_cursor) : data.next_cursor !== null)) {
      throw new Error('The conversation page is incomplete. Please retry.');
    }
    const rows = data.items as ContextConversation[], next = data.next_cursor as ReaderCursor | null;
    if (rows.some(row => !object(row) || typeof row.id !== 'string' || row.conversation_id !== row.id
      || row.context !== context || row.is_group !== false || !Number.isSafeInteger(row.unread_count) || row.unread_count < 0)
      || new Set(rows.map(row => row.id)).size !== rows.length
      || (ids && (next || rows.some(row => !ids.includes(row.id))))
      || (next && (!rows.length || next.viewer !== owner || next.context !== context || next.kind !== 'context_inbox'
        || JSON.stringify(next) === JSON.stringify(cursor)))) {
      throw new Error('Loaded conversations could not be checked. Please retry.');
    }
    return { rows, cursor: next };
  };
  const compatible = previous?.scope === scope && previous.context === context && previous.paging?.context === context ? previous : null;
  if (append) {
    if (!compatible) throw new Error('The conversation reader changed. Please refresh.');
    if (!compatible.paging?.cursor) return compatible;
    const page = await readPage(compatible.paging.cursor);
    if (!page) throw new Error('The conversation reader changed. Please refresh.');
    const rows = new Map(compatible.rows.map(row => [row.id, row]));
    page.rows.forEach(row => rows.set(row.id, row));
    return { scope, context, rows: [...rows.values()].sort(compareContextConversations), paging: { version: 2, context, cursor: page.cursor } };
  }

  const capabilities = await readPagedReaderCapabilities(supabase, readerScope);
  let page = capabilities.inbox ? await readPage(null, null, true) : null;
  if (!page) {
    const { data, error } = await request('get_conversations_by_context', { p_context: context, p_include_groups: false });
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Conversations could not be loaded. Please retry.');
    return { scope, context, rows: data.map(row => ({ ...row, id: row.conversation_id })), paging: null };
  }
  const rows = new Map(page.rows.map(row => [row.id, row]));
  const budget = Math.max(1, Math.ceil((compatible?.rows.length ?? 0) / PAGE_SIZE));
  for (let n = 1; n < budget && page.cursor; n++) {
    const next = await readPage(page.cursor);
    if (!next) throw new Error('The conversation reader changed. Please refresh.');
    page = next; page.rows.forEach(row => rows.set(row.id, row));
  }
  const retained = [...new Set(compatible?.rows.map(row => row.id) ?? [])].filter(id => !rows.has(id));
  for (let n = 0; n < retained.length; n += 100) {
    const batches = [retained.slice(n, n + 50), retained.slice(n + 50, n + 100)].filter(ids => ids.length);
    const verified = await Promise.all(batches.map(ids => readPage(null, ids)));
    verified.forEach(value => value?.rows.forEach(row => rows.set(row.id, row)));
  }
  check();
  return { scope, context, rows: [...rows.values()].sort(compareContextConversations), paging: { version: 2, context, cursor: page.cursor } };
}
