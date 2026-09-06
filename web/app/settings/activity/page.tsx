"use client";
// Your activity: likes, comments, reposts and saves with the post each happened on.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Kind = "likes" | "comments" | "reposts" | "saved";
type Item = { key: string; post_id: string; when: string; note: string | null; text: string; image: string | null };
const TABS: { key: Kind; label: string; table: string }[] = [{ key: "likes", label: "Likes", table: "post_likes" }, { key: "comments", label: "Comments", table: "post_comments" }, { key: "reposts", label: "Reposts", table: "post_reposts" }, { key: "saved", label: "Saved", table: "post_bookmarks" }];

export default function ActivityPage() {
  const supabase = useRef(createClient()).current;
  const [kind, setKind] = useState<Kind>("likes");
  const [items, setItems] = useState<Item[]>([]);
  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser(); const id = auth.user?.id; if (!id) return;
    const tab = TABS.find((x) => x.key === kind)!;
    const sel = kind === "comments" ? "id, post_id, created_at, body, content" : "post_id, created_at";
    const { data: rows } = await supabase.from(tab.table).select(sel).eq("user_id", id).order("created_at", { ascending: false }).limit(60);
    const list = ((rows as unknown) as { id?: string; post_id: string; created_at: string; body?: string | null; content?: string | null }[]) || [];
    const ids = Array.from(new Set(list.map((r) => r.post_id)));
    const posts: Record<string, { article_title?: string | null; content?: string | null; body?: string | null; post_media?: { url: string; media_type: string }[] }> = {};
    if (ids.length) { const { data: ps } = await supabase.from("posts").select("id, content, body, article_title, post_media(url, media_type)").in("id", ids); (ps || []).forEach((p) => { posts[(p as { id: string }).id] = p as never; }); }
    setItems(list.filter((r) => posts[r.post_id]).map((r, i) => { const p = posts[r.post_id]; return { key: (r.id || r.post_id) + ":" + i, post_id: r.post_id, when: r.created_at, note: kind === "comments" ? (r.body || r.content || "") : null, text: p.article_title || p.content || p.body || "Post", image: (p.post_media || []).find((m) => m.media_type === "image")?.url || null }; }));
  }, [supabase, kind]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="mx-auto max-w-[640px] px-4 py-6">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"><ArrowLeft size={14} /> Settings</Link>
      <h1 className="mt-4 font-display text-[24px] font-bold text-ink">Your activity</h1>
      <div className="mt-4 flex gap-2">{TABS.map((x) => <button key={x.key} type="button" onClick={() => setKind(x.key)} className={"rounded-full border px-3.5 py-1.5 text-[13px] font-semibold " + (kind === x.key ? "border-ink bg-ink text-white" : "border-ink/15 text-ink/70 hover:border-ink/40")}>{x.label}</button>)}</div>
      <ul className="mt-4 divide-y divide-ink/8">
        {items.map((it) => (
          <li key={it.key}><Link href={"/p/" + it.post_id} className="flex items-center gap-3 py-3 hover:bg-surface/60">
            {it.image ? <img src={it.image} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <div className="h-12 w-12 rounded-lg bg-surface" />}
            <div className="min-w-0 flex-1">{it.note ? <p className="line-clamp-2 text-[14px] font-semibold text-ink">{it.note}</p> : null}<p className={"line-clamp-1 text-[14px] " + (it.note ? "text-ink/55" : "font-semibold text-ink")}>{it.text}</p></div>
            <span className="text-[12px] text-ink/45">{new Date(it.when).toLocaleDateString()}</span>
          </Link></li>
        ))}
      </ul>
      {items.length === 0 ? <p className="mt-3 text-[13.5px] text-ink/50">Nothing here yet.</p> : null}
    </div>
  );
}