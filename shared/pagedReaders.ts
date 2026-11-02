/** Versioned additive readers. A missing/disabled capability keeps old builds
 * and old backends compatible; a failed authorized read is never downgraded. */
export type ReaderCursor = Record<string, unknown>;
type Result = { data: unknown; error: unknown };
export type ReaderQuery = PromiseLike<Result> & {
  abortSignal?: (signal: AbortSignal) => ReaderQuery;
  setHeader?: (name: string, value: string) => ReaderQuery;
};
export type ReaderClient = { rpc: (name: string, args: Record<string, unknown>) => ReaderQuery };
export type ReaderScope = { viewer: string; token?: string; signal?: AbortSignal; current?: () => boolean };
type Capabilities = { books: boolean; inbox: boolean; bookWindows?: boolean };
const disabled: Capabilities = { books: false, inbox: false };
const capabilities = new WeakMap<object, Map<string, { value: Capabilities; until: number }>>();
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const cancelled = () => Object.assign(new Error('The account or reader changed.'), { name: 'AbortError' });
function assertCurrent(scope: ReaderScope) {
  if (!scope.viewer || scope.signal?.aborted || scope.current?.() === false) throw cancelled();
}
async function request(client: ReaderClient, name: string, args: Record<string, unknown>, scope: ReaderScope) {
  assertCurrent(scope);
  let query = client.rpc(name, args);
  if (scope.token && query.setHeader) query = query.setHeader('Authorization', `Bearer ${scope.token}`);
  if (scope.signal && query.abortSignal) query = query.abortSignal(scope.signal);
  const result = await query;
  assertCurrent(scope);
  return result;
}
export async function readPagedReaderCapabilities(client: ReaderClient, scope: ReaderScope): Promise<Capabilities> {
  assertCurrent(scope);
  const cached = capabilities.get(client)?.get(scope.viewer);
  if (cached && cached.until > Date.now()) return cached.value;
  const { data, error } = await request(client, 'get_paged_reader_capabilities', {}, scope);
  if (error && (!object(error) || !['PGRST202', '42883'].includes(String(error.code)))) throw error;
  const value = object(data) && data.version === 1 && !error
    ? { books: data.books === true, inbox: data.inbox === true, ...(data.books_window === true ? { bookWindows: true } : {}) } : disabled;
  let cache = capabilities.get(client);
  if (!cache) { cache = new Map(); capabilities.set(client, cache); }
  // Capabilities are not content or authorization. Every actual page still
  // rechecks its session, viewer and canonical visibility on the server.
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  cache.set(scope.viewer, { value, until: Date.now() + 60_000 });
  return value;
}

export type MemoryPagination = { version: 2; viewer: string; revision: string; cursor: ReaderCursor | null;
  windowSupported?: boolean; offset?: number };
export type MemoryCollection = { id: string; can_view: boolean; count: number; pages: { id: string }[];
  _pagination?: MemoryPagination; _mediaExpiresAt?: number | null };
