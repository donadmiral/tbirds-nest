"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Ticket = { id: string; subject: string; body: string; status: string; created_at: string };
type Msg = { id: string; sender: string; body: string; created_at: string };

const STATUS_META: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-red-500/10 text-red-500" },
  pending: { label: "Replied — your turn", cls: "bg-amber-500/10 text-amber-700" },
  solved: { label: "Solved", cls: "bg-success/10 text-success" },
};

export default function TicketPage() {
  const params = useParams<{ id: string }>();
  const ticketId = params.id;
  const supabase = useRef(createClient()).current;
  const [uid, setUid] = useState<string | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [t, m] = await Promise.all([
      supabase.from("support_tickets").select("id, subject, body, status, created_at").eq("id", ticketId).maybeSingle(),
      supabase.from("support_messages").select("id, sender, body, created_at").eq("ticket_id", ticketId).order("created_at", { ascending: true }),
    ]);
    if (t.data) setTicket(t.data);
    setMsgs(m.data ?? []);
  }, [supabase, ticketId]);

  useEffect(() => {
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      setUid(auth.user?.id ?? null);
      await load();
    })();
  }, [supabase, load]);

  const send = async () => {
    if (!draft.trim() || busy || !uid) return;
    setBusy(true);
    const { error } = await supabase.from("support_messages").insert({ ticket_id: ticketId, sender: "member", sender_id: uid, body: draft.trim() });
    if (!error) await supabase.from("support_tickets").update({ status: "open", updated_at: new Date().toISOString() }).eq("id", ticketId);
    setBusy(false);
    if (error) { alert("Could not send: " + error.message); return; }
    setDraft("");
    await load();
  };

  if (!ticket) return <div className="mx-auto max-w-[600px] px-1"><p className="py-10 text-center text-sm text-ink/40">Loading</p></div>;
  const meta = STATUS_META[ticket.status] || STATUS_META.open;

  return (
    <div className="mx-auto max-w-[600px] px-1">
      <Link href="/settings/support" aria-label="Back to Support" className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink/60 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"><ArrowLeft size={19} /></Link>
      <div className="mb-4 flex items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate font-display text-xl text-porcelain">{ticket.subject}</h1>
        <span className={"shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold " + meta.cls}>{meta.label}</span>
      </div>

      <div className="mb-2 rounded-xl bg-ink/[0.035] p-3.5">
        <p className="text-[13.5px] leading-relaxed text-ink/80">{ticket.body}</p>
        <p className="mt-2 text-[11px] text-ink/40">{new Date(ticket.created_at).toLocaleString()}</p>
      </div>

      {(msgs ?? []).map(m => (
        <div key={m.id} className={"mb-2 max-w-[85%] rounded-xl p-3 " + (m.sender === "member" ? "ml-auto bg-ink text-white" : "bg-ink/[0.035] text-ink")}>
          <p className="text-[13.5px] leading-relaxed">{m.body}</p>
          <p className={"mt-1.5 text-[10.5px] " + (m.sender === "member" ? "text-white/50" : "text-ink/40")}>{m.sender === "member" ? "You" : "Platinum Circles"} · {new Date(m.created_at).toLocaleString()}</p>
        </div>
      ))}

      <div className="mt-4 flex gap-2">
        <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void send(); }} placeholder="Write a reply" className="w-full rounded-lg border border-ink/15 px-3.5 py-2.5 text-[14px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
        <button onClick={send} disabled={busy || !draft.trim()} className="shrink-0 rounded-lg bg-ink px-4 py-2.5 text-[13.5px] font-bold text-white transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">Send</button>
      </div>
    </div>
  );
}