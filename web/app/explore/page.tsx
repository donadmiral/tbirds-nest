"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TrendingUp, Briefcase } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { FeedRow } from "@/lib/feed";
import { PostCard } from "@/components/PostCard";
import { ListingCard } from "@/components/ListingCard";
import { StoryAvatar } from "@/components/StoryAvatar";
import { FollowButton } from "@/components/FollowButton";
import type { Listing } from "@/lib/market";

type Topic = { topic: string; post_count: number };
type Person = { id: string; full_name: string | null; username: string | null; avatar_url: string | null; headline: string | null };
type JobHit = { id: string; title: string; company: string | null; location: string | null; salary_range: string | null };

export default function ExplorePage() {
  const supabase = useRef(createClient()).current;
  const [topics, setTopics] = useState<Topic[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [posts, setPosts] = useState<FeedRow[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [jobs, setJobs] = useState<JobHit[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id ?? null;
      const [t, feed, ppl, mkt, jb] = await Promise.all([
        supabase.rpc("get_trending_topics", { p_days: 7, p_limit: 10 }),
        supabase.rpc("get_feed", { p_mode: "trending", p_cursor_key: null, p_cursor_id: null, p_limit: 10 }),
        uid
          ? supabase.from("profiles").select("id, full_name, username, avatar_url, headline, connections_count").neq("id", uid).is("deactivated_at", null).order("connections_count", { ascending: false, nullsFirst: false }).limit(12)
          : Promise.resolve({ data: [] as Person[] }),
        supabase.from("marketplace_listings").select("*").eq("status", "available").order("created_at", { ascending: false }).limit(8),
        supabase.from("jobs").select("id, title, company, location, salary_range").order("created_at", { ascending: false }).limit(5),
      ]);
      setTopics(((t.data ?? []) as Topic[]).slice(0, 10));
      setPosts((feed.data ?? []) as FeedRow[]);
      let candidates = (ppl.data ?? []) as Person[];
      if (uid && candidates.length > 0) {
        const { data: fRows } = await supabase.from("follows").select("following_id").eq("follower_id", uid);
        const followed = new Set((fRows ?? []).map((r) => r.following_id as string));
        candidates = candidates.filter((c) => !followed.has(c.id));
      }
      setPeople(candidates.slice(0, 6));
      setListings((mkt.data ?? []) as Listing[]);
      setJobs((jb.data ?? []) as JobHit[]);
      setLoaded(true);
    })();
  }, [supabase]);

  const head = "flex items-center gap-1.5 pb-2 pt-7 text-[15px] font-semibold text-white";

  if (!loaded) return <p className="py-16 text-center text-sm text-white/40">Loading</p>;

  return (
    <div className="px-1">
      <h1 className="font-display text-xl text-porcelain">Explore</h1>

      {topics.length > 0 ? (
        <>
          <h2 className={head}><TrendingUp size={16} className="text-pearl" /> Trending</h2>
          <div className="flex flex-wrap gap-2">
            {topics.map((t) => {
              const tag = t.topic.startsWith("#") ? t.topic : "#" + t.topic;
              return (
                <Link key={t.topic} href={"/topic/" + encodeURIComponent(tag.slice(1))} className="rounded-full bg-surface px-3.5 py-1.5 text-[13px] text-white/80 transition-colors hover:bg-surface-elevated hover:text-white">
                  {tag} <span className="text-white/40">· {t.post_count}</span>
                </Link>
              );
            })}
          </div>
        </>
      ) : null}

      {people.length > 0 ? (
        <>
          <h2 className={head}>People to follow</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {people.map((p) => (
              <div key={p.id} className="flex flex-col items-center gap-2 rounded-xl border border-white/10 p-4 text-center">
                <StoryAvatar userId={p.id} name={p.full_name} avatarUrl={p.avatar_url} size={56} href={p.username ? "/" + p.username : null} />
                <Link href={p.username ? "/" + p.username : "#"} className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-white">{p.full_name}</span>
                  <span className="block truncate text-[12px] text-white/45">{p.headline || "@" + (p.username ?? "")}</span>
                </Link>
                <FollowButton authorId={p.id} size="md" />
              </div>
            ))}
          </div>
        </>
      ) : null}

      {listings.length > 0 ? (
        <>
          <h2 className={head}>Fresh on the Market <Link href="/market" className="ml-auto text-[12px] font-normal text-pearl hover:underline">See all</Link></h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {listings.map((l) => <ListingCard key={l.id} l={l} />)}
          </div>
        </>
      ) : null}

      {jobs.length > 0 ? (
        <>
          <h2 className={head}>Latest jobs <Link href="/jobs" className="ml-auto text-[12px] font-normal text-pearl hover:underline">See all</Link></h2>
          {jobs.map((j) => (
            <Link key={j.id} href={"/jobs/" + j.id} className="flex items-center gap-3 rounded-md px-1 py-2.5 transition-colors hover:bg-surface">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface text-pearl"><Briefcase size={16} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-white">{j.title}</span>
                <span className="block truncate text-[12px] text-white/45">{[j.company, j.location, j.salary_range].filter(Boolean).join(" · ")}</span>
              </span>
            </Link>
          ))}
        </>
      ) : null}

      {posts.length > 0 ? (
        <>
          <h2 className={head}>Trending posts</h2>
          {posts.map((p) => <PostCard key={p.post_id} post={p} />)}
        </>
      ) : null}
    </div>
  );
}