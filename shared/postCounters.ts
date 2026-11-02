export type PostCounters = { post_id: string; likes_count: number; comments_count: number;
  reposts_count: number; bookmarks_count: number; views_count: number; shares_count?: number; quotes_count?: number };
type Result = { data: unknown; error: { code?: string; message?: string } | null };
type Client = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<Result> };

/** Counter shards are authoritative. Legacy reads are allowed only while the
 * reader is absent, before the server can enable distributed writes. */
export async function readPostCounters(client: Client, ids: string[], legacy: () => Promise<PostCounters[]>): Promise<PostCounters[]> {
  const selected = [...new Set(ids.filter(Boolean))];
  if (selected.length > 100) throw new Error('Counter reads are limited to 100 posts.');
  if (!selected.length) return [];
  const result = await client.rpc('get_post_engagement_counts_v1', { p_ids: selected });
  if (result.error) {
    if (result.error.code === 'PGRST202' || result.error.code === '42883') return legacy();
    throw new Error('Post interactions could not be checked. Please retry.');
  }
  if (!Array.isArray(result.data) || new Set(result.data.map(row => row?.post_id)).size !== result.data.length
    || result.data.some(row => !row || !selected.includes(row.post_id)
    || ['likes_count', 'comments_count', 'reposts_count', 'bookmarks_count', 'views_count'].some(key => !Number.isSafeInteger(row[key]) || row[key] < 0)
    || ['shares_count', 'quotes_count'].some(key => row[key] !== undefined && (!Number.isSafeInteger(row[key]) || row[key] < 0)))) {
    throw new Error('Post interactions could not be checked. Please retry.');
  }
  return result.data as PostCounters[];
}

/** Keep one identifier for one completed share action. A caller may retry this
 * request with the same identifier without counting that share a second time. */
export async function recordPostShare(client: Client, postId: string, eventId: string): Promise<number | null> {
  if (!postId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) {
    throw new Error('A valid share identifier is required.');
  }
  const result = await client.rpc('record_post_share_v1', { p_post_id: postId, p_event_id: eventId });
  if (result.error?.code === 'PGRST202' || result.error?.code === '42883') {
    const legacy = await client.rpc('increment_share_count', { p_post_id: postId });
    if (legacy.error) throw new Error('The share count could not be confirmed.');
    return null;
  }
  if (result.error || !Number.isSafeInteger(result.data) || Number(result.data) < 0) {
    throw new Error('The share count could not be confirmed.');
  }
  return Number(result.data);
}
