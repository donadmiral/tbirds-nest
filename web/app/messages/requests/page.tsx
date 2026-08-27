"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Row = { conversation_id: string; sender_id: string; sender_name: string | null; sender_username: string | null; sender_avatar_url: string | null; requested_at: string | null; last_message_preview: string | null; last_message_time: string | null };

function relTime(d?: string | null) {
  if (!d) return "";
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (m < 1) return "now"; if (m < 60) return m + "m"; if (h < 24) return h + "h"; if (dy < 7) return dy + "d";
  return new Date(d).toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function MessageRequestsPage() {
  const supabase = useRef(createClient()).current;
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_message_requests");
    if (error) { setRows([]); return; }
    setRows((data as Row[]) ?? []);
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  const accept = async (r: Row) => {
    if (busy[r.conversation_id]) return;
    setBusy(b => ({ ...b, [r.conversation_id]: true }));
    const { error } = await supabase.rpc("accept_message_request", { p_conversation_id: r.conversation_id });
    if (error) { alert(error.message); setBusy(b => { const n = { ...b }; delete n[r.conversation_id]; return n; }); return; }
    router.push("/messages?c=" + r.conversation_id);
  };
  const decline = async (r: Row) => {
    if (busy[r.conversation_id]) return;
    if (!confirm((r.sender_name || "This user") + " will not be notified. Their messages will be deleted. Decline?")) return;
    setBusy(b => ({ ...b, [r.conversation_id]: true }));
    const { error } = await supabase.rpc("decline_message_request", { p_conversation_id: r.conversation_id });
    setBusy(b => { const n = { ...b }; delete n[r.conversation_id]; return n; });
    if (error) { alert(error.message); return; }
    setRows(rs => (rs ?? []).filter(x => x.conversation_id !== r.conversation_id));
  };

  return (
    <div className="mx-auto max-w-[560px] px-1">
      <Link href="/messages" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"><ArrowLeft size={14} /> Messages</Link>
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><Inbox size={19} className="text-pearl" /> Message requests</h1>
      <p className="pb-5 text-[13px] text-ink/50">Messages from people you do not follow wait here. Accept to reply, decline to remove.</p>
      {rows === null ? <p className="py-10 text-center text-sm text-ink/40">Loading</p>
      : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-ink/15 py-14 text-center">
          <Inbox size={28} className="text-ink/25" />
          <p className="text-[14px] font-semibold text-ink">No requests</p>
        </div>
      ) : rows.map(r => (
        <div key={r.conversation_id} className="mb-2 rounded-xl border border-ink/10 p-3.5">
          <div className="flex items-center gap-3">
            {r.sender_avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.sender_avatar_url} alt="" className="h-11 w-11 rounded-full object-cover" />
            ) : <span className="flex h-11 w-11 items-center justify-center rounded-full bg-navy text-[13px] font-semibold text-white">{(r.sender_name || "U").charAt(0)}</span>}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-ink">{r.sender_name || "User"}</p>
              <p className="text-[12px] text-ink/45">{r.sender_username ? "@" + r.sender_username : ""}</p>
            </div>
            <p className="shrink-0 text-[11px] text-ink/40">{relTime(r.requested_at || r.last_message_time)}</p>
          </div>
          {r.last_message_preview ? <p className="mt-2 line-clamp-2 text-[13px] text-ink/70">{r.last_message_preview}</p> : null}
          <div className="mt-3 flex gap-2">
            <button onClick={() => decline(r)} disabled={!!busy[r.conversation_id]} className="flex-1 rounded-lg border border-ink/15 py-2 text-[13px] font-semibold text-ink/70 disabled:opacity-40">Decline</button>
            <button onClick={() => accept(r)} disabled={!!busy[r.conversation_id]} className="flex-1 rounded-lg bg-ink py-2 text-[13px] font-semibold text-white disabled:opacity-40">{busy[r.conversation_id] ? "..." : "Accept"}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
