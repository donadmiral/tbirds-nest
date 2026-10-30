"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, FileText, ShieldCheck } from "lucide-react";
import { ProductDialog } from "@/components/ProductDialog";
import styles from "@/app/jobs/JobsWorkspace.module.css";
import { createClient } from "@/lib/supabase/client";
import { isJobDeadlinePassed, STATUS_META, type ApplicationStatus } from "@/lib/jobs";
import { APPLICATION_CV_BUCKET, applicationCvFile } from "../../shared/applicationCv";

export function ApplyPanel(props: Parameters<typeof ApplyPanelContent>[0]) {
  return <ApplyPanelContent key={props.jobId} {...props} />;
}

function ApplyPanelContent({ jobId, applyUrl, deadline, jobTitle, company }: { jobId: string; applyUrl: string | null; deadline: string | null; jobTitle?: string; company?: string }) {
  const [supabase] = useState(createClient);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [applied, setApplied] = useState<ApplicationStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [retry, setRetry] = useState(0);
  const sending = useRef(false);
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState(false);
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
    let cancelled = false;
    const requestGeneration = generation.current += 1;
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
        setCv(null); setOpen(false); setReview(false); setApplied(null); setCoverNote(""); setPhone(""); setPortfolio(""); setRetry(n => n + 1);
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
      setOpen(false); setReview(false);
    } catch (reason) {
      if (token === generation.current) setError(reason && typeof reason === "object" && "message" in reason ? String(reason.message) : "Could not send application. Please try again.");
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  function reviewApplication() {
    setError(null);
    try {
      if (isJobDeadlinePassed(deadline)) throw new Error("The application deadline has passed.");
      if (portfolio.trim()) {
        let url: URL;
        try { url = new URL(portfolio.trim()); } catch { throw new Error("Enter a complete portfolio URL starting with https://."); }
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("Use an http or https portfolio URL.");
      }
      if (cv) applicationCvFile(cv.name, cv.size);
      setReview(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Check your application details."); }
  }

  if (applied) return <div className={styles.form}><div className={styles.notice}><CheckCircle2 size={20} aria-hidden /><div>{applied === "applied" ? "Application sent. The recruiter will see it in their applicants list." : "Application status: " + (STATUS_META[applied]?.label ?? applied) + "."}</div></div><Link href="/jobs/applications" className={styles.button}>Track your application <ArrowRight size={16} aria-hidden /></Link></div>;
  if (isJobDeadlinePassed(deadline)) return <p className={styles.notice}>The application deadline has passed.</p>;
  if (applyUrl) {
    let safeUrl: string | null = null;
    try { const url = new URL(applyUrl); if (["https:", "http:"].includes(url.protocol)) safeUrl = url.href; } catch { /* Invalid external destinations cannot be opened. */ }
    return safeUrl ? <div className={styles.form}><a href={safeUrl} target="_blank" rel="noopener noreferrer" className={styles.primary}>Apply on company site <ExternalLink size={16} aria-hidden /></a><p className={styles.help}>Opens the employer’s application site in a new tab. Your application is managed there.</p></div> : <p role="alert" className={styles.error}>The employer’s application link is unavailable. Message the employer for the correct link.</p>;
  }
  if (!open) return <div className={styles.form}>
    {signedIn === false ? <Link href="/login" className={styles.primary}>Sign in to apply</Link> : <button disabled={checking || !!error} onClick={() => setOpen(true)} className={styles.primary}>{checking ? "Checking application…" : "Apply"}<ArrowRight size={16} aria-hidden /></button>}
    {error ? <p role="alert" className={styles.error}>{error} <button onClick={() => setRetry(n => n + 1)} className="underline">Retry</button></p> : <p className={styles.help}>Review your profile, résumé and details before you send.</p>}
  </div>;
  return <>
    <form className={styles.form} onSubmit={event => { event.preventDefault(); reviewApplication(); }}>
      <label htmlFor="application-cover">Cover note <span className={styles.help}>(optional)</span></label>
      <textarea id="application-cover" value={coverNote} disabled={pending} onChange={e => setCoverNote(e.target.value)} placeholder="Tell the hiring team why this role interests you" rows={4} maxLength={10000} />
      <label htmlFor="application-phone">Phone <span className={styles.help}>(optional)</span></label>
      <input id="application-phone" type="tel" autoComplete="tel" value={phone} disabled={pending} onChange={e => setPhone(e.target.value)} maxLength={80} />
      <label htmlFor="application-portfolio">Portfolio URL <span className={styles.help}>(optional)</span></label>
      <input id="application-portfolio" type="url" value={portfolio} disabled={pending} onChange={e => setPortfolio(e.target.value)} placeholder="https://" maxLength={2048} />
      <label htmlFor="application-cv">Résumé / CV <span className={styles.help}>(optional)</span></label>
      <input id="application-cv" type="file" accept=".pdf,.doc,.docx,.txt" disabled={pending} aria-describedby="application-cv-help" onChange={e => {
        const file = e.target.files?.[0] ?? null;
        try { if (file) applicationCvFile(file.name, file.size); setCv(file); uploaded.current = null; setError(null); }
        catch (reason) { e.target.value = ""; setCv(null); setError(reason instanceof Error ? reason.message : "Choose another CV."); }
      }} />
      <p id="application-cv-help" className={styles.help}>PDF, Word or text, up to 8 MB. Your CV is shared with this job’s hiring team.</p>
      {cv ? <div className={styles.notice}><FileText size={18} aria-hidden /><span className="min-w-0 flex-1 break-words">{cv.name}</span><button type="button" disabled={pending} className="text-sm underline" onClick={() => { setCv(null); uploaded.current = null; const input = document.getElementById("application-cv") as HTMLInputElement | null; if (input) input.value = ""; }}>Remove CV</button></div> : null}
      {error && !review ? <p role="alert" className={styles.error}>{error}</p> : null}
      <div className={styles.actions}><button type="submit" disabled={pending} className={styles.primary}>Review application <ArrowRight size={16} aria-hidden /></button><button type="button" disabled={pending} onClick={() => setOpen(false)} className={styles.button}>Cancel</button></div>
      <p className={styles.help}>Recruiters also see your Platinum profile with the application. Nothing is sent until you confirm.</p>
    </form>
    <ProductDialog open={review} title="Review application" description="Check your details before sending them to the hiring team." busy={pending} onClose={() => setReview(false)}>
      {jobTitle ? <div className={styles.notice}><BriefcaseReview /><div><strong>{jobTitle}</strong>{company ? <p className={styles.help}>{company}</p> : null}</div></div> : null}
      <dl className={styles.review}>
        <div><dt>Résumé / CV</dt><dd>{cv ? cv.name : "Apply with your Platinum profile"}</dd></div>
        <div><dt>Cover note</dt><dd>{coverNote.trim() || "No cover note added"}</dd></div>
        {phone.trim() ? <div><dt>Phone</dt><dd>{phone.trim()}</dd></div> : null}
        {portfolio.trim() ? <div><dt>Portfolio</dt><dd>{portfolio.trim()}</dd></div> : null}
      </dl>
      <p className={styles.notice}><ShieldCheck size={19} aria-hidden />Your profile and the details shown here will be shared with this job’s hiring team.</p>
      {error ? <p role="alert" className={styles.error + " mt-3"}>{error}</p> : null}
      <div className={styles.actions + " mt-5"}><button type="button" disabled={pending} onClick={() => setReview(false)} className={styles.button}><ArrowLeft size={16} aria-hidden /> Edit application</button><button type="button" disabled={pending} onClick={submit} className={styles.primary}>{pending ? "Sending…" : "Submit application"}</button></div>
    </ProductDialog>
  </>;
}
function BriefcaseReview() { return <FileText size={21} aria-hidden />; }
