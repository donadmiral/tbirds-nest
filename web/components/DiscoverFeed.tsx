"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DiscoverTile } from "@/components/DiscoverTile";
import { EmptyState } from "@/components/ui";
import { CATEGORIES } from "@/lib/categories";
import type { FeedRow } from "@/lib/feed";

// Discover: Innovation leads, exact category matches outrank keyword
// guesses, the interest graph replaces keywords at scale.
export function DiscoverFeed() {
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
      if (!seen.has(r.post_id) && !(r as unknown as { reposted_by_id?: string | null }).reposted_by_id) { seen.add(r.post_id); merged.push(r); }
    }
    setPool(merged);
    setInno(((c.data ?? []) as FeedRow[]).filter((r) => !(r as unknown as { reposted_by_id?: string | null }).reposted_by_id));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const active = CATEGORIES.find((x) => x.key === cat) ?? CATEGORIES[0];
  const density = (r: FeedRow) => {
    const hours = Math.max(1, (Date.now() - new Date(r.created_at).getTime()) / 3600000);
    return ((r.likes_count ?? 0) + (r.comments_count ?? 0) * 2.5 + (r.reposts_count ?? 0) * 2) / Math.pow(hours + 2, 1.2);
  };
  const shownRaw = cat === "innovation"
    ? inno
    : pool.filter((r) => {
        const rc = (r as unknown as { category?: string | null }).category;
        if (rc) return rc === cat;
        const hay = ((r.content ?? "") + " " + (r.article_title ?? "")).toLowerCase();
        return active.words.some((w) => hay.includes(w));
      });
  const shown = shownRaw.slice().sort((a, b) => density(b) - density(a));
  // The lead slot only earns its size if it has something to show.
  const heroIdx = shown.findIndex((r) => (r.media ?? []).length > 0);
  const hero = heroIdx >= 0 ? shown[heroIdx] : null;
  const rest = hero ? shown.filter((_, i) => i !== heroIdx) : shown;

  return (
    <div>
      <div className="sticky top-[72px] z-10 flex gap-1.5 overflow-x-auto rounded-2xl border border-ink/10 bg-white/95 px-3 py-2.5 backdrop-blur">
        {CATEGORIES.map((c) => (
          <button key={c.key} onClick={() => setCat(c.key)}
            className={"shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors duration-[140ms] " + (c.key === cat ? "bg-pearl text-ink" : "text-ink/55 hover:bg-surface hover:text-ink")}
          >
            {c.label}
          </button>
        ))}
      </div>
      {loading ? (
        <p className="py-16 text-center text-sm text-ink/40">Loading</p>
      ) : shown.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={"Nothing in " + active.label + " yet"}
            line="The first post claims the category. Write something and it lands here."
            action="Write a post"
            actionHref="/write"
          />
        </div>
      ) : (
        <>
          {/* The strongest item in the category leads at full width. Everything
              after it is a grid, because discovery is about seeing many things
              at once rather than one post at a time. */}
          {hero ? (
            <div className="mt-4">
              <DiscoverTile post={hero} />
            </div>
          ) : null}
          <div className="mt-4 grid grid-cols-2 gap-4">
            {rest.map((r) => <DiscoverTile key={r.post_id} post={r} />)}
          </div>
        </>
      )}
    </div>
  );
}