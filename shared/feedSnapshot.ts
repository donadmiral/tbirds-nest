/** A small, account-bound copy of public feed content. Never an authorization cache. */
export const FEED_SNAPSHOT_VERSION = 1;
export const FEED_SNAPSHOT_MAX_AGE = 15 * 60_000;
export const FEED_SNAPSHOT_LIMIT = 20;
const MAX_BYTES = 160_000;
const MODES = ['forYou', 'latest', 'trending'] as const;
type Mode = typeof MODES[number];
type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
};
type Row = Record<string, any>;
export type FeedSnapshot = { version: number; owner: string; mode: Mode; savedAt: number; rows: Row[] };
const key = (owner: string, mode: string) => `pc-feed-v${FEED_SNAPSHOT_VERSION}:${owner}:${mode}`;
const text = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : null;
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const publicUrl = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 2048) return null;
  // Signed/private URLs and credentials must not become durable feed data.
  if (/\/storage\/v1\/object\/public\/(post-media|story-media|media)\//i.test(value)) return null;
  return /^https:\/\/[^/?#@]+\/storage\/v1\/object\/public\//i.test(value) && !/[?#]/.test(value) ? value : null;
};

/** The caller must establish public post AND public author visibility first. */
export function publicSnapshotRows(rows: Row[], eligible: Set<string>): Row[] {
  const seen = new Set<string>();
  return rows.flatMap(row => {
    if (!row || typeof row.post_id !== 'string' || typeof row.author_id !== 'string'
      || !eligible.has(row.post_id) || seen.has(row.post_id) || seen.size >= FEED_SNAPSHOT_LIMIT) return [];
    seen.add(row.post_id);
    const media = (Array.isArray(row.media) ? row.media : []).slice(0, 10).flatMap((item: Row) => {
      const url = publicUrl(item?.url);
      if (!url || !['image', 'video'].includes(item.media_type)) return [];
      return [{ id: text(item.id, 80) ?? url, url, media_type: item.media_type,
        width: count(item.width) || null, height: count(item.height) || null,
        sort_order: count(item.sort_order), is_sensitive: item.is_sensitive === true,
        edit: publicUrl(item.edit?.coverUrl) ? { coverUrl: publicUrl(item.edit.coverUrl) } : null }];
    });
    return [{ post_id: row.post_id, author_id: row.author_id,
      content: text(row.content ?? row.body, 12_000) ?? '', created_at: text(row.created_at, 40),
      author_name: text(row.author_name, 160), author_username: text(row.author_username, 80),
      author_avatar: publicUrl(row.author_avatar), author_verified: row.author_verified === true,
      author_verified_tier: text(row.author_verified_tier, 40),
      likes_count: count(row.likes_count), comments_count: count(row.comments_count),
      reposts_count: count(row.reposts_count), bookmarks_count: count(row.bookmarks_count),
      views_count: count(row.views_count), shares_count: count(row.shares_count),
      article_title: text(row.article_title, 300), channel: text(row.channel, 80),
      media_url: publicUrl(row.media_url), media, is_trending: row.is_trending === true,
      // These flags are bound to the owner, not shared with another account.
      viewer_liked: row.viewer_liked === true, viewer_bookmarked: row.viewer_bookmarked === true,
      viewer_reposted: row.viewer_reposted === true, products: [] }];
  });
}

export function createFeedSnapshotStore(storage: Storage, now = Date.now) {
  let owner: string | null = null;
  let generation = 0;
  // Serialize writes and purges: a slow old write cannot resurrect a signed-out account.
  let mutations: Promise<unknown> = Promise.resolve();
  const enqueue = (action: () => Promise<unknown>) => {
    mutations = mutations.catch(() => {}).then(action).catch(() => {});
    return mutations;
  };
  const valid = (account: string, token: number) => owner === account && generation === token;
  return {
    revision: () => generation,
    setAccount(next: string | null) {
      if (owner === next) return;
      const previous = owner;
      owner = next;
      generation++;
      if (previous) enqueue(() => Promise.all(MODES.map(mode => storage.removeItem(key(previous, mode)))));
    },
    async read(account: string, mode: string): Promise<FeedSnapshot | null> {
      if (!MODES.includes(mode as Mode) || owner !== account) return null;
      const token = generation;
      try {
        await mutations;
        if (!valid(account, token)) return null;
        const raw = await storage.getItem(key(account, mode));
        if (!valid(account, token) || !raw || raw.length > MAX_BYTES) return null;
        const value = JSON.parse(raw);
        if (value.version !== FEED_SNAPSHOT_VERSION || value.owner !== account || value.mode !== mode
          || !Number.isFinite(value.savedAt) || value.savedAt > now() || now() - value.savedAt > FEED_SNAPSHOT_MAX_AGE
          || !Array.isArray(value.rows)) return null;
        const rows = publicSnapshotRows(value.rows, new Set(value.rows.map((r: Row) => r?.post_id)));
        return rows.length ? { version: FEED_SNAPSHOT_VERSION, owner: account, mode: mode as Mode, savedAt: value.savedAt, rows } : null;
      } catch { return null; }
    },
    write(account: string, mode: string, rows: Row[], eligible: Set<string>, expectedRevision = generation) {
      if (!MODES.includes(mode as Mode) || owner !== account || expectedRevision !== generation) return Promise.resolve();
      const token = generation;
      const selected = publicSnapshotRows(rows, eligible);
      const snapshot: FeedSnapshot = { version: FEED_SNAPSHOT_VERSION, owner: account, mode: mode as Mode, savedAt: now(), rows: selected };
      // Keep valid JSON when long articles fill the byte budget.
      while (snapshot.rows.length && JSON.stringify(snapshot).length > MAX_BYTES) snapshot.rows.pop();
      return enqueue(async () => {
        if (!valid(account, token)) return;
        if (!snapshot.rows.length) return storage.removeItem(key(account, mode));
        return storage.setItem(key(account, mode), JSON.stringify(snapshot));
      });
    },
    clear(account: string) {
      if (owner === account) generation++;
      return enqueue(() => Promise.all(MODES.map(mode => storage.removeItem(key(account, mode)))));
    },
  };
}

/** Refresh existing rows in place. Hold new rows until the reader asks for them. */
export function mergeFeedRefresh<T extends { id: string }>(current: T[], incoming: T[], preservePosition: boolean) {
  const unique = Array.from(new Map(incoming.map(row => [row.id, row])).values());
  if (!preservePosition || current.length === 0) return { rows: unique, pending: [] as T[] };
  const next = new Map(unique.map(row => [row.id, row]));
  const present = new Set(current.map(row => row.id));
  return { rows: current.map(row => next.get(row.id) ?? row), pending: unique.filter(row => !present.has(row.id)) };
}

/** Never fetch video bytes speculatively. Prefetch a small number of public posters/images. */
export function feedPrefetchUrls(rows: Row[], start: number, dataSaver: boolean): string[] {
  if (dataSaver) return [];
  const urls = new Set<string>();
  for (const row of rows.slice(Math.max(0, start), Math.max(0, start) + 3)) {
    for (const media of (Array.isArray(row.media) ? row.media : []).slice(0, 2)) {
      if (media.is_sensitive) continue;
      const candidate = media.media_type === 'video' ? media.edit?.coverUrl : media.url;
      // A signed URL may be prefetched in memory while authorized, never saved in snapshots.
      const signed = typeof candidate === 'string' && /^https:\/\/[^/?#@]+\/storage\/v1\/object\/sign\/(post-media|story-media|media)\/[^#]+\?token=[^#]+$/i.test(candidate);
      const url = signed ? candidate : publicUrl(candidate);
      if (url) urls.add(url);
      if (urls.size === 4) return [...urls];
    }
  }
  return [...urls];
}
