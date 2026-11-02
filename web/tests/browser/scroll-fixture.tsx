/** Local-only wheel regression fixture. Actual application components; synthetic records and services. */
import type { FeedRow } from '../../lib/feed';
import { createRoot } from 'react-dom/client';
import { GlobalMediaLightbox } from '../../components/GlobalMediaLightbox';
import { createClient, posts } from './social-backend';

const id = (index: number) => `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const mediaId = (index: number) => `80000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const quotedSourceId = id(90);
const quotedContent = 'Authorized quoted source for the warm navigation geometry check.';
const pollLabel = 'Keep a steady reading position';
const legacyOriginal = 'https://synthetic.invalid/storage/v1/object/public/post-media/legacy.jpg';
const legacyGranted = 'https://synthetic.invalid/functions/v1/media-content/post-media/legacy.jpg?token=' + 'b'.repeat(64);
let quoteMode: 'legacy' | 'text' | 'missing' = 'legacy';
const base = posts[0];
const rows: FeedRow[] = Array.from({ length: 36 }, (_, index) => {
  const video = index === 1 || index > 1 && index % 3 === 0;
  return {
    ...base, post_id: id(index + 1), sort_key: 1000 - index,
    content: `Wheel verification post ${index + 1}. Synthetic content for stable scrolling.`,
    ...(index === 4 ? { has_poll: true } : {}),
    ...(index === 5 ? { quoted_post_id: quotedSourceId } : {}),
    created_at: new Date(Date.now() - (index + 1) * 3600000).toISOString(),
    media: [{ id: mediaId(index + 1),
      url: index === 0 ? '/delayed-image.svg' : index === 1 ? '/delayed-video.mp4' : video ? `/video.mp4?post=${index + 1}` : `/coast.svg?post=${index + 1}`,
      media_type: video ? 'video' : 'image', width: index < 2 ? null : 1200, height: index < 2 ? null : 720, sort_order: 0 }],
  };
});
// The initial server page has twenty rows. The actual HomeFeed controller requests
// page two from its real IntersectionObserver as the wheel approaches the end.
posts.splice(0, posts.length, ...rows.slice(0, 20));

