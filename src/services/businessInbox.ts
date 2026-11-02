import { readPagedReaderCapabilities, type ReaderCursor } from '../../shared/pagedReaders';
import { navigationScope } from '../lib/navigationCache';
import { useAuthStore } from '../stores/authStore';
import { supabase } from './supabase';

export type BusinessInboxTab = 'primary' | 'requests';
export type BusinessConversation = {
  id: string; conversation_id: string; context: string | null; other_id: string;
  other_name: string | null; other_username: string | null; other_avatar: string | null;
  last_text: string | null; last_at: string | null; last_sender: string | null; unread: number; is_request: boolean;
};
export type BusinessInboxWindow = {
  scope: string; businessId: string; tab: BusinessInboxTab; rows: BusinessConversation[];
  summary: { primary: number; requests: number };
  paging: { cursor: ReaderCursor | null; canView: boolean } | null;
};
const PAGE_SIZE = 30;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const missing = (error: unknown) => object(error) && ['PGRST202', '42883'].includes(String(error.code));
const matches = (row: BusinessConversation, tab: BusinessInboxTab) => row.is_request === (tab === 'requests');
const timestamp = (value: string | null) => value ? Date.parse(value) * 1000 + Number((value.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0').slice(3, 6)) : null;
export function compareBusinessConversations(a: BusinessConversation, b: BusinessConversation) {
  const left = timestamp(a.last_at), right = timestamp(b.last_at);
  if (left === null || right === null) { if (left !== right) return left === null ? 1 : -1; }
  else if (left !== right) return right - left;
  return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
}

/** Business membership remains a server check on every page. The initiating
 * human account authenticates the request; businessId is never an auth token
 * or substituted user identity. Chat's existing actAsId navigation is separate. */
export async function readBusinessInboxWindow(owner: string, businessId: string, tab: BusinessInboxTab,
  previous: BusinessInboxWindow | null = null, append = false, signal?: AbortSignal,
  current?: () => boolean, requestedIds?: string[]): Promise<BusinessInboxWindow> {
  const scope = navigationScope(), session = useAuthStore.getState().session;
  if (!scope || session?.user.id !== owner) throw new Error('Sign in to load the business inbox.');
  const valid = () => navigationScope() === scope && current?.() !== false && !signal?.aborted;
  const check = () => { if (!valid()) throw Object.assign(new Error('The business inbox read was cancelled.'), { name: 'AbortError' }); };
  const request = async (name: string, args: Record<string, unknown>) => {
    check(); let query = supabase.rpc(name, args).setHeader('Authorization', `Bearer ${session.access_token}`);
    if (signal) query = query.abortSignal(signal);
    const result = await query; check(); return result;
  };
  const readPage = async (cursor: ReaderCursor | null, ids: string[] | null = null, allowMissing = false) => {
    const { data, error } = await request('get_business_inbox_page_v2', {
      p_business_id: businessId, p_tab: tab, p_cursor: cursor, p_limit: ids ? 50 : PAGE_SIZE, p_ids: ids,
    });
    if (error) { if (allowMissing && missing(error)) return null; throw error; }
    if (!object(data) || data.version !== 2 || typeof data.can_view !== 'boolean' || !Array.isArray(data.items)
      || data.items.length > (ids ? 50 : PAGE_SIZE) || !object(data.summary)
      || !['primary', 'requests'].every(key => Number.isSafeInteger((data.summary as Record<string, unknown>)[key]) && Number((data.summary as Record<string, unknown>)[key]) >= 0)
      || typeof data.has_more !== 'boolean' || (data.has_more ? !object(data.next_cursor) : data.next_cursor !== null)) {
      throw new Error('The business inbox page is incomplete. Please retry.');
    }
    const rows = data.items as BusinessConversation[], cursorNext = data.next_cursor as ReaderCursor | null;
    const summary = data.summary as { primary: number; requests: number };
    if (rows.some(row => !object(row) || typeof row.id !== 'string' || row.conversation_id !== row.id
      || typeof row.is_request !== 'boolean' || !Number.isSafeInteger(row.unread) || row.unread < 0
      || (!ids && !matches(row, tab))) || new Set(rows.map(row => row.id)).size !== rows.length
      || (ids && (cursorNext || rows.some(row => !ids.includes(row.id))))
      || (cursorNext && (!rows.length || cursorNext.viewer !== owner || cursorNext.business !== businessId
        || cursorNext.tab !== tab || cursorNext.kind !== 'business_inbox' || JSON.stringify(cursorNext) === JSON.stringify(cursor)))
      || (!data.can_view && (rows.length || cursorNext || summary.primary || summary.requests))) {
      throw new Error('Business conversations could not be checked. Please retry.');
    }
    return { rows, summary, paging: { cursor: cursorNext, canView: data.can_view } };
  };
  const prior = previous?.scope === scope && previous.businessId === businessId ? previous : null;
  if (requestedIds) {
    if (requestedIds.length > 100) throw new Error('At most 100 conversations can be restored together.');
    const rows: BusinessConversation[] = []; let summary = { primary: 0, requests: 0 };
    for (let from = 0; from < requestedIds.length; from += 50) {
      const page = (await readPage(null, requestedIds.slice(from, from + 50)))!;
      if (!page.paging.canView) return { scope, businessId, tab, ...page };
      summary = page.summary; rows.push(...page.rows.filter(row => matches(row, tab)));
    }
    return { scope, businessId, tab, rows, summary, paging: { cursor: null, canView: true } };
  }
  const compatible = prior?.paging && prior.tab === tab ? prior : null;
  if (append) {
    if (!compatible) throw new Error('The business inbox changed. Please refresh.');
    if (!compatible.paging?.cursor) return compatible;
    const page = await readPage(compatible.paging.cursor);
    if (!page) throw new Error('The business inbox reader changed. Please refresh.');
    if (!page.paging.canView) return { scope, businessId, tab, ...page };
    const rows = new Map(compatible.rows.map(row => [row.id, row])); page.rows.forEach(row => rows.set(row.id, row));
    return { scope, businessId, tab, ...page, rows: [...rows.values()].filter(row => matches(row, tab)).sort(compareBusinessConversations) };
  }
  const capability = await readPagedReaderCapabilities(supabase, { viewer: owner, token: session.access_token, signal, current: valid });
  let page = capability.inbox ? await readPage(null, null, true) : null;
  if (!page) {
    const { data, error } = await request('get_business_conversations', { p_business_id: businessId });
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Business conversations could not be loaded. Please retry.');
    const rows = data.map(row => ({ ...row, id: row.conversation_id })) as BusinessConversation[];
    return { scope, businessId, tab, rows, paging: null,
      summary: { primary: rows.filter(row => !row.is_request).length, requests: rows.filter(row => row.is_request).length } };
  }
  if (!page.paging.canView) return { scope, businessId, tab, ...page };
  const retained = compatible?.rows ?? (prior && !prior.paging ? prior.rows.filter(row => matches(row, tab)) : []);
  const rows = new Map(page.rows.map(row => [row.id, row]));
  for (let n = 1, budget = Math.max(1, Math.ceil(retained.length / PAGE_SIZE)); n < budget && page.paging.cursor; n++) {
    const next = await readPage(page.paging.cursor);
    if (!next) throw new Error('The business inbox reader changed. Please refresh.');
    if (!next.paging.canView) return { scope, businessId, tab, ...next };
    page = next; page.rows.forEach(row => rows.set(row.id, row));
  }
  const ids = [...new Set(retained.map(row => row.id))].filter(id => !rows.has(id));
  for (let n = 0; n < ids.length; n += 100) {
    const batches = [ids.slice(n, n + 50), ids.slice(n + 50, n + 100)].filter(batch => batch.length);
    const verified = await Promise.all(batches.map(batch => readPage(null, batch)));
    const denied = verified.find(result => result && !result.paging.canView);
    if (denied) return { scope, businessId, tab, ...denied };
    verified.forEach(result => result?.rows.forEach(row => rows.set(row.id, row)));
  }
  check();
  return { scope, businessId, tab, ...page, rows: [...rows.values()].filter(row => matches(row, tab)).sort(compareBusinessConversations) };
}
