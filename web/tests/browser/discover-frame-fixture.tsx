import { createRoot } from 'react-dom/client';
import { DiscoverTile } from '../../components/DiscoverTile';
import { setDataSaver } from '../../lib/mediaPrefs';
import { service } from './discover-frame-adapter';
import type { FeedRow } from '../../lib/feed';
const origin = process.env.FIXTURE_MEDIA_ORIGIN as string;
const row = (id: string, url: string, edit?: object): FeedRow => ({ post_id: 'post-' + id, author_id: 'author', content: 'Clip ' + id, body: null, media_url: url,
  media: [{ id: 'media-' + id, url, media_type: 'video', width: 160, height: 120, sort_order: 0, ...(edit ? { edit } : {}) }], products: [], link: null, channel: null, article_title: null, read_minutes: null,
  quoted_post_id: null, thread_parent_id: null, created_at: '2026-11-01T12:00:00Z', likes_count: 0, comments_count: 0, reposts_count: 0, bookmarks_count: 0, views_count: 0, is_trending: false,
  author_name: 'Fixture author', author_username: 'fixture', author_avatar: null, author_verified: false, author_kind: null, author_verified_tier: null,
  viewer_liked: false, viewer_bookmarked: false, viewer_reposted: false, viewer_follows: false, sort_key: 1, innovation_field: null, innovation_stage: null });
// every decode makes one video element; counting them shows a frame was decoded again rather than recalled
let decodes = 0; const create = document.createElement.bind(document);
document.createElement = ((tag: string, options?: ElementCreationOptions) => { if (String(tag).toLowerCase() === 'video') decodes++; return create(tag, options); }) as typeof document.createElement;
(window as any).__frameFixture = { dataSaver: setDataSaver, ...service, get decodes() { return decodes; } };
function App() {
  return <main className="mx-auto max-w-3xl p-4">
    <h1>Actual Discover tiles · synthetic transport and local video bytes</h1>
    <div className="grid grid-cols-2 gap-4">
      <div data-tile="red"><DiscoverTile post={row('red', origin + '/red.mp4')} /></div>
      <div data-tile="blue"><DiscoverTile post={row('blue', origin + '/blue.mp4', { coverUrl: origin + '/missing-cover.jpg' })} /></div>
      <div data-tile="green"><DiscoverTile post={row('green', origin + '/green.mp4', { trimStart: 2 })} /></div>
      <div data-tile="sealed"><DiscoverTile post={row('sealed', origin + '/sealed.mp4', {trimStart:2})} /></div>
      <div data-tile="slow"><DiscoverTile post={row('slow', origin + '/slow.mp4')} /></div>
    </div>
    <div style={{ height: 2600 }} aria-hidden="true" />
    <div className="grid grid-cols-2 gap-4"><div data-tile="far"><DiscoverTile post={row('far', origin + '/far.mp4')} /></div></div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
