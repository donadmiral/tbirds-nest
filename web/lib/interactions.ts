// Direct table ops, mirroring mobile. Count columns are trigger-maintained.
import { createClient } from "@/lib/supabase/client";

let viewerIdPromise: Promise<string | null> | null = null;

export function getViewerId(): Promise<string | null> {
  if (!viewerIdPromise) {
    viewerIdPromise = createClient()
      .auth.getSession()
      .then(({ data }) => data.session?.user.id ?? null)
      .catch(() => null);
  }
  return viewerIdPromise;
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