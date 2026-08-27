"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, LifeBuoy } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Ticket = { id: string; kind: string; subject: string; status: string; created_at: string; updated_at: string | null };

export default function SupportPage() {
  const supabase = useRef(createClient()).current;
  const [uid, setUid] = useState<string | null>(null);
  const [isAppeal, setIsAppeal] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ready, setReady] = useState(false);

  const load = useCallback(async (me: string) => {
    const { data } = await supabase.from("support_tickets").select("id, kind, subject, status, created_at, updated_at")
      .eq("user_id", me).order("created_at", { ascending: false }).limit(10);
    setTickets(data ?? []);
  }, [supabase]);

  useEffect(() => {
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const me = auth.user?.id ?? null;
      setUid(me);
      if (!me) { setReady(true); return; }
      const { data: prof } = await supabase.from("profiles").select("deactivated_at").eq("id", me).maybeSingle();
      const appeal = !!prof?.deactivated_at;
      setIsAppeal(appeal);
      if (appeal) setSubject("Appeal my suspension");
      await load(me);
      setReady(true);
    })();
  }, [supabase, load]);

  const submit = async () => {
    if (!uid || busy) return;
    if (!subject.trim() || !body.trim()) { alert("A subject and a message are required."); return; }
    setBusy(true);
    const { error } = await supabase.from("support_tickets").insert({
      user_id: uid, kind: isAppeal ? "appeal" : "support", subject: subject.trim(), body: body.trim(),
    });
    setBusy(false);
    if (error) { alert("Could not send: " + error.message); return; }
    setSubject(isAppeal ? "Appeal my suspension" : ""); setBody("");
    await load(uid);
    alert(isAppeal ? "Your appeal is with the operations team. The outcome will appear here." : "Your message is with the operations team. The reply will appear here.");
  };

  const pill = (status: string) => {
    if (status === "solved") return <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10.5px] font-bold text-success">Solved</span>;
    if (status === "pending") return <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-bold text-amber-700">Replied — open it</span>;
    return <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10.5px] font-bold text-red-500">With the team</span>;
  };

  return (
    <div className="mx-auto max-w-[600px] px-1">
      <Link href="/settings" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"><ArrowLeft size={14} /> Settings</Link>
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><LifeBuoy size={19} className="text-pearl" /> {isAppeal ? "Appeal" : "Support"}</h1>
      <p className="pb-5 text-[13px] leading-relaxed text-ink/50">{isAppeal
        ? "Your account is suspended. Tell the operations team why it should be restored — a person reads every appeal."
        : "Write to the Platinum Circles operations team. A person reads every message and the reply appears here."}</p>

      {!ready ? <p className="py-8 text-center text-sm text-ink/40">Loading</p> : !uid ? (
        <p className="rounded-xl border border-dashed border-ink/15 px-4 py-8 text-center text-[13.5px] text-ink/50">Sign in to contact support.</p>
      ) : (
        <>
          <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" className="mb-2.5 w-full rounded-lg border border-ink/15 px-3.5 py-2.5 text-[14px] text-ink outline-none focus:border-ink/40" />
          <textarea value={body} onChange={e => setBody(e.target.value)} placeholder={isAppeal ? "Your case for restoration..." : "What do you need help with?"} className="mb-3 h-32 w-full rounded-lg border border-ink/15 px-3.5 py-2.5 text-[14px] text-ink outline-none focus:border-ink/40" />
          <button onClick={submit} disabled={busy} className="w-full rounded-xl bg-ink py-3 text-[14px] font-bold text-white disabled:opacity-40">{busy ? "Sending" : isAppeal ? "Send appeal" : "Send to operations"}</button>

          {tickets.length ? <p className="mb-2 mt-7 text-[11px] font-semibold uppercase tracking-wide text-ink/40">Your messages</p> : null}
          {tickets.map(t => (
            <Link key={t.id} href={"/settings/support/" + t.id} className="mb-2 block rounded-xl border border-ink/10 p-3 hover:bg-ink/[0.02]">
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-ink">{t.subject}</span>
                {pill(t.status)}
                <ChevronRight size={15} className="shrink-0 text-ink/25" />
              </span>
              <span className="mt-1.5 block text-[11px] text-ink/40">{new Date(t.updated_at || t.created_at).toLocaleString()}</span>
            </Link>
          ))}
        </>
      )}
    </div>
  );
}