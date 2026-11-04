"use client";

import { createHomeFeedController, type FeedSeed, type FeedMode, type HomeFeedMemory } from "@/lib/homeFeedController";
import { getNavigationStore } from "@/lib/navigationCache";
import { createWebSessionHistory } from '@/lib/sessionHistory';
import { restoreHomeFeedScroll } from "@/lib/homeFeedScroll";
import { hydratePostMedia, retainFeedMedia } from "@/lib/contentMedia";
import { getFeedCache } from "@/lib/feedCache";
import { dataSaverEnabled } from '@/lib/mediaPrefs';
import { renewFeedMedia } from "../../shared/feedMedia";
import { createFeedLive, feedLiveWindow } from '../../shared/feedLive';
import { applyPostInteractionsLive } from '@/lib/usePostInteractions';

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { LiveEntry } from "./LiveEntry";
import { ArrowUp } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import { PostCard } from "@/components/PostCard";
import { StoryRings } from "@/components/StoryRings";
import { Composer } from "@/components/Composer";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { SponsoredCard } from "@/components/SponsoredCard";
import { getActivePromos, type PromoRow } from "@/lib/ads";
import { MarketplaceShelf } from './MarketplaceShelf';
import { isMarketplacePost, MARKETPLACE_SHELF_AFTER, readMarketplaceRecommendations, type MarketplaceRecommendation } from '../../shared/marketplaceRecommendations';


const MODES = [
  { key: "for_you", label: "For You" },
  { key: "latest", label: "Latest" },
  { key: "trending", label: "Trending" },
] as const;

// Appending another page must not render every already-visible media player.
// Controller rows retain their identity until their actual data changes.
const FeedPostCard = memo(PostCard);

/** Only measured, complete pages leave the DOM. Ordinary wheel/touch scrolling
 * stays with the browser; the two spacers retain the exact document geometry. */
