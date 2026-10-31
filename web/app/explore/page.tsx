"use client";

import { profilePath } from "@/lib/profileLookup";
import { useEffect, useState } from "react";
import Link from "next/link";
import { TrendingUp, Briefcase } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import type { FeedRow } from "@/lib/feed";
import { PostCard } from "@/components/PostCard";
import { ListingCard } from "@/components/ListingCard";
import { StoryAvatar } from "@/components/StoryAvatar";
import { FollowButton } from "@/components/FollowButton";
import type { Listing } from "@/lib/market";
import { withTimeout } from "@/lib/withTimeout";

type Topic = { topic: string; post_count: number };
type Person = { id: string; full_name: string | null; username: string | null; avatar_url: string | null; headline: string | null };
type JobHit = { id: string; title: string; company: string | null; location: string | null; salary_range: string | null };

export default function ExplorePage() {
  const [supabase] = useState(createClient);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [posts, setPosts] = useState<FeedRow[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [jobs, setJobs] = useState<JobHit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void withTimeout((async () => {
      const { data: sess, error: authError } = await supabase.auth.getSession();
      if (authError) throw authError;
      const uid = sess.session?.user.id ?? null;
      const [t, feedT, feedL, ppl, mkt, jb] = await Promise.all([
        supabase.rpc("get_trending_topics", { p_days: 7, p_limit: 10 }),
        supabase.rpc("get_feed", { p_mode: "trending", p_cursor_key: null, p_cursor_id: null, p_limit: 20 }),
        supabase.rpc("get_feed", { p_mode: "latest", p_cursor_key: null, p_cursor_id: null, p_limit: 30 }),
        uid
          ? supabase.from("profiles").select("id, full_name, username, avatar_url, headline, connections_count").neq("id", uid).is("deactivated_at", null).order("connections_count", { ascending: false, nullsFirst: false }).limit(12)
          : Promise.resolve({ data: [] as Person[], error: null }),
        supabase.from("marketplace_listings").select("*").eq("status", "available").order("created_at", { ascending: false }).limit(8),
        supabase.from("jobs").select("id, title, company, location, salary_range").order("created_at", { ascending: false }).limit(5),
      ]);
      for (const response of [t, feedT, feedL, ppl, mkt, jb]) if (response.error) throw response.error;
      let nextPosts: FeedRow[] = [];
      // Same order as the phone's Discover: the server scores every candidate
      // (engagement with recency decay, media bonus, seen push-down, daily
      // rotation), then authors are spaced so nobody gets more than two in a row.
      {
        const seen = new Set<string>(); const merged: FeedRow[] = [];
        for (const r of [...((feedT.data ?? []) as FeedRow[]), ...((feedL.data ?? []) as FeedRow[])]) { if (!seen.has(r.post_id)) { seen.add(r.post_id); merged.push(r); } }
        let ordered = merged;
        try {
          const { data: ranked } = await supabase.rpc("rank_discover", { p_ids: merged.map((r) => r.post_id) });
          const score = new Map<string, number>(); ((ranked ?? []) as {id:string;score:number|string}[]).forEach((x) => score.set(x.id, Number(x.score) || 0));
          if (score.size) {
            merged.sort((a, b) => (score.get(b.post_id) ?? 0) - (score.get(a.post_id) ?? 0));
            const spaced: FeedRow[] = []; const deferred: FeedRow[] = []; let last: string | null = null; let run = 0;
            for (const r of merged) { const au = r.author_id ?? null; if (au && au === last && run >= 2) { deferred.push(r); continue; } if (au === last) run += 1; else { last = au; run = 1; } spaced.push(r); }
            ordered = [...spaced, ...deferred];
          }
        } catch { /* fall back to fetch order */ }
        nextPosts = ordered.slice(0, 20);
      }
      let candidates = (ppl.data ?? []) as Person[];
      if (uid && candidates.length > 0) {
        const { data: fRows, error: followingError } = await supabase.from("follows").select("following_id").eq("follower_id", uid);
        if (followingError) throw followingError;
        const followed = new Set((fRows ?? []).map((r) => r.following_id as string));
        candidates = candidates.filter((c) => !followed.has(c.id));
      }
      return { topics: ((t.data ?? []) as Topic[]).slice(0, 10), posts: nextPosts, people: candidates.slice(0, 6), listings: (mkt.data ?? []) as Listing[], jobs: (jb.data ?? []) as JobHit[] };
    })()).then(result => {
      if (!active) return;
      setTopics(result.topics); setPosts(result.posts); setPeople(result.people); setListings(result.listings); setJobs(result.jobs); setLoaded(true); setError(false);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [supabase, attempt]);

  const head = "flex items-center gap-1.5 pb-2 pt-7 text-[15px] font-semibold text-ink";

  if (error) return <div role="alert" className="px-1 py-8 text-sm text-muted"><h1 className="font-display text-xl text-porcelain">Explore</h1><p className="mt-3">Could not load Explore. Please try again.</p><button type="button" className="mt-3 underline" onClick={() => { setError(false); setAttempt(value => value + 1); }}>Try again</button></div>;
  if (!loaded) return <p role="status" className="py-16 text-center text-sm text-muted">Loading</p>;

  return (
    <div className="px-1">
      <h1 className="font-display text-xl text-porcelain">Explore</h1>

      {topics.length > 0 ? (
        <>
          <h2 className={head}><TrendingUp size={16} className="text-accent" /> Trending</h2>
          <div className="flex flex-wrap gap-2">
            {topics.map((t) => {
              const tag = t.topic.startsWith("#") ? t.topic : "#" + t.topic;
              return (
                <Link key={t.topic} href={"/topic/" + encodeURIComponent(tag.slice(1))} className="rounded-full bg-surface px-3.5 py-1.5 text-[13px] text-ink/80 transition-colors hover:bg-surface-elevated hover:text-ink">
                  {tag} <span className="text-muted">· {t.post_count}</span>
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
              <div key={p.id} className="flex flex-col items-center gap-2 rounded-xl border border-ink/10 p-4 text-center">
                <StoryAvatar userId={p.id} name={p.full_name} avatarUrl={p.avatar_url} size={56} href={p.username ? "/" + p.username : null} />
                <Link href={profilePath(p.username, p.id)} className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-ink">{p.full_name} <VerifiedBadge userId={p.id} size={13} /></span>
                  <span className="block truncate text-[12px] text-muted">{p.headline || "@" + (p.username ?? "")}</span>
                </Link>
                <FollowButton authorId={p.id} size="md" />
              </div>
            ))}
          </div>
        </>
      ) : null}

      {listings.length > 0 ? (
        <>
          <h2 className={head}>Fresh on the Market <Link href="/market" className="ml-auto text-[12px] font-normal text-accent hover:underline">See all</Link></h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {listings.map((l) => <ListingCard key={l.id} l={l} />)}
          </div>
        </>
      ) : null}

      {jobs.length > 0 ? (
        <>
          <h2 className={head}>Latest jobs <Link href="/jobs" className="ml-auto text-[12px] font-normal text-accent hover:underline">See all</Link></h2>
          {jobs.map((j) => (
            <Link key={j.id} href={"/jobs/" + j.id} className="flex items-center gap-3 rounded-md px-1 py-2.5 transition-colors hover:bg-surface">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface text-accent"><Briefcase size={16} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-ink">{j.title}</span>
                <span className="block truncate text-[12px] text-muted">{[j.company, j.location, j.salary_range].filter(Boolean).join(" · ")}</span>
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
