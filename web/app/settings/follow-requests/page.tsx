"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { ArrowLeft, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";

type Row = { id: string; requester_id: string; created_at: string; full_name: string | null; username: string | null; avatar_url: string | null };

function relTime(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (m < 1) return "now"; if (m < 60) return m + "m"; if (h < 24) return h + "h"; if (dy < 7) return dy + "d";
  return new Date(d).toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function FollowRequestsPage() {
  const supabase = useRef(createClient()).current;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) { setRows([]); return; }
    const { data } = await supabase.from("follow_requests").select("id, requester_id, created_at").eq("target_id", uid).eq("status", "pending").order("created_at", { ascending: false });
    const rows = data ?? [];
    if (!rows.length) { setRows([]); return; }
    const { data: people } = await supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", rows.map(r => r.requester_id));
    const byId = new Map((people ?? []).map(p => [p.id, p]));
    setRows(rows.map(r => ({ ...r, full_name: byId.get(r.requester_id)?.full_name ?? null, username: byId.get(r.requester_id)?.username ?? null, avatar_url: byId.get(r.requester_id)?.avatar_url ?? null })));
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  const respond = async (id: string, action: "accept" | "reject") => {
    if (busy[id]) return;
    setBusy(b => ({ ...b, [id]: true }));
    const { error } = await supabase.rpc("respond_follow_request", { p_request_id: id, p_action: action });
    setBusy(b => { const n = { ...b }; delete n[id]; return n; });
    if (error) { alert(error.message); return; }
    setRows(r => (r ?? []).filter(x => x.id !== id));
  };

  return (
    <div className="mx-auto max-w-[560px] px-1">
      <Link href="/settings" aria-label="Back to Settings" className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink/60 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"><ArrowLeft size={19} /></Link>
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><UserCheck size={19} className="text-pearl" /> Follow requests</h1>
      <p className="pb-5 text-[13px] text-ink/50">People asking to follow your private account.</p>
      {rows === null ? <p className="py-10 text-center text-sm text-ink/40">Loading</p>
      : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-ink/15 py-14 text-center">
          <UserCheck size={28} className="text-ink/25" />
          <p className="text-[14px] font-semibold text-ink">No pending requests</p>
        </div>
      ) : rows.map(r => (
        <div key={r.id} className="mb-2 flex items-center gap-3.5 rounded-lg border border-ink/10 p-3.5">
          <Link href={"/" + (r.username || "")} className="flex min-w-0 flex-1 items-center gap-3.5">
            {r.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={displayImageUrl(r.avatar_url, 200) ?? r.avatar_url} alt="" className="h-14 w-14 rounded-full object-cover" />
            ) : <span className="flex h-14 w-14 items-center justify-center rounded-full bg-navy text-[17px] font-semibold text-white">{(r.full_name || "U").charAt(0)}</span>}
            <div className="min-w-0">
              <p className="truncate text-[14.5px] font-semibold text-ink">{r.full_name || "Member"} <VerifiedBadge userId={r.requester_id} size={13} /></p>
              <p className="text-[12px] text-ink/45">{r.username ? "@" + r.username + " · " : ""}{relTime(r.created_at)}</p>
            </div>
          </Link>
          <button onClick={() => respond(r.id, "accept")} disabled={!!busy[r.id]} className="rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">Accept</button>
          <button onClick={() => respond(r.id, "reject")} disabled={!!busy[r.id]} className="rounded-full border border-ink/15 px-3 py-1.5 text-[12.5px] text-ink/60 transition-colors duration-[140ms] hover:text-ink disabled:opacity-40">Decline</button>
        </div>
      ))}
    </div>
  );
}