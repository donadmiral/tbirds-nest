import type { FeedRow } from './feed';
import { createFeedSnapshotStore } from '../../shared/feedSnapshot';
import { isMarketplacePost } from '../../shared/marketplaceRecommendations';
import { createFeedTabCache } from '../../shared/feedTabCache';

export type FeedMode = 'for_you' | 'latest' | 'trending';
export type FeedSeed = { owner: string; rows: FeedRow[]; mutedWords: string[]; error: string | null };
type Result = { data: unknown; error: { message: string } | null };
type Query = PromiseLike<Result> & { abortSignal?: (signal: AbortSignal) => Query };
type Client = { rpc: (name: string, args: Record<string, unknown>) => Query };
type Snapshots = ReturnType<typeof createFeedSnapshotStore>;
type Measurement = { operation: 'refresh' | 'page'; durationMs: number; outcome: 'ok' | 'error'; rows: number };
export type HomeFeedState = {
  owner: string | null; mode: FeedMode; rows: FeedRow[]; loading: boolean; loadingMore: boolean;
  hasMore: boolean; pending: number; error: string | null;
};
const PAGE_SIZE = 20;
const cacheMode = (mode: FeedMode) => mode === 'for_you' ? 'forYou' : mode;
const uniqueRows = (rows: FeedRow[]) => [...new Map(rows.map(row => [row.post_id, row])).values()];
export const filterMutedFeedRows = (rows: FeedRow[], words: string[]) => rows.filter(row => {
  if (isMarketplacePost(row)) return false;
  const text = `${row.content ?? row.body ?? ''} ${row.article_title ?? ''}`.toLowerCase();
  return !words.some(word => word && text.includes(word.toLowerCase()));
});