function validatePages(value: unknown): value is { id: string }[] {
  return Array.isArray(value) && value.every(row => object(row) && typeof row.id === 'string')
    && new Set(value.map(row => row.id)).size === value.length;
}
function bookResponse(value: unknown, album: string, scope: ReaderScope, continuation: boolean) {
  if (!object(value) || value.version !== 2 || typeof value.can_view !== 'boolean' || !validatePages(value.pages)) {
    throw new Error('The memory page response is incomplete. Please retry.');
  }
  if (!value.can_view) {
    if (continuation) throw new Error('This book is no longer available. Reopen it to check access.');
    return value;
  }
  if (value.id !== album || value.pages.length > 40 || typeof value.has_more !== 'boolean'
    || typeof value.revision !== 'string' || !/^\d{1,20}$/.test(value.revision)
    || value.metadata_included !== !continuation
    || (value.has_more ? !object(value.next_cursor) : value.next_cursor !== null)
    || (value.has_more && (!value.pages.length || (value.next_cursor as ReaderCursor).viewer !== scope.viewer
      || (value.next_cursor as ReaderCursor).album !== album || (value.next_cursor as ReaderCursor).revision !== value.revision))) {
    throw new Error('The memory page response is incomplete. Please retry.');
  }
  return value;
}
export function memoryBookHasMore(book: MemoryCollection | null | undefined) { return !!book?._pagination?.cursor; }
export function memoryBookOffset(book: MemoryCollection | null | undefined) { return book?._pagination?.offset ?? 0; }
export function memoryBookHasPrevious(book: MemoryCollection | null | undefined) { return memoryBookOffset(book) > 0; }
export function memoryBookIsComplete(book: MemoryCollection | null | undefined) {
  return !!book && !memoryBookHasPrevious(book) && !memoryBookHasMore(book) && book.pages.length === book.count;
}
export function isMemoryBookChanged(error: unknown) {
  return object(error) && (error.code === '40001' || String(error.message).includes('MEMORY_BOOK_CHANGED'));
}
export async function readMemoryBookFirst<T extends MemoryCollection>(client: ReaderClient, album: string, scope: ReaderScope,
  hydrate?: (book: T) => Promise<T>): Promise<T | null> {
  const capability = await readPagedReaderCapabilities(client, scope);
  const enabled = capability.books;
  const { data, error } = await request(client, enabled ? 'get_memory_book_page_v2' : 'get_memory_book',
    enabled ? { p_album: album, p_limit: 24 } : { p_album: album }, scope);
  if (error) throw error;
  if (!data) return null;
  let book: T;
  if (enabled) {
    const value = bookResponse(data, album, scope, false);
    if (!Number.isSafeInteger(value.count) || (value.count as number) < (value.pages as unknown[]).length) {
      throw new Error('The memory count is incomplete. Please retry.');
    }
    book = { ...value, ...(value.can_view ? { _pagination: { version: 2, viewer: scope.viewer,
      revision: value.revision, cursor: value.next_cursor,
      ...(capability.bookWindows ? { windowSupported: true, offset: 0 } : {}) } } : {}) } as T;
    if (book.can_view && !memoryBookHasMore(book) && book.pages.length !== book.count) {
      throw new Error('Some memories are missing. Please retry.');
    }
  } else book = data as T;
  if (hydrate) book = await hydrate(book);
  assertCurrent(scope); return book;
}
export async function readMemoryBookNext<T extends MemoryCollection>(client: ReaderClient, previous: T, scope: ReaderScope,
  hydrate?: (book: T) => Promise<T>): Promise<T> {
  assertCurrent(scope);
  const paging = previous._pagination;
  if (!paging?.cursor) return previous;
  if (paging.viewer !== scope.viewer) throw cancelled();
  const { data, error } = await request(client, 'get_memory_book_page_v2',
    { p_album: previous.id, p_cursor: paging.cursor, p_limit: 24 }, scope);
  if (error) throw error;
  const value = bookResponse(data, previous.id, scope, true);
  if (value.revision !== paging.revision) throw Object.assign(new Error('MEMORY_BOOK_CHANGED'), { code: '40001' });
  const ids = new Set(previous.pages.map(page => page.id));
  const added = value.pages as T['pages'];
  if (added.some(page => ids.has(page.id)) || memoryBookOffset(previous) + previous.pages.length + added.length > previous.count
    || JSON.stringify(value.next_cursor) === JSON.stringify(paging.cursor)) {
    throw new Error('The memory continuation is inconsistent. Please reopen the book.');
  }
  let chunk = { ...previous, pages: added, _pagination: { ...paging, cursor: value.next_cursor as ReaderCursor | null } } as T;
  // Hydrate only this page and the small cover projection, never all previously
  // loaded pages again. Signing still uses the album's canonical authorization.
  if (hydrate) chunk = await hydrate(chunk);
  assertCurrent(scope);
  const next = { ...chunk, pages: [...previous.pages, ...chunk.pages] } as T;
  if (typeof previous._mediaExpiresAt === 'number') {
    next._mediaExpiresAt = typeof next._mediaExpiresAt === 'number'
      ? Math.min(previous._mediaExpiresAt, next._mediaExpiresAt) : previous._mediaExpiresAt;
  }
  if (!memoryBookHasMore(next) && memoryBookOffset(next) + next.pages.length !== next.count) throw new Error('Some memories are missing. Please reopen the book.');
  return next;
}

