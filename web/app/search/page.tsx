"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Briefcase, ShoppingBag, ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { StoryAvatar } from "@/components/StoryAvatar";
import { FollowButton } from "@/components/FollowButton";
import { RichText } from "@/components/RichText";
import { timeAgo } from "@/lib/feed";

type Person = { id: string; full_name: string | null; username: string | null; avatar_url: string | null; headline: string | null };
type PostHit = { id: string; user_id: string; content: string | null; created_at: string; author?: Person | null };
type JobHit = { id: string; title: string; company: string | null; location: string | null; salary_range: string | null };
type ListingHit = { id: string; title: string; price: number; currency: string; images: string[]; seller_id: string };
type Topic = { topic: string; post_count: number };

export default function SearchPage() {
  const supabase = useRef(createClient()).current;
  const router = useRouter();
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [posts, setPosts] = useState<PostHit[]>([]);
  const [jobs, setJobs] = useState<JobHit[]>([]);
  const [listings, setListings] = useState<ListingHit[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    supabase.rpc("get_trending_topics", { p_limit: 8 }).then(({ data }) => setTopics((data ?? []) as Topic[]));
  }, [supabase]);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setSearched(false); setPeople([]); setPosts([]); setJobs([]); setListings([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const like = "%" + query + "%";
      const { data: sess } = await supabase.auth.getSession();
      const myId = sess.session?.user.id ?? null;
      const { data: blk } = await supabase.from("blocked_users").select("blocker_id, blocked_id").or("blocker_id.eq." + (myId ?? "") + ",blocked_id.eq." + (myId ?? ""));
      const blocked = new Set<string>((blk ?? []).map((b) => (b.blocker_id === myId ? b.blocked_id : b.blocker_id)));
      const [pplRes, postRes, jobRes, mktRes] = await Promise.all([
        supabase.from("profiles").select("id, full_name, username, avatar_url, headline").or("full_name.ilike." + like + ",username.ilike." + like + ",headline.ilike." + like).neq("id", myId ?? "").limit(25),
        supabase.rpc("search_posts", { p_q: query, p_limit: 20 }),
        supabase.from("jobs").select("id, title, company, location, salary_range").or("title.ilike." + like + ",company.ilike." + like + ",location.ilike." + like + ",industry.ilike." + like).order("created_at", { ascending: false }).limit(10),
        supabase.from("marketplace_listings").select("id, title, price, currency, images, seller_id").eq("status", "available").or("title.ilike." + like + ",description.ilike." + like + ",category.ilike." + like).order("created_at", { ascending: false }).limit(10),
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
      setSearching(false);
      setSearched(true);
    }, 350);
    return () => clearTimeout(t);
  }, [q, supabase]);

  const head = "pb-1 pt-5 text-[12px] font-semibold uppercase tracking-wide text-white/40";
  const nothing = searched && !searching && people.length === 0 && posts.length === 0 && jobs.length === 0 && listings.length === 0;

  return (
    <div className="px-1">
      <div className="flex items-center gap-2">
        <button onClick={() => router.back()} title="Back" className="shrink-0 rounded-full p-2 text-white/60 transition-colors hover:bg-surface hover:text-white"><ArrowLeft size={19} /></button>
      <div className="relative flex-1">
        <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
        <input value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search Platinum Circles"
          autoFocus
          className="w-full rounded-lg bg-surface py-3 pl-11 pr-4 text-[15px] text-white placeholder:text-white/30 outline-none focus:bg-surface-elevated"
        />
      </div>
      </div>

      {q.trim().length < 2 ? (
        topics.length > 0 ? (
          <div className="pt-5">
            <p className={head}>Trending</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {topics.map((t) => {
                const tag = t.topic.startsWith("#") ? t.topic : "#" + t.topic;
                return (
                  <Link key={t.topic} href={"/topic/" + encodeURIComponent(tag.slice(1))} className="rounded-full bg-surface px-3.5 py-1.5 text-[13px] text-white/80 transition-colors hover:bg-surface-elevated hover:text-white">
                    {tag} <span className="text-white/40">· {t.post_count}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null
      ) : searching && !searched ? (
        <p className="py-14 text-center text-sm text-white/40">Searching</p>
      ) : nothing ? (
        <p className="py-14 text-center text-sm text-white/40">Nothing found for &ldquo;{q.trim()}&rdquo;.</p>
      ) : (
        <>
          {people.length > 0 ? (
            <section>
              <p className={head}>People</p>
              {people.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-md px-1 py-2 transition-colors hover:bg-surface">
                  <StoryAvatar userId={p.id} name={p.full_name} avatarUrl={p.avatar_url} size={42} href={p.username ? "/" + p.username : null} />
                  <Link href={p.username ? "/" + p.username : "#"} className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-white">{p.full_name}</span>
                    <span className="block truncate text-[12px] text-white/45">{p.headline || "@" + (p.username ?? "")}</span>
                  </Link>
                  <FollowButton authorId={p.id} />
                </div>
              ))}
            </section>
          ) : null}

          {posts.length > 0 ? (
            <section>
              <p className={head}>Posts</p>
              {posts.map((p) => (
                <Link key={p.id} href={"/post/" + p.id} className="flex gap-3 rounded-md px-1 py-2.5 transition-colors hover:bg-surface">
                  <StoryAvatar userId={p.user_id} name={p.author?.full_name} avatarUrl={p.author?.avatar_url} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5 text-[13px]">
                      <span className="truncate font-semibold text-white">{p.author?.full_name ?? "Member"}</span>
                      <span className="shrink-0 text-white/40">{timeAgo(p.created_at)}</span>
                    </span>
                    <span className="line-clamp-2 block text-[13px] text-white/80"><RichText text={p.content ?? ""} /></span>
                  </span>
                </Link>
              ))}
            </section>
          ) : null}

          {jobs.length > 0 ? (
            <section>
              <p className={head}>Jobs</p>
              {jobs.map((j) => (
                <Link key={j.id} href={"/jobs/" + j.id} className="flex items-center gap-3 rounded-md px-1 py-2.5 transition-colors hover:bg-surface">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface text-pearl"><Briefcase size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-white">{j.title}</span>
                    <span className="block truncate text-[12px] text-white/45">{[j.company, j.location, j.salary_range].filter(Boolean).join(" · ")}</span>
                  </span>
                </Link>
              ))}
            </section>
          ) : null}

          {listings.length > 0 ? (
            <section>
              <p className={head}>Market</p>
              {listings.map((l) => (
                <Link key={l.id} href={"/market/" + l.id} className="flex items-center gap-3 rounded-md px-1 py-2.5 transition-colors hover:bg-surface">
                  {l.images?.[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.images[0]} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover" />
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-surface text-pearl"><ShoppingBag size={16} /></span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-white">{l.title}</span>
                    <span className="block text-[13px] text-pearl">{(l.currency === "USD" ? "$" : l.currency + " ") + Number(l.price).toLocaleString()}</span>
                  </span>
                </Link>
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}