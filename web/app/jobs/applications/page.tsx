"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Send, RefreshCw, CalendarDays } from "lucide-react";
import { ProductDialog } from "@/components/ProductDialog";
import styles from "../JobsWorkspace.module.css";
import { createClient } from "@/lib/supabase/client";
import { type JobRow, STATUS_META, APPLICATION_STATUS_ORDER } from "@/lib/jobs";
import { RelativeTime } from "@/components/RelativeTime";
import { type ApplicantCursor, canWithdrawApplication, loadMyApplicationPage, mergeApplicants, withdrawApplication } from "../../../../shared/hiring";

type AppRow = {
  id: string; job_id: string; status: string; applied_at: string | null; updated_at: string | null;
  interview_at: string | null; interview_location: string | null; job?: JobRow | null;
};

export default function MyApplicationsPage() {
  const [supabase] = useState(createClient);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [filter, setFilter] = useState("all");
  const [hasMore, setHasMore] = useState(false);
  const [confirmWithdrawal, setConfirmWithdrawal] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const request = useRef(0);
  const cursor = useRef<ApplicantCursor | null>(null);
  const pending = useRef(false);
  const account = useRef<string | null>(null);
  const retryAppend = useRef(false);
  const withdrawalPending = useRef(false);
  const live = useRef(true);

  const load = useCallback(async (append = false) => {
    if (append && pending.current) return;
    const token = ++request.current;
    retryAppend.current = append;
    pending.current = true;
    setLoading(true); setError(null);
    try {
      const { data: sess, error: sessionError } = await supabase.auth.getSession();
      if (token !== request.current) return;
      if (sessionError) throw sessionError;
      const uid = sess.session?.user.id ?? null;
      if (uid !== account.current) {
        account.current = uid; cursor.current = null; append = false; setApps([]);
      }
      setSignedOut(!uid);
      if (!uid) { setApps([]); setHasMore(false); return; }
      const page = await loadMyApplicationPage<AppRow>(supabase, append ? cursor.current : null, filter);
      if (token !== request.current) return;
      cursor.current = page.cursor;
      setHasMore(page.has_more);
      setApps(previous => append ? mergeApplicants(previous, page.applications) : page.applications);
    } catch {
      if (token === request.current) setError("Applications could not be loaded. Please try again.");
    } finally {
      if (token === request.current) { pending.current = false; setLoading(false); }
    }
  }, [supabase, filter]);

  const withdraw = async (application: AppRow) => {
    const owner = account.current;
    if (!owner || withdrawalPending.current) return;
    withdrawalPending.current = true; setWithdrawing(application.id); setWithdrawError(null);
    try {
      const saved = await withdrawApplication(supabase, application);
      if (!live.current || account.current !== owner) return;
      request.current++; pending.current = false; setLoading(false);
      setApps(previous => previous.map(row => row.id === saved.id ? saved : row)
        .filter(row => filter === 'all' || row.status === filter));
      setConfirmWithdrawal(null);
    } catch (error) {
      if (live.current && account.current === owner) setWithdrawError(error instanceof Error ? error.message : 'Refresh and try again.');
    } finally {
      withdrawalPending.current = false;
      if (live.current && account.current === owner) setWithdrawing(null);
    }
  };

  useEffect(() => {
    let active = true;
    live.current = true; cursor.current = null;
    setConfirmWithdrawal(null); setWithdrawError(null);
    queueMicrotask(() => { if (active) void load(); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user.id ?? null;
      if (uid === account.current) return;
      request.current++; account.current = uid; cursor.current = null; pending.current = false;
      setApps([]); setHasMore(false); setError(null); setSignedOut(!uid);
      setConfirmWithdrawal(null); setWithdrawError(null); setWithdrawing(null);
      // Leave the auth callback before calling another Supabase method.
      queueMicrotask(() => { if (active) void load(); });
    });
    return () => { active = false; live.current = false; request.current++; pending.current = false; subscription.unsubscribe(); };
  }, [load, supabase]);

  const withdrawingApplication = apps.find(application => application.id === confirmWithdrawal);
  return <div className={styles.workspace}>
    <Link href="/jobs" className={styles.back}><ArrowLeft size={17} aria-hidden />Back to Jobs</Link>
    <header className={styles.header}><div><h1>My applications</h1><p>Follow your progress, review interviews, and manage your next steps.</p></div><button onClick={() => void load()} disabled={loading || withdrawing !== null} className={styles.button}><RefreshCw size={16} aria-hidden />Refresh</button></header>
    <nav className={styles.tabs} aria-label="Jobs navigation"><Link href="/jobs">Discover</Link><Link href="/jobs/saved">Saved jobs</Link><Link href="/jobs/applications" aria-current="page">My applications</Link></nav>
    <div className={styles.toolbar + " mb-5"}><label className={styles.help} htmlFor="application-status">Application status</label><select id="application-status" disabled={withdrawing !== null} value={filter} onChange={event => { request.current++; setApps([]); setHasMore(false); setLoading(true); setFilter(event.target.value); }}><option value="all">All statuses</option>{APPLICATION_STATUS_ORDER.map(status => <option key={status} value={status}>{STATUS_META[status].label}</option>)}</select><span className={styles.help}>{!loading && !signedOut && !error ? apps.length + " applications shown" : ""}</span></div>
    {error ? <div role="alert" className={styles.notice + " mb-4"}><p>{error}</p><button disabled={loading} onClick={() => void load(retryAppend.current)} className="underline">Retry</button></div> : null}
    {signedOut ? <div className={styles.state}><Send size={28} aria-hidden /><h2>Keep track of your applications</h2><p>Sign in to view updates from hiring teams.</p><Link href="/login" className={styles.primary}>Sign in</Link></div>
      : loading && apps.length === 0 ? <div className={styles.state} role="status"><p>Loading applications…</p></div>
      : apps.length === 0 && !error ? <div className={styles.state}><Send size={28} aria-hidden /><h2>{filter === "all" ? "Your next chapter starts here" : "No applications with this status"}</h2><p>{filter === "all" ? "Roles you apply for will appear here with their latest status." : "Choose another status to find your applications."}</p>{filter === "all" ? <Link href="/jobs" className={styles.primary}>Discover jobs</Link> : <button onClick={() => setFilter("all")} className={styles.button}>Show all applications</button>}</div>
      : <div className={styles.list}>{apps.map(application => {
        const meta = STATUS_META[application.status as keyof typeof STATUS_META] || { label: application.status, color: "#6B7280", bg: "#F3F4F6" };
        return <article key={application.id} className={styles.panel + " " + styles.application}>
          <div className={styles.applicationTop}><Link href={"/jobs/" + application.job_id}><strong>{application.job?.title ?? "Job no longer available"}</strong>{application.job ? <small>{[application.job.company, application.job.location].filter(Boolean).join(" · ")}</small> : null}<small>Applied {application.applied_at && Number.isFinite(Date.parse(application.applied_at)) ? <RelativeTime dateTime={application.applied_at} /> : "date unavailable"}</small></Link><span className={styles.badge} style={{color: meta.color, backgroundColor: meta.bg}}>{meta.label}</span></div>
          {application.status === "interview" && application.interview_at && Number.isFinite(Date.parse(application.interview_at)) ? <p className={styles.notice + " mt-4"}><CalendarDays size={18} aria-hidden /><span>Interview {new Date(application.interview_at).toLocaleString()}{application.interview_location ? " · " + application.interview_location : ""}</span></p> : null}
          <div className={styles.applicationFooter}><Link className={styles.button} href={"/jobs/" + application.job_id}>View role <ArrowRight size={15} aria-hidden /></Link>{canWithdrawApplication(application.status) ? <button disabled={withdrawing !== null} onClick={() => { setConfirmWithdrawal(application.id); setWithdrawError(null); }}>Withdraw application</button> : null}</div>
        </article>;
      })}</div>}
    {hasMore && !signedOut ? <button disabled={loading} onClick={() => void load(true)} className={styles.button + " mt-5"}>{loading ? "Loading…" : "Load more applications"}</button> : null}
    <ProductDialog open={!!withdrawingApplication} title="Withdraw application?" description={withdrawingApplication?.job?.title ?? "Review this change before continuing."} busy={withdrawing !== null} onClose={() => setConfirmWithdrawal(null)}>
      <p className={styles.help}>The employer will be notified. Your history stays available, but this application cannot be reopened.</p>
      {withdrawError ? <p role="alert" className={styles.error + " mt-3"}>{withdrawError}</p> : null}
      <div className={styles.actions + " mt-5"}><button disabled={withdrawing !== null} onClick={() => setConfirmWithdrawal(null)} className={styles.button}>Keep application</button><button disabled={withdrawing !== null} onClick={() => withdrawingApplication && void withdraw(withdrawingApplication)} className={styles.primary}>{withdrawing ? "Withdrawing…" : "Confirm withdrawal"}</button></div>
    </ProductDialog>
  </div>;
}
