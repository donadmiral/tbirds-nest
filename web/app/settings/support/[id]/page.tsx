"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { replyToMemberSupport } from "@/lib/memberSupport";
import { readSupportConversation, supportError, type SupportTicket, type SupportMessage } from "../../../../../shared/memberSupport";
import { readWithDeadline } from "../../../../../shared/readDeadline";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-danger/10 text-danger" },
  pending: { label: "Replied — your turn", cls: "bg-warn/10 text-warn" },
  solved: { label: "Solved", cls: "bg-success/10 text-success" },
};

export default function TicketPage() {
  const { id: ticketId } = useParams<{ id: string }>();
  const [supabase] = useState(createClient);
  const [uid, setUid] = useState<string | null>(null);
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [msgs, setMsgs] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const visit = useRef(0), submitting = useRef(false);
  const readRevision = useRef(0), mutation = useRef(0);

  const load = useCallback(async (owner: string, generation = visit.current) => {
    if (generation !== visit.current) return;
    const read = ++readRevision.current;
    const current = () => generation === visit.current && read === readRevision.current;
    setLoading(true);
    setError(null);
    setHistoryError(null);
    try {
      if (!ticketId) { setTicket(null); return; }
      const result = await readSupportConversation(supabase, owner, ticketId);
      if (!current()) return;
      setTicket(result.ticket);
      setMsgs(result.messages);
      setHistoryError(result.historyError);
    } catch {
      if (current()) setError("This ticket could not be loaded. Please try again.");
    } finally {
      if (current()) setLoading(false);
    }
  }, [supabase, ticketId]);

  const initialize = useCallback(async () => {
    const generation = ++visit.current;
    ++readRevision.current; ++mutation.current;
    submitting.current = false; setBusy(false);
    setLoading(true);
    setError(null);
    setTicket(null);
    setMsgs([]);
    try {
      const { data: auth, error: authError } = await readWithDeadline(supabase.auth.getUser());
      if (authError) throw authError;
      if (generation !== visit.current) return;
      const owner = auth.user?.id ?? null;
      setUid(owner);
      if (owner) await load(owner, generation);
    } catch {
      if (generation === visit.current) setError("This ticket could not be loaded. Please try again.");
    } finally {
      if (generation === visit.current) setLoading(false);
    }
  }, [supabase, load]);

  const invalidateVisit = useCallback(() => {
    ++visit.current; ++readRevision.current; ++mutation.current;
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) { setDraft(""); void initialize(); } });
    return () => { active = false; invalidateVisit(); };
  }, [initialize, invalidateVisit]);

  const send = async () => {
    if (!draft.trim() || submitting.current || !uid || !ticket) return;
    submitting.current = true;
    setBusy(true);
    const generation = visit.current, sentBody = draft;
    const attempt = ++mutation.current;
    ++readRevision.current; setLoading(false);
    try {
      const confirmation = await replyToMemberSupport(supabase, uid, ticketId, sentBody,
        () => generation === visit.current && attempt === mutation.current);
      const accepted = await confirmation.accept(() => {
        ++readRevision.current;
        setDraft(value => value === sentBody ? "" : value);
      });
      if (!accepted || generation !== visit.current || attempt !== mutation.current) return;
      await load(uid, generation);
    } catch (failure) {
      if (generation === visit.current && attempt === mutation.current) alert(supportError(failure, "Your reply could not be confirmed. Your draft is kept. Try again to check the same request."));
    } finally {
      if (attempt === mutation.current) { submitting.current = false; setBusy(false); }
    }
  };

  const back = <Link href="/settings/support" className="mb-4 inline-block text-sm text-ink underline">Back to support</Link>;
  if (loading && !ticket) return <div className="mx-auto max-w-[600px] px-1">{back}<p role="status" className="py-10 text-center text-sm text-muted">Loading</p></div>;
  if (error) return <div className="mx-auto max-w-[600px] px-1">{back}<div role="alert" className="rounded-lg border border-danger/30 p-4 text-sm text-ink"><p>{error}</p><button onClick={() => void initialize()} className="mt-3 rounded-lg bg-ink px-4 py-2 font-bold text-white">Try again</button></div></div>;
  if (!uid) return <div className="mx-auto max-w-[600px] px-1">{back}<p className="py-8 text-sm text-muted">Sign in to view this support ticket.</p></div>;
  if (!ticket) return <div className="mx-auto max-w-[600px] px-1">{back}<p role="status" className="py-8 text-sm text-muted">This ticket is not available to this account.</p></div>;
  const meta = STATUS_META[ticket.status] || STATUS_META.open;

  return (
    <div className="mx-auto max-w-[600px] px-1">
      {back}
      <div className="mb-4 flex items-center gap-2"><h1 className="min-w-0 flex-1 truncate font-display text-xl text-porcelain">{ticket.subject}</h1><span className={"shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold " + meta.cls}>{meta.label}</span></div>
      <div className="mb-2 rounded-xl bg-ink/[0.035] p-3.5"><p className="text-[13.5px] leading-relaxed text-ink/80">{ticket.body}</p><p className="mt-2 text-[11px] text-muted">{new Date(ticket.created_at).toLocaleString()}</p></div>
      {historyError ? <div role="alert" className="mb-3 rounded-lg border border-danger/30 p-3 text-sm text-ink"><p>{historyError}</p><button disabled={loading} onClick={() => void load(uid)} className="mt-2 underline">Try again</button></div> : null}
      {loading ? <p role="status" className="text-sm text-muted">Refreshing conversation</p> : null}
      {msgs.map(message => (
        <div key={message.id} className={"mb-2 max-w-[85%] rounded-xl p-3 " + (message.sender === "member" ? "ml-auto bg-ink text-white" : "bg-ink/[0.035] text-ink")}>
          <p className="text-[13.5px] leading-relaxed">{message.body}</p>
          <p className={"mt-1.5 text-[10.5px] " + (message.sender === "member" ? "text-white/80" : "text-muted")}>{message.sender === "member" ? "You" : "Platinum Circles"} · {new Date(message.created_at).toLocaleString()}</p>
        </div>
      ))}
      <div className="mt-4 flex gap-2">
        <label className="sr-only" htmlFor="support-reply">Reply</label>
        <input id="support-reply" value={draft} maxLength={2000} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void send(); }} placeholder="Write a reply" className="min-w-0 flex-1 rounded-lg border border-ink/15 px-3.5 py-2.5 text-[14px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
        <button onClick={() => void send()} disabled={busy || !draft.trim()} className="shrink-0 rounded-lg bg-ink px-4 py-2.5 text-[13.5px] font-bold text-white transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">{busy ? "Sending" : "Send"}</button>
      </div>
    </div>
  );
}
