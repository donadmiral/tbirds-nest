"use client";

import { useRef, useState } from "react";
import { useAccountResource } from "@/lib/useAccountResource";
import { errorMessage } from "@/lib/errors";
import { withTimeout } from "@/lib/withTimeout";
import { ErrorState } from "@/components/ErrorState";
import { RelativeTime } from "@/components/RelativeTime";
import { displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Row = { conversation_id: string; sender_id: string; sender_name: string | null; sender_username: string | null; sender_avatar_url: string | null; requested_at: string | null; last_message_preview: string | null; last_message_time: string | null };

async function loadRequests(supabase: ReturnType<typeof createClient>): Promise<Row[]> {
  const {data,error}=await supabase.rpc("get_message_requests");
  if(error) throw error;
  return (data??[]) as Row[];
}
export default function MessageRequestsPage() {
  const resource=useAccountResource(loadRequests, []);
  const router=useRouter();
  const rows=resource.data;
  const locks=useRef(new Set<string>());
  const [busy,setBusy]=useState<Record<string,boolean>>({});
  const [actionError,setActionError]=useState("");
  const decide = async (row: Row, action: "accept" | "decline") => {
    const id=row.conversation_id;
    if(locks.current.has(id)) return;
    if(action==="decline"&&!confirm((row.sender_name||"This user")+" will not be notified. Their messages will be deleted. Decline?"))return;
    locks.current.add(id); setBusy(value=>({...value,[id]:true}));setActionError("");
    try {
      await resource.assertOwner();
      const {error}=await withTimeout(resource.client.rpc(action==="accept"?"accept_message_request":"decline_message_request",{p_conversation_id:id}));
      if(error)throw error;
      await resource.assertOwner();
      if(action==="accept")router.push("/messages?c="+encodeURIComponent(id));
      else resource.setData(values=>values.filter(value=>value.conversation_id!==id));
    } catch(cause) {setActionError(errorMessage(cause,"The request could not be updated. Please try again."));}
    finally {locks.current.delete(id);setBusy(value=>{const next={...value};delete next[id];return next;});}
  };
  return (
    <div className="mx-auto max-w-[560px] px-1">
      <Link href="/messages" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"><ArrowLeft size={14} /> Messages</Link>
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><Inbox size={19} className="text-accent" /> Message requests</h1>
      <p className="pb-5 text-[13px] text-muted">Messages from people you do not follow wait here. Accept to reply, decline to remove.</p>
      {actionError ? <p role="alert" className="mb-4 text-sm text-danger">{actionError}</p> : null}
      {resource.error ? <ErrorState title="Message requests could not load" line={resource.error} onRetry={resource.retry}/> : resource.loading ? <p className="py-10 text-center text-sm text-muted">Loading</p>
      : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-ink/15 py-14 text-center">
          <Inbox size={28} className="text-muted" />
          <p className="text-[14px] font-semibold text-ink">No requests</p>
        </div>
      ) : rows.map(r => (
        <div key={r.conversation_id} className="mb-2 rounded-xl border border-ink/10 p-3.5">
          <div className="flex items-center gap-3">
            {r.sender_avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={displayImageUrl(r.sender_avatar_url, 200) ?? r.sender_avatar_url} alt="" className="h-11 w-11 rounded-full object-cover" />
            ) : <span className="flex h-11 w-11 items-center justify-center rounded-full bg-navy text-[13px] font-semibold text-white">{(r.sender_name || "U").charAt(0)}</span>}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-ink">{r.sender_name || "User"}</p>
              <p className="text-[12px] text-muted">{r.sender_username ? "@" + r.sender_username : ""}</p>
            </div>
            <p className="shrink-0 text-[11px] text-muted">{r.requested_at || r.last_message_time ? <RelativeTime dateTime={(r.requested_at || r.last_message_time)!}/> : null}</p>
          </div>
          {r.last_message_preview ? <p className="mt-2 line-clamp-2 text-[13px] text-ink/70">{r.last_message_preview}</p> : null}
          <div className="mt-3 flex gap-2">
            <button onClick={() => void decide(r,"decline")} disabled={!!busy[r.conversation_id]} className="flex-1 rounded-lg border border-ink/15 py-2 text-[13px] font-semibold text-ink/70 disabled:opacity-40">Decline</button>
            <button onClick={() => void decide(r,"accept")} disabled={!!busy[r.conversation_id]} className="flex-1 rounded-lg bg-ink py-2 text-[13px] font-semibold text-white disabled:opacity-40">{busy[r.conversation_id] ? "..." : "Accept"}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
