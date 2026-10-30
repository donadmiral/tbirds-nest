"use client";

import { useState } from "react";
import { useAccountResource } from "@/lib/useAccountResource";
import { errorMessage } from "@/lib/errors";
import { withTimeout } from "@/lib/withTimeout";
import { ErrorState } from "@/components/ErrorState";
import { displayImageUrl } from "@/lib/media";

import { EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";

type Row = { muted_id: string; full_name: string | null; username: string | null; avatar_url: string | null };

async function fetchRows(supabase: ReturnType<typeof createClient>, uid: string): Promise<Row[]> {
  const { data: mutes, error } = await supabase.from("muted_stories").select("muted_id").eq("user_id", uid).order("created_at", { ascending: false });
  if (error) throw error;
  const ids = (mutes ?? []).map(row => row.muted_id);
  if (!ids.length) return [];
  const { data: people, error: profileError } = await supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", ids);
  if (profileError) throw profileError;
  const byId = new Map((people ?? []).map(person => [person.id, person]));
  return ids.map(id => ({ muted_id: id, full_name: byId.get(id)?.full_name ?? "Member", username: byId.get(id)?.username ?? null, avatar_url: byId.get(id)?.avatar_url ?? null }));
}

export default function MutedStoriesPage() {
  const { client: supabase, data: rows, setData: setRows, error: loadError, loading, retry, assertOwner } = useAccountResource<Row[]>(fetchRows, []);


  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const unmute = async (mutedId: string) => {
    if (busy) return;
    setBusy(mutedId); setActionError("");
    try {
      const owner = await assertOwner();
      const { error } = await withTimeout(supabase.from("muted_stories").delete().eq("user_id", owner).eq("muted_id", mutedId));
      if (error) throw error;
      setRows(previous => previous.filter(item => item.muted_id !== mutedId));
    } catch (cause) { setActionError(errorMessage(cause, "This person could not be unmuted. Please try again.")); }
    finally { setBusy(null); }
  };

  return (
    <div className="mx-auto max-w-[560px] px-1">
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><EyeOff size={19} className="text-accent" /> Muted stories</h1>
      <p className="pb-5 text-[13px] text-muted">Muted people stay in your feed but their stories stay hidden.</p>
      {actionError ? <p role="alert" className="text-sm text-danger">{actionError}</p> : null}
      {loadError ? <ErrorState title={loadError} onRetry={retry} /> : null}
      {loading ? <p className="py-10 text-center text-sm text-muted">Loading</p>
      : loadError ? null : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-ink/15 py-14 text-center">
          <EyeOff size={28} className="text-muted" />
          <p className="text-[14px] font-semibold text-ink">Nobody is muted</p>
        </div>
      ) : rows.map(r => (
        <div key={r.muted_id} className="mb-2 flex items-center gap-3.5 rounded-lg border border-ink/10 p-3.5">
          {r.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayImageUrl(r.avatar_url, 200) ?? r.avatar_url} alt="" className="h-14 w-14 rounded-full object-cover" />
          ) : <span className="flex h-14 w-14 items-center justify-center rounded-full bg-navy text-[17px] font-semibold text-white">{(r.full_name || "?").charAt(0)}</span>}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-semibold text-ink">{r.full_name} <VerifiedBadge userId={r.muted_id} size={13} /></p>
            {r.username ? <p className="text-[12px] text-muted">@{r.username}</p> : null}
          </div>
          <button onClick={() => unmute(r.muted_id)} disabled={!!busy} className="rounded-full border border-ink/15 px-3.5 py-1.5 text-[12.5px] font-semibold text-ink transition-colors duration-[140ms] hover:bg-surface">Unmute</button>
        </div>
      ))}
    </div>
  );
}
