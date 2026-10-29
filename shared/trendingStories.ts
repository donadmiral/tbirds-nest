/** Ranked IDs are hints; only current, resolved story rows become visible tiles. */
export type TrendingStory = {
  story_id: string; user_id: string; full_name: string; username: string;
  avatar_url: string | null; views: number; reactions: number; heat: number;
  thumb?: string | null; media_type?: string | null; expires_at?: string;
  created_at?: string;
};
export type TrendingStoryMedia = {
  id: string; user_id: string; media_type: string; media_url: string | null;
  thumbnail_url: string | null; expires_at: string; created_at: string;
};
type Result = { data: unknown; error: unknown };
type TrendingSource = {
  session(): PromiseLike<{ data: { session: { user: { id: string } } | null }; error: unknown }>;
  ranked(limit: number): PromiseLike<Result>;
  stories(ids: string[]): PromiseLike<Result>;
};

export function resolveTrendingStories(ranked: TrendingStory[], stories: TrendingStoryMedia[], now = Date.now()): TrendingStory[] {
  const current = new Map(stories.map(story => [story.id, story]));
  const authors = new Set<string>();
  return ranked.flatMap(row => {
    const story = current.get(row.story_id);
    if (!story || story.user_id !== row.user_id || authors.has(row.user_id)
      || !(Date.parse(story.expires_at) > now)
      || !['text', 'image', 'video'].includes(story.media_type)
      || (story.media_type !== 'text' && !story.media_url)) return [];
    authors.add(row.user_id);
    return [{ ...row, media_type: story.media_type, expires_at: story.expires_at,
      created_at: story.created_at,
      thumb: story.thumbnail_url || (story.media_type === 'image' ? story.media_url : null) }];
  });
}

async function bounded<T>(request: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(request), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Stories took too long to load.')), 15000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function loadTrendingStories(source: TrendingSource,
  hydrate: (rows: TrendingStoryMedia[]) => Promise<TrendingStoryMedia[]>, limit = 8): Promise<TrendingStory[]> {
  const initial = await bounded(source.session());
  const viewer = initial.data.session?.user.id;
  if (initial.error || !viewer) return [];
  const ranking = await bounded(source.ranked(limit));
  if (ranking.error) throw new Error('Trending stories could not be loaded.');
  const ranked = Array.isArray(ranking.data) ? ranking.data as TrendingStory[] : [];
  if (!ranked.length) return [];
  const result = await bounded(source.stories(ranked.map(row => row.story_id)));
  if (result.error) throw new Error('Story previews could not be loaded.');
  const resolved = await bounded(hydrate(Array.isArray(result.data) ? result.data as TrendingStoryMedia[] : []));
  const latest = await bounded(source.session());
  if (latest.error || latest.data.session?.user.id !== viewer) return [];
  return resolveTrendingStories(ranked, resolved);
}
