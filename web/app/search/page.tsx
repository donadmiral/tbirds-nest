"use client";

import { profilePath } from "@/lib/profileLookup";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Briefcase, ShoppingBag, ArrowLeft, FileText, MapPin, Play, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { StoryAvatar } from "@/components/StoryAvatar";
import { FollowButton } from "@/components/FollowButton";
import { RichText } from "@/components/RichText";
import { timeAgo } from "@/lib/feed";
import { displayImageUrl } from "@/lib/media";
import { hydratePostMedia } from "@/lib/contentMedia";
import { withTimeout } from "@/lib/withTimeout";
import { ErrorState } from "@/components/ErrorState";

type Person = { id: string; full_name: string | null; username: string | null; avatar_url: string | null; headline: string | null };
type PostHit = { id: string; user_id: string; content: string | null; created_at: string; author?: Person | null };
type JobHit = { id: string; title: string; company: string | null; location: string | null; salary_range: string | null };
type ListingHit = { id: string; title: string; price: number; currency: string; images: string[]; seller_id: string };
type MediaHit = { post_id: string; url: string; media_type: string | null; width: number | null; height: number | null; created_at: string };
type ArticleHit = { post_id: string; article_title: string | null; read_minutes: number | null; created_at: string; author_name: string | null; author_username: string | null; author_avatar: string | null };
type PlaceHit = { name: string; kind: string; hits: number };
type DirectoryHit = { id: string; name: string; description: string | null; member_count: number; icon_url: string | null };
type Topic = { topic: string; post_count: number };

const RECENT_KEY = "tbn_recent_searches_v1";
const MAX_RECENT = 8;
const CHIPS: [string, string][] = [["all", "All"], ["people", "People"], ["posts", "Posts"], ["media", "Media"], ["articles", "Articles"], ["jobs", "Jobs"], ["market", "Market"], ["places", "Places"], ["channels", "Channels"], ["communities", "Communities"]];

