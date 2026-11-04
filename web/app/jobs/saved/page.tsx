"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bookmark, Send } from "lucide-react";
import styles from "../JobsWorkspace.module.css";
import { createClient } from "@/lib/supabase/client";
import { type JobRow } from "@/lib/jobs";
import { JobCard } from "@/components/JobCard";
import { isAccessDeniedError } from "@/lib/errors";

export default function SavedJobsPage() {
  const [supabase] = useState(createClient);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [hasResult, setHasResult] = useState(false);
  const account = useRef<string | null | undefined>(undefined);
  const request = useRef(0);
  const generation = request.current;

  useEffect(() => {
    let live = true;
    const token = ++request.current;
    const isCurrent = () => live && token === request.current;
    (async () => {
      setLoading(true); setError(null);
      try {
      const { data: sess, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!isCurrent()) return;
      const uid = sess.session?.user.id ?? null;
      if (uid !== account.current) { setJobs([]); setHasResult(false); }
      account.current = uid; setViewerId(uid);
      if (!uid) { setJobs([]); setHasResult(true); return; }
      const { data: savedRows, error: savedError } = await supabase.from("job_saves").select("job_id").eq("user_id", uid);
      if (savedError) throw savedError;
      if (!isCurrent()) return;
      if (!Array.isArray(savedRows)) throw new Error('Saved jobs returned an incomplete response.');
      const ids = savedRows.map((r) => r.job_id);
      if (ids.length === 0) { setJobs([]); setHasResult(true); return; }
      const { data, error: jobsError } = await supabase.from("jobs").select("*").in("id", ids).order("created_at", { ascending: false });
      if (jobsError) throw jobsError;
      if (!Array.isArray(data)) throw new Error('Jobs returned an incomplete response.');
      if (isCurrent()) { setJobs(data as JobRow[]); setHasResult(true); }
      } catch (reason) { if (isCurrent()) {
        if (isAccessDeniedError(reason)) { setJobs([]); setHasResult(false); }
        setError("Your saved jobs could not be loaded. Please try again.");
      } }
      finally { if (isCurrent()) setLoading(false); }
    })();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if ((session?.user.id ?? null) !== account.current) { live = false; request.current++; account.current = session?.user.id ?? null; setJobs([]); setHasResult(false); setViewerId(account.current); setRetry(n => n + 1); }
    });
    return () => { live = false; if (request.current === token) request.current++; listener.subscription.unsubscribe(); };
  }, [supabase, retry]);

  return <div className={styles.workspace}>
    <Link href="/jobs" className={styles.back}><ArrowLeft size={17} aria-hidden />Back to Jobs</Link>
    <header className={styles.header}><div><h1>Saved jobs</h1><p>A shortlist of roles you’d like to come back to.</p></div><Link href="/jobs/applications" className={styles.button}><Send size={17} aria-hidden />My applications</Link></header>
    <nav className={styles.tabs} aria-label="Jobs navigation"><Link href="/jobs">Discover</Link><Link href="/jobs/saved" aria-current="page">Saved jobs</Link><Link href="/jobs/applications">My applications</Link></nav>
    {error ? <div className={styles.state} role="alert"><p>{error}</p><button onClick={() => setRetry(n => n + 1)} className={styles.primary}>Try again</button></div> : null}
    {loading && !hasResult ? <div className={styles.state} role="status"><p>Loading saved jobs…</p></div> : error && !hasResult ? null : !viewerId ? <div className={styles.state}><Bookmark size={28} aria-hidden /><h2>Your shortlist starts here</h2><p>Sign in to save roles and find them again on any device.</p><Link href="/login" className={styles.primary}>Sign in</Link></div> : jobs.length === 0 ? <div className={styles.state}><Bookmark size={28} aria-hidden /><h2>No saved jobs yet</h2><p>Save a role from Discover to keep it in your shortlist.</p><Link href="/jobs" className={styles.primary}>Browse jobs</Link></div> : <div className={styles.list}>{jobs.map(job => <JobCard key={viewerId + job.id} job={job} initiallySaved viewerId={viewerId} onSavedChange={on => { if (!on && generation === request.current) setJobs(rows => generation === request.current ? rows.filter(row => row.id !== job.id) : rows); }} />)}</div>}
  </div>;
}
