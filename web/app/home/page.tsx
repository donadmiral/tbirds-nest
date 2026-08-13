"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { FeedRow } from "@/lib/feed";
import { PostCard } from "@/components/PostCard";
import { StoryRings } from "@/components/StoryRings";
import { Composer } from "@/components/Composer";

const PAGE_SIZE = 20;
const MODES = [
  { key: "for_you", label: "For You" },
  { key: "latest", label: "Latest" },
  { key: "innovation", label: "Innovation" },
  { key: "trending", label: "Trending" },
] as const;

function Skeleton() {
  return (
    <div className="animate-pulse border-b border-white/10 px-1 py-5">
      <div className="flex gap-3">
        <div className="h-11 w-11 rounded-full bg-surface" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-3 w-40 rounded bg-surface" />
          <div className="h-3 w-full rounded bg-surface" />
          <div className="h-3 w-2/3 rounded bg-surface" />
        </div>
      </div>
    </div>
  );
}

export default function HomeFeed() {
  const supabase = useRef(createClient()).current;
  const [mode, setMode] = useState<(typeof MODES)[number]["key"]>("for_you");
  const [posts, setPosts] = useState<FeedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef<{ key: number; id: string } | null>(null);

  const load = useCallback(
    async (more: boolean) => {
      if (more) setLoadingMore(true);
      else {
        setLoading(true);
        cursor.current = null;
      }
      setError(null);
      const { data, error } = await supabase.rpc("get_feed", {
        p_mode: mode,
        p_cursor_key: more ? cursor.current?.key ?? null : null,
        p_cursor_id: more ? cursor.current?.id ?? null : null,
        p_limit: PAGE_SIZE,
      });
      if (error) {
        setError(error.message);
      } else {
        const rows = (data ?? []) as FeedRow[];
        setPosts((prev) => (more ? [...prev, ...rows] : rows));
        if (rows.length > 0) {
          const last = rows[rows.length - 1];
          cursor.current = { key: last.sort_key, id: last.post_id };
        }
        setHasMore(rows.length >= PAGE_SIZE);
      }
      setLoading(false);
      setLoadingMore(false);
    },
    [mode, supabase]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  return (
    <div>
      <StoryRings />
      <Composer onPosted={() => load(false)} />
      <div className="sticky top-0 z-10 -mx-1 flex border-b border-white/10 bg-ink/90 px-1 backdrop-blur">
        {MODES.map((m) => (
          <button key={m.key}
            onClick={() => setMode(m.key)}
            className={
              "flex-1 py-4 text-[15px] transition-colors " +
              (mode === m.key ? "font-semibold text-white" : "text-white/50 hover:text-white/80")
            }
          >
            <span className={"border-b-2 pb-3 " + (mode === m.key ? "border-pearl" : "border-transparent")}>
              {m.label}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div>
          <Skeleton />
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 pt-24 text-center">
          <p className="text-sm text-white/70">The feed could not load.</p>
          <p className="text-xs text-white/40">{error}</p>
          <button onClick={() => load(false)} className="rounded-md bg-surface px-4 py-2 text-sm text-white hover:bg-surface-elevated">
            Try again
          </button>
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 pt-24 text-center">
          <p className="text-[15px] text-white/70">Nothing here yet.</p>
          <p className="text-sm text-white/40">New posts will appear here.</p>
        </div>
      ) : (
        <div>
          {posts.map((p) => (
            <PostCard key={p.post_id} post={p} />
          ))}
          {hasMore ? (
            <div className="flex justify-center py-6">
              <button onClick={() => load(true)}
                disabled={loadingMore}
                className="rounded-md bg-surface px-5 py-2.5 text-sm text-white transition-colors hover:bg-surface-elevated disabled:opacity-40"
              >
                {loadingMore ? "Loading" : "Load more"}
              </button>
            </div>
          ) : (
            <p className="py-8 text-center text-xs text-white/30">You are all caught up.</p>
          )}
        </div>
      )}
    </div>
  );
}