"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function ApplyPanel({ jobId, applyUrl }: { jobId: string; applyUrl: string | null }) {
  const supabase = createClient();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [applied, setApplied] = useState(false);
  const [open, setOpen] = useState(false);
  const [coverNote, setCoverNote] = useState("");
  const [phone, setPhone] = useState("");
  const [portfolio, setPortfolio] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user.id ?? null;
      setSignedIn(!!uid);
      if (uid) {
        const { data: existing } = await supabase
          .from("job_applications")
          .select("id")
          .eq("job_id", jobId)
          .eq("applicant_id", uid)
          .maybeSingle();
        if (existing) setApplied(true);
      }
    });
  }, [supabase, jobId]);

  async function submit() {
    if (pending) return;
    setPending(true);
    setError(null);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) {
      setError("Sign in to apply.");
      setPending(false);
      return;
    }
    const payload = {
      cover_note: coverNote.trim() || null,
      applicant_phone: phone.trim() || null,
      portfolio_url: portfolio.trim() || null,
    };
    const { error: insErr } = await supabase.from("job_applications").insert({
      job_id: jobId,
      applicant_id: uid,
      status: "applied",
      ...payload,
    });
    if (insErr) {
      if ((insErr as { code?: string }).code === "23505") {
        const { error: updErr } = await supabase
          .from("job_applications")
          .update(payload)
          .eq("job_id", jobId)
          .eq("applicant_id", uid);
        if (updErr) {
          setError(updErr.message);
          setPending(false);
          return;
        }
      } else {
        setError(insErr.message);
        setPending(false);
        return;
      }
    }
    setApplied(true);
    setOpen(false);
    setPending(false);
  }

  if (applied) {
    return <p className="rounded-md bg-success/15 px-4 py-3 text-[14px] text-success">Application sent. The recruiter will see it in their applicants list.</p>;
  }

  if (applyUrl) {
    return (
      <a href={applyUrl} target="_blank" rel="noopener noreferrer" className="inline-block rounded-md bg-pearl px-6 py-3 text-[15px] font-semibold text-ink transition-opacity hover:opacity-90">
        Apply on company site
      </a>
    );
  }

  if (!open) {
    return (
      <div>
        <button onClick={() => setOpen(true)} className="rounded-md bg-pearl px-6 py-3 text-[15px] font-semibold text-ink transition-opacity hover:opacity-90">
          Apply
        </button>
        {signedIn === false ? <p className="mt-2 text-[13px] text-white/50">You will need to sign in to send the application.</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/10 p-4">
      <textarea value={coverNote}
        onChange={(e) => setCoverNote(e.target.value)}
        placeholder="Cover note (optional)"
        rows={4}
        className="rounded-md bg-surface px-4 py-3 text-[14px] text-white placeholder:text-white/30 outline-none focus:bg-surface-elevated"
      />
      <input value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Phone (optional)"
        className="rounded-md bg-surface px-4 py-3 text-[14px] text-white placeholder:text-white/30 outline-none focus:bg-surface-elevated"
      />
      <input value={portfolio}
        onChange={(e) => setPortfolio(e.target.value)}
        placeholder="Portfolio URL (optional)"
        className="rounded-md bg-surface px-4 py-3 text-[14px] text-white placeholder:text-white/30 outline-none focus:bg-surface-elevated"
      />
      {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <button onClick={submit} disabled={pending} className="rounded-md bg-pearl px-6 py-2.5 text-[14px] font-semibold text-ink disabled:opacity-40">
          {pending ? "Sending" : "Send application"}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-md bg-surface px-4 py-2.5 text-[14px] text-white">
          Cancel
        </button>
      </div>
      <p className="text-[12px] text-white/40">CV attachment is coming to web soon. Recruiters see your Platinum profile with the application.</p>
    </div>
  );
}