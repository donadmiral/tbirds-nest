"use client";

import { createHomeFeedController, type FeedSeed, type FeedMode } from "@/lib/homeFeedController";
import { hydratePostMedia } from "@/lib/contentMedia";
import { getFeedCache } from "@/lib/feedCache";
import { feedPrefetchUrls } from "../../shared/feedSnapshot";
import { renewFeedMedia } from "../../shared/feedMedia";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUp } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { FeedRow } from "@/lib/feed";
import { PostCard } from "@/components/PostCard";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { StoryRings } from "@/components/StoryRings";
import { Composer } from "@/components/Composer";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { SponsoredCard } from "@/components/SponsoredCard";
import { getActivePromos, type PromoRow } from "@/lib/ads";


const MODES = [
  { key: "for_you", label: "For You" },
  { key: "latest", label: "Latest" },
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
    <div className="animate-pulse border-b border-ink/10 px-1 py-5">
      <div className="flex gap-3">
        <div className="h-11 w-11 rounded-full bg-surface" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-3 w-40 rounded-xs bg-surface" />
          <div className="h-3 w-full rounded-xs bg-surface" />
          <div className="h-3 w-2/3 rounded-xs bg-surface" />
        </div>
      </div>
    </div>
  );
}

export default function HomeFeed({ seed }: { seed: FeedSeed }) {
  const [supabase] = useState(createClient);
  const [controller] = useState(() => createHomeFeedController(supabase, seed, getFeedCache(), value => {
    window.dispatchEvent(new CustomEvent('pc-performance', { detail: { event: 'feed', ...value } }));
  }, rows => renewFeedMedia(rows, value => hydratePostMedia(value))));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { mode, rows: posts, loading, loadingMore, hasMore, error, pending: pendingNew } = state;
  const uidRef = useRef<string | null>(seed.owner);
  const load = useCallback((more = false, background = false) => controller.load(more, background), [controller]);
  const setMode = (value: FeedMode) => controller.setMode(value);
  const [quote, setQuote] = useState<{ id: string; author: string; text: string } | null>(null);
  const [composerGeneration, setComposerGeneration] = useState(0);
  const router = useRouter();
  // The ads wizard's format tiles land here: open the composer set to the
  // chosen kind, and after posting go back to the wizard with the post picked.
  const [composeKind, setComposeKind] = useState<"media" | "video" | undefined>(undefined);
  const thenPromote = useRef(false);
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const ck = sp.get("compose");
      if (ck === "video") setComposeKind("video"); else if (ck === "photo" || ck === "carousel") setComposeKind("media");
      thenPromote.current = sp.get("then") === "promote";
    } catch { /* fine */ }
  }, []);
  const [promos, setPromos] = useState<PromoRow[]>([]);
  const seenPendingRef = useRef<Set<string>>(new Set());
  const seenSentRef = useRef<Set<string>>(new Set());
  const seenObserverRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [listTop, setListTop] = useState(0);
  useEffect(() => { setListTop(listRef.current?.offsetTop ?? 0); }, [posts.length]);
  // An initial viewport makes real posts part of the server HTML and first frame.
  const rowVirtualizer = useWindowVirtualizer({ count: posts.length, estimateSize: () => 560,
    initialRect: { width: 640, height: 900 }, overscan: 5, scrollMargin: listTop,
    getItemKey: index => posts[index].post_id });
  const newDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void controller.start();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (next !== uidRef.current) {
        uidRef.current = next; seenPendingRef.current.clear(); seenSentRef.current.clear();
        setComposerGeneration(value => value + 1); setQuote(null); setComposeKind(undefined); thenPromote.current = false;
        controller.setOwner(next);
        queueMicrotask(() => { if (next) router.refresh(); else router.replace('/login'); });
      }
    });
    const onRefresh = () => { void load(false); };
    const onHidden = (event: Event) => { const postId = (event as CustomEvent).detail?.postId; if (typeof postId === 'string') controller.hide(postId); };
    const onVisibility = () => { if (document.visibilityState === 'visible') void load(false, true); };
    window.addEventListener('pc-refresh-feed', onRefresh);
    window.addEventListener('pc-feed-hidden', onHidden);
    document.addEventListener('visibilitychange', onVisibility);
    const mediaRefresh = setInterval(onVisibility, 240_000);
    return () => {
      clearInterval(mediaRefresh); subscription.unsubscribe(); controller.dispose();
      window.removeEventListener('pc-refresh-feed', onRefresh); window.removeEventListener('pc-feed-hidden', onHidden);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [controller, load, router, supabase]);

  useEffect(() => {
    let active = true;
    setPromos([]);
    if (mode === "for_you" && state.owner) void getActivePromos(3).then(value => {
      if (active) setPromos(value);
    }).catch(() => { if (active) setPromos([]); });
    return () => { active = false; };
  }, [mode, state.owner]);

  // Infinite scroll: the sentinel near the bottom triggers the next page.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && controller.getSnapshot().hasMore && !controller.getSnapshot().loadingMore) load(true);
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [load, posts.length, controller]);

  // Seen reporting: the phone's exact batch semantics - 6s flush, retry on failure.
  useEffect(() => {
    seenObserverRef.current = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        const pid2 = (e.target as HTMLElement).dataset.pid;
        const aid2 = (e.target as HTMLElement).dataset.aid;
        if (e.isIntersecting && pid2 && aid2 !== uidRef.current && !seenSentRef.current.has(pid2)) seenPendingRef.current.add(pid2);
      });
    }, { threshold: 0.5 });
    let active = true, sending = false;
    const flushSeen = async () => {
      const userId = uidRef.current;
      if (!userId || sending || !active || document.visibilityState !== 'visible') return;
      const batch = Array.from(seenPendingRef.current).slice(0, 100);
      if (batch.length === 0) return;
      sending = true;
      batch.forEach(id => { seenPendingRef.current.delete(id); seenSentRef.current.add(id); });
      try {
        const { error } = await supabase.from("post_seen")
          .upsert(batch.map(id => ({ user_id: userId, post_id: id })), { onConflict: "user_id,post_id" });
        if (error) throw error;
      } catch {
        if (active && uidRef.current === userId) batch.forEach(id => { seenSentRef.current.delete(id); seenPendingRef.current.add(id); });
      } finally { sending = false; }
    };
    const timer = setInterval(flushSeen, 6000);
    return () => { active = false; clearInterval(timer); seenPendingRef.current.clear(); seenObserverRef.current?.disconnect(); };
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
        newDebounceRef.current = setTimeout(() => { if (document.visibilityState === 'visible') void load(false, true); }, 2000);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); if (newDebounceRef.current) clearTimeout(newDebounceRef.current); };
  }, [supabase, load]);

  const prefetched = useRef(new Set<string>());
  const visibleItems = rowVirtualizer.getVirtualItems();
  const firstVisible = visibleItems[0]?.index ?? 0;
  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (document.visibilityState !== 'visible' || connection?.saveData || connection?.effectiveType === '2g' || connection?.effectiveType === 'slow-2g') return;
    const urls = feedPrefetchUrls(posts, firstVisible + 1, false).filter(url => !prefetched.current.has(url));
    if (prefetched.current.size > 80) prefetched.current.clear();
    urls.forEach(url => { prefetched.current.add(url); const image = new Image(); image.decoding = 'async'; image.src = url; });
  }, [posts, firstVisible]);

  useEffect(() => {
    function onQuote(e: Event) { setQuote((e as CustomEvent).detail); }
    window.addEventListener("pc-quote-post", onQuote);
    return () => window.removeEventListener("pc-quote-post", onQuote);
  }, []);

  function showNewPosts() {
    window.scrollTo({ top: 0, behavior: "smooth" });
    load(false);
  }

  return (
    <div>
      <AnnouncementBanner />
      <StoryRings />
      {state.owner ? <Composer key={state.owner + ':' + composerGeneration} ownerId={state.owner} initialKind={composeKind} onPosted={(id) => { load(false); if (id && thenPromote.current) router.push("/ads/new?post=" + id); }} quote={quote} onQuoteDone={() => setQuote(null)} /> : null}

      {/* Mode tabs: the active indicator is a pearl set in a ring, echoing the
          mark itself, instead of a plain underline. */}
      {/* The tab row is its own card and sticks under the top bar, so switching
          feeds never scrolls out of reach. The gold underline marks the active
          feed; the dot-in-a-ring read as decoration at this size. */}
      <div className="sticky top-[72px] z-10 mb-4 rounded-2xl border border-ink/10 bg-white/95 px-2 backdrop-blur">
        <div className="flex items-center gap-1 overflow-x-auto overflow-y-hidden">
          {MODES.map((m) => {
            const active = mode === m.key;
            return (
              <button key={m.key}
                aria-pressed={active}
                onClick={() => setMode(m.key)}
                className={
                  "relative shrink-0 px-3.5 py-3 text-[14.5px] transition-colors duration-[180ms] " +
                  (active ? "font-semibold text-ink" : "text-muted hover:text-ink/80")
                }
              >
                {m.label}
                <span
                  className={
                    "absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-pearl transition-opacity duration-[180ms] " +
                    (active ? "opacity-100" : "opacity-0")
                  }
                  aria-hidden
                />
              </button>
            );
          })}
        </div>
      </div>

      {mode === "trending" ? <div className="pt-3"><StoryRings mode="global" /></div> : null}
      {pendingNew > 0 && !loading ? (
        <div className="sticky top-16 z-10 flex justify-center py-2">
          <button onClick={showNewPosts} className="flex items-center gap-1.5 rounded-full bg-pearl px-4 py-1.5 text-[13px] font-semibold text-on-pearl shadow-lg transition-opacity duration-[140ms] hover:opacity-90">
            <ArrowUp size={14} /> {pendingNew === 1 ? "New post" : pendingNew + " new posts"}
          </button>
        </div>
      ) : null}

      {error && posts.length > 0 ? <div role="status" className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3 text-sm"><span>{error}</span><button className="font-semibold" onClick={() => load(false, true)}>Retry</button></div> : null}
      {loading && posts.length === 0 ? (
        <div>
          <Skeleton />
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : error && posts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
          <p className="text-[17px] font-semibold text-ink">The feed could not load.</p>
          <p className="text-[13.5px] text-muted">{error}</p>
          <button onClick={() => load(false)} className="mt-1 rounded-md bg-surface px-4 py-2 text-[13.5px] font-semibold text-ink transition-colors duration-[140ms] hover:bg-surface-elevated">
            Try again
          </button>
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-20 text-center">
          <p className="text-[17px] font-semibold text-ink">{EMPTY_COPY[mode].title}</p>
          <p className="text-[13.5px] text-muted">{EMPTY_COPY[mode].sub}</p>
        </div>
      ) : (
        <div>
          <div ref={listRef} data-feed-content="true" style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map((v) => {
              const p = posts[v.index];
              const i = v.index;
              const slot = i === 1 ? promos[0] : (i > 1 && (i - 1) % 6 === 0 ? promos[Math.floor((i - 1) / 6)] : null);
              return (
                <div key={p.post_id + ((p as unknown as { reposted_by_id?: string | null }).reposted_by_id ?? "")} data-index={v.index} ref={rowVirtualizer.measureElement}
                  style={{ position: "absolute", top: v.start - rowVirtualizer.options.scrollMargin, left: 0, width: "100%" }}>
                  <div data-pid={p.post_id} data-aid={p.author_id} ref={observeSeen}>
                    <PostCard post={p} />
                  </div>
                  {slot && slot.post_id !== p.post_id ? <SponsoredCard promo={slot} /> : null}
                </div>
              );
            })}
          </div>
          <div ref={sentinelRef} />
          {loadingMore ? <Skeleton /> : null}
          {!hasMore ? <p className="py-8 text-center text-xs text-muted">You are all caught up.</p> : null}
        </div>
      )}
    </div>
  );
}
