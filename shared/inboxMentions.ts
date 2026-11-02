import { readPagedReaderCapabilities, type ReaderClient, type ReaderScope } from './pagedReaders';
import { createInboxRefreshQueue } from './inboxRefreshQueue';

export const INBOX_MENTION_WINDOW_MS = 7 * 86400000;
const unavailable = new WeakMap<object, number>();
function current(scope: ReaderScope) {
  if (scope.signal?.aborted || scope.current?.() === false || !scope.viewer) {
    throw Object.assign(new Error('The mention reader changed.'), { name: 'AbortError' });
  }
}
/** Existing table RLS remains authoritative. Missing RPCs have the same legacy
 * compatibility behavior as a disabled inbox capability, never permission errors. */
export async function readInboxMentionTimes(client: ReaderClient, scope: ReaderScope, ids: string[], since: string): Promise<Map<string, number> | null> {
  current(scope);
  if (!ids.length) return new Map();
  if (ids.length > 50 || new Set(ids).size !== ids.length || !Number.isFinite(Date.parse(since))) throw new Error('Invalid mention window.');
  if ((unavailable.get(client) ?? 0) > Date.now() || !(await readPagedReaderCapabilities(client, scope)).inbox) return null;
  let query = client.rpc('get_inbox_mentions_v2', { p_conversation_ids: ids, p_since: since });
  if (scope.token && query.setHeader) query = query.setHeader('Authorization', `Bearer ${scope.token}`);
  if (scope.signal && query.abortSignal) query = query.abortSignal(scope.signal);
  const { data, error } = await query; current(scope);
  if (error) {
    if (['PGRST202', '42883'].includes(String((error as { code?: unknown }).code))) { unavailable.set(client, Date.now() + 60_000); return null; }
    throw error;
  }
  const value = data as { version?: unknown; since?: string; items?: { conversation_id: string; latest_mention_at: string }[] } | null;
  const effectiveSince = Date.parse(value?.since ?? '');
  if (value?.version !== 1 || !Number.isFinite(effectiveSince) || effectiveSince < Date.parse(since) || !Array.isArray(value.items)
    || value.items.length > ids.length) throw new Error('The mention response is incomplete.');
  const result = new Map<string, number>();
  for (const row of value.items) {
    const timestamp = Date.parse(row.latest_mention_at);
    // SQL enforces the strict boundary at PostgreSQL timestamp precision;
    // Date.parse truncates microseconds, so equal milliseconds can be valid.
    if (!ids.includes(row.conversation_id) || result.has(row.conversation_id) || !Number.isFinite(timestamp) || timestamp < effectiveSince) {
      throw new Error('The mention response is inconsistent.');
    }
    result.set(row.conversation_id, timestamp);
  }
  return result;
}

/** Only loaded rows and changes to their message preview can create work.
 * Avatar/count renders do not rescan mention history. The queue owns one
 * logical operation; each full operation has at most two real 50-ID reads. */
export function createInboxMentions(options: {
  read: (ids: string[], since: string, signal: AbortSignal) => Promise<Map<string, number> | null>;
  legacy: (since: string, signal: AbortSignal) => Promise<Map<string, number>>;
  paged: () => boolean;
  onChange: (times: Record<string, number>, verified: boolean) => void;
  active?: boolean; clock?: () => number;
}) {
  const clock = options.clock ?? Date.now;
  const interest = new Map<string, { activity: string; version: number }>(), values = new Map<string, number>();
  let version = 0, disposed = false;
  const publish = (verified: boolean) => { if (!disposed) options.onChange(Object.fromEntries(values), verified); };
  const queue = createInboxRefreshQueue({ active: options.active,
    read: async (ids, signal) => {
      const all = [...interest.keys()], requested = ids ? ids.filter(id => interest.has(id)) : all;
      if (!requested.length) return;
      const before = new Map(all.map(id => [id, interest.get(id)!.version]));
      const since = new Date(clock() - INBOX_MENTION_WINDOW_MS).toISOString();
      let fresh = new Map<string, number>(), checked = requested, legacy = !options.paged();
      if (!legacy) for (let index = 0; index < requested.length; index += 100) {
        const chunks = [requested.slice(index, index + 50), requested.slice(index + 50, index + 100)].filter(batch => batch.length);
        // Wait for every actual transport, even if one fails or ignores abort.
        const results = await Promise.allSettled(chunks.map(batch => options.read(batch, since, signal)));
        if (signal.aborted || disposed) return;
        const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failure) throw failure.reason;
        for (const result of results) if (result.status === 'fulfilled') {
          if (result.value === null) legacy = true;
          else for (const [id, timestamp] of result.value) fresh.set(id, timestamp);
        }
        if (legacy) break;
      }
      if (legacy) { fresh = await options.legacy(since, signal); checked = all; }
      if (signal.aborted || disposed) return;
      let applied = false;
      for (const id of checked) if (interest.get(id)?.version === before.get(id)) {
        const timestamp = fresh.get(id);
        if (timestamp !== undefined) values.set(id, timestamp); else values.delete(id);
        applied = true;
      }
      if (applied) publish(true);
    },
  });
  return {
    update(rows: { id: string; activity: string }[]) {
      if (disposed) return;
      const next = new Set(rows.map(row => row.id)), first = interest.size === 0, changed: string[] = [];
      let removed = false;
      for (const id of interest.keys()) if (!next.has(id)) { interest.delete(id); removed = values.delete(id) || removed; }
      for (const row of rows) if (interest.get(row.id)?.activity !== row.activity) {
        interest.set(row.id, { activity: row.activity, version: ++version }); changed.push(row.id);
      }
      for (const [id, timestamp] of values) if (timestamp <= clock() - INBOX_MENTION_WINDOW_MS) { values.delete(id); removed = true; }
      if (removed) publish(false);
      if (changed.length) {
        if (first || !options.paged()) queue.refresh(); else changed.forEach(id => queue.changed(id));
      }
    },
    refresh: () => queue.refresh(),
    setActive: (active: boolean) => queue.setActive(active),
    dispose() { disposed = true; queue.dispose(); interest.clear(); values.clear(); },
  };
}
