"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Briefcase, ShoppingBag, ArrowLeft, FileText, MapPin, Play, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { StoryAvatar } from "@/components/StoryAvatar";
import { FollowButton } from "@/components/FollowButton";
import { RichText } from "@/components/RichText";
import { timeAgo } from "@/lib/feed";
import { displayImageUrl } from "@/lib/media";

type Person = { id: string; full_name: string | null; username: string | null; avatar_url: string | null; headline: string | null };
type PostHit = { id: string; user_id: string; content: string | null; created_at: string; author?: Person | null };
type JobHit = { id: string; title: string; company: string | null; location: string | null; salary_range: string | null };
type ListingHit = { id: string; title: string; price: number; currency: string; images: string[]; seller_id: string };
type MediaHit = { post_id: string; url: string; media_type: string | null; width: number | null; height: number | null; created_at: string };
type ArticleHit = { post_id: string; article_title: string | null; read_minutes: number | null; created_at: string; author_name: string | null; author_username: string | null; author_avatar: string | null };
type PlaceHit = { name: string; kind: string; hits: number };
type Topic = { topic: string; post_count: number };

const RECENT_KEY = "tbn_recent_searches_v1";
const MAX_RECENT = 8;
const CHIPS: [string, string][] = [["all", "All"], ["people", "People"], ["posts", "Posts"], ["media", "Media"], ["articles", "Articles"], ["jobs", "Jobs"], ["market", "Market"], ["places", "Places"]];

