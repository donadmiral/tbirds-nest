import { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { VideoPlayer } from '../../components/VideoPlayer';
import { SharedPostThumbnail } from '../../components/SharedPostThumbnail';
import { useSharedPostPreview } from '../../lib/useSharedPostPreview';
import { createHomeFeedController } from '../../lib/homeFeedController';
import { createFeedSnapshotStore } from '../../../shared/feedSnapshot';
import { renewFeedMedia } from '../../../shared/feedMedia';
import { setDataSaver } from '../../lib/mediaPrefs';
import { service, original, granted, retainFeedMedia } from './media-readiness-adapter';
import type { FeedRow } from '../../lib/feed';
localStorage.setItem('pc_autoplay', 'off');
let letter = 'a', count = 0;
const row = (canonical = false): FeedRow => ({ post_id: 'feed-post', author_id: 'feed-author', content: 'Feed source ' + letter,
  media: [{ id: 'clip', url: canonical ? original(letter + '.mp4') : granted(letter + '.mp4'), media_type: 'video', edit: { coverUrl: granted(letter + '.svg'), trimStart: 1, trimEnd: 3 } }],
  likes_count: count, sort_key: 1, created_at: '2026-11-01T12:00:00Z', products: [], _mediaExpiresAt: canonical ? undefined : Date.now() + 180000 } as unknown as FeedRow);
const cache = createFeedSnapshotStore({ getItem: async () => null, setItem: async () => {}, removeItem: async () => {} });
const controller = createHomeFeedController({ rpc: async (name, args) => ({ data: name === 'get_feed' ? [row(true)] : (args.p_ids as string[]).map(post_id => ({ post_id, snapshot_eligible: true })), error: null }) },
  { owner: 'fixture-a', rows: [row()], mutedWords: [], error: null }, cache, undefined,
  rows => renewFeedMedia(rows, async values => values.map(value => ({ ...value, media: value.media.map(item => ({ ...item, url: granted(letter + '.mp4', 'b') })), _mediaExpiresAt: Date.now() + 180000 }))),
  null, { scope: () => 'fixture-a:1', retain: retainFeedMedia });
function Source({ id }: { id: string }) {
  const preview = useSharedPostPreview(id);
  return <section data-source-preview={id} className="flex gap-3 border p-3">
    <p>{preview?.content || 'Reading source'}</p><p>{preview?.author?.full_name || 'Author pending'}</p>
    {preview?.media ? <SharedPostThumbnail postId={id} media={preview.media} mediaCount={preview.mediaCount} /> : null}
  </section>;
}
function App() {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [source, setSource] = useState('a');
  const post = state.rows[0], media = post.media[0];
  (window as any).__mediaFixture = {
    refresh: async () => { count++; await controller.load(false, true); },
    switch: async (next: string) => { letter = next; await controller.load(false); },
    source: setSource, dataSaver: setDataSaver, ...service,
    visibility(hidden: boolean) { Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden }); document.dispatchEvent(new Event('visibilitychange')); },
  };
  return <main className="mx-auto max-w-3xl space-y-4 p-4">
    <h1>Actual media readiness components · synthetic transport</h1>
    <div data-feed-video className="h-[240px] w-[360px]"><VideoPlayer src={media.url} postId={post.post_id} edit={media.edit} width={360} height={240} mediaOverlay={<span data-moment-overlay className="absolute left-2 top-2">Current frame overlay</span>} /></div>
    <p data-count>{post.likes_count}</p>
    <Source id={source} />
    <div className="grid grid-cols-3 gap-3">{Array.from({ length: 6 }, (_, index) => <div key={index} data-warm-video={index} className="h-[120px] w-[160px]"><VideoPlayer src={granted('warm-' + index + '.mp4')} postId={'warm-' + index} /></div>)}</div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