type MetadataRead = { table: string; ids: string[]; postId: string | null; failed?: boolean };
type FeedRequest = { cursor: string | null; held: boolean; finished: boolean; aborted: boolean };
type AsyncKind = 'poll' | 'quote';
type AsyncRead = { kind: AsyncKind; held: boolean; finished: boolean };
const metadataReads: MetadataRead[] = [];
const feedRequests: FeedRequest[] = [];
const asyncReads: AsyncRead[] = [];
const asyncHolds = new Map<AsyncKind, { promise: Promise<void>; release: () => void }>();
type GrantRead = { held: boolean; denied: boolean; finished: boolean; authorizationPinned: boolean };
const grantReads: GrantRead[] = [];
let grantHold: { promise: Promise<void>; release: () => void; denied: boolean } | null = null;
async function readAsyncBlock(kind: AsyncKind, data: unknown) {
  const hold = asyncHolds.get(kind), read: AsyncRead = { kind, held: !!hold, finished: false };
  asyncReads.push(read);
  if (hold) await hold.promise;
  read.finished = true;
  return { data, error: null };
}
let holdPage = true, holdRefresh = false;
let releaseRecipe!: () => void;
const recipeReady = new Promise<void>(resolve => { releaseRecipe = resolve; });
let failRecipes = false;
const pending = new Set<() => void>();
const synthetic = createClient() as unknown as {
  from: (table: string) => { eq: (key: string, value: unknown) => unknown; in: (key: string, value: string[]) => unknown;
    select: (columns: string, options?: unknown) => unknown;
    then: (yes: (value: unknown) => unknown, no?: (reason: unknown) => unknown) => Promise<unknown> };
  rpc: (name: string, args?: Record<string, unknown>) => unknown;
  functions: { invoke: (name: string, options: { body: Record<string, unknown>; headers?: Record<string, string> }) => Promise<{ data: unknown; error: unknown }> };
};
const from = synthetic.from.bind(synthetic), rpc = synthetic.rpc.bind(synthetic);
synthetic.from = (table: string) => {
  const query = from(table);
  if (table === 'post_media' || table === 'post_media_tags') {
    const read: MetadataRead = { table, ids: [], postId: null }; metadataReads.push(read);
    const eq = query.eq.bind(query), inside = query.in.bind(query);
    query.eq = (key, value) => { if (key === 'post_id') read.postId = String(value); return eq(key, value); };
    query.in = (key, values) => { if (key === 'id' || key === 'media_id') read.ids = [...values]; return inside(key, values); };
    const then = query.then.bind(query);
    // The production metadata reader now coalesces media IDs across cards and
    // validates their parent post. Keep the same delayed authored recipe at
    // this actual query boundary instead of requiring the old per-card eq().
    query.then = (yes, no) => table === 'post_media' && read.ids.includes(mediaId(1))
      ? recipeReady.then(() => {
        if (failRecipes) { read.failed = true; return { data: null, error: { message: 'Synthetic metadata renewal failure' } }; }
        return { data: [{ id: mediaId(1), post_id: id(1), edit: { aspectRatio: 1, scale: 2 } }], error: null };
      }).then(yes, no)
      : then(yes, no);
  }
  if (table === 'posts') {
    let selected = '', postId = '';
    const select = query.select.bind(query), eq = query.eq.bind(query), then = query.then.bind(query);
    query.select = (columns, options) => { selected = columns; return select(columns, options); };
    query.eq = (key, value) => { if (key === 'id') postId = String(value); return eq(key, value); };
    query.then = (yes, no) => postId === quotedSourceId && selected.includes('post_media(')
      ? readAsyncBlock('quote', quoteMode === 'missing' ? null : { id: quotedSourceId, content: quotedContent, body: null,
        created_at: base.created_at, user_id: base.author_id, media_url: quoteMode === 'legacy' ? legacyOriginal : null, image_url: null, post_media: [] }).then(yes, no)
      : then(yes, no);
  }
  return query;
};
synthetic.rpc = (name, args = {}) => {
  if (name === 'get_poll' && args.p_post_id === id(5)) return readAsyncBlock('poll', [
    { option_id: 'poll-option-1', label: pollLabel, votes: 4, viewer_vote: null, ends_at: '2099-01-01T00:00:00Z', total: 7 },
    { option_id: 'poll-option-2', label: 'Read the next post', votes: 3, viewer_vote: null, ends_at: '2099-01-01T00:00:00Z', total: 7 },
  ]);
  if (name !== 'get_feed') return rpc(name, args);
  const cursor = typeof args.p_cursor_id === 'string' ? args.p_cursor_id : null;
  const request: FeedRequest = { cursor, held: cursor ? holdPage : holdRefresh, finished: false, aborted: false };
  feedRequests.push(request);
  let signal: AbortSignal | undefined;
  let running: Promise<{ data: FeedRow[] | null; error: { message: string } | null }> | undefined;
  const execute = () => running ??= (async () => {
    if (request.held) await new Promise<void>(resolve => {
      const release = () => { pending.delete(release); resolve(); };
      pending.add(release);
      signal?.addEventListener('abort', release, { once: true });
      if (signal?.aborted) release();
    });
    request.finished = true; request.aborted = !!signal?.aborted;
    if (request.aborted) return { data: null, error: { message: 'Synthetic request cancelled' } };
    const offset = cursor ? rows.findIndex(row => row.post_id === cursor) + 1 : 0;
    // A network response gives the controller fresh objects, even for unchanged data.
    return { data: JSON.parse(JSON.stringify(rows.slice(offset, offset + 20))) as FeedRow[], error: null };
  })();
  return {
    abortSignal(value: AbortSignal) { signal = value; return this; },
    then(yes: (value: Awaited<ReturnType<typeof execute>>) => unknown, no?: (reason: unknown) => unknown) { return execute().then(yes, no); },
  };
};
const invoke = synthetic.functions.invoke.bind(synthetic.functions);
synthetic.functions.invoke = async (name, options) => {
  const references = options.body?.references;
  if (name !== 'content-media-sign' || !Array.isArray(references) || !references.some(reference => reference?.id === quotedSourceId)) return invoke(name, options);
  const hold = grantHold;
  const read: GrantRead = { held: !!hold, denied: hold?.denied ?? false, finished: false,
    authorizationPinned: options.headers?.Authorization === 'Bearer synthetic-only-no-live-access' };
  grantReads.push(read);
  if (hold) await hold.promise;
  read.finished = true;
  return { data: { urls: read.denied ? [] : [{ key: 'post-media/legacy.jpg', url: legacyGranted }], expiresAt: Date.now() + 180000 }, error: null };
};

const scrollFixture = {
  metadataReads, feedRequests, asyncReads, grantReads, quotedSourceId, quotedContent, pollLabel, legacyOriginal, legacyGranted,
  releaseRecipe,
  failRecipeReads(value: boolean) { failRecipes = value; },
  holdAsyncBlocks() {
    for (const kind of ['poll', 'quote'] as const) if (!asyncHolds.has(kind)) {
      let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; });
      asyncHolds.set(kind, { promise, release });
    }
    return asyncReads.length;
  },
  releaseAsyncBlock(kind: AsyncKind) { asyncHolds.get(kind)?.release(); asyncHolds.delete(kind); },
  holdLegacyGrant(denied = false) {
    let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; });
    grantHold = { promise, release, denied }; return grantReads.length;
  },
  releaseLegacyGrant() { grantHold?.release(); grantHold = null; },
  setQuoteMode(mode: typeof quoteMode) { quoteMode = mode; },
  holdRefresh() { holdRefresh = true; },
  release() { holdPage = false; holdRefresh = false; for (const release of [...pending]) release(); },
};
declare global { interface Window { __scrollFixture: typeof scrollFixture } }
window.__scrollFixture = scrollFixture;
localStorage.setItem('pc_autoplay', 'on');
const overlays = document.createElement('div');
document.body.append(overlays);
createRoot(overlays).render(<GlobalMediaLightbox />);
// Reuse the established real HomeFeed/Nav/TopBar/rails/Messages/composer shell.
// The service adapter and local router are the only synthetic application pieces.
void import('./social-fixture');
