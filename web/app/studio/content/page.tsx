"use client";

/**
 * The Content desk.
 *
 * Everything you have written in one table, whatever state it is in. The
 * Planner answers "what goes out when"; this answers "what exists, and how did
 * it do". They read the same rows from studio_list_posts, so a post cannot
 * appear in one and not the other.
 *
 * Engagement comes from studio_home, which only carries the recent set, so a
 * row without numbers shows a dash rather than a zero. A zero would claim
 * nobody saw it; a dash admits we have not measured it here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Eye, FileText, Heart, Image as ImageIcon, MessageCircle, Play, Plus, Search } from "lucide-react";
import { listScheduled, studioHome, type ScheduledPost, type StudioHome } from "@/lib/studio";
import { EmptyState, PillTabs } from "@/components/ui";
import { Metric } from "@/components/Charts";

type Tab = "all" | "published" | "scheduled" | "draft" | "failed";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "published", label: "Published" },
  { key: "scheduled", label: "Scheduled" },
  { key: "draft", label: "Drafts" },
  { key: "failed", label: "Needs attention" },
];

function statusChip(s: string) {
  if (s === "published") return "bg-success/15 text-success";
  if (s === "scheduled") return "bg-pearl/20 text-pearl-muted";
  if (s === "failed") return "bg-red-500/12 text-red-400";
  if (s === "publishing") return "bg-ink/10 text-ink/60";
  return "bg-surface text-ink/50";
}

export default function ContentPage() {
  const [rows, setRows] = useState<ScheduledPost[]>([]);
  const [home, setHome] = useState<StudioHome | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [posts, h] = await Promise.all([listScheduled(), studioHome()]);
      if (!mounted.current) return;
      setRows(posts);
      setHome(h);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  const engagement = useMemo(() => {
    const m = new Map<string, { likes: number; comments: number; views: number }>();
    for (const r of home?.recent ?? []) {
      m.set(r.post_id, { likes: r.likes_count, comments: r.comments_count, views: r.views_count });
    }
    return m;
  }, [home]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => (tab === "all" ? true : r.status === tab))
      .filter((r) => !needle || ((r.content ?? "") + " " + (r.body ?? "")).toLowerCase().includes(needle))
      .sort((a, b) => {
        const at = a.publish_at ? new Date(a.publish_at).getTime() : 0;
        const bt = b.publish_at ? new Date(b.publish_at).getTime() : 0;
        return bt - at;
      });
  }, [rows, tab, q]);

  const totals = useMemo(() => {
    let likes = 0, comments = 0, views = 0;
    for (const r of home?.recent ?? []) { likes += r.likes_count; comments += r.comments_count; views += r.views_count; }
    return { likes, comments, views };
  }, [home]);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[21px] leading-tight text-porcelain">Content library</h1>
          <p className="mt-1 text-[13px] text-ink/50">Everything you have written, whatever state it is in.</p>
        </div>
        <Link
          href="/studio/planner"
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[12.5px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90"
        >
          <Plus size={14} /> Create content
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
          <p className="text-[11.5px] text-ink/45">Pieces of content</p>
          <Metric value={rows.length} size={24} />
        </div>
        <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
          <p className="text-[11.5px] text-ink/45">Views, recent posts</p>
          <Metric value={totals.views} size={24} />
        </div>
        <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
          <p className="text-[11.5px] text-ink/45">Likes, recent posts</p>
          <Metric value={totals.likes} size={24} />
        </div>
        <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
          <p className="text-[11.5px] text-ink/45">Comments, recent posts</p>
          <Metric value={totals.comments} size={24} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <PillTabs
          tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] ?? 0 }))}
          active={tab}
          onSelect={(k) => setTab(k as Tab)}
        />
        <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-full border border-ink/10 bg-white px-3.5 py-2 sm:max-w-[280px]">
          <Search size={15} className="shrink-0 text-ink/35" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your content"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink/35"
          />
        </label>
      </div>

      {loading ? (
        <p className="py-14 text-center text-sm text-ink/40">Loading</p>
      ) : shown.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={<FileText size={19} />}
            title={q ? "Nothing matches that" : tab === "all" ? "No content yet" : "Nothing in this state"}
            line={q ? "Try a different word, or clear the search." : "Write a post or schedule one and it appears here."}
            action="Go to the planner"
            actionHref="/studio/planner"
          />
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-2xl border border-ink/10 bg-white">
          {shown.map((r, i) => {
            const e = engagement.get(r.published_post_id || r.id);
            const cover = r.media?.[0];
            const when = r.publish_at ? new Date(r.publish_at) : null;
            const text = r.content || r.body || "Untitled";
            return (
              <div
                key={r.id}
                className={"flex items-center gap-3.5 px-4 py-3 " + (i > 0 ? "border-t border-ink/8" : "")}
              >
                <span className="relative flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface">
                  {cover ? (
                    cover.media_type === "video" ? (
                      <>
                        <video src={cover.url} muted preload="metadata" className="h-full w-full object-cover" />
                        <Play size={13} className="absolute text-white" fill="currentColor" />
                      </>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover.url} alt="" className="h-full w-full object-cover" />
                    )
                  ) : (
                    <ImageIcon size={16} className="text-ink/25" />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block text-[13.5px] leading-snug text-ink">{text}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-ink/45">
                    <span className={"rounded-full px-2 py-0.5 font-semibold capitalize " + statusChip(r.status)}>{r.status}</span>
                    {when ? <span>{when.toLocaleDateString(undefined, { month: "short", day: "numeric" })} at {when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span> : <span>no date set</span>}
                  </span>
                </span>

                <span className="hidden shrink-0 items-center gap-4 text-[12px] text-ink/45 sm:flex">
                  {e ? (
                    <>
                      <span className="flex items-center gap-1"><Eye size={12} /> {e.views}</span>
                      <span className="flex items-center gap-1"><Heart size={12} /> {e.likes}</span>
                      <span className="flex items-center gap-1"><MessageCircle size={12} /> {e.comments}</span>
                    </>
                  ) : (
                    <span className="text-ink/25">not measured</span>
                  )}
                </span>

                <Link
                  href={r.status === "published" ? "/post/" + (r.published_post_id || r.id) : "/studio/planner"}
                  className="shrink-0 rounded-full border border-ink/15 px-3 py-1.5 text-[12px] font-semibold text-ink/65 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"
                >
                  {r.status === "published" ? "View" : "Edit"}
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
