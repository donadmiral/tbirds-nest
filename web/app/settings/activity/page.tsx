"use client";
import NextImage from "next/image";
// Your activity: likes, comments, reposts and saves with the post each happened on.
import { useCallback, useState } from "react";
import Link from "next/link";
import { useAccountResource } from "@/lib/useAccountResource";
import { hydratePostMedia } from "@/lib/contentMedia";
import { ErrorState } from "@/components/ErrorState";
import { createClient } from "@/lib/supabase/client";

type Kind = "likes" | "comments" | "reposts" | "saved";
type Item = { key: string; post_id: string; when: string; note: string | null; text: string; image: string | null };
const TABS: { key: Kind; label: string; table: string }[] = [{ key: "likes", label: "Likes", table: "post_likes" }, { key: "comments", label: "Comments", table: "post_comments" }, { key: "reposts", label: "Reposts", table: "post_reposts" }, { key: "saved", label: "Saved", table: "post_bookmarks" }];

export default function ActivityPage() {
  const [kind, setKind] = useState<Kind>("likes");
  const load = useCallback(async (supabase: ReturnType<typeof createClient>, id: string): Promise<Item[]> => {
    const tab = TABS.find((x) => x.key === kind)!;
    const sel = kind === "comments" ? "id, post_id, created_at, body, content" : "post_id, created_at";
    const { data: rows, error } = await supabase.from(tab.table).select(sel).eq("user_id", id).order("created_at", { ascending: false }).limit(60);
    if (error) throw error;
    const list = ((rows as unknown) as { id?: string; post_id: string; created_at: string; body?: string | null; content?: string | null }[]) || [];
    const ids = Array.from(new Set(list.map((r) => r.post_id)));
    const posts: Record<string, { article_title?: string | null; content?: string | null; body?: string | null; post_media?: { url: string; media_type: string }[] }> = {};
    if (ids.length) { const { data: ps, error: postsError } = await supabase.from("posts").select("id, content, body, article_title, post_media(url, media_type)").in("id", ids); if (postsError) throw postsError; const safe = await hydratePostMedia(ps || [], supabase); safe.forEach((p) => { posts[(p as { id: string }).id] = p as never; }); }
    return list.filter((r) => posts[r.post_id]).map((r, i) => { const p = posts[r.post_id]; return { key: (r.id || r.post_id) + ":" + i, post_id: r.post_id, when: r.created_at, note: kind === "comments" ? (r.body || r.content || "") : null, text: p.article_title || p.content || p.body || "Post", image: (p.post_media || []).find((m) => m.media_type === "image")?.url || null }; });
  }, [kind]);
  const { data: items, loading, error, retry } = useAccountResource(load, []);
  return (
    <div className="mx-auto max-w-[640px] px-4 py-6">
      <h1 className="mt-4 font-display text-[24px] font-bold text-ink">Your activity</h1>
      <div className="mt-4 flex gap-2">{TABS.map((x) => <button key={x.key} type="button" onClick={() => setKind(x.key)} className={"rounded-full border px-3.5 py-1.5 text-[13px] font-semibold " + (kind === x.key ? "border-ink bg-ink text-white" : "border-ink/15 text-ink/70 hover:border-ink/40")}>{x.label}</button>)}</div>
      {error ? <ErrorState title={error} onRetry={retry} /> : null}
      {loading ? <p role="status" className="py-4 text-sm text-muted">Loading activity…</p> : null}
      <ul className="mt-4 divide-y divide-ink/8">
        {items.map((it) => (
          <li key={it.key}><Link href={"/post/" + it.post_id} className="flex items-center gap-3 py-3 hover:bg-surface/60">
            {it.image ? <NextImage unoptimized width={48} height={48} src={it.image} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <div className="h-12 w-12 rounded-lg bg-surface" />}
            <div className="min-w-0 flex-1">{it.note ? <p className="line-clamp-2 text-[14px] font-semibold text-ink">{it.note}</p> : null}<p className={"line-clamp-1 text-[14px] " + (it.note ? "text-muted" : "font-semibold text-ink")}>{it.text}</p></div>
            <span className="text-[12px] text-muted">{new Date(it.when).toLocaleDateString()}</span>
          </Link></li>
        ))}
      </ul>
      {!loading && !error && items.length === 0 ? <p className="mt-3 text-[13.5px] text-muted">Nothing here yet.</p> : null}
    </div>
  );
}