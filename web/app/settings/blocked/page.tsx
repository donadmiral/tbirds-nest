"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldOff, UserX } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Row = { blocked_id: string; created_at: string | null; full_name: string | null; username: string | null; avatar_url: string | null };

export default function BlockedAccountsPage() {
  const supabase = useRef(createClient()).current;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) { setRows([]); return; }
    const { data, error } = await supabase.from("blocked_users").select("blocked_id, created_at").eq("blocker_id", uid).order("created_at", { ascending: false });
    if (error) { setErr(error.message); return; }
    const ids = (data ?? []).map(r => r.blocked_id);
    if (!ids.length) { setRows([]); return; }
    const { data: people } = await supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", ids);
    const byId = new Map((people ?? []).map(p => [p.id, p]));
    setRows((data ?? []).map(r => ({ blocked_id: r.blocked_id, created_at: r.created_at, full_name: byId.get(r.blocked_id)?.full_name ?? null, username: byId.get(r.blocked_id)?.username ?? null, avatar_url: byId.get(r.blocked_id)?.avatar_url ?? null })));
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  const unblock = async (row: Row) => {
    const name = row.full_name || (row.username ? "@" + row.username : "this person");
    if (!confirm(name + " will be able to see your posts and message you again. Unblock?")) return;
    setBusy(b => ({ ...b, [row.blocked_id]: true }));
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    const { error } = await supabase.from("blocked_users").delete().eq("blocker_id", uid).eq("blocked_id", row.blocked_id);
    setBusy(b => { const n = { ...b }; delete n[row.blocked_id]; return n; });
    if (error) { alert("Could not unblock: " + error.message); return; }
    setRows(r => (r ?? []).filter(x => x.blocked_id !== row.blocked_id));
  };

  return (
    <div className="mx-auto max-w-[560px] px-1">
      <Link href="/settings" aria-label="Back to Settings" className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink/60 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"><ArrowLeft size={19} /></Link>
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><ShieldOff size={19} className="text-pearl" /> Blocked accounts</h1>
      <p className="pb-5 text-[13px] text-ink/50">When you block someone they cannot see your posts or message you. You can undo it here.</p>
      {err ? <p className="text-sm text-red-400">{err}</p> : rows === null ? <p className="py-10 text-center text-sm text-ink/40">Loading</p>
      : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-ink/15 py-14 text-center">
          <UserX size={28} className="text-ink/25" />
          <p className="text-[14px] font-semibold text-ink">Nobody is blocked</p>
        </div>
      ) : rows.map(r => (
        <div key={r.blocked_id} className="mb-2 flex items-center gap-3.5 rounded-lg border border-ink/10 p-3.5">
          {r.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.avatar_url} alt="" className="h-14 w-14 rounded-full object-cover" />
          ) : <span className="flex h-14 w-14 items-center justify-center rounded-full bg-navy text-[17px] font-semibold text-white">{(r.full_name || "U").charAt(0)}</span>}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-semibold text-ink">{r.full_name || "User"}</p>
            {r.username ? <p className="text-[12px] text-ink/45">@{r.username}</p> : null}
          </div>
          <button onClick={() => unblock(r)} disabled={!!busy[r.blocked_id]} className="rounded-full border border-ink/15 px-3.5 py-1.5 text-[12.5px] font-semibold text-ink transition-colors duration-[140ms] hover:bg-surface disabled:opacity-40">{busy[r.blocked_id] ? "..." : "Unblock"}</button>
        </div>
      ))}
    </div>
  );
}
