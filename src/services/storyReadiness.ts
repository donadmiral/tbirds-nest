import { Image } from 'react-native';
import { createNavigationCache } from '../../shared/navigationCache';
import { privateImageCachePolicy } from '../../shared/mediaDelivery';
import { storyPrefetchUrls } from '../../shared/storyPlayback';
import { clearStoryVideoWarmPool, prewarmStoryVideo } from '../../modules/boomerang/storyVideo';
import { navigationScope, subscribeNavigationScope } from '../lib/navigationCache';
import { storiesService, type StoryRow } from './storiesService';

type ProfilePreview = { user_id?: string; id?: string; full_name?: string | null; username?: string | null; avatar_url?: string | null };
type Entry = { stories: StoryRow[]; profile: ProfilePreview | null };
const cache = createNavigationCache({ maxEntries: 3, maxAgeMs: 20_000 });
const warmImages = new Set<string>();

function scope() { const current = navigationScope(); cache.setScope(current); return current; }
subscribeNavigationScope(() => { cache.setScope(navigationScope()); warmImages.clear(); clearStoryVideoWarmPool(); });
const fresh = (entry: Entry) => entry.stories.every(story => Date.parse(story.expires_at) > Date.now()
  && (!(story as any)._mediaExpiresAt || (story as any)._mediaExpiresAt > Date.now() + 5000));

/** Warm only already-authorized media, with no private image disk writes. */
export function prewarmStoryMedia(story: StoryRow | undefined) {
  const current = scope();
  if (!current || !story || Date.parse(story.expires_at) <= Date.now()) return;
  for (const uri of storyPrefetchUrls(story)) {
    if (privateImageCachePolicy(uri) === 'none' || warmImages.has(uri)) continue;
    if (warmImages.size >= 64) warmImages.delete(warmImages.values().next().value!);
    warmImages.add(uri);
    void Image.prefetch(uri).then(ok => { if (!ok) warmImages.delete(uri); }, () => warmImages.delete(uri));
  }
  if (story.media_type === 'video') prewarmStoryVideo(story.media_url, current,
    Math.min(Date.parse(story.expires_at), (story as any)._mediaExpiresAt || Infinity));
}

/** The strip starts one bounded read before navigation; a tap joins that read. */
export function prefetchStoryEntry(userId: string, profile: ProfilePreview | null = null): Promise<Entry | null> {
  const current = scope();
  if (!current || !userId) return Promise.resolve(null);
  const saved = cache.read<Entry>(current, userId);
  if (saved && fresh(saved)) return Promise.resolve(saved);
  const pending = cache.pending<Entry>(current, userId);
  if (pending) return pending.catch(() => null);
  return cache.load(current, userId, async signal => {
    const stories = await storiesService.getUserStories(userId);
    if (signal.aborted || scope() !== current) throw new Error('The story session changed.');
    const start = Math.max(0, stories.findIndex(story => !story.is_viewed));
    stories.slice(start, start + 2).forEach(prewarmStoryMedia);
    return { stories, profile };
  }).catch(() => null);
}

/** Transfer a prefetched entry once. Later visits recheck server permissions. */
export async function takeStoryEntry(userId: string): Promise<Entry | null> {
  const current = scope();
  if (!current) return null;
  const saved = cache.read<Entry>(current, userId) || await cache.pending<Entry>(current, userId)?.catch(() => null);
  if (scope() !== current) return null;
  cache.remove(current, userId);
  return saved && fresh(saved) ? saved : null;
}

export function invalidateStoryEntries() { cache.clear(); warmImages.clear(); clearStoryVideoWarmPool(); }
