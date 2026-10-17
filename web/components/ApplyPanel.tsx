"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isJobDeadlinePassed, STATUS_META, type ApplicationStatus } from "@/lib/jobs";

export function ApplyPanel({ jobId, applyUrl, deadline }: { jobId: string; applyUrl: string | null; deadline: string | null }) {
  const [supabase] = useState(createClient);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [applied, setApplied] = useState<ApplicationStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [retry, setRetry] = useState(0);
  const sending = useRef(false);
  const [open, setOpen] = useState(false);
  const [coverNote, setCoverNote] = useState("");
  const [phone, setPhone] = useState("");
  const [portfolio, setPortfolio] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function checkApplication() {
      setChecking(true);
      setError(null);
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const uid = data.session?.user.id ?? null;
        if (cancelled) return;
        setSignedIn(!!uid);
        setApplied(null);
        if (uid) {
          const { data: existing, error: applicationError } = await supabase.from("job_applications")
            .select("id, status").eq("job_id", jobId).eq("applicant_id", uid).maybeSingle();
          if (applicationError) throw applicationError;
          if (!cancelled && existing) setApplied(existing.status as ApplicationStatus);
        }
      } catch {
        if (!cancelled) setError("Could not check your application. Please retry before applying.");
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    void checkApplication();
    return () => { cancelled = true; };
  }, [supabase, jobId, retry]);

  async function submit() {
    if (sending.current) return;
    if (isJobDeadlinePassed(deadline)) { setError("The application deadline has passed."); return; }
    sending.current = true;
    setPending(true);
    setError(null);
    try {
      const { data: sess, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const uid = sess.session?.user.id;
      if (!uid) throw new Error("Sign in to apply.");
      const portfolioValue = portfolio.trim();
      if (portfolioValue) {
        let url: URL;
        try { url = new URL(portfolioValue); } catch { throw new Error("Enter a complete portfolio URL starting with https://."); }
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Use an http or https portfolio URL.");
      }
      const payload = {
        cover_note: coverNote.trim() || null,
        applicant_phone: phone.trim() || null,
        portfolio_url: portfolioValue || null,
      };
      const { error: insErr } = await supabase.from("job_applications").insert({
        job_id: jobId, applicant_id: uid, status: "applied", ...payload,
      });
      let status: ApplicationStatus = "applied";
      if (insErr) {
        if (insErr.code !== "23505") throw insErr;
        const { data: updated, error: updErr } = await supabase.from("job_applications")
          .update(payload).eq("job_id", jobId).eq("applicant_id", uid).select("status").single();
        if (updErr) throw updErr;
        status = updated.status as ApplicationStatus;
      }
      setApplied(status);
      setOpen(false);
    } catch (reason) {
      setError(reason && typeof reason === "object" && "message" in reason ? String(reason.message) : "Could not send application. Please try again.");
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  if (applied) {
    return <p className="rounded-md bg-success/15 px-4 py-3 text-[14px] text-success">{applied === "applied" ? "Application sent. The recruiter will see it in their applicants list." : "Application status: " + (STATUS_META[applied]?.label ?? applied) + "."}</p>;
  }

  if (isJobDeadlinePassed(deadline)) return <p className="rounded-md bg-surface px-4 py-3 text-[14px] text-ink/60">The application deadline has passed.</p>;

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
        <button disabled={checking || !!error} onClick={() => setOpen(true)} className="rounded-md bg-pearl px-6 py-3 text-[15px] font-semibold text-ink transition-opacity hover:opacity-90">
          Apply
        </button>
        {error ? <p role="alert" className="mt-2 text-[13px] text-danger">{error} <button onClick={() => setRetry((n) => n + 1)} className="underline">Retry</button></p> : null}
        {signedIn === false ? <p className="mt-2 text-[13px] text-ink/50">You will need to sign in to send the application.</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-ink/10 p-4">
      <textarea value={coverNote}
        onChange={(e) => setCoverNote(e.target.value)}
        placeholder="Cover note (optional)"
        rows={4}
        className="rounded-md bg-surface px-4 py-3 text-[14px] text-ink placeholder:text-ink/30 outline-none focus:bg-surface-elevated"
      />
      <input value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Phone (optional)"
        className="rounded-md bg-surface px-4 py-3 text-[14px] text-ink placeholder:text-ink/30 outline-none focus:bg-surface-elevated"
      />
      <input value={portfolio}
        onChange={(e) => setPortfolio(e.target.value)}
        placeholder="Portfolio URL (optional)"
        className="rounded-md bg-surface px-4 py-3 text-[14px] text-ink placeholder:text-ink/30 outline-none focus:bg-surface-elevated"
      />
      {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <button onClick={submit} disabled={pending} className="rounded-md bg-pearl px-6 py-2.5 text-[14px] font-semibold text-ink disabled:opacity-40">
          {pending ? "Sending" : "Send application"}
        </button>
        <button disabled={pending} onClick={() => setOpen(false)} className="rounded-md bg-surface px-4 py-2.5 text-[14px] text-ink">
          Cancel
        </button>
      </div>
      <p className="text-[12px] text-ink/40">CV attachment is coming to web soon. Recruiters see your Platinum profile with the application.</p>
    </div>
  );
}