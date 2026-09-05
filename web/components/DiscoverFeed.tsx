"use client";

/**
 * Discover.
 *
 * Categories are exact. A post appears under Comedy because its author filed
 * it under Comedy in the composer, never because the text contained "lol".
 * The keyword guessing that used to live here is gone; it put finance posts
 * under Comedy and confused everyone.
 *
 * For you is the ranked feed. Videos is every video post, laid out as a grid
 * with its caption, the way a video surface should be.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { FeedRow } from "@/lib/feed";
import { CATEGORIES } from "@/lib/categories";
import { DiscoverTile } from "@/components/DiscoverTile";
import { EmptyState } from "@/components/ui";
import { ErrorState } from "@/components/ErrorState";
import { withTimeout } from "@/lib/withTimeout";

type Chip = { key: string; label: string };
const CHIPS: Chip[] = [
  { key: "for_you", label: "All" },
  { key: "videos", label: "Videos" },
  ...CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
];

function hasVideo(r: FeedRow) {
  return (r.media ?? []).some((m) => m.media_type === "video");
}

export function DiscoverFeed() {
  const supabase = useRef(createClient()).current;
  const [chip, setChip] = useState("for_you");
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const loadRanked = useCallback(async () => {
    const [a, b] = await withTimeout(Promise.all([
      supabase.rpc("get_feed", { p_mode: "trending", p_limit: 30 }),
      supabase.rpc("get_feed", { p_mode: "for_you", p_limit: 60 }),
    ]));
    if (a.error && b.error) throw a.error;
    const seen = new Set<string>();
    const out: FeedRow[] = [];
    for (const r of ([...(a.data ?? []), ...(b.data ?? [])] as FeedRow[])) {
      const reposted = (r as unknown as { reposted_by_id?: string | null }).reposted_by_id;
      if (!seen.has(r.post_id) && !reposted) { seen.add(r.post_id); out.push(r); }
    }
    return out;
  }, [supabase]);

  // Strict: posts.category must equal the chip. Three small queries rather
  // than one guess: the posts, their media, their authors.
  const loadCategory = useCallback(async (key: string) => {
    const { data: posts, error } = await withTimeout(
      supabase
        .from("posts")
        .select("id, user_id, content, body, category, channel, article_title, read_minutes, created_at, likes_count, comments_count, reposts_count, bookmarks_count, views_count, media_url, link_url")
        .eq("category", key)
        .is("community_id", null)
        .order("created_at", { ascending: false })
        .limit(40),
    );
    if (error) throw error;
    const list = (posts ?? []) as Record<string, unknown>[];
    if (list.length === 0) return [];
    const ids = list.map((p) => p.id as string);
    const authorIds = Array.from(new Set(list.map((p) => p.user_id as string)));
    const [{ data: media }, { data: authors }] = await Promise.all([
      supabase.from("post_media").select("id, post_id, url, media_type, width, height, sort_order").in("post_id", ids),
      supabase.from("profiles").select("id, full_name, username, avatar_url, is_verified, verified_tier, account_type").in("id", authorIds),
    ]);
    const mediaBy = new Map<string, FeedRow["media"]>();
    for (const m of (media ?? []) as (FeedRow["media"][number] & { post_id: string })[]) {
      const arr = mediaBy.get(m.post_id) ?? [];
      arr.push(m);
      mediaBy.set(m.post_id, arr);
    }
    const authorBy = new Map<string, Record<string, unknown>>();
    for (const a of (authors ?? []) as Record<string, unknown>[]) authorBy.set(a.id as string, a);

    return list.map((p) => {
      const a = authorBy.get(p.user_id as string) ?? {};
      return {
        post_id: p.id,
        author_id: p.user_id,
        content: p.content,
        body: p.body,
        media_url: p.media_url,
        media: mediaBy.get(p.id as string) ?? [],
        products: [],
        link: null,
        channel: p.channel,
        article_title: p.article_title,
        read_minutes: p.read_minutes,
        created_at: p.created_at,
        likes_count: p.likes_count ?? 0,
        comments_count: p.comments_count ?? 0,
        reposts_count: p.reposts_count ?? 0,
        bookmarks_count: p.bookmarks_count ?? 0,
        views_count: p.views_count ?? 0,
        author_name: a.full_name ?? null,
        author_username: a.username ?? null,
        author_avatar: a.avatar_url ?? null,
        author_verified: a.is_verified ?? false,
        author_verified_tier: a.verified_tier ?? null,
        author_kind: a.account_type ?? null,
      } as unknown as FeedRow;
    });
  }, [supabase]);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      if (chip === "for_you") setRows(await loadRanked());
      else if (chip === "videos") setRows((await loadRanked()).filter(hasVideo));
      else setRows(await loadCategory(chip));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [chip, loadRanked, loadCategory]);

  useEffect(() => { void load(); }, [load]);

  const hidePost = (id: string) => setRows((cur) => cur.filter((r) => r.post_id !== id));
  const active = CHIPS.find((c) => c.key === chip) ?? CHIPS[0];
  const heroIdx = chip === "videos" ? -1 : rows.findIndex((r) => (r.media ?? []).length > 0);
  const hero = heroIdx >= 0 ? rows[heroIdx] : null;
  const rest = hero ? rows.filter((_, i) => i !== heroIdx) : rows;

  return (
    <div>
      <div className="sticky top-[72px] z-10 flex gap-1.5 overflow-x-auto rounded-2xl border border-ink/10 bg-white/95 px-3 py-2.5 backdrop-blur">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            onClick={() => setChip(c.key)}
            className={"shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors duration-[140ms] " + (c.key === chip ? "bg-pearl text-ink" : "text-ink/55 hover:bg-surface hover:text-ink")}
          >
            {c.label}
          </button>
        ))}
      </div>

      {failed ? (
        <div className="mt-4"><ErrorState title="Could not load Discover" onRetry={() => void load()} /></div>
      ) : loading ? (
        <div className="mt-4 grid grid-cols-2 gap-4 animate-pulse" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="aspect-square rounded-2xl border border-ink/10 bg-white" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={chip === "videos" ? "No videos yet" : "Nothing in " + active.label + " yet"}
            line={chip === "for_you" || chip === "videos" ? "Follow a few people and this fills up." : "Posts filed under " + active.label + " in the composer appear here."}
            action="Write a post"
            actionHref="/write"
          />
        </div>
      ) : (
        <>
          {hero ? <div className="mt-4"><DiscoverTile post={hero} onHide={hidePost} /></div> : null}
          {/* Videos sit three across, square, like every video surface people
              already know. Everything else is two across so text has room. */}
          <div className={"mt-4 grid gap-4 " + (chip === "videos" ? "grid-cols-3" : "grid-cols-2")}>
            {rest.map((r) => <DiscoverTile key={r.post_id} post={r} onHide={hidePost} />)}
          </div>
        </>
      )}
    </div>
  );
}
