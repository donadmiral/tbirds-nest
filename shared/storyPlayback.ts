export const STORY_LOAD_TIMEOUT_MS = 12000;
export const STORY_STALL_NOTICE_MS = 900;

/** Bound a read without allowing its late result to change the visible story. */
export async function withStoryTimeout<T>(work: PromiseLike<T>, timeoutMs = STORY_LOAD_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(work),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('This story is taking too long to load. Please retry.')), timeoutMs);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

/** The saved trim is measured in source seconds, including when playback speed changes. */
export function storyVideoWindow(duration: number, declaredDuration: number | null | undefined, trimStart?: number | null, trimEnd?: number | null) {
  const available = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const requestedStart = Number.isFinite(trimStart) ? Math.max(0, trimStart!) : 0;
  const start = available ? Math.min(requestedStart, Math.max(0, available - .05)) : requestedStart;
  const requestedEnd = Number.isFinite(trimEnd) && trimEnd! > start ? trimEnd! : available || start + (declaredDuration && declaredDuration > 0 ? declaredDuration : 30);
  const end = Math.max(start + .05, Math.min(start + 30, requestedEnd, available || Infinity));
  return { start, end, duration: end - start };
}

export type StoryMediaStatus = 'loading' | 'ready' | 'error' | 'removed';

/** Warm the same image cache used by photos, posters and embedded story cards. */
export function storyPrefetchUrls(story: { media_type?: string; media_url?: string | null; thumbnail_url?: string | null; dual_front_url?: string | null; stickers_json?: any[] | null } | undefined): string[] {
  if (!story) return [];
  const urls = [story.media_type === 'image' ? story.media_url : story.thumbnail_url, story.dual_front_url];
  for (const sticker of story.stickers_json || []) {
    if (sticker.kind === 'post') urls.push(sticker.postMediaType === 'video' ? sticker.postThumbnailUrl : sticker.postMediaUrl);
    if (sticker.kind === 'photo') urls.push(sticker.photoUrl || sticker.photoUri);
    if (sticker.kind === 'story') urls.push(sticker.storyThumbUrl || (sticker.storyMediaType === 'image' ? sticker.storyMediaUrl : null));
  }
  return [...new Set(urls.filter((url): url is string => typeof url === 'string' && /^https?:\/\//.test(url)))];
}

/** One instance belongs to one mounted story/retry. Old callbacks retain their old instance. */
export class StoryPlaybackScope {
  readonly assets = new Map<string, StoryMediaStatus>();
  primaryReady: boolean;
  buffering = false;
  failed = false;
  completed = false;
  active = true;
  constructor(readonly key: string, textOnly: boolean) { this.primaryReady = textOnly; }
  report(id: string, status: StoryMediaStatus) {
    if (status === 'removed') this.assets.delete(id);
    else this.assets.set(id, status);
  }
  get error() { return this.failed || [...this.assets.values()].some(status => status === 'error'); }
  get ready() { return this.active && this.primaryReady && !this.error && !this.buffering && [...this.assets.values()].every(status => status === 'ready'); }
  canRun(paused: boolean) { return this.ready && !paused && !this.completed; }
  finish(paused: boolean) {
    if (!this.canRun(paused)) return false;
    this.completed = true;
    return true;
  }
}
