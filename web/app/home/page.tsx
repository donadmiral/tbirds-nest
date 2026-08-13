"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
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

const EMPTY_COPY: Record<string, { title: string; sub: string }> = {
  for_you: { title: "Nothing here yet.", sub: "Follow people and your feed builds itself." },
  latest: { title: "Nothing here yet.", sub: "New posts will appear here." },
  innovation: { title: "No innovation posts yet.", sub: "Zimbabwe's builders, inventions and STEM work land here." },
  trending: { title: "Nothing is trending right now.", sub: "Check back soon." },
};

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
  const [pendingNew, setPendingNew] = useState(0);
  const [quote, setQuote] = useState<{ id: string; author: string; text: string } | null>(null);
  const cursor = useRef<{ key: number; id: string } | null>(null);
  const uidRef = useRef<string | null>(null);
  const hiddenRef = useRef<Set<string>>(new Set());
  const seenPendingRef = useRef<Set<string>>(new Set());
  const seenSentRef = useRef<Set<string>>(new Set());
  const seenObserverRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(false);
  const newDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (more: boolean) => {
      if (more) { setLoadingMore(true); loadingMoreRef.current = true; }
      else {
        setLoading(true);
        cursor.current = null;
        setPendingNew(0);
      }
      setError(null);
      if (uidRef.current === null) {
        const { data: sess } = await supabase.auth.getSession();
        uidRef.current = sess.session?.user.id ?? null;
      }
      if (!more && uidRef.current) {
        const { data: hid } = await supabase.from("hidden_posts").select("post_id").eq("user_id", uidRef.current);
        hiddenRef.current = new Set((hid ?? []).map((h) => h.post_id as string));
      }
      const { data, error } = await supabase.rpc("get_feed", {
        p_mode: mode,
        p_cursor_key: more ? cursor.current?.key ?? null : null,
        p_cursor_id: more ? cursor.current?.id ?? null : null,
        p_limit: PAGE_SIZE,
      });
      if (error) {
        setError(error.message);
      } else {
        const raw = (data ?? []) as FeedRow[];
        if (raw.length > 0) {
          const last = raw[raw.length - 1];
          cursor.current = { key: last.sort_key, id: last.post_id };
        }
        const rows = raw.filter((r) => !hiddenRef.current.has(r.post_id));
        setPosts((prev) => {
          const base = more ? prev : [];
          const known = new Set(base.map((p) => p.post_id));
          return [...base, ...rows.filter((r) => !known.has(r.post_id))];
        });
        const more2 = raw.length >= PAGE_SIZE;
        setHasMore(more2);
        hasMoreRef.current = more2;
      }
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
    },
    [mode, supabase]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  // Infinite scroll: the sentinel near the bottom triggers the next page.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasMoreRef.current && !loadingMoreRef.current) load(true);
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [load, posts.length]);

  // Seen reporting: the phone's exact batch semantics — 6s flush, retry on failure.
  useEffect(() => {
    seenObserverRef.current = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        const pid2 = (e.target as HTMLElement).dataset.pid;
        if (e.isIntersecting && pid2 && !seenSentRef.current.has(pid2)) seenPendingRef.current.add(pid2);
      });
    }, { threshold: 0.5 });
    const flushSeen = async () => {
      const userId = uidRef.current;
      if (!userId) return;
      const batch = Array.from(seenPendingRef.current);
      if (batch.length === 0) return;
      seenPendingRef.current.clear();
      batch.forEach((id) => seenSentRef.current.add(id));
      const { error: sErr } = await supabase
        .from("post_seen")
        .upsert(batch.map((id) => ({ user_id: userId, post_id: id })), { onConflict: "user_id,post_id" });
      if (sErr) batch.forEach((id) => seenSentRef.current.delete(id));
    };
    const timer = setInterval(flushSeen, 6000);
    return () => { clearInterval(timer); flushSeen(); seenObserverRef.current?.disconnect(); };
  }, [supabase]);

  const observeSeen = useCallback((el: HTMLDivElement | null) => {
    if (el) seenObserverRef.current?.observe(el);
  }, []);

  // New posts pill: realtime inserts, debounced like the phone, never yanks scroll.
  useEffect(() => {
    const ch = supabase
      .channel("web_feed_new_posts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, (p) => {
        const authorId = (p.new as { user_id?: string }).user_id;
        if (authorId && authorId === uidRef.current) return;
        if (newDebounceRef.current) clearTimeout(newDebounceRef.current);
        newDebounceRef.current = setTimeout(() => setPendingNew((n) => n + 1), 2000);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase]);

  useEffect(() => {
    function onQuote(e: Event) { setQuote((e as CustomEvent).detail); }
    window.addEventListener("pc-quote-post", onQuote);
    return () => window.removeEventListener("pc-quote-post", onQuote);
  }, []);

  function showNewPosts() {
    setPendingNew(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
    load(false);
  }

  return (
    <div>
      <StoryRings />
      <Composer onPosted={() => load(false)} quote={quote} onQuoteDone={() => setQuote(null)} />
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

      {pendingNew > 0 && !loading ? (
        <div className="sticky top-16 z-10 flex justify-center py-2">
          <button onClick={showNewPosts} className="flex items-center gap-1.5 rounded-full bg-pearl px-4 py-1.5 text-[13px] font-semibold text-ink shadow-lg transition-opacity hover:opacity-90">
            <ArrowUp size={14} /> {pendingNew === 1 ? "New post" : pendingNew + " new posts"}
          </button>
        </div>
      ) : null}

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
          <p className="text-[15px] text-white/70">{EMPTY_COPY[mode].title}</p>
          <p className="text-sm text-white/40">{EMPTY_COPY[mode].sub}</p>
        </div>
      ) : (
        <div>
          {posts.map((p) => (
            <div key={p.post_id} data-pid={p.post_id} ref={observeSeen}>
              <PostCard post={p} />
            </div>
          ))}
          <div ref={sentinelRef} />
          {loadingMore ? <Skeleton /> : null}
          {!hasMore ? <p className="py-8 text-center text-xs text-white/30">You are all caught up.</p> : null}
        </div>
      )}
    </div>
  );
}