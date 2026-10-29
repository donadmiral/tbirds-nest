import type { SupabaseClient } from "@supabase/supabase-js";

export const COMMENT_COUNT_UPDATED = "pc-comment-count-updated";
export type CommentCountUpdate = { postId: string; count: number };

// Events carry server totals, never deltas. Only the latest read for a post may
// notify mounted cards, so overlapping mutations cannot apply an older total.
const pending = new Map<string, object>();

export async function refreshCommentCount(client: SupabaseClient, postId: string): Promise<void> {
  const request = {};
  pending.set(postId, request);
  try {
    const { data, error } = await client.from("posts").select("comments_count").eq("id", postId).maybeSingle();
    if (pending.get(postId) !== request || error || !data) return;
    const count = data.comments_count;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return;
    window.dispatchEvent(new CustomEvent<CommentCountUpdate>(COMMENT_COUNT_UPDATED, { detail: { postId, count } }));
  } catch {
    // A failed reconciliation must not invent a count or alter the draft.
    // The next mutation or normal feed refresh can reconcile it again.
  } finally {
    if (pending.get(postId) === request) pending.delete(postId);
  }
}
