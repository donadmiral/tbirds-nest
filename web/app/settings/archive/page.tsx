"use client";
import NextImage from "next/image";
// Archive: posts hidden from everyone without deleting. Restore returns one as it was.
import { useState } from "react";
import { hydratePostMedia } from "@/lib/contentMedia";
import { useAccountResource } from "@/lib/useAccountResource";
import { errorMessage } from "@/lib/errors";
import { withTimeout } from "@/lib/withTimeout";
import { ErrorState } from "@/components/ErrorState";


import { createClient } from "@/lib/supabase/client";

type Row = { id: string; content: string | null; body: string | null; article_title: string | null; archived_at: string; post_media: { url: string; media_type: string }[] | null };

async function fetchRows(supabase: ReturnType<typeof createClient>, uid: string): Promise<Row[]> {
  const { data, error } = await supabase.from("posts").select("id, content, body, article_title, archived_at, post_media(url, media_type)").eq("user_id", uid).not("archived_at", "is", null).order("archived_at", { ascending: false });
  if (error) throw error;
  return await hydratePostMedia((data ?? []) as Row[], supabase);
}

export default function ArchivePage() {
  const { client: supabase, data: rows, setData: setRows, error: loadError, loading, retry, assertOwner } = useAccountResource<Row[]>(fetchRows, []);
  const [actionError, setActionError] = useState("");
  const [restoring, setRestoring] = useState<string | null>(null);
  const restore = async (row: Row) => {
    if (restoring || !window.confirm("Restore this post to your profile and feeds?")) return;
    setRestoring(row.id); setActionError("");
    try {
      const owner = await assertOwner();
      const { error } = await withTimeout(supabase.from("posts").update({ archived_at: null }).eq("id", row.id).eq("user_id", owner));
      if (error) throw error;
      setRows(previous => previous.filter(item => item.id !== row.id));
    } catch (cause) { setActionError(errorMessage(cause, "This post could not be restored. Please try again.")); }
    finally { setRestoring(null); }
  };
  return (
    <div className="mx-auto max-w-[640px] px-4 py-6">
      <h1 className="mt-4 font-display text-[24px] font-bold text-ink">Archive</h1>
      <p className="mt-1 text-[13.5px] text-ink/60">Posts you hid from everyone without deleting them.</p>
      {loadError ? <ErrorState title={loadError} onRetry={retry} /> : null}
      {actionError ? <p role="alert" className="mt-3 text-sm text-danger">{actionError}</p> : null}
      {loading ? <p role="status">Loading archived posts…</p> : null}
      <ul className="mt-4 divide-y divide-ink/8">
        {rows.map((r) => { const img = (r.post_media || []).find((m) => m.media_type === "image")?.url; return (
          <li key={r.id} className="flex items-center gap-3 py-3">
            {img ? <NextImage unoptimized width={56} height={56} src={img} alt="" className="h-14 w-14 rounded-lg object-cover" /> : <div className="h-14 w-14 rounded-lg bg-surface" />}
            <div className="min-w-0 flex-1"><p className="line-clamp-2 text-[14px] font-semibold text-ink">{r.article_title || r.content || r.body || "Post"}</p><p className="text-[12px] text-muted">Archived {new Date(r.archived_at).toLocaleDateString()}</p></div>
            <button type="button" onClick={() => restore(r)} disabled={!!restoring} className="rounded-full bg-ink px-4 py-1.5 text-[13px] font-bold text-white hover:opacity-90">Restore</button>
          </li>
        ); })}
      </ul>
      {!loading && !loadError && rows.length === 0 ? <p className="mt-3 text-[13.5px] text-muted">Nothing archived.</p> : null}
    </div>
  );
}