import type { InboxPage, InboxReadOptions, ReaderCursor } from './pagedReaders';

export const INBOX_PAGE_SIZE = 30;
export type InboxPaging = { version: 2; query: string; cursor: ReaderCursor | null;
  summary: { total: number; archivedPersonal: number } };
export type InboxWindow<T> = { items: T[]; paging: InboxPaging | null; checkedIds?: string[] };
export type InboxRead<T> = (options: InboxReadOptions) => Promise<InboxPage<T> | null>;

/** Cursor identity includes the UI filters. An old search cursor must never be
 * reused for a new tab, folder, owner or context. The server binds these too. */
export function inboxQueryKey(options: InboxReadOptions): string {
  return JSON.stringify([options.context ?? null, options.order ?? 'pinned', options.folder ?? 'all',
    options.groups ?? true, options.deleted ?? false, options.search ?? null,
    options.searchMode ?? 'web', options.filter ?? 'all', options.excludeCommunity ?? false,
    options.excludeRequests ?? false]);
}

function summary<T>(page: InboxPage<T>) {
  if (!page.summary || page.summary.total < 0 || page.summary.archivedPersonal < 0) {
    throw new Error('The conversation totals could not be checked. Please retry.');
  }
  return page.summary;
}

/** Bounded, authorized lookups do not confuse absence from page one with
 * revoked membership. At most two independent batches are in flight. */
export async function readInboxIds<T extends { id: string }>(read: InboxRead<T>, options: InboxReadOptions,
  ids: string[]): Promise<Map<string, T>> {
  const unique = [...new Set(ids.filter(Boolean))], rows = new Map<string, T>();
  for (let index = 0; index < unique.length; index += 100) {
    const batches = [unique.slice(index, index + 50), unique.slice(index + 50, index + 100)].filter(batch => batch.length);
    const settled = await Promise.allSettled(batches.map(batch => read({ ...options, cursor: null, ids: batch, limit: 50, badges: false })));
    // A rejected sibling must not release the caller's transport slot while
    // another SDK request is still settling after cancellation.
    const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) throw failed.reason;
    const pages = settled.map(result => (result as PromiseFulfilledResult<InboxPage<T> | null>).value);
    for (let n = 0; n < pages.length; n++) {
      const page = pages[n];
      if (!page || page.cursor || page.items.some(row => !batches[n].includes(row.id))) {
        throw new Error('Loaded conversations could not be checked. Please retry.');
      }
      for (const row of page.items) rows.set(row.id, row);
    }
  }
  return rows;
}

/** Revisit only the range the person has loaded, plus canonical checks for
 * rows displaced from that range. Never download an entire inbox to search or
 * to restore one deep link. Live ordering can overlap pages; IDs deduplicate. */
export async function refreshInboxWindow<T extends { id: string }>(read: InboxRead<T>, options: InboxReadOptions,
  previous: InboxWindow<T> | null, matches: (row: T) => boolean, compare: (a: T, b: T) => number,
  extraIds: string[] = []): Promise<(InboxWindow<T> & { resolved: Map<string, T> }) | null> {
  const query = inboxQueryKey(options);
  let page = await read({ ...options, cursor: null, ids: null, limit: INBOX_PAGE_SIZE, badges: false });
  if (!page) return null;
  const retained = previous && (!previous.paging || previous.paging.query === query) ? previous.items.filter(matches) : [];
  const pageBudget = Math.max(1, Math.ceil(retained.length / INBOX_PAGE_SIZE));
  let totals = summary(page);
  const fresh = new Map(page.items.map(row => [row.id, row]));
  for (let count = 1; count < pageBudget && page.cursor; count++) {
    const next = await read({ ...options, cursor: page.cursor, ids: null, limit: INBOX_PAGE_SIZE, badges: false });
    if (!next) throw new Error('The conversation reader changed. Please refresh.');
    page = next; totals = summary(page);
    for (const row of page.items) fresh.set(row.id, row);
  }
  const lookupIds = [...retained.map(row => row.id), ...extraIds].filter(id => !fresh.has(id));
  const checked = await readInboxIds(read, options, lookupIds);
  for (const [id, row] of checked) fresh.set(id, row);
  return { items: [...fresh.values()].filter(matches).sort(compare),
    paging: { version: 2, query, cursor: page.cursor, summary: totals }, resolved: fresh,
    checkedIds: [...new Set([...fresh.keys(), ...lookupIds])] };
}

export async function appendInboxWindow<T extends { id: string }>(read: InboxRead<T>, options: InboxReadOptions,
  previous: InboxWindow<T>, matches: (row: T) => boolean, compare: (a: T, b: T) => number): Promise<InboxWindow<T>> {
  if (!previous.paging?.cursor) return { ...previous, checkedIds: [] };
  if (previous.paging.query !== inboxQueryKey(options)) throw new Error('The conversation filter changed.');
  const page = await read({ ...options, ids: null, cursor: previous.paging.cursor, limit: INBOX_PAGE_SIZE, badges: false });
  if (!page) throw new Error('The conversation reader changed. Please refresh.');
  const rows = new Map(previous.items.map(row => [row.id, row]));
  for (const row of page.items) rows.set(row.id, row);
  return { items: [...rows.values()].filter(matches).sort(compare),
    paging: { ...previous.paging, cursor: page.cursor, summary: summary(page) }, checkedIds: page.items.map(row => row.id) };
}

/** An earlier range refresh must not roll back a receipt, a newer targeted
 * refresh, or removal of a conversation. Tombstones last for this session. */
export function createInboxMergeGuard<T extends { id: string }>() {
  let revision = 0;
  const changed = new Map<string, number>();
  const merge = (incoming: T[], current: T[], requestedAt: number) => {
    const next = new Map(incoming.map(row => [row.id, row]));
    const existing = new Map(current.map(row => [row.id, row]));
    for (const [id, version] of changed) if (version > requestedAt) {
      const row = existing.get(id);
      if (row) next.set(id, row); else next.delete(id);
    }
    return [...next.values()];
  };
  return {
    revision: () => revision,
    begin: () => ++revision,
    canApply: (id: string, requestedAt: number) => (changed.get(id) ?? 0) <= requestedAt,
    touch(ids: string[]) { const next = ++revision; for (const id of ids) changed.set(id, next); },
    merge,
    commit(incoming: T[], current: T[], requestedAt: number, checkedIds = [...incoming, ...current].map(row => row.id)) {
      const merged = merge(incoming, current, requestedAt), present = new Set(incoming.map(row => row.id));
      // Positive results use request order. A denial/removal is conservative:
      // only a request begun after we observed it may restore that row.
      let removedAt: number | undefined;
      for (const id of checkedIds) if ((changed.get(id) ?? 0) <= requestedAt) {
        changed.set(id, present.has(id) ? requestedAt : (removedAt ??= ++revision));
      }
      return merged;
    },
    clear() { changed.clear(); revision = 0; },
  };
}