/** Keep only the current page and nearby pages in the ordinary reader. The
 * server seeks on either side of the exact authorized page, so returning to
 * older memories needs neither OFFSET scans nor an ever-growing cursor ledger.
 * Whole-book operations continue using readMemoryBookComplete explicitly. */
export async function readMemoryBookWindow<T extends MemoryCollection>(client: ReaderClient, previous: T,
  anchorIndex: number, direction: -1 | 1, scope: ReaderScope, hydrate?: (book: T) => Promise<T>): Promise<{ book: T; index: number }> {
  assertCurrent(scope);
  const paging = previous._pagination;
  if (!paging?.windowSupported || paging.viewer !== scope.viewer || !Number.isInteger(anchorIndex)
    || anchorIndex < 0 || anchorIndex >= previous.pages.length) throw new Error('The memory window is unavailable.');
  const anchor = previous.pages[anchorIndex].id;
  const { data, error } = await request(client, 'get_memory_book_window_v3', { p_album: previous.id,
    p_anchor: anchor, p_revision: paging.revision, p_before: direction < 0 ? 35 : 12, p_after: direction < 0 ? 12 : 35 }, scope);
  if (error) throw error;
  if (!object(data) || data.version !== 3 || data.can_view !== true || data.id !== previous.id
    || data.revision !== paging.revision || !validatePages(data.pages) || data.pages.length > 48
    || !Number.isSafeInteger(data.anchor_index) || (data.anchor_index as number) < 0
    || data.pages[data.anchor_index as number]?.id !== anchor || typeof data.has_more !== 'boolean'
    || typeof data.has_previous !== 'boolean'
    || (data.has_more ? !object(data.next_cursor) : data.next_cursor !== null)) {
    throw new Error('The memory window changed. Please reopen the book.');
  }
  const offset = memoryBookOffset(previous) + anchorIndex - (data.anchor_index as number);
  if (offset < 0 || offset + data.pages.length > previous.count || data.has_previous !== (offset > 0)
    || (!data.has_more && offset + data.pages.length !== previous.count)) throw new Error('The memory position changed. Please reopen the book.');
  if (object(data.next_cursor) && (data.next_cursor.viewer !== scope.viewer || data.next_cursor.album !== previous.id
    || data.next_cursor.revision !== paging.revision)) throw new Error('The memory cursor changed.');
  let book = { ...previous, pages: data.pages, _pagination: { ...paging, offset, cursor: data.next_cursor as ReaderCursor | null } } as T;
  if (hydrate) book = await hydrate(book);
  assertCurrent(scope);
  return { book, index: data.anchor_index as number };
}
export async function readMemoryBookComplete<T extends MemoryCollection>(client: ReaderClient, album: string, scope: ReaderScope,
  hydrate?: (book: T) => Promise<T>): Promise<T | null> {
  let book = await readMemoryBookFirst<T>(client, album, scope, hydrate);
  while (book && memoryBookHasMore(book)) book = await readMemoryBookNext(client, book, scope, hydrate);
  return book;
}

