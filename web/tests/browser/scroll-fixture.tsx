/** Local-only wheel regression fixture. Actual application components; synthetic records and services. */
import type { FeedRow } from '../../lib/feed';
import { createRoot } from 'react-dom/client';
import { GlobalMediaLightbox } from '../../components/GlobalMediaLightbox';
import { createClient, posts } from './social-backend';

const id = (index: number) => `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const mediaId = (index: number) => `80000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const base = posts[0];
const rows: FeedRow[] = Array.from({ length: 36 }, (_, index) => {
  const video = index === 1 || index > 1 && index % 3 === 0;
  return {
    ...base, post_id: id(index + 1), sort_key: 1000 - index,
    content: `Wheel verification post ${index + 1}. Synthetic content for stable scrolling.`,
    created_at: new Date(Date.now() - (index + 1) * 3600000).toISOString(),
    media: [{ id: mediaId(index + 1),
      url: index === 0 ? '/delayed-image.svg' : index === 1 ? '/delayed-video.mp4' : video ? `/video.mp4?post=${index + 1}` : `/coast.svg?post=${index + 1}`,
      media_type: video ? 'video' : 'image', width: index < 2 ? null : 1200, height: index < 2 ? null : 720, sort_order: 0 }],
  };
});
// The initial server page has twenty rows. The actual HomeFeed controller requests
// page two from its real IntersectionObserver as the wheel approaches the end.
posts.splice(0, posts.length, ...rows.slice(0, 20));

type MetadataRead = { table: string; ids: string[]; postId: string | null };
type FeedRequest = { cursor: string | null; held: boolean; finished: boolean; aborted: boolean };
const metadataReads: MetadataRead[] = [];
const feedRequests: FeedRequest[] = [];
let holdPage = true, holdRefresh = false;
let releaseRecipe!: () => void;
const recipeReady = new Promise<void>(resolve => { releaseRecipe = resolve; });
const pending = new Set<() => void>();
const synthetic = createClient() as unknown as {
  from: (table: string) => { eq: (key: string, value: unknown) => unknown; in: (key: string, value: string[]) => unknown;
    then: (yes: (value: unknown) => unknown, no?: (reason: unknown) => unknown) => Promise<unknown> };
  rpc: (name: string, args?: Record<string, unknown>) => unknown;
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
    query.then = (yes, no) => table === 'post_media' && read.postId === id(1)
      ? recipeReady.then(() => ({ data: [{ id: mediaId(1), edit: { aspectRatio: 1, scale: 2 } }], error: null })).then(yes, no)
      : then(yes, no);
  }
  return query;
};
synthetic.rpc = (name, args = {}) => {
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

const scrollFixture = {
  metadataReads, feedRequests,
  releaseRecipe,
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
