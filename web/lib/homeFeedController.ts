import type { FeedRow } from './feed';
import { createFeedSnapshotStore } from '../../shared/feedSnapshot';
import { isMarketplacePost } from '../../shared/marketplaceRecommendations';
import { createFeedTabCache } from '../../shared/feedTabCache';
import type { FeedLiveRow, FeedLiveRequest } from '../../shared/feedLive';
import type { HistorySnapshot, SessionHistory } from '../../shared/sessionHistory';

export type FeedMode = 'for_you' | 'latest' | 'trending';
export type FeedSeed = { owner: string; rows: FeedRow[]; mutedWords: string[]; error: string | null };
type Result = { data: unknown; error: { message: string } | null };
type Query = PromiseLike<Result> & { abortSignal?: (signal: AbortSignal) => Query };
type Client = { rpc: (name: string, args: Record<string, unknown>) => Query };
type Snapshots = ReturnType<typeof createFeedSnapshotStore>;
type Measurement = { operation: 'refresh' | 'page'; durationMs: number; outcome: 'ok' | 'error'; rows: number };
export type FeedScrollRestore = { id: number; owner: string; mode: FeedMode; top: number };
export type HomeFeedState = {
  owner: string | null; mode: FeedMode; rows: FeedRow[]; loading: boolean; loadingMore: boolean;
  hasMore: boolean; pending: number; error: string | null; scrollRestore: FeedScrollRestore | null;
  history: HistorySnapshot<FeedRow> | null;
};
type FeedTabMemory = { rows: FeedRow[]; cursor: FeedRow | null; hasMore: boolean; pending: number; scrollTop: number; mediaScope?: string | null; history?: SessionHistory<FeedRow> | null };
type HistoryFactory = (options: { id: (row: FeedRow) => string; fetch: (ids: string[], signal: AbortSignal) => Promise<FeedRow[]>; current: () => boolean }) => SessionHistory<FeedRow>;
type FeedMediaContext = {
  scope: () => string | null;
  retain: (current: FeedRow[], incoming: FeedRow[], previousScope: string | null, nextScope: string | null) => FeedRow[];
};
export type HomeFeedMemory = {
  owner: string; mode: FeedMode; tab: FeedTabMemory; tabs: [string, FeedTabMemory][]; hidden: string[]; mutedWords: string[];
};
const PAGE_SIZE = 20;
const cacheMode = (mode: FeedMode) => mode === 'for_you' ? 'forYou' : mode;
const uniqueRows = (rows: FeedRow[]) => [...new Map(rows.map(row => [row.post_id, row])).values()];
const scrollOffset = (value: number) => Number.isFinite(value) && value >= 0 ? value : 0;
export const filterMutedFeedRows = (rows: FeedRow[], words: string[]) => rows.filter(row => {
  if (isMarketplacePost(row)) return false;
  const text = `${row.content ?? row.body ?? ''} ${row.article_title ?? ''}`.toLowerCase();
  return !words.some(word => word && text.includes(word.toLowerCase()));
});