/** Old owner-only links resolve the default book without loading its history. */
export async function readDefaultMemoryBookFirst<T extends MemoryCollection>(client: ReaderClient, owner: string,
  scope: ReaderScope, hydrate?: (book: T) => Promise<T>): Promise<T | null> {
  const capability=await readPagedReaderCapabilities(client,scope);
  const {data,error}=await request(client,capability.bookWindows?'get_default_memory_book_page_v3':'get_memory_album',{p_owner:owner},scope);
  if(error)throw error;if(!data)return null;
  let book:T;
  if(capability.bookWindows){
    const value=bookResponse(data,object(data)&&typeof data.id==='string'?data.id:'',scope,false);
    if(!Number.isSafeInteger(value.count)||(value.count as number)<(value.pages as unknown[]).length)throw new Error('The memory count is incomplete.');
    book={...value,...(value.can_view?{_pagination:{version:2,viewer:scope.viewer,revision:value.revision,
      cursor:value.next_cursor,windowSupported:true,offset:0}}:{})} as T;
    if(book.can_view&&!memoryBookHasMore(book)&&book.pages.length!==book.count)throw new Error('Some memories are missing. Please retry.');
  }else book=data as T;
  if(hydrate)book=await hydrate(book);assertCurrent(scope);return book;
}

export type MemoryShelfPagination = { viewer: string; owner: string; revision: string; cursor: ReaderCursor | null };
export type MemoryShelfCollection<T extends { id: string }> = { is_owner: boolean; books: T[]; _pagination?: MemoryShelfPagination };
function shelfResponse(value: unknown, owner: string, scope: ReaderScope) {
  if (!object(value) || value.version !== 2 || typeof value.is_owner !== 'boolean' || !validatePages(value.books)
    || value.books.length > 12 || typeof value.has_more !== 'boolean' || typeof value.revision !== 'string'
    || !/^\d{1,20}$/.test(value.revision) || (value.has_more ? !object(value.next_cursor) : value.next_cursor !== null)
    || (value.has_more && (!value.books.length || (value.next_cursor as ReaderCursor).viewer !== scope.viewer
      || (value.next_cursor as ReaderCursor).owner !== owner || (value.next_cursor as ReaderCursor).revision !== value.revision))) {
    throw new Error('The book collection is incomplete. Please retry.');
  }
  return value;
}
export async function readMemoryShelfFirst<T extends { id: string }>(client: ReaderClient, owner: string, scope: ReaderScope): Promise<MemoryShelfCollection<T>> {
  const enabled = (await readPagedReaderCapabilities(client, scope)).books;
  const { data, error } = await request(client, enabled ? 'get_memory_books_page_v2' : 'get_memory_albums',
    { p_owner: owner, ...(enabled ? { p_limit: 12 } : {}) }, scope);
  if (error) throw error;
  if (!enabled) {
    if (Array.isArray(data)) return { is_owner: false, books: data as T[] };
    if (!object(data) || !Array.isArray(data.books)) throw new Error('Memory books are unavailable.');
    return { is_owner: data.is_owner === true, books: data.books as T[] };
  }
  const value = shelfResponse(data, owner, scope);
  return { is_owner: value.is_owner as boolean, books: value.books as T[], _pagination: {
    viewer: scope.viewer, owner, revision: value.revision as string, cursor: value.next_cursor as ReaderCursor | null,
  } };
}
export async function readMemoryShelfNext<T extends { id: string }>(client: ReaderClient, previous: MemoryShelfCollection<T>, scope: ReaderScope): Promise<MemoryShelfCollection<T>> {
  assertCurrent(scope); const paging = previous._pagination;
  if (!paging?.cursor) return previous;
  if (paging.viewer !== scope.viewer) throw cancelled();
  const { data, error } = await request(client, 'get_memory_books_page_v2',
    { p_owner: paging.owner, p_cursor: paging.cursor, p_limit: 12 }, scope);
  if (error) throw error;
  const value = shelfResponse(data, paging.owner, scope);
  if (value.revision !== paging.revision) throw Object.assign(new Error('MEMORY_BOOK_CHANGED'), { code: '40001' });
  const ids = new Set(previous.books.map(book => book.id));
  if ((value.books as T[]).some(book => ids.has(book.id)) || JSON.stringify(value.next_cursor) === JSON.stringify(paging.cursor)) {
    throw new Error('The book collection changed. Please refresh it.');
  }
  return { is_owner: value.is_owner as boolean, books: [...previous.books, ...value.books as T[]],
    _pagination: { ...paging, cursor: value.next_cursor as ReaderCursor | null } };
}
export async function readNextMemoryBook<T>(client: ReaderClient, album: string, includeEmpty: boolean, scope: ReaderScope): Promise<{ supported: boolean; book: T | null }> {
  if (!(await readPagedReaderCapabilities(client, scope)).books) return { supported: false, book: null };
  const { data, error } = await request(client, 'get_next_memory_book_v2', { p_album: album, p_include_empty: includeEmpty }, scope);
  if (error) throw error;
  if (data !== null && (!object(data) || typeof data.id !== 'string')) throw new Error('The next book could not be checked.');
  return { supported: true, book: data as T | null };
}

