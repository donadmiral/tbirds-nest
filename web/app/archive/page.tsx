"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookHeart, Check, Plus, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getMyStories, addMemoryPage } from "@/lib/memoryAlbum";

type Row = Awaited<ReturnType<typeof getMyStories>>[number];
type Draft = { id: string; media_url: string | null; media_type: string; created_at: string };

export default function ArchivePage() {
  const supabase = useRef(createClient()).current;
  const [rows, setRows] = useState<Row[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Row | null>(null);

  const load = async () => {
    setRows(await getMyStories(500));
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (uid) {
      const { data } = await supabase.from("story_drafts")
        .select("id, media_url, media_type, created_at")
        .eq("user_id", uid).order("created_at", { ascending: false });
      setDrafts((data ?? []) as Draft[]);
    }
  };
  useEffect(() => { load(); }, []);

  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const k = new Date(r.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" });
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return Array.from(m.entries());
  }, [rows]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-[640px] px-4 pb-16">
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex items-center gap-2 border-b border-ink/10 bg-white/75 px-4 py-2.5 backdrop-blur-md">
        <button onClick={() => history.back()} className="rounded-full p-2 text-ink/60 hover:bg-black/5" aria-label="Back"><ArrowLeft size={18} /></button>
        <p className="flex-1 font-display text-[17px] text-ink">Story archive</p>
        <Link href="/story/new" className="flex items-center gap-1 rounded-full bg-pearl px-3 py-1.5 text-[12px] font-semibold text-ink"><Plus size={13} /> New story</Link>
      </div>

      {drafts.length > 0 ? (
        <div className="mb-6">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Drafts</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {drafts.map((d) => (
              <div key={d.id} className="relative w-24 shrink-0">
                <Link href={"/story/new?draft=" + d.id} className="block aspect-[9/14] overflow-hidden rounded-lg border border-ink/10 bg-ink/5">
                  {d.media_url ? (
                    d.media_type === "video"
                      ? <video src={d.media_url} muted className="h-full w-full object-cover" />
                      // eslint-disable-next-line @next/next/no-img-element
                      : <img src={d.media_url} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </Link>
                <span className="mt-1 block text-center text-[11px] text-ink/45">Continue</span>
                <button onClick={async () => { await supabase.from("story_drafts").delete().eq("id", d.id); load(); }}
                  className="absolute -right-1 -top-1 rounded-full bg-white p-1 text-ink/50 shadow" aria-label="Delete draft"><X size={11} /></button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-ink/40">Stories you post live here forever, only you can see this.</p>
      ) : groups.map(([month, list]) => (
        <div key={month} className="mb-6">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">{month}</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {list.map((s) => (
              <div key={s.id} className="group relative aspect-[9/14] overflow-hidden rounded-lg border border-ink/10 bg-ink/5">
                <button onClick={() => setOpen(s)} className="block h-full w-full">
                  {s.media_type === "video" && s.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.thumbnail_url} alt="" className="h-full w-full object-cover" />
                  ) : s.media_url ? (
                    s.media_type === "video"
                      ? <video src={s.media_url} muted className="h-full w-full object-cover" />
                      // eslint-disable-next-line @next/next/no-img-element
                      : <img src={s.media_url} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </button>
                <div className="absolute inset-x-1 bottom-1 flex justify-between opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={async () => { if (await addMemoryPage(s.id)) setSaved((p) => new Set(p).add(s.id)); }}
                    className="rounded-full bg-white/90 p-1.5 text-ink" title="Add to memory album">
                    {saved.has(s.id) ? <Check size={13} /> : <BookHeart size={13} />}
                  </button>
                  <button onClick={async () => { if (confirm("Delete this story everywhere? This cannot be undone.")) { await supabase.from("stories").delete().eq("id", s.id); load(); } }}
                    className="rounded-full bg-white/90 p-1.5 text-ink hover:text-red-600" title="Delete story"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {open ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/85" onClick={() => setOpen(null)}>
          <button className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white" aria-label="Close"><X size={18} /></button>
          <div className="max-h-[88vh] max-w-[92vw]" onClick={(e) => e.stopPropagation()}>
            {open.media_type === "video" && open.media_url ? (
              <video src={open.media_url} controls autoPlay playsInline className="max-h-[88vh] rounded-xl" />
            ) : open.media_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={open.media_url} alt="" className="max-h-[88vh] rounded-xl object-contain" />
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}