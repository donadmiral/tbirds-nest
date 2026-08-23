"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ListingCard } from "@/components/ListingCard";
import { JobCard } from "@/components/JobCard";
import { getMarketFeed, type Listing } from "@/lib/market";
import { PostCard } from "@/components/PostCard";
import type { FeedRow } from "@/lib/feed";
import type { JobRow } from "@/lib/jobs";

const CITIES = ["All Zimbabwe", "Harare", "Bulawayo", "Mutare", "Gweru", "Masvingo"];

// Local: the Zimbabwe commerce surface. Listings and jobs near the
// chosen city, live data from day one, no empty-profile problem.
export function LocalFeed() {
  const supabase = useRef(createClient()).current;
  const [city, setCity] = useState("All Zimbabwe");
  const [listings, setListings] = useState<Listing[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [bizPosts, setBizPosts] = useState<FeedRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try { const c = localStorage.getItem("pc_local_city"); if (c && CITIES.includes(c)) setCity(c); } catch { /* fine */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [ls, jb, fp] = await Promise.all([
      getMarketFeed({ limit: 30 }),
      supabase.from("jobs").select("*").order("created_at", { ascending: false }).limit(30),
      supabase.rpc("get_feed", { p_mode: "latest", p_limit: 40 }),
    ]);
    setListings(ls);
    setJobs(((jb.data ?? []) as unknown) as JobRow[]);
    setBizPosts((((fp.data ?? []) as FeedRow[]).filter((r) => r.author_kind === "business" && !(r as unknown as { reposted_by_id?: string | null }).reposted_by_id)).slice(0, 4));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  function pick(c: string) {
    setCity(c);
    try { localStorage.setItem("pc_local_city", c); } catch { /* fine */ }
  }

  const inCity = (loc: string | null | undefined) =>
    city === "All Zimbabwe" || (loc ?? "").toLowerCase().includes(city.toLowerCase());
  const shownListings = listings.filter((l) => inCity((l as unknown as { location_city?: string | null }).location_city)).slice(0, 8);
  const shownJobs = jobs.filter((j) => inCity((j as unknown as { location?: string | null }).location)).slice(0, 6);

  const head = "flex items-baseline justify-between pb-2 pt-6";
  const h2 = "text-[15px] font-semibold text-ink";
  const see = "text-[12px] font-semibold text-pearl-muted hover:underline";

  return (
    <div className="px-1">
      <div className="flex gap-1.5 overflow-x-auto pt-3">
        {CITIES.map((c) => (
          <button key={c} onClick={() => pick(c)}
            className={"shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors " + (c === city ? "bg-pearl text-ink" : "bg-surface text-ink/60 hover:bg-surface-elevated")}
          >
            {c}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="py-16 text-center text-sm text-ink/40">Loading {city}</p>
      ) : (
        <>
          <div className={head}>
            <h2 className={h2}>Marketplace {city === "All Zimbabwe" ? "across Zimbabwe" : "in " + city}</h2>
            <Link href="/market" className={see}>See all</Link>
          </div>
          {shownListings.length === 0 ? (
            <p className="rounded-lg border border-ink/10 p-4 text-[13px] text-ink/45">Nothing listed here yet. Be the first, list something on the Market.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {shownListings.map((l) => <ListingCard key={l.id} l={l} />)}
            </div>
          )}

          <div className={head}>
            <h2 className={h2}>Jobs {city === "All Zimbabwe" ? "across Zimbabwe" : "in " + city}</h2>
            <Link href="/jobs" className={see}>See all</Link>
          </div>
          {shownJobs.length === 0 ? (
            <p className="rounded-lg border border-ink/10 p-4 text-[13px] text-ink/45">No openings here right now. New roles land as employers post them.</p>
          ) : (
            <div className="flex flex-col gap-2.5 pb-6">
              {shownJobs.map((j) => <JobCard key={(j as unknown as { id: string }).id} job={j as JobRow & { profile?: null }} />)}
            </div>
          )}
          {bizPosts.length > 0 ? (
            <>
              <div className={head}>
                <h2 className={h2}>From Zimbabwe businesses</h2>
              </div>
              <div>
                {bizPosts.map((r) => <PostCard key={r.post_id} post={r} />)}
              </div>
            </>
          ) : null}
          <p className="flex items-center gap-1.5 pb-8 pt-2 text-[12px] text-ink/35">
            <MapPin size={13} /> Local shows Zimbabwe listings, jobs and business posts. City filters apply to listings and jobs.
          </p>
        </>
      )}
    </div>
  );
}