export type InboxPage<T> = { items: T[]; cursor: ReaderCursor | null; badges: unknown; badgesIncluded: boolean;
  summary?: { total: number; archivedPersonal: number } };
export type InboxReadOptions = { context?: string | null; cursor?: ReaderCursor | null; limit?: number;
  order?: 'pinned' | 'activity'; folder?: 'all' | 'active' | 'archived'; groups?: boolean; deleted?: boolean; badges?: boolean;
  ids?: string[] | null; search?: string | null; searchMode?: 'native' | 'web'; filter?: 'all' | 'groups' | 'unread';
  excludeCommunity?: boolean; excludeRequests?: boolean };
export async function readInboxPage<T extends { id: string }>(client: ReaderClient, scope: ReaderScope,
  options: InboxReadOptions = {}): Promise<InboxPage<T> | null> {
  if (!options.cursor && !(await readPagedReaderCapabilities(client, scope)).inbox) return null;
  const { data, error } = await request(client, 'get_inbox_page_v2', {
    p_context: options.context ?? null, p_cursor: options.cursor ?? null, p_limit: options.limit ?? 30,
    p_order: options.order ?? 'pinned', p_folder: options.folder ?? 'all', p_include_groups: options.groups ?? true,
    p_include_deleted: options.deleted ?? false, p_include_badges: options.badges ?? false,
    p_ids: options.ids ?? null, p_search: options.search ?? null, p_search_mode: options.searchMode ?? 'web',
    p_filter: options.filter ?? 'all', p_exclude_community: options.excludeCommunity ?? false,
    p_exclude_requests: options.excludeRequests ?? false,
  }, scope);
  if (error) throw error;
  if (!object(data) || data.version !== 2 || !validatePages(data.items) || data.items.length > 50
    || typeof data.has_more !== 'boolean' || (data.has_more ? !object(data.next_cursor) : data.next_cursor !== null)
    || (data.has_more && (!data.items.length || (data.next_cursor as ReaderCursor).viewer !== scope.viewer))
    || (options.cursor && JSON.stringify(data.next_cursor) === JSON.stringify(options.cursor))) {
    throw new Error('The conversation page is incomplete. Please retry.');
  }
  return { items: data.items as T[], cursor: data.next_cursor as ReaderCursor | null,
    badges: data.badges, badgesIncluded: data.badges_included === true,
    ...(object(data.summary) && Number.isSafeInteger(data.summary.total) && Number.isSafeInteger(data.summary.archived_personal)
      ? { summary: { total: data.summary.total as number, archivedPersonal: data.summary.archived_personal as number } } : {}) };
}
export type InboxUnreadTotals = { personal: number; market: number; jobs: number };
export async function readInboxUnreadTotals(client: ReaderClient, scope: ReaderScope): Promise<InboxUnreadTotals | null> {
  if (!(await readPagedReaderCapabilities(client, scope)).inbox) return null;
  const { data, error } = await request(client, 'get_inbox_unread_totals_v2', {}, scope);
  if (error) throw error;
  if (!object(data) || data.version !== 2 || !['personal','market','jobs'].every(key => Number.isSafeInteger(data[key]) && (data[key] as number) >= 0)) {
    throw new Error('The unread totals could not be checked. Please retry.');
  }
  return { personal: data.personal as number, market: data.market as number, jobs: data.jobs as number };
}
