"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Row = { muted_id: string; full_name: string | null; username: string | null; avatar_url: string | null };

export default function MutedStoriesPage() {
  const supabase = useRef(createClient()).current;
  const [rows, setRows] = useState<Row[] | null>(null);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) { setRows([]); return; }
    const { data: mutes } = await supabase.from("muted_stories").select("muted_id").eq("user_id", uid).order("created_at", { ascending: false });
    const ids = (mutes ?? []).map(m => m.muted_id);
    if (!ids.length) { setRows([]); return; }
    const { data: people } = await supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", ids);
    const byId = new Map((people ?? []).map(p => [p.id, p]));
    setRows(ids.map(id => ({ muted_id: id, full_name: byId.get(id)?.full_name ?? "Member", username: byId.get(id)?.username ?? null, avatar_url: byId.get(id)?.avatar_url ?? null })));
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  const unmute = async (mutedId: string) => {
    setRows(r => (r ?? []).filter(x => x.muted_id !== mutedId));
    const { data: auth } = await supabase.auth.getUser();
    await supabase.from("muted_stories").delete().eq("user_id", auth.user?.id).eq("muted_id", mutedId);
  };

  return (
    <div className="mx-auto max-w-[560px] px-1">
      <Link href="/settings" aria-label="Back to Settings" className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink/60 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"><ArrowLeft size={19} /></Link>
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><EyeOff size={19} className="text-pearl" /> Muted stories</h1>
      <p className="pb-5 text-[13px] text-ink/50">Muted people stay in your feed but their stories stay hidden.</p>
      {rows === null ? <p className="py-10 text-center text-sm text-ink/40">Loading</p>
      : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-ink/15 py-14 text-center">
          <EyeOff size={28} className="text-ink/25" />
          <p className="text-[14px] font-semibold text-ink">Nobody is muted</p>
        </div>
      ) : rows.map(r => (
        <div key={r.muted_id} className="mb-2 flex items-center gap-3.5 rounded-lg border border-ink/10 p-3.5">
          {r.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.avatar_url} alt="" className="h-14 w-14 rounded-full object-cover" />
          ) : <span className="flex h-14 w-14 items-center justify-center rounded-full bg-navy text-[17px] font-semibold text-white">{(r.full_name || "?").charAt(0)}</span>}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-semibold text-ink">{r.full_name}</p>
            {r.username ? <p className="text-[12px] text-ink/45">@{r.username}</p> : null}
          </div>
          <button onClick={() => unmute(r.muted_id)} className="rounded-full border border-ink/15 px-3.5 py-1.5 text-[12.5px] font-semibold text-ink transition-colors duration-[140ms] hover:bg-surface">Unmute</button>
        </div>
      ))}
    </div>
  );
}
