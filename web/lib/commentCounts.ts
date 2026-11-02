import type { SupabaseClient } from "@supabase/supabase-js";
import { getNavigationStore } from './navigationCache';

export const COMMENT_COUNT_UPDATED = "pc-comment-count-updated";
export type CommentCountUpdate = { postId: string; count: number; confirmedAt?: number; ownerId?: string | null };

/** A batch started before a confirmed mutation cannot undo that mutation. */
export function reconcileLiveCommentCount(update: CommentCountUpdate, seed: number, requestedAt: number | undefined,
  liveOwner: string | undefined, owner: string | null): 'apply' | 'batch' | 'legacy' | 'ignore' {
  if (requestedAt === undefined) return 'legacy';
  if (!Number.isFinite(requestedAt) || liveOwner !== owner || (update.ownerId !== undefined && update.ownerId !== owner)) return 'ignore';
  if (!Number.isSafeInteger(seed) || seed < 0) return 'ignore';
  return requestedAt > (update.confirmedAt ?? Infinity) ? 'apply' : 'batch';
}

// Events carry server totals, never deltas. Only the latest read for a post may
// notify mounted cards, so overlapping mutations cannot apply an older total.
const pending = new Map<string, object>();

export async function refreshCommentCount(client: SupabaseClient, postId: string): Promise<void> {
  const navigation = getNavigationStore(), session = navigation.getSnapshot();
  const request = {};
  pending.set(postId, request);
  try {
    const { data, error } = await client.from("posts").select("comments_count").eq("id", postId).maybeSingle();
    const current = navigation.getSnapshot();
    if (pending.get(postId) !== request || error || !data || current.revision !== session.revision || current.scope !== session.scope) return;
    const count = data.comments_count;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return;
    window.dispatchEvent(new CustomEvent<CommentCountUpdate>(COMMENT_COUNT_UPDATED, { detail: { postId, count, confirmedAt: Date.now(), ownerId: current.owner } }));
    window.dispatchEvent(new CustomEvent('pc-feed-post-changed', { detail: { postId } }));
  } catch {
    // A failed reconciliation must not invent a count or alter the draft.
    // The next mutation or normal feed refresh can reconcile it again.
  } finally {
    if (pending.get(postId) === request) pending.delete(postId);
  }
}
