"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Check = {
  id: string; body: string; sources: string[]; created_at: string;
  helpful_count: number; not_helpful_count: number;
  viewer_vote: boolean | null; is_mine: boolean; qualifies: boolean;
};

// Fact Check: readers add context with sources, votes decide what shows.
export function FactCheckBanner({ postId }: { postId: string }) {
  const supabase = useRef(createClient()).current;
  const [checks, setChecks] = useState<Check[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("get_fact_checks", { p_post_id: postId });
    setChecks((data ?? []) as Check[]);
  }, [postId, supabase]);

  useEffect(() => { load(); }, [load]);

  const top = checks.find((c) => c.qualifies) ?? null;
  const pendingMine = checks.find((c) => c.is_mine && !c.qualifies);
  if (!top && !pendingMine) return null;

  async function rate(id: string, helpful: boolean) {
    await supabase.rpc("rate_fact_check", { p_id: id, p_helpful: helpful });
    load();
  }

  return (
    <div className="mt-3 rounded-lg border border-pearl/30 bg-pearl/5 p-3.5">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-pearl">
        <ShieldCheck size={14} /> {top ? "Readers added a fact check" : "Your fact check is awaiting reader ratings"}
      </p>
      {top ? (
        <>
          <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink/85">{top.body}</p>
          {top.sources.length > 0 ? (
            <span className="mt-2 flex flex-wrap gap-2">
              {top.sources.map((s, i) => (
                <a key={i} href={s} target="_blank" rel="noopener noreferrer" className="max-w-full truncate rounded-md bg-surface px-2 py-1 text-[11px] text-pearl hover:underline">
                  {s.replace(/^https?:\/\//, "").slice(0, 40)}
                </a>
              ))}
            </span>
          ) : null}
          {!top.is_mine ? (
            <span className="mt-2.5 flex items-center gap-2 text-[12px] text-ink/50">
              Is this helpful?
              <button onClick={() => rate(top.id, true)} className={"rounded-md px-2.5 py-1 " + (top.viewer_vote === true ? "bg-pearl font-semibold text-ink" : "bg-surface text-ink hover:bg-surface-elevated")}>Yes</button>
              <button onClick={() => rate(top.id, false)} className={"rounded-md px-2.5 py-1 " + (top.viewer_vote === false ? "bg-pearl font-semibold text-ink" : "bg-surface text-ink hover:bg-surface-elevated")}>No</button>
              <span className="ml-auto">{top.helpful_count} found this helpful</span>
            </span>
          ) : (
            <span className="mt-2 block text-[12px] text-ink/40">{top.helpful_count} readers found this helpful</span>
          )}
        </>
      ) : (
        <p className="mt-1 text-[12px] text-ink/50">It becomes public once at least 3 readers rate it helpful.</p>
      )}
    </div>
  );
}

export function FactCheckModal({ postId, onClose }: { postId: string; onClose: () => void }) {
  const supabase = useRef(createClient()).current;
  const [body, setBody] = useState("");
  const [s1, setS1] = useState("");
  const [s2, setS2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid) { setErr("Sign in first."); setBusy(false); return; }
    const sources = [s1, s2].map((x) => x.trim()).filter((x) => /^https?:\/\//.test(x));
    const { error } = await supabase.from("fact_checks").insert({ post_id: postId, author_id: uid, body: body.trim(), sources });
    setBusy(false);
    if (error) {
      setErr(error.message.includes("duplicate") ? "You already added a fact check on this post." : error.message.includes("row-level") ? "You cannot fact check your own post." : error.message);
      return;
    }
    onClose();
    alert("Fact check submitted. It shows publicly once readers rate it helpful.");
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-ink/10 bg-navy p-5" onClick={(e) => e.stopPropagation()}>
        <p className="flex items-center justify-between text-[15px] font-semibold text-ink">
          <span className="flex items-center gap-2"><ShieldCheck size={17} className="text-pearl" /> Add a fact check</span>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1 text-ink/40 hover:bg-surface hover:text-ink"><X size={16} /></button>
        </p>
        <p className="mt-1 text-[12px] text-ink/45">Add missing context with sources. It shows on the post once at least 3 readers rate it helpful. Minimum 20 characters.</p>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={4}
          placeholder="What context is missing, and what do the sources actually say?"
          className="mt-3 w-full resize-none rounded-md bg-surface px-3 py-2.5 text-[13.5px] text-ink placeholder:text-ink/25 outline-none focus:bg-surface-elevated"
        />
        <input value={s1} onChange={(e) => setS1(e.target.value)} placeholder="Source link, https://" className="mt-2 w-full rounded-md bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink/25 outline-none" />
        <input value={s2} onChange={(e) => setS2(e.target.value)} placeholder="Second source, optional" className="mt-2 w-full rounded-md bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink/25 outline-none" />
        {err ? <p className="mt-2 text-[12px] text-danger">{err}</p> : null}
        <button onClick={submit} disabled={busy || body.trim().length < 20}
          className="mt-3 w-full rounded-md bg-pearl py-2.5 text-[13px] font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Submitting" : "Submit fact check"}
        </button>
      </div>
    </div>
  );
}