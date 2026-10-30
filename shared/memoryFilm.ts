import { memoryPhotoDuration } from './memoryPlayback';
import { memoryStoryRecipe, memoryStoryStickers } from './memoryStoryPresentation';

export type MemoryFilmPage = {
  id: string; media_type?: string; media_url?: string | null; thumbnail_url?: string | null;
  caption?: string | null; story_caption?: string | null; duration_sec?: number | null; media_transform?: unknown;
  filter_id?: string | null; stickers?: unknown; text_background?: unknown;
};
export type MemoryFilmItem = {
  id: string; kind: 'image' | 'video' | 'text'; uri: string | null; poster: string | null;
  page: MemoryFilmPage; postId: string | null; author: string | null; excerpt: string | null;
};

/** Use the authorized, hydrated references; never synthesize a public storage URL. */
export function memoryFilmItems(pages: readonly MemoryFilmPage[]): MemoryFilmItem[] {
  return pages.map(page => {
    const post = memoryStoryStickers(page.stickers).find(sticker => sticker.kind === 'post');
    const own = typeof page.media_url === 'string' && page.media_url.length > 0;
    const uri = own ? page.media_url! : typeof post?.postMediaUrl === 'string' && post.postMediaUrl ? post.postMediaUrl : null;
    const kind = uri ? (own ? page.media_type : post?.postMediaType) === 'video' ? 'video' : 'image' : 'text';
    return {
      id: page.id, kind, uri, poster: page.thumbnail_url || (typeof post?.postThumbnailUrl === 'string' ? post.postThumbnailUrl : null),
      page, postId: typeof post?.postId === 'string' ? post.postId : null,
      author: typeof post?.postAuthorName === 'string' ? post.postAuthorName : typeof post?.postAuthor === 'string' ? post.postAuthor : typeof post?.authorName === 'string' ? post.authorName : null,
      excerpt: typeof post?.postText === 'string' ? post.postText : typeof post?.text === 'string' ? post.text : null,
    };
  });
}

/** Every page advances, including a one-page film. A loop gets a fresh playback key. */
export function memoryFilmStep(index: number, count: number, direction: 1 | -1) {
  if (!Number.isSafeInteger(count) || count <= 0) return { index: 0, wrapped: false };
  const current = Number.isFinite(index) ? Math.max(0, Math.min(count - 1, Math.floor(index))) : 0;
  const next = current + direction;
  return { index: (next + count) % count, wrapped: next < 0 || next >= count };
}

export function memoryFilmVideoWindow(page: MemoryFilmPage, actualDuration: number) {
  const recipe = memoryStoryRecipe(page.media_transform, actualDuration);
  // An absent metadata duration cannot manufacture completion; the media event supplies it.
  const end = recipe.end ?? (Number.isFinite(actualDuration) && actualDuration > 0 ? actualDuration : null);
  return { ...recipe, end, seconds: end == null ? null : Math.max(.05, (end - recipe.start) / recipe.speed) };
}

export function memoryFilmProgress(time: number, start: number, end: number | null) {
  return end == null || end <= start || !Number.isFinite(time) ? 0 : Math.min(1, Math.max(0, (time - start) / (end - start)));
}

export function memoryFilmPhotoDuration(item: MemoryFilmItem) { return memoryPhotoDuration(item.page); }

/** Only foreground playback counts towards a stalled-media deadline. */
export function createMemoryFilmProgressGuard(timeout = 20000) {
  let position = NaN, changedAt: number | null = null;
  return {
    reset() { position = NaN; changedAt = null; },
    stalled(time: number, now: number, expected: boolean) {
      if (!expected || !Number.isFinite(time) || !Number.isFinite(now)) {
        position = NaN; changedAt = null; return false;
      }
      if (changedAt == null || now < changedAt || !Number.isFinite(position) || Math.abs(time - position) > .001) {
        position = time; changedAt = now; return false;
      }
      return now - changedAt >= timeout;
    },
  };
}
export const MEMORY_SCORE_TITLE = 'Quiet light';
export const MEMORY_SCORE_DESCRIPTION = 'Original instrumental for Platinum Circles';
export const MEMORY_SCORE_VOLUME = .32;
export const MEMORY_SCORE_DUCK = .12;
