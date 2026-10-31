"use client";

import { useState } from "react";
import { useAccountResource } from "@/lib/useAccountResource";
import { errorMessage } from "@/lib/errors";
import { withTimeout } from "@/lib/withTimeout";
import { profilePath } from "@/lib/profileLookup";
import { RelativeTime } from "@/components/RelativeTime";
import { ErrorState } from "@/components/ErrorState";
import { displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";

type Row = { id: string; requester_id: string; created_at: string; full_name: string | null; username: string | null; avatar_url: string | null };

async function fetchRows(supabase: ReturnType<typeof createClient>, uid: string): Promise<Row[]> {
  const { data, error } = await supabase.from("follow_requests").select("id, requester_id, created_at").eq("target_id", uid).eq("status", "pending").order("created_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  if (!rows.length) return [];
  const { data: people, error: profileError } = await supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", rows.map(row => row.requester_id));
  if (profileError) throw profileError;
  const byId = new Map((people ?? []).map(person => [person.id, person]));
  return rows.map(row => ({ ...row, full_name: byId.get(row.requester_id)?.full_name ?? null, username: byId.get(row.requester_id)?.username ?? null, avatar_url: byId.get(row.requester_id)?.avatar_url ?? null }));
}

export default function FollowRequestsPage() {
  const { client: supabase, data: rows, setData: setRows, error: loadError, loading, retry, assertOwner } = useAccountResource<Row[]>(fetchRows, []);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});


  const respond = async (id: string, action: "accept" | "reject") => {
    if (busy[id]) return;
    setBusy(previous => ({ ...previous, [id]: true })); setActionError("");
    try {
      await assertOwner();
      const { error } = await withTimeout(supabase.rpc("respond_follow_request", { p_request_id: id, p_action: action }));
      if (error) throw error;
      setRows(previous => previous.filter(item => item.id !== id));
    } catch (cause) { setActionError(errorMessage(cause, "This request could not be updated. Please try again.")); }
    finally { setBusy(previous => ({ ...previous, [id]: false })); }
  };

  return (
    <div className="mx-auto max-w-[560px] px-1">
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><UserCheck size={19} className="text-accent" /> Follow requests</h1>
      <p className="pb-5 text-[13px] text-muted">People asking to follow your private account.</p>
      {actionError ? <p role="alert" className="text-sm text-danger">{actionError}</p> : null}
      {loadError ? <ErrorState title={loadError} onRetry={retry} /> : null}
      {loading ? <p className="py-10 text-center text-sm text-muted">Loading</p>
      : loadError ? null : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-ink/15 py-14 text-center">
          <UserCheck size={28} className="text-muted" />
          <p className="text-[14px] font-semibold text-ink">No pending requests</p>
        </div>
      ) : rows.map(r => (
        <div key={r.id} className="mb-2 flex items-center gap-3.5 rounded-lg border border-ink/10 p-3.5">
          <Link href={profilePath(r.username, r.requester_id)} className="flex min-w-0 flex-1 items-center gap-3.5">
            {r.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={displayImageUrl(r.avatar_url, 200) ?? r.avatar_url} alt="" className="h-14 w-14 rounded-full object-cover" />
            ) : <span className="flex h-14 w-14 items-center justify-center rounded-full bg-navy text-[17px] font-semibold text-white">{(r.full_name || "U").charAt(0)}</span>}
            <div className="min-w-0">
              <p className="truncate text-[14.5px] font-semibold text-ink">{r.full_name || "Member"} <VerifiedBadge userId={r.requester_id} size={13} /></p>
              <p className="text-[12px] text-muted">{r.username ? "@" + r.username + " · " : ""}<RelativeTime dateTime={r.created_at} /></p>
            </div>
          </Link>
          <button onClick={() => respond(r.id, "accept")} disabled={!!busy[r.id]} className="rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">Accept</button>
          <button onClick={() => respond(r.id, "reject")} disabled={!!busy[r.id]} className="rounded-full border border-ink/15 px-3 py-1.5 text-[12.5px] text-ink/60 transition-colors duration-[140ms] hover:text-ink disabled:opacity-40">Decline</button>
        </div>
      ))}
    </div>
  );
}