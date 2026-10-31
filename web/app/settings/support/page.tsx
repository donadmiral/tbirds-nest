"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, LifeBuoy } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { createMemberSupportRequest } from "@/lib/memberSupport";
import { readSupportTickets, supportError, type SupportTicket } from "../../../../shared/memberSupport";
import { readWithDeadline } from "../../../../shared/readDeadline";

export default function SupportPage() {
  const [supabase] = useState(createClient);
  const [uid, setUid] = useState<string | null>(null);
  const [isAppeal, setIsAppeal] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const visit = useRef(0);
  const readRevision = useRef(0), mutation = useRef(0);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [ready, setReady] = useState(false);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);

  const load = useCallback(async (owner: string, generation = visit.current) => {
    if (generation !== visit.current) return;
    const read = ++readRevision.current;
    const current = () => generation === visit.current && read === readRevision.current;
    setListLoading(true);
    setListError(null);
    try {
      const rows = await readSupportTickets(supabase, owner);
      if (current()) setTickets(rows);
    } catch {
      if (current()) setListError("Your messages could not be loaded. Please try again.");
    } finally {
      if (current()) setListLoading(false);
    }
  }, [supabase]);

  const initialize = useCallback(async () => {
    const generation = ++visit.current;
    ++readRevision.current; ++mutation.current;
    submitting.current = false; setBusy(false);
    setReady(false);
    setInitialError(null);
    try {
      const { data: auth, error: authError } = await readWithDeadline(supabase.auth.getUser());
      if (authError) throw authError;
      if (generation !== visit.current) return;
      const owner = auth.user?.id ?? null;
      setUid(owner);
      if (!owner) { setTickets([]); return; }
      const [profile] = await Promise.all([
        readWithDeadline(supabase.from("profiles").select("deactivated_at").eq("id", owner).maybeSingle()),
        load(owner, generation),
      ]);
      if (profile.error) throw profile.error;
      if (generation !== visit.current) return;
      const appeal = !!profile.data?.deactivated_at;
      setIsAppeal(appeal);
      if (appeal) setSubject(value => value || "Appeal my suspension");
    } catch {
      if (generation === visit.current) setInitialError("Support could not be loaded. Check your connection and try again.");
    } finally {
      if (generation === visit.current) setReady(true);
    }
  }, [supabase, load]);

  const invalidateVisit = useCallback(() => {
    ++visit.current; ++readRevision.current; ++mutation.current;
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void initialize(); });
    return () => { active = false; invalidateVisit(); };
  }, [initialize, invalidateVisit]);

  const submit = async () => {
    if (!uid || submitting.current) return;
    if (!subject.trim() || !body.trim()) { alert("A subject and a message are required."); return; }
    submitting.current = true;
    setBusy(true);
    const generation = visit.current, sentSubject = subject, sentBody = body;
    const attempt = ++mutation.current;
    ++readRevision.current; setListLoading(false);
    try {
      const confirmation = await createMemberSupportRequest(supabase, uid, { kind: isAppeal ? "appeal" : "support", subject: sentSubject, body: sentBody },
        () => generation === visit.current && attempt === mutation.current);
      const accepted = await confirmation.accept(() => {
        ++readRevision.current;
        setSubject(value => value === sentSubject ? (isAppeal ? "Appeal my suspension" : "") : value);
        setBody(value => value === sentBody ? "" : value);
      });
      if (!accepted || generation !== visit.current || attempt !== mutation.current) return;
      await load(uid, generation);
      if (generation === visit.current) alert(isAppeal ? "Your appeal is with the operations team. The outcome will appear here." : "Your message is with the operations team. The reply will appear here.");
    } catch (error) {
      if (generation === visit.current && attempt === mutation.current) alert(supportError(error, "Sending could not be confirmed. Your draft is kept. Try again to check the same request."));
    } finally {
      if (attempt === mutation.current) { submitting.current = false; setBusy(false); }
    }
  };

  const pill = (status: string) => {
    if (status === "solved") return <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10.5px] font-bold text-success">Solved</span>;
    if (status === "pending") return <span className="rounded-full bg-warn/10 px-2 py-0.5 text-[10.5px] font-bold text-warn">Replied — open it</span>;
    return <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10.5px] font-bold text-danger">With the team</span>;
  };

  return (
    <div className="mx-auto max-w-[600px] px-1">
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><LifeBuoy size={19} className="text-accent" /> {isAppeal ? "Appeal" : "Support"}</h1>
      <p className="pb-5 text-[13px] leading-relaxed text-muted">{isAppeal
        ? "Your account is suspended. Tell the operations team why it should be restored — a person reads every appeal."
        : "Write to the Platinum Circles operations team. A person reads every message and the reply appears here."}</p>
      {!ready ? <p role="status" className="py-8 text-center text-sm text-muted">Loading</p> : initialError ? (
        <div role="alert" className="rounded-lg border border-danger/30 p-4 text-sm text-ink">
          <p>{initialError}</p><button onClick={() => void initialize()} className="mt-3 rounded-lg bg-ink px-4 py-2 font-bold text-white">Try again</button>
        </div>
      ) : !uid ? (
        <p className="rounded-lg border border-dashed border-ink/15 px-4 py-8 text-center text-[13.5px] text-muted">Sign in to contact support.</p>
      ) : (
        <>
          <label className="sr-only" htmlFor="support-subject">Subject</label>
          <input id="support-subject" value={subject} maxLength={160} onChange={e => setSubject(e.target.value)} placeholder="Subject" className="mb-2.5 w-full rounded-lg border border-ink/15 px-3.5 py-2.5 text-[14px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
          <label className="sr-only" htmlFor="support-body">Message</label>
          <textarea id="support-body" value={body} maxLength={2000} onChange={e => setBody(e.target.value)} placeholder={isAppeal ? "Your case for restoration..." : "What do you need help with?"} className="mb-3 h-32 w-full rounded-lg border border-ink/15 px-3.5 py-2.5 text-[14px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
          <button onClick={() => void submit()} disabled={busy} className="w-full rounded-full bg-ink py-3 text-[14px] font-bold text-white transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">{busy ? "Sending" : isAppeal ? "Send appeal" : "Send to operations"}</button>
          <p className="mb-2 mt-7 text-[11px] font-semibold uppercase tracking-wide text-muted">Your messages</p>
          {listError ? <div role="alert" className="mb-3 rounded-lg border border-danger/30 p-3 text-sm text-ink"><p>{listError}</p><button disabled={listLoading} onClick={() => void load(uid)} className="mt-2 underline">Try again</button></div> : null}
          {listLoading ? <p role="status" className="text-sm text-muted">Loading messages</p> : !listError && !tickets.length ? <p className="text-sm text-muted">You have no support messages yet.</p> : null}
          {tickets.map(ticket => (
            <Link key={ticket.id} href={"/settings/support/" + ticket.id} className="mb-2 block rounded-lg border border-ink/10 p-3 transition-colors duration-[140ms] hover:bg-surface">
              <span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-ink">{ticket.subject}</span>{pill(ticket.status)}<ChevronRight size={15} className="shrink-0 text-muted" /></span>
              <span className="mt-1.5 block text-[11px] text-muted">{new Date(ticket.updated_at || ticket.created_at).toLocaleString()}</span>
            </Link>
          ))}
        </>
      )}
    </div>
  );
}