/** One controller per mounted feed. No server-side or cross-account shared state. */
export function createHomeFeedController(client: Client, seed: FeedSeed, snapshots: Snapshots,
  measure: (value: Measurement) => void = () => {}, hydrate: (rows: FeedRow[]) => Promise<FeedRow[]> = async rows => rows,
  memory?: HomeFeedMemory | null, mediaContext?: FeedMediaContext, historyFactory?: HistoryFactory) {
  const restored = memory?.owner === seed.owner && (!mediaContext || memory.tab.mediaScope === mediaContext.scope()) ? memory : null;
  let words = restored && seed.error ? restored.mutedWords : seed.mutedWords;
  let state: HomeFeedState = { owner: seed.owner, mode: restored?.mode ?? 'for_you', rows: filterMutedFeedRows(restored?.tab.rows ?? seed.rows, words),
    loading: false, loadingMore: false, hasMore: restored?.tab.hasMore ?? seed.rows.length >= PAGE_SIZE,
    pending: restored?.tab.pending ?? 0, error: seed.error, history: restored?.tab.history?.getSnapshot() ?? null,
    scrollRestore: restored ? { id: 1, owner: seed.owner, mode: restored.mode, top: restored.tab.scrollTop } : null };
  let cursor = restored ? restored.tab.cursor : seed.rows.length ? seed.rows[seed.rows.length - 1] : null;
  let mediaScope = restored ? restored.tab.mediaScope ?? null : mediaContext?.scope() ?? null;
  const tabs = createFeedTabCache<FeedTabMemory>();
  restored?.tabs.forEach(([key, tab]) => tabs.save(key, tab));
  let revision = 0, pageRevision = 0, scrollRevision = restored ? 1 : 0, disposed = false, liveResolved = !!restored || !seed.error, refreshing = false;
  const hidden = new Set<string>(restored?.hidden), listeners = new Set<() => void>(), active = new Set<AbortController>();
  const deniedAt = new Map<string, number>();
  let deniedFloor = -1;
  let history = restored?.tab.history ?? null, unsubscribeHistory: (() => void) | undefined, historyReady: boolean | null = null;
  const publish = (patch: Partial<HomeFeedState>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const current = (token: number, owner: string | null, mode: FeedMode) => !disposed && revision === token && state.owner === owner && state.mode === mode;
  const cancel = () => { active.forEach(controller => controller.abort()); active.clear(); };
  function bindHistory(value: SessionHistory<FeedRow> | null) {
    if (value && !value.available()) value = null;
    unsubscribeHistory?.(); history = value;
    if (!value) { publish({ history: null }); return; }
    const owner = state.owner, mode = state.mode, scope = mediaContext?.scope() ?? null;
    const valid = () => !disposed && state.owner === owner && state.mode === mode && (!mediaContext || mediaContext.scope() === scope);
    value.rebind({ current: valid, fetch: async (ids, signal) => {
      const requestedAt = Date.now();
      const result = await query('get_feed_rows_by_ids_v1', { p_ids: ids }, signal);
      if (!valid() || signal.aborted) throw Object.assign(new Error('The reading session changed.'), { name: 'AbortError' });
      if (result.error || !Array.isArray(result.data)) throw new Error('Earlier posts could not be loaded. Please retry.');
      const rows = await hydrate(filterMutedFeedRows(result.data as FeedRow[], words).filter(row => !hidden.has(row.post_id)));
      if (!valid() || signal.aborted) throw Object.assign(new Error('The reading session changed.'), { name: 'AbortError' });
      if (requestedAt <= deniedFloor) throw new Error('Post access changed. Please retry.');
      return rows.filter(row => !hidden.has(row.post_id) && (deniedAt.get(row.post_id) ?? -1) < requestedAt);
    } });
    const sync = () => { if (valid()) { const snapshot = value.getSnapshot(); publish({ rows: snapshot.rows, history: snapshot,
      ...(snapshot.error ? { error: snapshot.error } : {}) }); } };
    unsubscribeHistory = value.subscribe(sync); sync();
  }
  async function enableHistory() {
    if (!historyFactory || !state.owner || disposed) return;
    if (history) { bindHistory(history); return; }
    const owner = state.owner, mode = state.mode, token = revision;
    if (historyReady === null) {
      try { const result = await query('get_feed_rows_by_ids_v1', { p_ids: [] });
        if (!current(token, owner, mode)) return;
        historyReady = !result.error && Array.isArray(result.data) && result.data.length === 0;
      } catch { return; }
    }
    if (!historyReady || !current(token, owner, mode)) return;
    const value = historyFactory({ id: row => row.post_id, current: () => current(token, owner, mode), fetch: async () => [] });
    try {
      for (let from = 0; from < state.rows.length; from += 100) await value.append(state.rows.slice(from, from + 100));
      if (current(token, owner, mode)) bindHistory(value); else await value.dispose();
    } catch { await value.dispose(); }
  }
  function removeLive(ids: Set<string>) {
    if (!ids.size || disposed) return;
    const now = Date.now();
    ids.forEach(id => { deniedAt.delete(id); deniedAt.set(id, now); });
    // These tombstones only fence older in-flight responses. They are not a
    // permanent hide, so a later authorized response can restore a post.
    // A global floor fences requests older than a discarded tombstone, so
    // pruning cannot make an old response authorized again.
    while (deniedAt.size > 2000) {
      const [id, at] = deniedAt.entries().next().value!;
      deniedFloor = Math.max(deniedFloor, at); deniedAt.delete(id);
    }
    if (state.owner) void snapshots.clear(state.owner);
    tabs.update(tab => ({ ...tab, rows: tab.rows.filter(row => !ids.has(row.post_id)) }));
    history?.remove(ids);
    publish({ rows: state.rows.filter(row => !ids.has(row.post_id)) });
  }
  async function query(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<Result> {
    const controller = new AbortController(); active.add(controller);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      let work = client.rpc(name, args);
      if (work.abortSignal) work = work.abortSignal(controller.signal);
      return await Promise.race([work, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Your connection is taking longer than usual. Please try again.')); }, 12_000);
      })]);
    } finally { if (timer) clearTimeout(timer); signal?.removeEventListener('abort', abort); active.delete(controller); }
  }
  async function visibility(ids: string[], token: number, owner: string | null, mode: FeedMode, request?: FeedLiveRequest) {
    const allowed = new Map<string, boolean>(), deduped = [...new Set(ids)];
    for (let index = 0; index < deduped.length; index += 200) {
      if (!current(token, owner, mode) || (request && !request.current())) return null;
      const batches = [deduped.slice(index, index + 100), deduped.slice(index + 100, index + 200)].filter(batch => batch.length);
      const results = await Promise.all(batches.map(p_ids => query('get_feed_visibility', { p_ids }, request?.signal)));
      if (!current(token, owner, mode) || (request && !request.current())) return null;
      for (const result of results) {
        if (result.error) throw new Error('Post visibility could not be refreshed. Please try again.');
        for (const row of (result.data ?? []) as { post_id: string; snapshot_eligible: boolean }[]) allowed.set(row.post_id, row.snapshot_eligible === true);
      }
    }
    return allowed;
  }
  async function persist(rows: FeedRow[], token: number, owner: string, mode: FeedMode, known?: Map<string, boolean>, snapshotRevision = snapshots.revision()) {
    try {
      const eligibility = known ?? await visibility(rows.slice(0, 20).map(row => row.post_id), token, owner, mode);
      if (!eligibility || !current(token, owner, mode)) return;
      await snapshots.write(owner, cacheMode(mode), rows, new Set([...eligibility].filter(([, eligible]) => eligible).map(([id]) => id)), snapshotRevision);
    } catch { /* Optional disk caching never blocks a live feed. */ }
  }
  async function load(more = false, background = false, modeChange = false) {
    if (more && history && !history.atEnd()) {
      await history.around((history.getSnapshot().pages.at(-1)?.index ?? 0) + 1).catch(() => {}); return;
    }
    if (!state.owner || disposed || (more && (refreshing || state.loadingMore || !state.hasMore || !cursor))) return;
    if (!more) { revision++; pageRevision++; cancel(); refreshing = true; }
    const token = revision, pageToken = more ? ++pageRevision : pageRevision, owner = state.owner, mode = state.mode;
    const requestScope = mediaContext?.scope() ?? null;
    const valid = () => current(token, owner, mode) && (!more || pageToken === pageRevision)
      && (!mediaContext || requestScope === mediaContext.scope());
    const started = performance.now(), requestedAt = Date.now(), snapshotRevision = snapshots.revision();
    publish({ loading: !more && !state.rows.length, loadingMore: more, error: null,
      ...(!more && !background && !modeChange ? { scrollRestore: null } : {}) });
    try {
      const result = await query('get_feed', { p_mode: mode, p_cursor_key: more ? cursor?.sort_key : null,
        p_cursor_id: more ? cursor?.post_id : null, p_limit: PAGE_SIZE });
      if (!valid()) return;
      if (result.error) throw new Error(result.error.message);
      if (requestedAt <= deniedFloor) throw new Error('Post access changed. Please retry.');
      const raw = (result.data ?? []) as FeedRow[];
      const received = uniqueRows(filterMutedFeedRows(raw, words)).filter(row => !hidden.has(row.post_id)
        && (deniedAt.get(row.post_id) ?? -1) < requestedAt);
      let existing = state.rows;
      let allowed: Map<string, boolean> | null = null;
      // Revalidate retained pages, rather than mistaking their absence from page one for deletion.
      if (!more && background && existing.length) {
        allowed = await visibility([...existing.map(row => row.post_id), ...received.map(row => row.post_id)], token, owner, mode);
        if (!valid() || !allowed) return;
        const retained = allowed;
        existing = existing.filter(row => retained.has(row.post_id));
        if (existing.length !== state.rows.length) await snapshots.clear(owner);
      }
      if (!valid()) return;
      const authorized = allowed ? received.filter(row => allowed.has(row.post_id)) : received;
      const incoming = mediaContext ? mediaContext.retain(existing, authorized, mediaScope, requestScope) : authorized;
      if (mediaContext && mediaScope !== requestScope) existing = existing.map(row => ({ ...row, _mediaExpiresAt: undefined }));
      let rows: FeedRow[], pending = 0;
      if (more) rows = uniqueRows([...existing, ...incoming]);
      else if (background && existing.length) {
        const latest = new Map(incoming.map(row => [row.post_id, row]));
        const shown = new Set(existing.map(row => row.post_id));
        rows = existing.map(row => latest.get(row.post_id) ?? row);
        pending = incoming.filter(row => !shown.has(row.post_id)).length;
      } else rows = incoming;
      rows = (await hydrate(rows)).map(row => {
        const hasUrl = (item: FeedRow['media'][number]) => typeof item.url === 'string' && item.url.length > 0;
        // Renewal already preserves still-authorized rows. Keep that identity
        // while paging so existing cards do not reset their media metadata.
        if (row.media?.every(hasUrl)) return row;
        return { ...row, media: (row.media ?? []).filter(hasUrl) };
      });
      if (!valid()) return;
      if (requestedAt <= deniedFloor) throw new Error('Post access changed. Please retry.');
      const latest = new Map(state.rows.map(row => [row.post_id, row]));
      rows = rows.filter(row => !hidden.has(row.post_id) && (deniedAt.get(row.post_id) ?? -1) < requestedAt).map(row => {
        const newer = latest.get(row.post_id);
        if (!newer?._liveRequestedAt || newer._liveRequestedAt <= requestedAt) return row;
        // Check after async hydration too: a slower page read must not undo a
        // newer canonical live value or revive a post removed for lost access.
        return { ...row, content: newer.content, body: newer.body, likes_count: newer.likes_count,
          comments_count: newer.comments_count, reposts_count: newer.reposts_count, bookmarks_count: newer.bookmarks_count,
          views_count: newer.views_count, viewer_liked: newer.viewer_liked, viewer_bookmarked: newer.viewer_bookmarked,
          viewer_reposted: newer.viewer_reposted, _liveRequestedAt: newer._liveRequestedAt, _liveOwner: newer._liveOwner };
      });
      mediaScope = requestScope;
      if (history) {
        if (more) { history.update(rows); await history.append(rows.filter(row => !existing.some(previous => previous.post_id === row.post_id))); }
        else if (background && existing.length) history.replaceHot(rows);
        else if (historyFactory) {
          const previous = history, next = historyFactory({ id: row => row.post_id, current: valid, fetch: async () => [] });
          try { await next.append(rows); if (!valid()) { await next.dispose(); return; } }
          catch (reason) { await next.dispose(); throw reason; }
          bindHistory(next); void previous.dispose().catch(() => {});
        }
        if (!valid()) return;
        rows = history.getSnapshot().rows;
      }
      // Snapshot rows may be cached before the first network page establishes a cursor.
      const keepCursor = background && existing.length > 0 && cursor !== null;
      if (!keepCursor) cursor = raw.length ? raw[raw.length - 1] : null;
      liveResolved = true;
      publish({ rows, pending, loading: false, loadingMore: false, hasMore: keepCursor ? state.hasMore : raw.length >= PAGE_SIZE });
      if (!more) void persist(raw, token, owner, mode, allowed ?? undefined, snapshotRevision);
      measure({ operation: more ? 'page' : 'refresh', durationMs: performance.now() - started, outcome: 'ok', rows: rows.length });
    } catch {
      if (!valid()) return;
      publish({ error: history?.getSnapshot().error ?? 'The feed could not load. Please try again.' });
      measure({ operation: more ? 'page' : 'refresh', durationMs: performance.now() - started, outcome: 'error', rows: state.rows.length });
    } finally { if (valid()) { if (!more) refreshing = false; publish({ loading: false, loadingMore: false }); } }
  }
  function changeSession(owner: string | null, scope: string | null, initial = false) {
    if (owner === state.owner && (!mediaContext || scope === mediaScope)) return;
    // An SSR seed belongs to the first matching authenticated browser session.
    // A later session, including a new login for the same user, must reauthorize.
    if (initial && owner === state.owner && mediaScope === null && !restored) {
      mediaScope = scope;
      // An empty/error SSR seed may have started its retry before Auth finished
      // initializing. That null-scope request is now obsolete; start its scoped
      // replacement so it cannot leave the feed's loading guard permanently set.
      if (refreshing || state.loadingMore) {
        revision++; pageRevision++; cancel(); refreshing = false;
        publish({ loadingMore: false });
        queueMicrotask(() => { if (state.owner === owner && mediaScope === scope) void load(false, state.rows.length > 0); });
      }
      return;
    }
    revision++; pageRevision++; cancel(); refreshing = false; snapshots.setAccount(owner); hidden.clear(); deniedAt.clear(); deniedFloor = -1;
    const obsolete = new Set([history, ...tabs.snapshot().map(([, tab]) => tab.history)].filter(Boolean) as SessionHistory<FeedRow>[]);
    unsubscribeHistory?.(); history = null; obsolete.forEach(value => { void value.dispose(); }); tabs.clear(); cursor = null; liveResolved = false; historyReady = null;
    if (owner !== state.owner) words = [];
    mediaScope = scope;
    publish({ owner, rows: [], history: null, pending: 0, hasMore: false, loading: !!owner, loadingMore: false, error: null, scrollRestore: null });
    if (owner) queueMicrotask(() => { if (state.owner === owner && mediaScope === scope) void load().then(enableHistory); });
  }
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async start() {
      disposed = false; snapshots.setAccount(state.owner);
      const owner = state.owner, mode = state.mode, token = revision;
      if (!owner) return;
      if (historyFactory) await enableHistory();
      if (owner !== seed.owner) { await load(); return; }
      if (restored) { await load(false, true); return; }
      if (!seed.error) { void persist(seed.rows, token, owner, mode); return; }
      const fresh = load(false);
      const readToken = revision;
      const diskRestore = snapshots.read(owner, cacheMode(mode)).then(snapshot => {
        if (!snapshot || !current(readToken, owner, mode) || liveResolved || state.rows.length) return;
        const rows = snapshot.rows.map(row => ({ ...row, body: null, read_minutes: null, quoted_post_id: null, thread_parent_id: null,
          created_at: row.created_at ?? '', sort_key: 0, author_kind: null, viewer_follows: false, link: null,
          innovation_field: null, innovation_stage: null })) as FeedRow[];
        publish({ rows: filterMutedFeedRows(rows, words), loading: false });
      });
      await Promise.all([diskRestore, fresh]);
    },
    load: (more = false, background = false) => load(more, background),
    async checkHead(request: FeedLiveRequest) {
      const token = revision, owner = state.owner, mode = state.mode, requestedAt = Date.now();
      if (!owner || disposed || !request.current()) return;
      const result = await query('get_feed', { p_mode: mode, p_cursor_key: null, p_cursor_id: null, p_limit: PAGE_SIZE }, request.signal);
      if (!current(token, owner, mode) || !request.current()) return;
      if (result.error) throw new Error('New posts could not be checked.');
      if (requestedAt <= deniedFloor) return;
      const shown = new Set(state.rows.map(row => row.post_id));
      const incoming = uniqueRows(filterMutedFeedRows((result.data ?? []) as FeedRow[], words));
      const pending = incoming.filter(row => !shown.has(row.post_id) && !hidden.has(row.post_id) && (deniedAt.get(row.post_id) ?? -1) < requestedAt).length;
      if (pending !== state.pending) publish({ pending });
    },
    applyLive(owner: string, ids: string[], rows: FeedLiveRow[], requestedAt: number) {
      if (disposed || state.owner !== owner || requestedAt <= deniedFloor) return;
      const expected = new Set(ids), byId = new Map(rows.filter(row => expected.has(row.post_id)).map(row => [row.post_id, row]));
      removeLive(new Set(ids.filter(id => !byId.has(id))));
      let changed = false;
      const next = state.rows.map(post => {
        const row = byId.get(post.post_id);
        if (!row || (post._liveRequestedAt ?? -1) > requestedAt) return post;
        changed = true;
        return { ...post, content: row.content, body: row.body, likes_count: row.likes_count, comments_count: row.comments_count,
          reposts_count: row.reposts_count, bookmarks_count: row.bookmarks_count, views_count: row.views_count,
          viewer_liked: row.viewer_liked, viewer_bookmarked: row.viewer_bookmarked, viewer_reposted: row.viewer_reposted,
          _liveRequestedAt: requestedAt, _liveOwner: owner };
      });
      const filtered = filterMutedFeedRows(next, words);
      if (filtered.length !== next.length) {
        const visible = new Set(filtered.map(row => row.post_id)); removeLive(new Set(next.filter(row => !visible.has(row.post_id)).map(row => row.post_id)));
      }
      if (changed) { history?.replaceHot(filtered); publish({ rows: filtered }); }
    },
    async reconcileLiveAccess(authors: string[] | null, request?: FeedLiveRequest) {
      const token = revision, owner = state.owner, mode = state.mode;
      if (!owner || disposed) return;
      const selected = state.rows.filter(row => !authors || authors.includes(row.author_id)).map(row => row.post_id);
      const allowed = await visibility(selected, token, owner, mode, request);
      if (allowed && current(token, owner, mode) && (!request || request.current())) removeLive(new Set(selected.filter(id => !allowed.has(id))));
    },
    setMode(mode: FeedMode, currentScrollTop = 0) {
      if (disposed || mode === state.mode) return;
      // Save only an established result. A request interrupted by another tab
      // must not turn that tab's next visit into a cached empty state.
      if (!state.loading && (state.rows.length > 0 || !state.error)) tabs.save(state.mode, { rows: state.rows, cursor, hasMore: state.hasMore, pending: state.pending, mediaScope, history,
        // Rapid tab changes must not replace an unapplied destination offset
        // with the previous tab's temporarily clamped window position.
        scrollTop: state.rows.length ? state.scrollRestore?.top ?? scrollOffset(currentScrollTop) : 0 });
      const restored = tabs.read(mode);
      cursor = restored?.cursor ?? null;
      mediaScope = restored?.mediaScope ?? null;
      const rows = restored?.rows.filter(row => !hidden.has(row.post_id)) ?? [];
      publish({ mode, rows, pending: restored?.pending ?? 0,
        hasMore: restored?.hasMore ?? false, loading: !restored, loadingMore: false, error: null,
        scrollRestore: state.owner ? { id: ++scrollRevision, owner: state.owner, mode, top: rows.length ? scrollOffset(restored?.scrollTop ?? 0) : 0 } : null });
      bindHistory(restored?.history ?? null);
      void load(false, !!restored, true).then(enableHistory);
    },
    finishScrollRestore(id: number) {
      if (state.scrollRestore?.id === id) publish({ scrollRestore: null });
    },
    setOwner: (owner: string | null) => changeSession(owner, mediaContext?.scope() ?? null),
    setMediaSession: changeSession,
    hide(postId: string) {
      hidden.add(postId); if (state.owner) void snapshots.clear(state.owner);
      removeLive(new Set([postId]));
      // Canonical readers enforce persisted hides. Keep only a bounded recent
      // local fence for requests that began before the hide was saved.
      while (hidden.size > 2000) hidden.delete(hidden.values().next().value!);
    },
    remember(currentScrollTop = 0): HomeFeedMemory | null {
      if (!state.owner || (state.loading && !state.rows.length)) return null;
      return { owner: state.owner, mode: state.mode,
        tab: { rows: state.rows, cursor, hasMore: state.hasMore, pending: state.pending, mediaScope, history,
          scrollTop: state.scrollRestore?.top ?? scrollOffset(currentScrollTop) },
        tabs: tabs.snapshot(), hidden: [...hidden], mutedWords: words };
    },
    measurePage(index: number, height: number) { history?.measure(index, height); },
    setHistoryAnchor(id: string) { history?.setAnchor(id); },
    approachHistory(offset: number, viewport: number) { void history?.near(offset, viewport).catch(() => {}); },
    dispose() { disposed = true; revision++; pageRevision++; cancel(); unsubscribeHistory?.(); tabs.clear(); state = { ...state, scrollRestore: null }; listeners.clear(); },
  };
}
