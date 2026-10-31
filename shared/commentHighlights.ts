type QueryResult = { data: unknown; error?: unknown };
type Client = { from(name: string): any };

/** Optional decoration cannot erase an otherwise readable comment thread. */
export async function loadCommentHighlights(client: Client, postId: string, authorId: string | null, ids: string[]) {
  const likedByAuthor = new Set<string>();
  const pinQuery = client.from('post_comment_pins').select('comment_id').eq('post_id', postId).maybeSingle();
  const likesQuery = async () => {
    if (!authorId || !ids.length) return;
    for (let offset = 0; offset < ids.length; offset += 100) {
      const result: QueryResult = await client.from('comment_reactions').select('comment_id').eq('user_id', authorId)
        .eq('value', 1).in('comment_id', ids.slice(offset, offset + 100));
      if (result.error) throw result.error;
      for (const row of (result.data ?? []) as { comment_id: string }[]) likedByAuthor.add(row.comment_id);
    }
  };
  const [pin, likes] = await Promise.allSettled([pinQuery as PromiseLike<QueryResult>, likesQuery()]);
  const pinResult = pin.status === 'fulfilled' && !pin.value.error ? pin.value.data as { comment_id?: string } | null : null;
  return { pinnedId: pinResult?.comment_id ?? null, likedByAuthor: likes.status === 'fulfilled' ? likedByAuthor : new Set<string>(),
    unavailable: pin.status === 'rejected' || !!(pin.status === 'fulfilled' && pin.value.error) || likes.status === 'rejected' };
}

export function pinnedFirst<T extends { id: string }>(comments: T[], pinnedId: string | null): T[] {
  if (!pinnedId) return comments;
  const pinned = comments.find(comment => comment.id === pinnedId);
  return pinned ? [pinned, ...comments.filter(comment => comment.id !== pinnedId)] : comments;
}