type SearchData = { people: Person[]; posts: PostHit[]; jobs: JobHit[]; listings: ListingHit[]; media: MediaHit[]; articles: ArticleHit[]; places: PlaceHit[]; channels: DirectoryHit[]; communities: DirectoryHit[] };
type Vertical = keyof SearchData;
type Results = SearchData & { key: string; error: boolean; asOf: string; offsets: Partial<Record<Vertical, number>>; more: Partial<Record<Vertical, boolean>>; errors: Partial<Record<Vertical, string>> };
const EMPTY_RESULTS: SearchData = { people: [], posts: [], jobs: [], listings: [], media: [], articles: [], places: [], channels: [], communities: [] };
const VERTICALS = Object.keys(EMPTY_RESULTS) as Vertical[];
const PAGE_SIZE = 20;
const SEARCH_RPC: Record<Vertical, string> = {
  people: "search_people_page", posts: "search_posts_page", jobs: "search_jobs_fts_page", listings: "search_listings_fts_page",
  media: "search_media_page", articles: "search_articles_page", places: "search_places_page", channels: "get_channels_page", communities: "get_communities_page",
};
function normalizeSearchPosts(rows: unknown[]): PostHit[] {
  return rows.map((value) => {
    const p = value as PostHit & { post_id?: string; author_id?: string; author_name?: string; author_username?: string; author_avatar?: string };
    return { ...p, id: p.id || p.post_id!, user_id: p.user_id || p.author_id!, author: p.author ?? { id: p.author_id!, full_name: p.author_name ?? null, username: p.author_username ?? null, avatar_url: p.author_avatar ?? null, headline: null } };
  });
}
function resultIdentity(item: unknown): string {
  const row = item as Record<string, unknown>;
  const url = typeof row.url === "string" && row.url.includes("/storage/v1/object/")
    ? row.url.replace(/(\/storage\/v1\/object\/)(?:public|sign|authenticated)\//, "$1").split("?")[0]
    : row.url;
  return String(row.id ?? row.post_id ?? row.name) + ":" + String(url ?? row.kind ?? "");
}

export default function SearchPage() {
  return <Suspense fallback={<p className="py-14 text-center text-sm text-muted">Loading</p>}><SearchFromUrl /></Suspense>;
}

function SearchFromUrl() {
  const params = useSearchParams();
  const query = params.get("q") ?? "";
  return <SearchResults key={query} initialQuery={query} />;
}

function SearchResults({ initialQuery }: { initialQuery: string }) {
  const [supabase] = useState(createClient);
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [filter, setFilter] = useState("all");
  const [result, setResult] = useState<Results | null>(null);
  const [retry, setRetry] = useState(0);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [postMode, setPostMode] = useState<"top" | "latest">("top");
  const [paging, setPaging] = useState<Set<Vertical>>(new Set());
  const pageLocks = useRef(new Set<string>());
  const activeKey = useRef("");
  const authVersion = useRef(0);
  const [recentKey, setRecentKey] = useState(RECENT_KEY + ":anonymous");
  const queryKey = q.trim() + "\0" + postMode;
  useEffect(() => { activeKey.current = queryKey; }, [queryKey]);
  const searched = result?.key === queryKey;
  const searching = q.trim().length >= 2 && !searched;
  const searchError = searched && result.error;
  const { people, posts, jobs, listings, media, articles, places, channels, communities } = searched && !result.error ? result : EMPTY_RESULTS;

  useEffect(() => {
    let alive = true;
    supabase.rpc("get_trending_topics", { p_limit: 8 }).then(({ data }) => { if (alive) setTopics((data ?? []) as Topic[]); });
    let uid: string | null | undefined;
    const bind = (next: string | null) => {
      if (!alive || uid === next) return;
      uid = next; authVersion.current++;
      setResult(null); setPaging(new Set()); setRecent([]); setRecentKey(RECENT_KEY + ":" + (next ?? "anonymous"));
      setRetry((value) => value + 1);
    };
    const { data: auth } = supabase.auth.onAuthStateChange((_event, session) => bind(session?.user.id ?? null));
    supabase.auth.getSession().then(({ data }) => { if (uid === undefined) bind(data.session?.user.id ?? null); });
    return () => { alive = false; authVersion.current++; auth.subscription.unsubscribe(); };
  }, [supabase]);

  useEffect(() => {
    try {
      const values: unknown = JSON.parse(window.localStorage.getItem(recentKey) ?? "[]");
      setRecent(Array.isArray(values) ? values.filter((value): value is string => typeof value === "string").slice(0, MAX_RECENT) : []);
    } catch { setRecent([]); }
  }, [recentKey]);

  const saveRecent = useCallback((term: string) => {
    const t = term.trim();
    if (!t) return;
    setRecent((prev) => {
      const next = [t, ...prev.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX_RECENT);
      try { window.localStorage.setItem(recentKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [recentKey]);

  const removeRecent = (term: string) => {
    setRecent((prev) => {
      const next = prev.filter((x) => x !== term);
      try { window.localStorage.setItem(recentKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const clearRecent = () => {
    setRecent([]);
    try { window.localStorage.removeItem(recentKey); } catch { /* ignore */ }
  };

  const fetchPage = useCallback(async (vertical: Vertical, query: string, offset: number, asOf: string) => {
    const args: Record<string, unknown> = { p_limit: PAGE_SIZE, p_offset: offset, p_as_of: asOf };
    if (vertical === "channels" || vertical === "communities") args.p_query = query;
    else args.p_q = query;
    if (vertical === "posts") args.p_mode = postMode;
    const { data, error } = await withTimeout(supabase.rpc(SEARCH_RPC[vertical], args));
    if (error) throw new Error(error.message || "Search unavailable. Try again.");
    const rows = vertical === "posts" ? normalizeSearchPosts(data ?? []) : (data ?? []) as unknown[];
    return ["posts", "media", "articles"].includes(vertical) ? withTimeout(hydratePostMedia(rows, supabase)) : rows;
  }, [supabase, postMode]);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const asOf = new Date().toISOString();
      const version = authVersion.current;
      const responses = await Promise.allSettled(VERTICALS.map((vertical) => fetchPage(vertical, query, 0, asOf)));
      if (cancelled || version !== authVersion.current) return;
      const next: Results = { ...EMPTY_RESULTS, key: queryKey, error: false, asOf, offsets: {}, more: {}, errors: {} };
      responses.forEach((response, index) => {
        const vertical = VERTICALS[index];
        if (response.status === "rejected") {
          next.errors[vertical] = "Could not load " + (vertical === "listings" ? "market" : vertical) + ". Try again.";
          next.more[vertical] = true;
        } else {
          Object.assign(next, { [vertical]: response.value });
          next.offsets[vertical] = response.value.length;
          next.more[vertical] = response.value.length === PAGE_SIZE;
        }
      });
      next.error = responses.every((response) => response.status === "rejected");
      setResult(next);
      void supabase.rpc("log_search_event", { p_query: query, p_vertical: "all" }).then(() => {}, () => {});
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [q, queryKey, supabase, fetchPage, retry]);

  const loadMore = async (vertical: Vertical) => {
    if (!result || result.key !== queryKey || !result.more[vertical]) return;
    const key = queryKey;
    const version = authVersion.current;
    const lock = key + "\0" + version + "\0" + vertical;
    if (pageLocks.current.has(lock)) return;
    pageLocks.current.add(lock); setPaging((prev) => new Set(prev).add(vertical));
    try {
      const items = await fetchPage(vertical, q.trim(), result.offsets[vertical] ?? 0, result.asOf);
      if (activeKey.current !== key || version !== authVersion.current) return;
      setResult((prev) => {
        if (!prev || prev.key !== key) return prev;
        const existing = prev[vertical] as unknown[];
        const seen = new Set(existing.map(resultIdentity));
        const added = items.filter((item) => { const id = resultIdentity(item); if (seen.has(id)) return false; seen.add(id); return true; });
        const errors = { ...prev.errors }; delete errors[vertical];
        return { ...prev, [vertical]: [...existing, ...added], errors,
          offsets: { ...prev.offsets, [vertical]: (prev.offsets[vertical] ?? 0) + items.length },
          more: { ...prev.more, [vertical]: items.length === PAGE_SIZE } };
      });
    } catch {
      if (activeKey.current === key && version === authVersion.current) setResult((prev) => prev?.key === key ? { ...prev, errors: { ...prev.errors, [vertical]: "Could not load more results. Try again." } } : prev);
    } finally {
      pageLocks.current.delete(lock);
      if (activeKey.current === key && version === authVersion.current) setPaging((prev) => { const next = new Set(prev); next.delete(vertical); return next; });
    }
  };

  useEffect(() => {
    if (!result || result.key !== queryKey) return;
    let alive = true, pending = false;
    const version = authVersion.current;
    const renew = async () => {
      if (pending || document.visibilityState !== "visible") return;
      const expiring = result.media.filter((row) => {
        const expiry = (row as unknown as { _mediaExpiresAt?: number })._mediaExpiresAt;
        return typeof expiry === "number" && expiry <= Date.now() + 60000;
      });
      if (!expiring.length) return;
      pending = true;
      try {
        const hydrated = await withTimeout(hydratePostMedia(expiring, supabase));
        if (!alive || version !== authVersion.current) return;
        const byId = new Map(hydrated.map((row) => [resultIdentity(row), row]));
        setResult((previous) => previous?.key === result.key ? { ...previous,
          media: previous.media.map((row) => (byId.get(resultIdentity(row)) as MediaHit | undefined) ?? row),
        } : previous);
      } catch { /* Retry when the connection returns; never fall back to public URLs. */ }
      finally { pending = false; }
    };
    void renew();
    const timer = setInterval(() => { void renew(); }, 60000);
    window.addEventListener("online", renew); document.addEventListener("visibilitychange", renew);
    return () => { alive = false; clearInterval(timer); window.removeEventListener("online", renew); document.removeEventListener("visibilitychange", renew); };
  }, [result, queryKey, supabase]);

  const show = (k: string) => filter === "all" || filter === k;
  const openPlace = (p: PlaceHit) => {
    const key = p.kind === "jobs" ? "jobs" : p.kind === "market" ? "market" : "people";
    saveRecent(p.name);
    setFilter(key);
    setQ(p.name);
  };

  const head = "pb-1 pt-5 text-[12px] font-semibold uppercase tracking-wide text-muted";
  const nothing = searched && !searching && people.length === 0 && posts.length === 0 && jobs.length === 0 && listings.length === 0 && media.length === 0 && articles.length === 0 && places.length === 0 && channels.length === 0 && communities.length === 0 && Object.keys(result?.errors ?? {}).length === 0;
  const counts: Record<string, number> = { people: people.length, posts: posts.length, media: media.length, articles: articles.length, jobs: jobs.length, market: listings.length, places: places.length, channels: channels.length, communities: communities.length };
  const filterEmpty = searched && !searching && !nothing && filter !== "all" && (counts[filter] ?? 0) === 0;

  return (
    <div className="px-1">
      <div className="flex items-center gap-2">
        <button onClick={() => router.back()} title="Back" className="shrink-0 rounded-full p-2 text-ink/60 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"><ArrowLeft size={19} /></button>
      <div className="relative flex-1">
        <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
        <input value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") saveRecent(q); }}
          placeholder="Search Platinum Circles"
          aria-label="Search Platinum Circles"
          autoFocus
          className="w-full rounded-lg bg-surface py-3 pl-11 pr-4 text-[15px] text-ink placeholder:text-muted outline-none transition-colors duration-[140ms] focus:bg-surface-elevated"
        />
      </div>
      </div>

      {q.trim().length >= 2 ? (
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {CHIPS.map((c) => (
            <button key={c[0]} onClick={() => setFilter(c[0])}
              className={(filter === c[0] ? "bg-pearl text-on-pearl" : "bg-surface text-ink/70 hover:bg-surface-elevated hover:text-ink") + " shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors duration-[140ms]"}>
              {c[1]}
            </button>
          ))}
        </div>
      ) : null}

      {q.trim().length < 2 ? (
        <>
          {topics.length > 0 ? (
            <div className="pt-5">
              <p className={head}>Trending</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {topics.map((t) => {
                  const tag = t.topic.startsWith("#") ? t.topic : "#" + t.topic;
                  return (
                    <Link key={t.topic} href={"/topic/" + encodeURIComponent(tag.slice(1))} className="rounded-full bg-surface px-3.5 py-1.5 text-[13px] text-ink/80 transition-colors duration-[140ms] hover:bg-surface-elevated hover:text-ink">
                      {tag} <span className="text-muted">· {t.post_count}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : null}
          {recent.length > 0 ? (
            <div className="pt-1">
              <div className="flex items-center justify-between">
                <p className={head}>Recent</p>
                <button onClick={clearRecent} className="pt-4 text-[12px] font-medium text-muted transition-colors duration-[140ms] hover:text-ink">Clear</button>
              </div>
              {recent.map((r) => (
                <div key={r} className="flex items-center gap-3 rounded-md px-1 py-2 transition-colors duration-[140ms] hover:bg-surface">
                  <Search size={15} className="shrink-0 text-muted" />
                  <button onClick={() => setQ(r)} className="min-w-0 flex-1 truncate text-left text-[14px] text-ink">{r}</button>
                  <button onClick={() => removeRecent(r)} title="Remove" className="shrink-0 rounded-full p-1 text-muted transition-colors duration-[140ms] hover:bg-surface-elevated hover:text-ink"><X size={14} /></button>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : searchError ? (
        <ErrorState title="Could not complete your search" onRetry={() => { setResult(null); setRetry((value) => value + 1); }} />
      ) : searching && !searched ? (
        <p className="py-14 text-center text-sm text-muted">Searching</p>
      ) : nothing ? (
        <p className="py-14 text-center text-sm text-muted">Nothing found for &ldquo;{q.trim()}&rdquo;.</p>
      ) : (
        <>
          {filterEmpty ? (
            <p className="py-14 text-center text-sm text-muted">No results here for &ldquo;{q.trim()}&rdquo;. Try another tab.</p>
          ) : null}

          {show("people") && people.length > 0 ? (
            <section>
              <p className={head}>People</p>
              {people.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-md px-1 py-2 transition-colors duration-[140ms] hover:bg-surface">
                  <StoryAvatar userId={p.id} name={p.full_name} avatarUrl={p.avatar_url} size={42} href={p.username ? "/" + p.username : null} />
                  <Link href={profilePath(p.username, p.id)} onClick={() => saveRecent(q)} className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{p.full_name} <VerifiedBadge userId={p.id} size={13} /></span>
                    <span className="block truncate text-[12px] text-muted">{p.headline || "@" + (p.username ?? "")}</span>
                  </Link>
                  <FollowButton authorId={p.id} />
                </div>
              ))}
            </section>
          ) : null}

          {show("posts") && posts.length > 0 ? (
            <section>
              <p className={head}>Posts</p>
              <div className="mb-2 flex gap-2">{(["top", "latest"] as const).map((mo) => (<button key={mo} onClick={() => setPostMode(mo)} className={"rounded-full px-3 py-1 text-[12px] font-semibold transition-colors duration-[140ms] " + (postMode === mo ? "bg-ink text-white" : "bg-ink/5 text-ink")}>{mo === "top" ? "Top" : "Latest"}</button>))}</div>
              {posts.map((p) => (
                <div key={p.id} role="link" tabIndex={0} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); saveRecent(q); router.push("/post/" + p.id); } }} onClick={() => { saveRecent(q); router.push("/post/" + p.id); }} className="flex cursor-pointer gap-3 rounded-md px-1 py-2.5 transition-colors duration-[140ms] hover:bg-surface">
                  <StoryAvatar userId={p.user_id} name={p.author?.full_name} avatarUrl={p.author?.avatar_url} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5 text-[13px]">
                      <span className="truncate font-semibold text-ink">{p.author?.full_name ?? "Member"} <VerifiedBadge userId={p.user_id} size={13} /></span>
                      <span className="shrink-0 text-muted">{timeAgo(p.created_at)}</span>
                    </span>
                    <span className="line-clamp-2 block text-[13px] text-ink/80"><RichText text={p.content ?? ""} /></span>
                  </span>
                </div>
              ))}
            </section>
          ) : null}

          {show("media") && media.length > 0 ? (
            <section>
              <p className={head}>Media</p>
              <div className="mt-1 grid grid-cols-3 gap-1">
                {media.map((m) => (
                  <Link key={m.post_id + m.url} href={"/post/" + m.post_id} onClick={() => saveRecent(q)} className="relative block aspect-square overflow-hidden rounded-md bg-surface">
                    {m.media_type === "video" ? (
                      <span className="relative block h-full w-full"><video src={m.url} preload="metadata" muted playsInline className="h-full w-full object-cover" /><span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white"><Play size={20} /></span></span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={displayImageUrl(m.url, 400)!} onError={(e) => { if (e.currentTarget.src !== m.url) e.currentTarget.src = m.url; }} alt="" loading="lazy" className="h-full w-full object-cover" />
                    )}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {show("articles") && articles.length > 0 ? (
            <section>
              <p className={head}>Articles</p>
              {articles.map((a) => (
                <Link key={a.post_id} href={"/post/" + a.post_id} onClick={() => saveRecent(q)} className="flex items-center gap-3 rounded-md px-1 py-2.5 transition-colors duration-[140ms] hover:bg-surface">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface text-accent"><FileText size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{a.article_title || "Article"}</span>
                    <span className="block truncate text-[12px] text-muted">{[a.author_name, a.read_minutes ? a.read_minutes + " min read" : null, timeAgo(a.created_at)].filter(Boolean).join(" · ")}</span>
                  </span>
                </Link>
              ))}
            </section>
          ) : null}

          {show("jobs") && jobs.length > 0 ? (
            <section>
              <p className={head}>Jobs</p>
              {jobs.map((j) => (
                <Link key={j.id} href={"/jobs/" + j.id} onClick={() => saveRecent(q)} className="flex items-center gap-3 rounded-md px-1 py-2.5 transition-colors duration-[140ms] hover:bg-surface">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface text-accent"><Briefcase size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{j.title}</span>
                    <span className="block truncate text-[12px] text-muted">{[j.company, j.location, j.salary_range].filter(Boolean).join(" · ")}</span>
                  </span>
                </Link>
              ))}
            </section>
          ) : null}

          {show("market") && listings.length > 0 ? (
            <section>
              <p className={head}>Market</p>
              {listings.map((l) => (
                <Link key={l.id} href={"/market/" + l.id} onClick={() => saveRecent(q)} className="flex items-center gap-3 rounded-md px-1 py-2.5 transition-colors duration-[140ms] hover:bg-surface">
                  {l.images?.[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={displayImageUrl(l.images[0], 200)!} onError={(e) => { if (l.images?.[0] && e.currentTarget.src !== l.images[0]) e.currentTarget.src = l.images[0]; }} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover" />
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-surface text-accent"><ShoppingBag size={16} /></span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{l.title}</span>
                    <span className="block text-[13px] text-accent">{(l.currency === "USD" ? "$" : l.currency + " ") + Number(l.price).toLocaleString()}</span>
                  </span>
                </Link>
              ))}
            </section>
          ) : null}

          {show("places") && places.length > 0 ? (
            <section>
              <p className={head}>Places</p>
              {places.map((p) => (
                <button key={p.name + "-" + p.kind} onClick={() => openPlace(p)} className="flex w-full items-center gap-3 rounded-md px-1 py-2.5 text-left transition-colors duration-[140ms] hover:bg-surface">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface text-accent"><MapPin size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{p.name}</span>
                    <span className="block truncate text-[12px] text-muted">{p.hits + (p.hits === 1 ? " result" : " results") + " in " + (p.kind === "jobs" ? "Jobs" : p.kind === "market" ? "Market" : "People")}</span>
                  </span>
                </button>
              ))}
            </section>
          ) : null}
          {(["channels", "communities"] as const).map((vertical) => show(vertical) && (vertical === "channels" ? channels : communities).length > 0 ? (
            <section key={vertical}>
              <p className={head}>{vertical === "channels" ? "Channels" : "Communities"}</p>
              {(vertical === "channels" ? channels : communities).map((item) => <Link key={item.id} href={"/" + vertical + "/" + item.id} onClick={() => saveRecent(q)} className="block rounded-md px-1 py-3 hover:bg-surface">
                <span className="block text-sm font-semibold text-ink">{item.name}</span>
                <span className="block text-xs text-muted">{item.member_count.toLocaleString()} members{item.description ? " · " + item.description : ""}</span>
              </Link>)}
            </section>
          ) : null)}
          {searched ? VERTICALS.filter((vertical) => show(vertical === "listings" ? "market" : vertical) && result.more[vertical]).map((vertical) => (
            <div key={vertical} className="py-3 text-center">
              {result.errors[vertical] ? <p role="alert" className="mb-2 text-sm text-danger">{result.errors[vertical]}</p> : null}
              <button disabled={paging.has(vertical)} onClick={() => void loadMore(vertical)} className="rounded-full bg-surface px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">
                {paging.has(vertical) ? "Loading…" : (result.errors[vertical] ? "Retry " : "More ") + (vertical === "listings" ? "market results" : vertical)}
              </button>
            </div>
          )) : null}
        </>
      )}
    </div>
  );
}