function FeedHistoryPage({ index, height, measure, children }: { index: number; height: number;
  measure: (index: number, height: number) => void; children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = content.current; if (!node) return;
    const update = () => measure(index, node.getBoundingClientRect().height);
    update(); const observer = new ResizeObserver(update); observer.observe(node);
    return () => observer.disconnect();
  }, [index, measure]);
  return <div data-history-page={index} style={{ minHeight: height || undefined }}><div ref={content}>{children}</div></div>;
}

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
  const [navigationStore] = useState(getNavigationStore);
  const navigationSession = useSyncExternalStore(navigationStore.subscribe, navigationStore.getSnapshot, navigationStore.getServerSnapshot);
  const [controller] = useState(() => createHomeFeedController(supabase, seed, getFeedCache(), value => {
    window.dispatchEvent(new CustomEvent('pc-performance', { detail: { event: 'feed', ...value } }));
  }, rows => renewFeedMedia(rows, value => hydratePostMedia(value)),
    navigationStore.getSnapshot().owner === seed.owner
      ? navigationStore.cache.read<HomeFeedMemory>(navigationStore.getSnapshot().scope, 'home:personal') : null,
    { scope: () => navigationStore.getSnapshot().scope, retain: retainFeedMedia }, createWebSessionHistory));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { mode, rows: posts, loading, loadingMore, hasMore, error, pending: pendingNew } = state;
  const uidRef = useRef<string | null>(seed.owner);
  const load = useCallback((more = false, background = false) => controller.load(more, background), [controller]);
  const setMode = (value: FeedMode) => controller.setMode(value, window.scrollY);
  const [quote, setQuote] = useState<{ id: string; author: string; text: string } | null>(null);
  const [composerGeneration, setComposerGeneration] = useState(0);
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedFeed = searchParams.get('feed');
  useEffect(() => {
    if (requestedFeed === 'latest' || requestedFeed === 'trending' || requestedFeed === 'for_you') controller.setMode(requestedFeed, window.scrollY);
  }, [controller, requestedFeed]);
  // The ads wizard's format tiles land here: open the composer set to the
  // chosen kind, and after posting go back to the wizard with the post picked.
  const [composeKind, setComposeKind] = useState<"post" | "media" | "video" | "poll" | undefined>(undefined);
  const [composeRequest, setComposeRequest] = useState(0);
  const [thenPromote,setThenPromote] = useState(false);
  const requestedCompose = searchParams.get("compose");
  const requestedNext = searchParams.get("then");
  const composeUrl = requestedCompose + ":" + requestedNext;
  const [previousComposeUrl,setPreviousComposeUrl]=useState<string|null>(null);
  if(previousComposeUrl!==composeUrl){
    setPreviousComposeUrl(composeUrl);
    const ck=requestedCompose;
    if(ck&&['post','photo','carousel','video','poll'].includes(ck)){
      setComposeKind(ck==='photo'||ck==='carousel'?'media':ck as 'post'|'video'|'poll');
      setComposeRequest(value=>value+1);setThenPromote(requestedNext==='promote');
    }
  }
  useEffect(() => {
    const open = (event: Event) => {
      const intent = (event as CustomEvent<{ intent?: string }>).detail?.intent;
      if (!intent || !['post', 'photo', 'video', 'poll'].includes(intent)) return;
      setThenPromote(false);
      setComposeKind(intent === 'photo' ? 'media' : intent as 'post' | 'video' | 'poll');
      setComposeRequest(value => value + 1);
    };
    window.addEventListener('pc-compose', open);
    return () => window.removeEventListener('pc-compose', open);
  }, []);
  const [promoResult, setPromos] = useState<{owner:string;items:PromoRow[]}|null>(null);
  const promos=mode==="for_you"&&promoResult?.owner===state.owner?promoResult.items:[];
  const [marketplace, setMarketplace] = useState<{ owner: string; items: MarketplaceRecommendation[] } | null>(null);
  const [marketplaceRefresh, setMarketplaceRefresh] = useState(0);
  const marketplaceRequest = useRef<AbortController | null>(null);
  const refreshMarketplace = useCallback((sellerId?: string) => {
    marketplaceRequest.current?.abort();
    if (sellerId) setMarketplace(current => current ? { ...current, items: current.items.filter(item => item.seller_id !== sellerId) } : current);
    setMarketplaceRefresh(value => value + 1);
  }, []);
  const marketplaceItems = mode === 'for_you' && marketplace?.owner === state.owner ? marketplace.items : [];
  const seenPendingRef = useRef<Set<string>>(new Set());
  const seenSentRef = useRef<Set<string>>(new Set());
  const seenObserverRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  // Rows keep their native document flow. Only complete measured pages may
  // become equal-height spacers; there are no estimated-height corrections.
  const newDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedLiveRef = useRef<ReturnType<typeof createFeedLive> | null>(null);
  const [feedBroadcast, setFeedBroadcast] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const interestObserverRef = useRef<IntersectionObserver | null>(null);
  const interestAnchorRef = useRef<string | null>(null);
  const lastFeedScroll = useRef(0);

  useLayoutEffect(() => {
    if (!state.scrollRestore) return;
    return restoreHomeFeedScroll(controller, () => feedRef.current, state.scrollRestore);
  }, [controller, state.scrollRestore]);

  useEffect(() => {
    const cacheScope = navigationStore.getSnapshot().owner === seed.owner ? navigationStore.getSnapshot().scope : null;
    lastFeedScroll.current = controller.getSnapshot().scrollRestore?.top ?? window.scrollY;
    const rememberScroll = () => { if (window.location.pathname === '/home') {
      lastFeedScroll.current = window.scrollY;
      const node = listRef.current;
      if (node) controller.approachHistory(-node.getBoundingClientRect().top, window.innerHeight);
    } };
    window.addEventListener('scroll', rememberScroll, { passive: true });
    const syncMediaSession = () => {
      const session = navigationStore.getSnapshot();
      if (session.initialized) controller.setMediaSession(session.owner, session.scope, !session.changed);
    };
    const unsubscribeNavigation = navigationStore.subscribe(syncMediaSession);
    syncMediaSession();
    void controller.start();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (next !== uidRef.current) {
        uidRef.current = next; seenPendingRef.current.clear(); seenSentRef.current.clear();
        setComposerGeneration(value => value + 1); setQuote(null); setComposeKind(undefined); setThenPromote(false);
        controller.setOwner(next);
        queueMicrotask(() => { if (next) router.refresh(); else router.replace('/login'); });
      }
    });
    const onRefresh = () => { void load(false); refreshMarketplace(); };
    const onHidden = (event: Event) => { const postId = (event as CustomEvent).detail?.postId; if (typeof postId === 'string') controller.hide(postId); };
    const onAuthorHidden = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || detail.ownerId !== uidRef.current || typeof detail.authorId !== 'string') return;
      refreshMarketplace(detail.authorId);
      for (const post of controller.getSnapshot().rows) if (post.author_id === detail.authorId) controller.hide(post.post_id);
      void load(false);
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') { void load(false, true); void feedLiveRef.current?.start(); refreshMarketplace(); } };
    window.addEventListener('pc-refresh-feed', onRefresh);
    window.addEventListener('pc-feed-hidden', onHidden);
    window.addEventListener('pc-feed-author-hidden', onAuthorHidden);
    document.addEventListener('visibilitychange', onVisibility);
    const mediaRefresh = setInterval(onVisibility, 240_000);
    return () => {
      const memory = controller.remember(lastFeedScroll.current);
      const session = navigationStore.getSnapshot();
      const initialScope = !session.changed && session.owner === seed.owner ? session.scope : null;
      if (memory) navigationStore.cache.save(cacheScope ?? initialScope, 'home:personal', memory);
      window.removeEventListener('scroll', rememberScroll);
      clearInterval(mediaRefresh); subscription.unsubscribe(); unsubscribeNavigation(); controller.dispose();
      window.removeEventListener('pc-refresh-feed', onRefresh); window.removeEventListener('pc-feed-hidden', onHidden);
      window.removeEventListener('pc-feed-author-hidden', onAuthorHidden);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [controller, load, router, supabase, refreshMarketplace, navigationStore, seed.owner]);

  useEffect(() => {
    let active = true;
    const owner=state.owner;
    if (mode === "for_you" && owner) void getActivePromos(3).then(value => {
      if (active) setPromos({owner,items:value.filter(post => !isMarketplacePost(post))});
    }).catch(() => { if (active) setPromos(null); });
    return () => { active = false; };
  }, [mode, state.owner]);

  useEffect(() => {
    const owner = state.owner;
    if (!owner || mode !== 'for_you') return;
    let active = true;
    const request = new AbortController();
    marketplaceRequest.current = request;
    const timer = setTimeout(() => request.abort(), 10000);
    void readMarketplaceRecommendations(supabase, request.signal)
      .then(items => { if (active && !request.signal.aborted && uidRef.current === owner) setMarketplace({ owner, items }); })
      .catch(() => { /* Optional recommendations never block the feed. */ })
      .finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); request.abort(); if (marketplaceRequest.current === request) marketplaceRequest.current = null; };
  }, [supabase, mode, state.owner, marketplaceRefresh]);

  // Infinite scroll: the sentinel near the bottom triggers the next page.
  useEffect(() => {
    let io: IntersectionObserver | null = null;
    const observe = () => {
      io?.disconnect();
      const cards = listRef.current?.querySelectorAll<HTMLElement>('[data-pid]');
      const el = !dataSaverEnabled() && cards?.length ? cards[Math.max(0, cards.length - 7)] : sentinelRef.current;
      if (!el) return;
      io = new IntersectionObserver((entries) => {
        const current = controller.getSnapshot();
        if (entries[0]?.isIntersecting && !document.hidden && current.hasMore && !current.loadingMore && !current.loading && !current.error) void load(true);
      }, { rootMargin: "600px 0px" });
      io.observe(el);
    };
    observe();
    window.addEventListener('pc-media-preferences', observe);
    document.addEventListener('visibilitychange', observe);
    return () => { io?.disconnect(); window.removeEventListener('pc-media-preferences', observe); document.removeEventListener('visibilitychange', observe); };
  }, [load, posts, controller]);

  // Seen reporting: the phone's exact batch semantics - 6s flush, retry on failure.
  useEffect(() => {
    const pendingSeen=seenPendingRef.current;
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
      while (seenSentRef.current.size > 2000) seenSentRef.current.delete(seenSentRef.current.values().next().value!);
      try {
        const { error } = await supabase.from("post_seen")
          .upsert(batch.map(id => ({ user_id: userId, post_id: id })), { onConflict: "user_id,post_id" });
        if (error) throw error;
      } catch {
        if (active && uidRef.current === userId) batch.forEach(id => { seenSentRef.current.delete(id); seenPendingRef.current.add(id); });
      } finally { sending = false; }
    };
    const timer = setInterval(flushSeen, 6000);
    return () => { active = false; clearInterval(timer); pendingSeen.clear(); seenObserverRef.current?.disconnect(); };
  }, [supabase]);

  const observeSeen = useCallback((el: HTMLDivElement | null) => {
    if (el) { seenObserverRef.current?.observe(el); interestObserverRef.current?.observe(el); }
  }, []);

  useEffect(() => {
    const visible = () => { const active = document.visibilityState === 'visible'; setPageVisible(active); feedLiveRef.current?.setActive(active); };
    visible(); document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, []);

  useEffect(() => {
    setFeedBroadcast(false);
    const owner = state.owner, scope = navigationSession.scope;
    if (!owner || navigationSession.owner !== owner) return;
    let live = true;
    const current = () => live && uidRef.current === owner && controller.getSnapshot().owner === owner
      && navigationStore.getSnapshot().scope === scope;
    const coordinator = createFeedLive({
      client: supabase, owner, current, active: document.visibilityState === 'visible',
      mode: enabled => { if (current()) setFeedBroadcast(enabled); },
      hasPending: () => controller.getSnapshot().pending > 0,
      head: request => controller.checkHead(request),
      access: (authors, request) => controller.reconcileLiveAccess(authors, request),
      apply: (ids, rows, requestedAt) => {
        if (!current()) return;
        const retry = rows.filter(row => !applyPostInteractionsLive(row.post_id, owner, {
          liked: row.viewer_liked, bookmarked: row.viewer_bookmarked, likesCount: row.likes_count, bookmarksCount: row.bookmarks_count,
        }, requestedAt)).map(row => row.post_id);
        const waiting = new Set(retry);
        controller.applyLive(owner, ids.filter(id => !waiting.has(id)), rows.filter(row => !waiting.has(row.post_id)), requestedAt);
        return retry;
      },
    });
    feedLiveRef.current = coordinator;
    coordinator.setWindow(feedLiveWindow(controller.getSnapshot().rows.map(post => ({ id: post.post_id, authorId: post.author_id })), interestAnchorRef.current));
    void coordinator.start();
    const changed = (event: Event) => {
      const postId = (event as CustomEvent).detail?.postId;
      if (typeof postId === 'string' && current()) coordinator.invalidate([postId]);
    };
    window.addEventListener('pc-feed-post-changed', changed);
    return () => { live = false; coordinator.dispose(); if (feedLiveRef.current === coordinator) feedLiveRef.current = null;
      window.removeEventListener('pc-feed-post-changed', changed); };
  }, [controller, load, state.owner, navigationSession.owner, navigationSession.scope, navigationStore, supabase]);

  useEffect(() => {
    feedLiveRef.current?.setWindow(feedLiveWindow(posts.map(post => ({ id: post.post_id, authorId: post.author_id })), interestAnchorRef.current));
  }, [posts, state.owner, navigationSession.scope]);
  useEffect(() => { feedLiveRef.current?.pendingChanged(); }, [pendingNew]);

  useEffect(() => {
    const visible = new Set<string>();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const id = (entry.target as HTMLElement).dataset.pid;
        if (id) { if (entry.isIntersecting) visible.add(id); else visible.delete(id); }
      });
      const rows = controller.getSnapshot().rows;
      const anchor = rows.find(row => visible.has(row.post_id))?.post_id ?? interestAnchorRef.current;
      interestAnchorRef.current = anchor;
      if (anchor) controller.setHistoryAnchor(anchor);
      feedLiveRef.current?.setWindow(feedLiveWindow(rows.map(post => ({ id: post.post_id, authorId: post.author_id })), anchor));
    }, { threshold: 0.01 });
    interestObserverRef.current = observer;
    listRef.current?.querySelectorAll<HTMLElement>('[data-pid]').forEach(element => observer.observe(element));
    return () => { observer.disconnect(); interestObserverRef.current = null; };
  }, [controller, state.owner]);

  // New posts pill: realtime inserts, debounced like the phone, never yanks scroll.
  useEffect(() => {
    if (feedBroadcast || !state.owner || !pageVisible) return;
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
  }, [supabase, load, feedBroadcast, state.owner, pageVisible]);

  // Lazy image elements prepare their own nearby pixels. Detached Image warms
  // cannot be reused for private no-store responses and duplicate those reads.

  useEffect(() => {
    function onQuote(e: Event) { setQuote((e as CustomEvent).detail); }
    window.addEventListener("pc-quote-post", onQuote);
    return () => window.removeEventListener("pc-quote-post", onQuote);
  }, []);

  function showNewPosts() {
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    load(false);
  }

  return (
    <div ref={feedRef} data-feed-owner={state.owner ?? ''} data-feed-mode={mode}>
      <AnnouncementBanner />
      <header className="mb-3 flex items-center justify-between gap-4"><h1 className="font-display text-[30px] font-bold tracking-[-0.04em] text-ink">Home</h1><Link href="/discover" className="text-xs font-semibold text-muted hover:text-ink">Find your circles</Link></header>

      {/* Mode tabs: the active indicator is a pearl set in a ring, echoing the
          mark itself, instead of a plain underline. */}
      {/* The tab row is its own card and sticks under the top bar, so switching
          feeds never scrolls out of reach. The gold underline marks the active
          feed; the dot-in-a-ring read as decoration at this size. */}
      <div className="pc-feed-tabs sticky top-[112px] z-10 mb-4 border-b border-ink/10 bg-[var(--canvas)] md:top-[68px]">
        <nav aria-label="Feed destinations" className="flex items-center gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain">
          {MODES.map((m) => {
            const active = mode === m.key;
            return (
              <span key={m.key} className="contents">
              {m.key === 'trending' ? <Link href="/discover" className="inline-flex min-h-12 shrink-0 items-center justify-center whitespace-nowrap px-3.5 py-3 text-center text-[13px] text-muted hover:text-ink sm:text-[14.5px]">Discover</Link> : null}
              <button
                aria-pressed={active}
                onClick={() => setMode(m.key)}
                className={
                  "relative min-h-12 shrink-0 whitespace-nowrap px-3.5 py-3 text-[13px] transition-colors duration-[180ms] sm:text-[14.5px] " +
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
              </button></span>
            );
          })}
          <LiveEntry />
        </nav>
      </div>

      <StoryRings />
      {state.owner ? <Composer key={state.owner + ':' + composerGeneration} ownerId={state.owner} initialKind={composeKind} openRequest={composeRequest} onPosted={(id) => { load(false); if (id && thenPromote) router.push("/ads/new?post=" + id); }} quote={quote} onQuoteDone={() => setQuote(null)} /> : null}

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
          <div ref={listRef} data-feed-content="true">
            {state.history?.before ? <div aria-hidden="true" data-history-before="true" style={{ height: state.history.before, overflowAnchor: 'none' }} /> : null}
            {(state.history?.pages ?? [{ index: 0, first: 0, rows: posts, height: 0 }]).map(page => {
              const cards = page.rows.filter(p => !isMarketplacePost(p)).map((p, localIndex) => {
              const i = page.first + localIndex;
              const slot = i === 1 ? promos[0] : (i > 1 && (i - 1) % 6 === 0 ? promos[Math.floor((i - 1) / 6)] : null);
              return (
                <div key={p.post_id + ((p as unknown as { reposted_by_id?: string | null }).reposted_by_id ?? "")} data-index={i}>
                  <div data-pid={p.post_id} data-aid={p.author_id} ref={observeSeen}>
                    <FeedPostCard post={p} />
                  </div>
                  {slot && slot.post_id !== p.post_id ? <SponsoredCard promo={slot} /> : null}
                  {mode === 'for_you' && i === MARKETPLACE_SHELF_AFTER - 1 ? <MarketplaceShelf items={marketplaceItems} /> : null}
                </div>
              );
              });
              return state.history ? <FeedHistoryPage key={page.index} index={page.index} height={page.height} measure={controller.measurePage}>{cards}</FeedHistoryPage> : cards;
            })}
            {state.history?.after ? <div aria-hidden="true" data-history-after="true" style={{ height: state.history.after, overflowAnchor: 'none' }} /> : null}
          </div>
          <div ref={sentinelRef} />
          {loadingMore ? <Skeleton /> : null}
          {!hasMore ? <p className="py-8 text-center text-xs text-muted">You are all caught up.</p> : null}
        </div>
      )}
    </div>
  );
}