/** One controller per mounted feed. No server-side or cross-account shared state. */
export function createHomeFeedController(client: Client, seed: FeedSeed, snapshots: Snapshots,
  measure: (value: Measurement) => void = () => {}, hydrate: (rows: FeedRow[]) => Promise<FeedRow[]> = async rows => rows) {
  let state: HomeFeedState = { owner: seed.owner, mode: 'for_you', rows: filterMutedFeedRows(seed.rows, seed.mutedWords),
    loading: false, loadingMore: false, hasMore: seed.rows.length >= PAGE_SIZE, pending: 0, error: seed.error };
  let cursor = seed.rows.length ? seed.rows[seed.rows.length - 1] : null;
  let words = seed.mutedWords;
  const tabs = createFeedTabCache<{ rows: FeedRow[]; cursor: FeedRow | null; hasMore: boolean; pending: number }>();
  let revision = 0, pageRevision = 0, disposed = false, liveResolved = !seed.error, refreshing = false;
  const hidden = new Set<string>(), listeners = new Set<() => void>(), active = new Set<AbortController>();
  const publish = (patch: Partial<HomeFeedState>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const current = (token: number, owner: string | null, mode: FeedMode) => !disposed && revision === token && state.owner === owner && state.mode === mode;
  const cancel = () => { active.forEach(controller => controller.abort()); active.clear(); };
  async function query(name: string, args: Record<string, unknown>): Promise<Result> {
    const controller = new AbortController(); active.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      let work = client.rpc(name, args);
      if (work.abortSignal) work = work.abortSignal(controller.signal);
      return await Promise.race([work, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Your connection is taking longer than usual. Please try again.')); }, 12_000);
      })]);
    } finally { if (timer) clearTimeout(timer); active.delete(controller); }
  }
  async function visibility(ids: string[], token: number, owner: string | null, mode: FeedMode) {
    const allowed = new Map<string, boolean>(), deduped = [...new Set(ids)];
    for (let index = 0; index < deduped.length; index += 200) {
      if (!current(token, owner, mode)) return null;
      const batches = [deduped.slice(index, index + 100), deduped.slice(index + 100, index + 200)].filter(batch => batch.length);
      const results = await Promise.all(batches.map(p_ids => query('get_feed_visibility', { p_ids })));
      if (!current(token, owner, mode)) return null;
      for (const result of results) {
        if (result.error) throw new Error('Post visibility could not be refreshed. Please try again.');
        for (const row of (result.data ?? []) as { post_id: string; snapshot_eligible: boolean }[]) allowed.set(row.post_id, row.snapshot_eligible === true);
      }
    }
    return allowed;
  }
  async function persist(rows: FeedRow[], token: number, owner: string, mode: FeedMode, known?: Map<string, boolean>) {
    const snapshotRevision = snapshots.revision();
    try {
      const eligibility = known ?? await visibility(rows.slice(0, 20).map(row => row.post_id), token, owner, mode);
      if (!eligibility || !current(token, owner, mode)) return;
      await snapshots.write(owner, cacheMode(mode), rows, new Set([...eligibility].filter(([, eligible]) => eligible).map(([id]) => id)), snapshotRevision);
    } catch { /* Optional disk caching never blocks a live feed. */ }
  }
  async function load(more = false, background = false) {
    if (!state.owner || disposed || (more && (refreshing || state.loadingMore || !state.hasMore || !cursor))) return;
    if (!more) { revision++; pageRevision++; cancel(); refreshing = true; }
    const token = revision, pageToken = more ? ++pageRevision : pageRevision, owner = state.owner, mode = state.mode;
    const valid = () => current(token, owner, mode) && (!more || pageToken === pageRevision);
    const started = performance.now();
    publish({ loading: !more && !state.rows.length, loadingMore: more, error: null });
    try {
      const result = await query('get_feed', { p_mode: mode, p_cursor_key: more ? cursor?.sort_key : null,
        p_cursor_id: more ? cursor?.post_id : null, p_limit: PAGE_SIZE });
      if (!valid()) return;
      if (result.error) throw new Error(result.error.message);
      const raw = (result.data ?? []) as FeedRow[];
      const received = uniqueRows(filterMutedFeedRows(raw, words)).filter(row => !hidden.has(row.post_id));
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
      const incoming = allowed ? received.filter(row => allowed.has(row.post_id)) : received;
      let rows: FeedRow[], pending = 0;
      if (more) rows = uniqueRows([...existing, ...incoming]);
      else if (background && existing.length) {
        const latest = new Map(incoming.map(row => [row.post_id, row]));
        const shown = new Set(existing.map(row => row.post_id));
        rows = existing.map(row => latest.get(row.post_id) ?? row);
        pending = incoming.filter(row => !shown.has(row.post_id)).length;
      } else rows = incoming;
      rows = (await hydrate(rows)).map(row => ({ ...row, media: (row.media ?? []).filter(item => typeof item.url === 'string' && item.url.length > 0) }));
      if (!valid()) return;
      // Snapshot rows may be cached before the first network page establishes a cursor.
      const keepCursor = background && existing.length > 0 && cursor !== null;
      if (!keepCursor) cursor = raw.length ? raw[raw.length - 1] : null;
      liveResolved = true;
      publish({ rows, pending, loading: false, loadingMore: false, hasMore: keepCursor ? state.hasMore : raw.length >= PAGE_SIZE });
      if (!more) void persist(raw, token, owner, mode, allowed ?? undefined);
      measure({ operation: more ? 'page' : 'refresh', durationMs: performance.now() - started, outcome: 'ok', rows: rows.length });
    } catch (error) {
      if (!valid()) return;
      publish({ error: 'The feed could not load. Please try again.' });
      measure({ operation: more ? 'page' : 'refresh', durationMs: performance.now() - started, outcome: 'error', rows: state.rows.length });
    } finally { if (valid()) { if (!more) refreshing = false; publish({ loading: false, loadingMore: false }); } }
  }
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async start() {
      disposed = false; snapshots.setAccount(state.owner);
      const owner = state.owner, mode = state.mode, token = revision;
      if (!owner) return;
      if (!seed.error) { void persist(seed.rows, token, owner, mode); return; }
      const fresh = load(false);
      const readToken = revision;
      const restored = snapshots.read(owner, cacheMode(mode)).then(snapshot => {
        if (!snapshot || !current(readToken, owner, mode) || liveResolved || state.rows.length) return;
        const rows = snapshot.rows.map(row => ({ ...row, body: null, read_minutes: null, quoted_post_id: null, thread_parent_id: null,
          created_at: row.created_at ?? '', sort_key: 0, author_kind: null, viewer_follows: false, link: null,
          innovation_field: null, innovation_stage: null })) as FeedRow[];
        publish({ rows: filterMutedFeedRows(rows, words), loading: false });
      });
      await Promise.all([restored, fresh]);
    },
    load,
    setMode(mode: FeedMode) {
      if (mode === state.mode) return;
      // Save only an established result. A request interrupted by another tab
      // must not turn that tab's next visit into a cached empty state.
      if (!state.loading && !state.error) tabs.save(state.mode, { rows: state.rows, cursor, hasMore: state.hasMore, pending: state.pending });
      const restored = tabs.read(mode);
      cursor = restored?.cursor ?? null;
      publish({ mode, rows: restored?.rows.filter(row => !hidden.has(row.post_id)) ?? [], pending: restored?.pending ?? 0,
        hasMore: restored?.hasMore ?? false, loading: !restored, loadingMore: false, error: null });
      void load(false, !!restored);
    },
    setOwner(owner: string | null) {
      if (owner === state.owner) return;
      revision++; pageRevision++; cancel(); refreshing = false; snapshots.setAccount(owner); hidden.clear(); tabs.clear(); words = []; cursor = null; liveResolved = false;
      publish({ owner, rows: [], pending: 0, hasMore: false, loading: !!owner, loadingMore: false, error: null });
      if (owner) queueMicrotask(() => { if (state.owner === owner) void load(); });
    },
    hide(postId: string) {
      hidden.add(postId); if (state.owner) void snapshots.clear(state.owner);
      publish({ rows: state.rows.filter(row => row.post_id !== postId) });
    },
    dispose() { disposed = true; revision++; pageRevision++; cancel(); tabs.clear(); listeners.clear(); },
  };
}
