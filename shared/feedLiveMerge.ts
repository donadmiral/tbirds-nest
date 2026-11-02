type Stamps = Record<string, number>;
export type FeedLiveFence = { denied: Stamps; applied: Stamps; mutated: Stamps; pending: (id: string) => boolean; floor?: number };
type Post = { id: string; content: string; likes_count: number; comments_count: number; reposts_count: number;
  bookmarks_count: number; shares_count?: number; views_count?: number };

export function feedSnapshotFresh(id: string, requestedAt: number, fence: FeedLiveFence) {
  return (fence.floor ?? -1) < requestedAt && (fence.denied[id] ?? -1) < requestedAt && (fence.applied[id] ?? -1) <= requestedAt
    && (fence.mutated[id] ?? -1) < requestedAt && !fence.pending(id);
}

/** Apply after every asynchronous hydrate, immediately before publishing rows.
 * Preserve refreshed media, stable ordering and newer authorized/social state. */
export function mergeNativeFeedLive<T extends Post>(incoming: T[], current: T[], requestedAt: number, fence: FeedLiveFence): T[] {
  const byId = new Map(current.map(post => [post.id, post]));
  if (requestedAt <= (fence.floor ?? -1)) return incoming.flatMap(post => byId.has(post.id) ? [byId.get(post.id)!] : []);
  return incoming.filter(post => (fence.denied[post.id] ?? -1) < requestedAt).map(post => {
    const latest = byId.get(post.id);
    if (!latest) return post;
    const live = (fence.applied[post.id] ?? -1) > requestedAt;
    const own = (fence.mutated[post.id] ?? -1) >= requestedAt || fence.pending(post.id);
    if (!live && !own) return post;
    return { ...post, likes_count: latest.likes_count, reposts_count: latest.reposts_count,
      bookmarks_count: latest.bookmarks_count, shares_count: latest.shares_count,
      ...(live ? { content: latest.content, comments_count: latest.comments_count, views_count: latest.views_count } : {}) };
  });
}
