"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { toggleBookmark, toggleLike } from "@/lib/interactions";
import { createPostInteractionStore, type PostInteractionSeed } from "@/lib/postInteractionState";

let store: ReturnType<typeof createPostInteractionStore> | undefined;
function sharedStore() {
  return store ??= createPostInteractionStore(createClient(), { like: toggleLike, bookmark: toggleBookmark });
}
const serverSnapshot = () => null;

export function usePostInteractions(postId: string, seed: PostInteractionSeed) {
  const shared = sharedStore();
  const subscribe = useCallback((listener: () => void) => shared.subscribe(postId, listener), [shared, postId]);
  const snapshot = useCallback(() => shared.snapshot(postId), [shared, postId]);
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const { liked, bookmarked, likesCount, bookmarksCount } = seed;
  useEffect(() => { shared.seed(postId, { liked, bookmarked, likesCount, bookmarksCount }); }, [shared, postId, liked, bookmarked, likesCount, bookmarksCount]);
  return {
    ...(value ?? { ...seed, bookmarksCount: bookmarksCount ?? 0, pending: false, error: null, uncertain: false }),
    setLike: (on: boolean) => shared.set(postId, "like", on),
    setBookmark: (on: boolean) => shared.set(postId, "bookmark", on),
    retry: () => shared.refresh(postId),
  };
}
