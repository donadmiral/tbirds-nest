"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PostCard } from "@/components/PostCard";
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
  const shown = cat === "innovation"
    ? inno
    : pool.filter((r) => {
        const rc = (r as unknown as { category?: string | null }).category;
        if (rc) return rc === cat;
        const hay = ((r.content ?? "") + " " + (r.article_title ?? "")).toLowerCase();
        return active.words.some((w) => hay.includes(w));
      });

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-1 flex gap-1.5 overflow-x-auto bg-white/90 px-1 py-2 backdrop-blur">
        {CATEGORIES.map((c) => (
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