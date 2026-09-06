"use client";
// Archive: posts hidden from everyone without deleting. Restore returns one as it was.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Row = { id: string; content: string | null; body: string | null; article_title: string | null; archived_at: string; post_media: { url: string; media_type: string }[] | null };

export default function ArchivePage() {
  const supabase = useRef(createClient()).current;
  const [rows, setRows] = useState<Row[]>([]);
  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser(); const id = auth.user?.id; if (!id) return;
    const { data } = await supabase.from("posts").select("id, content, body, article_title, archived_at, post_media(url, media_type)").eq("user_id", id).not("archived_at", "is", null).order("archived_at", { ascending: false });
    setRows((data as Row[]) || []);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);
  const restore = async (r: Row) => { if (!window.confirm("Restore this post to your profile and feeds?")) return; await supabase.from("posts").update({ archived_at: null }).eq("id", r.id); load(); };
  return (
    <div className="mx-auto max-w-[640px] px-4 py-6">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"><ArrowLeft size={14} /> Settings</Link>
      <h1 className="mt-4 font-display text-[24px] font-bold text-ink">Archive</h1>
      <p className="mt-1 text-[13.5px] text-ink/60">Posts you hid from everyone without deleting them.</p>
      <ul className="mt-4 divide-y divide-ink/8">
        {rows.map((r) => { const img = (r.post_media || []).find((m) => m.media_type === "image")?.url; return (
          <li key={r.id} className="flex items-center gap-3 py-3">
            {img ? <img src={img} alt="" className="h-14 w-14 rounded-lg object-cover" /> : <div className="h-14 w-14 rounded-lg bg-surface" />}
            <div className="min-w-0 flex-1"><p className="line-clamp-2 text-[14px] font-semibold text-ink">{r.article_title || r.content || r.body || "Post"}</p><p className="text-[12px] text-ink/50">Archived {new Date(r.archived_at).toLocaleDateString()}</p></div>
            <button type="button" onClick={() => restore(r)} className="rounded-full bg-ink px-4 py-1.5 text-[13px] font-bold text-white hover:opacity-90">Restore</button>
          </li>
        ); })}
      </ul>
      {rows.length === 0 ? <p className="mt-3 text-[13.5px] text-ink/50">Nothing archived.</p> : null}
    </div>
  );
}