export default function SearchPage() {
  const supabase = useRef(createClient()).current;
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [people, setPeople] = useState<Person[]>([]);
  const [posts, setPosts] = useState<PostHit[]>([]);
  const [jobs, setJobs] = useState<JobHit[]>([]);
  const [listings, setListings] = useState<ListingHit[]>([]);
  const [media, setMedia] = useState<MediaHit[]>([]);
  const [articles, setArticles] = useState<ArticleHit[]>([]);
  const [places, setPlaces] = useState<PlaceHit[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    supabase.rpc("get_trending_topics", { p_limit: 8 }).then(({ data }) => setTopics((data ?? []) as Topic[]));
    try {
      const raw = window.localStorage.getItem(RECENT_KEY);
      if (raw) setRecent(JSON.parse(raw) as string[]);
    } catch { /* ignore */ }
  }, [supabase]);

  const saveRecent = useCallback((term: string) => {
    const t = term.trim();
    if (!t) return;
    setRecent((prev) => {
      const next = [t, ...prev.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX_RECENT);
      try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const removeRecent = (term: string) => {
    setRecent((prev) => {
      const next = prev.filter((x) => x !== term);
      try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const clearRecent = () => {
    setRecent([]);
    try { window.localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
  };

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setSearched(false); setPeople([]); setPosts([]); setJobs([]); setListings([]); setMedia([]); setArticles([]); setPlaces([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const like = "%" + query + "%";
      const { data: sess } = await supabase.auth.getSession();
      const myId = sess.session?.user.id ?? null;
      const { data: blk } = await supabase.from("blocked_users").select("blocker_id, blocked_id").or("blocker_id.eq." + (myId ?? "") + ",blocked_id.eq." + (myId ?? ""));
      const blocked = new Set<string>((blk ?? []).map((b) => (b.blocker_id === myId ? b.blocked_id : b.blocker_id)));
      const [pplRes, postRes, jobRes, mktRes, mediaRes, artRes, placeRes] = await Promise.all([
        supabase.from("profiles").select("id, full_name, username, avatar_url, headline").or("full_name.ilike." + like + ",username.ilike." + like + ",headline.ilike." + like + ",location.ilike." + like).neq("id", myId ?? "").limit(25),
        supabase.rpc("search_posts", { p_q: query, p_limit: 20 }),
        supabase.from("jobs").select("id, title, company, location, salary_range").or("title.ilike." + like + ",company.ilike." + like + ",location.ilike." + like + ",industry.ilike." + like).order("created_at", { ascending: false }).limit(10),
        supabase.from("marketplace_listings").select("id, title, price, currency, images, seller_id").eq("status", "available").or("title.ilike." + like + ",description.ilike." + like + ",category.ilike." + like + ",location_city.ilike." + like).order("created_at", { ascending: false }).limit(10),
        supabase.rpc("search_media", { p_q: query, p_limit: 18 }),
        supabase.rpc("search_articles", { p_q: query, p_limit: 6 }),
        supabase.rpc("search_places", { p_q: query }),
      ]);
      setPeople(((pplRes.data ?? []) as Person[]).filter((p) => !blocked.has(p.id)).slice(0, 10));
      const postList = ((postRes.data ?? []) as PostHit[]).filter((p) => !blocked.has(p.user_id)).slice(0, 10);
      const authorIds = Array.from(new Set(postList.map((p) => p.user_id)));
      if (authorIds.length > 0) {
        const { data: authors } = await supabase.from("profiles").select("id, full_name, username, avatar_url, headline").in("id", authorIds);
        const map = new Map(((authors ?? []) as Person[]).map((a) => [a.id, a]));
        postList.forEach((p) => { p.author = map.get(p.user_id) ?? null; });
      }
      setPosts(postList);
      setJobs((jobRes.data ?? []) as JobHit[]);
      setListings(((mktRes.data ?? []) as ListingHit[]).filter((l) => !blocked.has(l.seller_id)));
      setMedia((mediaRes.data ?? []) as MediaHit[]);
      setArticles((artRes.data ?? []) as ArticleHit[]);
      setPlaces((placeRes.data ?? []) as PlaceHit[]);
      setSearching(false);
      setSearched(true);
    }, 350);
    return () => clearTimeout(t);
  }, [q, supabase]);

  const show = (k: string) => filter === "all" || filter === k;
  const openPlace = (p: PlaceHit) => {
    const key = p.kind === "jobs" ? "jobs" : p.kind === "market" ? "market" : "people";
    saveRecent(p.name);
    setFilter(key);
    setQ(p.name);
  };

  const head = "pb-1 pt-5 text-[12px] font-semibold uppercase tracking-wide text-ink/40";
  const nothing = searched && !searching && people.length === 0 && posts.length === 0 && jobs.length === 0 && listings.length === 0 && media.length === 0 && articles.length === 0 && places.length === 0;
  const counts: Record<string, number> = { people: people.length, posts: posts.length, media: media.length, articles: articles.length, jobs: jobs.length, market: listings.length, places: places.length };
  const filterEmpty = searched && !searching && !nothing && filter !== "all" && (counts[filter] ?? 0) === 0;

  return (
    <div className="px-1">
      <div className="flex items-center gap-2">
        <button onClick={() => router.back()} title="Back" className="shrink-0 rounded-full p-2 text-ink/60 transition-colors hover:bg-surface hover:text-ink"><ArrowLeft size={19} /></button>
      <div className="relative flex-1">
        <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink/30" />
        <input value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") saveRecent(q); }}
          placeholder="Search Platinum Circles"
          autoFocus
          className="w-full rounded-lg bg-surface py-3 pl-11 pr-4 text-[15px] text-ink placeholder:text-ink/30 outline-none focus:bg-surface-elevated"
        />
      </div>
      </div>

      {q.trim().length >= 2 ? (
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {CHIPS.map((c) => (
            <button key={c[0]} onClick={() => setFilter(c[0])}
              className={(filter === c[0] ? "bg-ink text-white" : "bg-surface text-ink/70 hover:bg-surface-elevated hover:text-ink") + " shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors"}>
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
                    <Link key={t.topic} href={"/topic/" + encodeURIComponent(tag.slice(1))} className="rounded-full bg-surface px-3.5 py-1.5 text-[13px] text-ink/80 transition-colors hover:bg-surface-elevated hover:text-ink">
                      {tag} <span className="text-ink/40">· {t.post_count}</span>
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
                <button onClick={clearRecent} className="pt-4 text-[12px] font-medium text-ink/50 transition-colors hover:text-ink">Clear</button>
              </div>
              {recent.map((r) => (
                <div key={r} className="flex items-center gap-3 rounded-md px-1 py-2 transition-colors hover:bg-surface">
                  <Search size={15} className="shrink-0 text-ink/30" />
                  <button onClick={() => setQ(r)} className="min-w-0 flex-1 truncate text-left text-[14px] text-ink">{r}</button>
                  <button onClick={() => removeRecent(r)} title="Remove" className="shrink-0 rounded-full p-1 text-ink/30 transition-colors hover:bg-surface-elevated hover:text-ink"><X size={14} /></button>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : searching && !searched ? (
        <p className="py-14 text-center text-sm text-ink/40">Searching</p>
      ) : nothing ? (
        <p className="py-14 text-center text-sm text-ink/40">Nothing found for &ldquo;{q.trim()}&rdquo;.</p>
      ) : (
        <>
          {filterEmpty ? (
            <p className="py-14 text-center text-sm text-ink/40">No results here for &ldquo;{q.trim()}&rdquo;. Try another tab.</p>
          ) : null}

          {show("people") && people.length > 0 ? (
            <section>
              <p className={head}>People</p>
              {people.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-md px-1 py-2 transition-colors hover:bg-surface">
                  <StoryAvatar userId={p.id} name={p.full_name} avatarUrl={p.avatar_url} size={42} href={p.username ? "/" + p.username : null} />
                  <Link href={p.username ? "/" + p.username : "#"} onClick={() => saveRecent(q)} className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{p.full_name}</span>
                    <span className="block truncate text-[12px] text-ink/45">{p.headline || "@" + (p.username ?? "")}</span>
                  </Link>
                  <FollowButton authorId={p.id} />
                </div>
              ))}
            </section>
          ) : null}

          {show("posts") && posts.length > 0 ? (
            <section>
              <p className={head}>Posts</p>
              {posts.map((p) => (
                <Link key={p.id} href={"/post/" + p.id} onClick={() => saveRecent(q)} className="flex gap-3 rounded-md px-1 py-2.5 transition-colors hover:bg-surface">
                  <StoryAvatar userId={p.user_id} name={p.author?.full_name} avatarUrl={p.author?.avatar_url} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5 text-[13px]">
                      <span className="truncate font-semibold text-ink">{p.author?.full_name ?? "Member"}</span>
                      <span className="shrink-0 text-ink/40">{timeAgo(p.created_at)}</span>
                    </span>
                    <span className="line-clamp-2 block text-[13px] text-ink/80"><RichText text={p.content ?? ""} /></span>
                  </span>
                </Link>
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
                      <span className="flex h-full w-full items-center justify-center bg-ink text-white/80"><Play size={22} /></span>
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
                <Link key={a.post_id} href={"/post/" + a.post_id} onClick={() => saveRecent(q)} className="flex items-center gap-3 rounded-md px-1 py-2.5 transition-colors hover:bg-surface">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface text-pearl"><FileText size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{a.article_title || "Article"}</span>
                    <span className="block truncate text-[12px] text-ink/45">{[a.author_name, a.read_minutes ? a.read_minutes + " min read" : null, timeAgo(a.created_at)].filter(Boolean).join(" · ")}</span>
                  </span>
                </Link>
              ))}
            </section>
          ) : null}

          {show("jobs") && jobs.length > 0 ? (
            <section>
              <p className={head}>Jobs</p>
              {jobs.map((j) => (
                <Link key={j.id} href={"/jobs/" + j.id} onClick={() => saveRecent(q)} className="flex items-center gap-3 rounded-md px-1 py-2.5 transition-colors hover:bg-surface">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface text-pearl"><Briefcase size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{j.title}</span>
                    <span className="block truncate text-[12px] text-ink/45">{[j.company, j.location, j.salary_range].filter(Boolean).join(" · ")}</span>
                  </span>
                </Link>
              ))}
            </section>
          ) : null}

          {show("market") && listings.length > 0 ? (
            <section>
              <p className={head}>Market</p>
              {listings.map((l) => (
                <Link key={l.id} href={"/market/" + l.id} onClick={() => saveRecent(q)} className="flex items-center gap-3 rounded-md px-1 py-2.5 transition-colors hover:bg-surface">
                  {l.images?.[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={displayImageUrl(l.images[0], 200)!} onError={(e) => { if (l.images?.[0] && e.currentTarget.src !== l.images[0]) e.currentTarget.src = l.images[0]; }} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover" />
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-surface text-pearl"><ShoppingBag size={16} /></span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{l.title}</span>
                    <span className="block text-[13px] text-pearl">{(l.currency === "USD" ? "$" : l.currency + " ") + Number(l.price).toLocaleString()}</span>
                  </span>
                </Link>
              ))}
            </section>
          ) : null}

          {show("places") && places.length > 0 ? (
            <section>
              <p className={head}>Places</p>
              {places.map((p) => (
                <button key={p.name + "-" + p.kind} onClick={() => openPlace(p)} className="flex w-full items-center gap-3 rounded-md px-1 py-2.5 text-left transition-colors hover:bg-surface">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface text-pearl"><MapPin size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{p.name}</span>
                    <span className="block truncate text-[12px] text-ink/45">{p.hits + (p.hits === 1 ? " result" : " results") + " in " + (p.kind === "jobs" ? "Jobs" : p.kind === "market" ? "Market" : "People")}</span>
                  </span>
                </button>
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}