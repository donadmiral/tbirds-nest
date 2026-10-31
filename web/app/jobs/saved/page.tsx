"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bookmark, Send } from "lucide-react";
import styles from "../JobsWorkspace.module.css";
import { createClient } from "@/lib/supabase/client";
import { type JobRow } from "@/lib/jobs";
import { JobCard } from "@/components/JobCard";

export default function SavedJobsPage() {
  const [supabase] = useState(createClient);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const account = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true); setError(null); setJobs([]);
      try {
      const { data: sess, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!live) return;
      const uid = sess.session?.user.id ?? null;
      account.current = uid; setViewerId(uid);
      if (!uid) { setLoading(false); return; }
      const { data: savedRows, error: savedError } = await supabase.from("job_saves").select("job_id").eq("user_id", uid);
      if (savedError) throw savedError;
      if (!live) return;
      const ids = (savedRows ?? []).map((r) => r.job_id);
      if (ids.length === 0) { setJobs([]); setLoading(false); return; }
      const { data, error: jobsError } = await supabase.from("jobs").select("*").in("id", ids).order("created_at", { ascending: false });
      if (jobsError) throw jobsError;
      if (live) setJobs((data ?? []) as JobRow[]);
      } catch { if (live) setError("Your saved jobs could not be loaded. Please try again."); }
      finally { if (live) setLoading(false); }
    })();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if ((session?.user.id ?? null) !== account.current) { live = false; account.current = session?.user.id ?? null; setJobs([]); setViewerId(account.current); setRetry(n => n + 1); }
    });
    return () => { live = false; listener.subscription.unsubscribe(); };
  }, [supabase, retry]);

  return <div className={styles.workspace}>
    <Link href="/jobs" className={styles.back}><ArrowLeft size={17} aria-hidden />Back to Jobs</Link>
    <header className={styles.header}><div><h1>Saved jobs</h1><p>A shortlist of roles you’d like to come back to.</p></div><Link href="/jobs/applications" className={styles.button}><Send size={17} aria-hidden />My applications</Link></header>
    <nav className={styles.tabs} aria-label="Jobs navigation"><Link href="/jobs">Discover</Link><Link href="/jobs/saved" aria-current="page">Saved jobs</Link><Link href="/jobs/applications">My applications</Link></nav>
    {loading ? <div className={styles.state} role="status"><p>Loading saved jobs…</p></div> : error ? <div className={styles.state} role="alert"><p>{error}</p><button onClick={() => setRetry(n => n + 1)} className={styles.primary}>Try again</button></div> : !viewerId ? <div className={styles.state}><Bookmark size={28} aria-hidden /><h2>Your shortlist starts here</h2><p>Sign in to save roles and find them again on any device.</p><Link href="/login" className={styles.primary}>Sign in</Link></div> : jobs.length === 0 ? <div className={styles.state}><Bookmark size={28} aria-hidden /><h2>No saved jobs yet</h2><p>Save a role from Discover to keep it in your shortlist.</p><Link href="/jobs" className={styles.primary}>Browse jobs</Link></div> : <div className={styles.list}>{jobs.map(job => <JobCard key={viewerId + job.id} job={job} initiallySaved viewerId={viewerId} onSavedChange={on => { if (!on) setJobs(rows => rows.filter(row => row.id !== job.id)); }} />)}</div>}
  </div>;
}
