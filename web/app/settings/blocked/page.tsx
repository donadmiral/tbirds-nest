"use client";

import { useState } from "react";
import { useAccountResource } from "@/lib/useAccountResource";
import { errorMessage } from "@/lib/errors";
import { withTimeout } from "@/lib/withTimeout";
import { ErrorState } from "@/components/ErrorState";
import { displayImageUrl } from "@/lib/media";

import { ShieldOff, UserX } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PersonName } from "@/components/PersonName";

type Row = { blocked_id: string; created_at: string | null; full_name: string | null; username: string | null; avatar_url: string | null };

async function fetchRows(supabase: ReturnType<typeof createClient>, uid: string): Promise<Row[]> {
  const { data, error } = await supabase.from("blocked_users").select("blocked_id, created_at").eq("blocker_id", uid).order("created_at", { ascending: false });
  if (error) throw error;
  const ids = (data ?? []).map(row => row.blocked_id);
  if (!ids.length) return [];
  const { data: people, error: profileError } = await supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", ids);
  if (profileError) throw profileError;
  const byId = new Map((people ?? []).map(person => [person.id, person]));
  return (data ?? []).map(row => ({ blocked_id: row.blocked_id, created_at: row.created_at, full_name: byId.get(row.blocked_id)?.full_name ?? null, username: byId.get(row.blocked_id)?.username ?? null, avatar_url: byId.get(row.blocked_id)?.avatar_url ?? null }));
}

export default function BlockedAccountsPage() {
  const { client: supabase, data: rows, setData: setRows, error: loadError, loading, retry, assertOwner } = useAccountResource<Row[]>(fetchRows, []);
  const [actionError, setActionError] = useState("");
  const err = actionError || loadError;
  const [busy, setBusy] = useState<Record<string, boolean>>({});


  const unblock = async (row: Row) => {
    const name = row.full_name || (row.username ? "@" + row.username : "this person");
    if (!confirm(name + " will be able to see your posts and message you again. Unblock?")) return;
    if (busy[row.blocked_id]) return;
    setBusy(previous => ({ ...previous, [row.blocked_id]: true })); setActionError("");
    try {
      const owner = await assertOwner();
      const { error } = await withTimeout(supabase.from("blocked_users").delete().eq("blocker_id", owner).eq("blocked_id", row.blocked_id));
      if (error) throw error;
      setRows(previous => previous.filter(item => item.blocked_id !== row.blocked_id));
    } catch (cause) { setActionError(errorMessage(cause, "This person could not be unblocked. Please try again.")); }
    finally { setBusy(previous => ({ ...previous, [row.blocked_id]: false })); }
  };

  return (
    <div className="mx-auto max-w-[560px] px-1">
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><ShieldOff size={19} className="text-accent" /> Blocked accounts</h1>
      <p className="pb-5 text-[13px] text-muted">When you block someone they cannot see your posts or message you. You can undo it here.</p>
      {err ? <ErrorState title={err} onRetry={() => { setActionError(""); retry(); }} /> : loading ? <p className="py-10 text-center text-sm text-muted">Loading</p>
      : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-ink/15 py-14 text-center">
          <UserX size={28} className="text-muted" />
          <p className="text-[14px] font-semibold text-ink">Nobody is blocked</p>
        </div>
      ) : rows.map(r => (
        <div key={r.blocked_id} className="mb-2 flex items-center gap-3.5 rounded-lg border border-ink/10 p-3.5">
          {r.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayImageUrl(r.avatar_url, 200) ?? r.avatar_url} alt="" className="h-14 w-14 rounded-full object-cover" />
          ) : <span className="flex h-14 w-14 items-center justify-center rounded-full bg-navy text-[17px] font-semibold text-white">{(r.full_name || "U").charAt(0)}</span>}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-semibold text-ink"><PersonName name={r.full_name || "User"} userId={r.blocked_id} badgeSize={13} /></p>
            {r.username ? <p className="text-[12px] text-muted">@{r.username}</p> : null}
          </div>
          <button onClick={() => unblock(r)} disabled={!!busy[r.blocked_id]} className="rounded-full border border-ink/15 px-3.5 py-1.5 text-[12.5px] font-semibold text-ink transition-colors duration-[140ms] hover:bg-surface disabled:opacity-40">{busy[r.blocked_id] ? "..." : "Unblock"}</button>
        </div>
      ))}
    </div>
  );
}
