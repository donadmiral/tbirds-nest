// Direct table ops, mirroring mobile. Count columns are trigger-maintained.
import { createClient } from "@/lib/supabase/client";

/**
 * The signed-in user's id, read fresh every time.
 *
 * This used to be cached in a module variable for the life of the tab. Next
 * keeps modules alive across client navigations, so after switching accounts
 * (Don to Intobank, say) every like, bookmark and repost was still written
 * under the previous user's id. Row-level security rejects an insert whose
 * user_id is not auth.uid(), so the button flipped back and nothing was saved,
 * with no error anywhere. getSession reads local storage, not the network, so
 * there is nothing to gain from caching it.
 */
export async function getViewerId(): Promise<string | null> {
  try {
    const { data } = await createClient().auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

type Table = "post_likes" | "post_bookmarks" | "post_reposts";

async function toggle(table: Table, postId: string, on: boolean): Promise<boolean> {
  const supabase = createClient();
  const userId = await getViewerId();
  if (!userId) return false;
  const { error } = on
    ? await supabase.from(table).insert({ post_id: postId, user_id: userId })
    : await supabase.from(table).delete().eq("post_id", postId).eq("user_id", userId);
  return !error;
}

export const toggleLike = (id: string, on: boolean) => toggle("post_likes", id, on);
export const toggleBookmark = (id: string, on: boolean) => toggle("post_bookmarks", id, on);
export const toggleRepost = (id: string, on: boolean) => toggle("post_reposts", id, on);