"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isJobDeadlinePassed, STATUS_META, type ApplicationStatus } from "@/lib/jobs";
import { APPLICATION_CV_BUCKET, applicationCvFile } from "../../shared/applicationCv";

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
  const [cv, setCv] = useState<File | null>(null);
  const uploaded = useRef<{ file: File; owner: string; job: string; reference: string } | null>(null);
  const generation = useRef(0);
  const account = useRef<string | null>(null);

  useEffect(() => {
    uploaded.current = null;
    setCv(null); setOpen(false); setCoverNote(""); setPhone(""); setPortfolio("");
  }, [jobId]);

  useEffect(() => {
    let cancelled = false;
    const requestGeneration = ++generation.current;
    const current = () => !cancelled && requestGeneration === generation.current;
    async function checkApplication() {
      setChecking(true);
      setError(null);
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const uid = data.session?.user.id ?? null;
        if (!current()) return;
        account.current = uid;
        setSignedIn(!!uid);
        setApplied(null);
        if (uid) {
          const { data: existing, error: applicationError } = await supabase.from("job_applications")
            .select("id, status").eq("job_id", jobId).eq("applicant_id", uid).maybeSingle();
          if (applicationError) throw applicationError;
          if (current() && existing) setApplied(existing.status as ApplicationStatus);
        }
      } catch {
        if (current()) setError("Could not check your application. Please retry before applying.");
      } finally {
        if (current()) setChecking(false);
      }
    }
    void checkApplication();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (account.current !== next) {
        account.current = next;
        generation.current += 1;
        uploaded.current = null;
        setCv(null); setOpen(false); setApplied(null); setCoverNote(""); setPhone(""); setPortfolio(""); setRetry(n => n + 1);
      }
    });
    return () => { cancelled = true; generation.current += 1; listener.subscription.unsubscribe(); };
  }, [supabase, jobId, retry]);

  async function submit() {
    if (sending.current) return;
    if (isJobDeadlinePassed(deadline)) { setError("The application deadline has passed."); return; }
    sending.current = true;
    const token = generation.current;
    setPending(true);
    setError(null);
    try {
      const { data: sess, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const uid = sess.session?.user.id;
      if (!uid) throw new Error("Sign in to apply.");
      if (token !== generation.current) return;
      const { data: currentJob, error: currentJobError } = await supabase.from("jobs")
        .select("id, deadline").eq("id", jobId).maybeSingle();
      if (currentJobError) throw currentJobError;
      if (!currentJob || isJobDeadlinePassed(currentJob.deadline)) throw new Error("This job is closed for new applications.");
      if (token !== generation.current) return;
      const portfolioValue = portfolio.trim();
      if (portfolioValue) {
        let url: URL;
        try { url = new URL(portfolioValue); } catch { throw new Error("Enter a complete portfolio URL starting with https://."); }
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Use an http or https portfolio URL.");
      }
      let cvReference: string | null = null;
      if (cv) {
        const { extension, contentType } = applicationCvFile(cv.name, cv.size);
        const previous = uploaded.current;
        if (previous?.file === cv && previous.owner === uid && previous.job === jobId) {
          cvReference = previous.reference;
        } else {
          const path = `${uid}/${jobId}/${crypto.randomUUID()}.${extension}`;
          const { error: uploadError } = await supabase.storage.from(APPLICATION_CV_BUCKET)
            .upload(path, cv, { contentType, upsert: false });
          if (uploadError) throw new Error("Your CV could not be uploaded securely. Please retry, or remove the file to apply with your profile.");
          cvReference = `${APPLICATION_CV_BUCKET}/${path}`;
          uploaded.current = { file: cv, owner: uid, job: jobId, reference: cvReference };
        }
      }
      const { data: currentSession, error: currentError } = await supabase.auth.getSession();
      if (currentError) throw currentError;
      if (token !== generation.current || currentSession.session?.user.id !== uid) return;
      const payload = {
        cover_note: coverNote.trim() || null,
        applicant_phone: phone.trim() || null,
        portfolio_url: portfolioValue || null,
        ...(cvReference ? { cv_url: cvReference, cv_name: cv!.name } : {}),
      };
      const { data: inserted, error: insErr } = await supabase.from("job_applications").insert({
        job_id: jobId, applicant_id: uid, status: "applied", ...payload,
      }).select("id, status").single();
      if (token !== generation.current) return;
      let status: ApplicationStatus = "applied";
      if (insErr) {
        if (insErr.code !== "23505") throw insErr;
        const { data: updated, error: updErr } = await supabase.from("job_applications")
          .update(payload).eq("job_id", jobId).eq("applicant_id", uid).select("status").single();
        if (updErr) throw updErr;
        status = updated.status as ApplicationStatus;
      } else if (!inserted?.id) {
        throw new Error("The application could not be confirmed. Please retry.");
      }
      if (token !== generation.current) return;
      setApplied(status);
      setOpen(false);
    } catch (reason) {
      if (token === generation.current) setError(reason && typeof reason === "object" && "message" in reason ? String(reason.message) : "Could not send application. Please try again.");
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
      <a href={applyUrl} target="_blank" rel="noopener noreferrer" className="inline-block rounded-md bg-pearl px-6 py-3 text-[15px] font-semibold text-on-pearl transition-opacity hover:opacity-90">
        Apply on company site
      </a>
    );
  }

  if (!open) {
    return (
      <div>
        <button disabled={checking || !!error} onClick={() => setOpen(true)} className="rounded-md bg-pearl px-6 py-3 text-[15px] font-semibold text-on-pearl transition-opacity hover:opacity-90">
          Apply
        </button>
        {error ? <p role="alert" className="mt-2 text-[13px] text-danger">{error} <button onClick={() => setRetry((n) => n + 1)} className="underline">Retry</button></p> : null}
        {signedIn === false ? <p className="mt-2 text-[13px] text-muted">You will need to sign in to send the application.</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-ink/10 p-4">
      <label htmlFor="application-cover" className="text-sm font-semibold text-ink">Cover note (optional)</label>
      <textarea id="application-cover" value={coverNote} disabled={pending}
        onChange={(e) => setCoverNote(e.target.value)}
        placeholder="Cover note (optional)"
        rows={4}
        className="rounded-md bg-surface px-4 py-3 text-[14px] text-ink placeholder:text-muted outline-none focus:bg-surface-elevated"
      />
      <label htmlFor="application-phone" className="text-sm font-semibold text-ink">Phone (optional)</label>
      <input id="application-phone" type="tel" autoComplete="tel" value={phone} disabled={pending}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Phone (optional)"
        className="rounded-md bg-surface px-4 py-3 text-[14px] text-ink placeholder:text-muted outline-none focus:bg-surface-elevated"
      />
      <label htmlFor="application-portfolio" className="text-sm font-semibold text-ink">Portfolio URL (optional)</label>
      <input id="application-portfolio" type="url" value={portfolio} disabled={pending}
        onChange={(e) => setPortfolio(e.target.value)}
        placeholder="Portfolio URL (optional)"
        className="rounded-md bg-surface px-4 py-3 text-[14px] text-ink placeholder:text-muted outline-none focus:bg-surface-elevated"
      />
      <label htmlFor="application-cv" className="text-sm font-semibold text-ink">CV (optional)</label>
      <input id="application-cv" type="file" accept=".pdf,.doc,.docx,.txt" disabled={pending}
        aria-describedby="application-cv-help" className="rounded-md bg-surface p-3 text-sm text-ink"
        onChange={e => {
          const file = e.target.files?.[0] ?? null;
          try { if (file) applicationCvFile(file.name, file.size); setCv(file); uploaded.current = null; setError(null); }
          catch (reason) { e.target.value = ""; setCv(null); setError(reason instanceof Error ? reason.message : "Choose another CV."); }
        }} />
      <p id="application-cv-help" className="text-[12px] text-muted">PDF, Word or text, up to 8 MB. Your CV is shared with this job’s hiring team.</p>
      {cv ? <button type="button" disabled={pending} className="self-start text-sm text-accent underline" onClick={() => { setCv(null); uploaded.current = null; const input = document.getElementById("application-cv") as HTMLInputElement | null; if (input) input.value = ""; }}>Remove CV</button> : null}
      {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <button onClick={submit} disabled={pending} className="rounded-md bg-pearl px-6 py-2.5 text-[14px] font-semibold text-on-pearl disabled:opacity-40">
          {pending ? "Sending" : "Send application"}
        </button>
        <button disabled={pending} onClick={() => setOpen(false)} className="rounded-md bg-surface px-4 py-2.5 text-[14px] text-ink">
          Cancel
        </button>
      </div>
      <p className="text-[12px] text-muted">Recruiters also see your Platinum profile with the application.</p>
    </div>
  );
}
