"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PostCard } from "@/components/PostCard";
import type { FeedRow } from "@/lib/feed";

// Discover v1: Innovation leads, then the category rail. Categories match
// on content keywords over the live pool. The learned interest graph and
// the seventy-twenty-ten mix replace keyword matching at scale.
const CATS: { key: string; label: string; words: string[] }[] = [
  { key: "innovation", label: "Innovation", words: [] },
  { key: "comedy", label: "Comedy", words: ["comedy", "funny", "joke", "skit", "lol", "haha"] },
  { key: "music", label: "Music", words: ["music", "song", "album", "artist", "beat", "zimdancehall", "sungura", "gospel"] },
  { key: "news", label: "News", words: ["news", "breaking", "report", "announced"] },
  { key: "sports", label: "Sports", words: ["sport", "match", "game", "team", "league"] },
  { key: "football", label: "Football", words: ["football", "soccer", "goal", "warriors", "premier"] },
  { key: "business", label: "Business", words: ["business", "startup", "entrepreneur", "company", "revenue"] },
  { key: "finance", label: "Finance", words: ["finance", "money", "investment", "bank", "forex", "crypto"] },
  { key: "technology", label: "Technology", words: ["tech", "technology", "software", "app", "coding", "ai"] },
  { key: "science", label: "Science", words: ["science", "research", "study", "physics", "biology"] },
  { key: "education", label: "Education", words: ["education", "school", "learning", "exam", "student"] },
  { key: "universities", label: "Universities", words: ["university", "uz", "nust", "msu", "campus", "college"] },
  { key: "fashion", label: "Fashion", words: ["fashion", "style", "outfit", "wear", "drip"] },
  { key: "beauty", label: "Beauty", words: ["beauty", "makeup", "skincare", "hair"] },
  { key: "food", label: "Food", words: ["food", "recipe", "cooking", "sadza", "restaurant", "meal"] },
  { key: "travel", label: "Travel", words: ["travel", "trip", "visit", "vacation", "victoria falls"] },
  { key: "cars", label: "Cars", words: ["car", "vehicle", "toyota", "honda", "drive", "ex-jap"] },
  { key: "property", label: "Property", words: ["property", "house", "rent", "stand", "apartment", "real estate"] },
  { key: "gaming", label: "Gaming", words: ["gaming", "game", "fifa", "playstation", "xbox"] },
  { key: "health", label: "Health & Fitness", words: ["health", "fitness", "gym", "workout", "wellness"] },
  { key: "culture", label: "Culture", words: ["culture", "tradition", "heritage", "shona", "ndebele"] },
  { key: "history", label: "History", words: ["history", "historic", "chimurenga", "great zimbabwe"] },
  { key: "agriculture", label: "Agriculture", words: ["agriculture", "farming", "farm", "tobacco", "maize", "harvest"] },
  { key: "creators", label: "Creators", words: ["creator", "content", "vlog", "youtube", "tiktok"] },
  { key: "photography", label: "Photography", words: ["photography", "photo", "camera", "shot"] },
  { key: "art", label: "Art", words: ["art", "artist", "painting", "drawing", "design"] },
  { key: "lifestyle", label: "Lifestyle", words: ["lifestyle", "life", "daily", "routine", "relationship"] },
  { key: "diaspora", label: "Diaspora", words: ["diaspora", "abroad", "uk", "usa", "south africa", "remit"] },
  { key: "market", label: "Market", words: ["market", "selling", "buy", "sale", "listing", "price"] },
  { key: "careers", label: "Careers", words: ["career", "job", "hiring", "cv", "interview", "internship"] },
];

export default function DiscoverPage() {
  const supabase = useRef(createClient()).current;
  const [cat, setCat] = useState("innovation");
  const [pool, setPool] = useState<FeedRow[]>([]);
  const [inno, setInno] = useState<FeedRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [a, b, c] = await Promise.all([
      supabase.rpc("get_feed", { p_mode: "latest", p_limit: 50 }),
      supabase.rpc("get_feed", { p_mode: "trending", p_limit: 20 }),
      supabase.rpc("get_feed", { p_mode: "innovation", p_limit: 30 }),
    ]);
    const seen = new Set<string>();
    const merged: FeedRow[] = [];
    for (const r of ([...(b.data ?? []), ...(a.data ?? [])] as FeedRow[])) {
      const rid = r.post_id + ((r as unknown as { reposted_by_id?: string | null }).reposted_by_id ?? "");
      if (!seen.has(rid) && !(r as unknown as { reposted_by_id?: string | null }).reposted_by_id) { seen.add(rid); merged.push(r); }
    }
    setPool(merged);
    setInno(((c.data ?? []) as FeedRow[]).filter((r) => !(r as unknown as { reposted_by_id?: string | null }).reposted_by_id));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const active = CATS.find((x) => x.key === cat) ?? CATS[0];
  const shown = cat === "innovation"
    ? inno
    : pool.filter((r) => {
        const hay = ((r.content ?? "") + " " + (r.article_title ?? "")).toLowerCase();
        return active.words.some((w) => hay.includes(w));
      });

  return (
    <div className="px-1">
      <h1 className="pb-1 font-display text-xl text-porcelain">Discover</h1>
      <p className="pb-3 text-[13px] text-ink/50">What Zimbabwe is talking about, by interest.</p>
      <div className="sticky top-0 z-10 -mx-1 flex gap-1.5 overflow-x-auto bg-white/90 px-1 py-2 backdrop-blur">
        {CATS.map((c) => (
          <button key={c.key} onClick={() => setCat(c.key)}
            className={"shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors " + (c.key === cat ? "bg-pearl text-ink" : "bg-surface text-ink/60 hover:bg-surface-elevated")}
          >
            {c.label}
          </button>
        ))}
      </div>
      {loading ? (
        <p className="py-16 text-center text-sm text-ink/40">Loading</p>
      ) : shown.length === 0 ? (
        <p className="mt-4 rounded-lg border border-ink/10 p-5 text-center text-[13px] text-ink/45">
          Nothing in {active.label} yet. The first post claims the category.
        </p>
      ) : (
        <div>
          {shown.map((r) => <PostCard key={r.post_id} post={r} />)}
        </div>
      )}
    </div>
  );
}