"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { type JobRow } from "@/lib/jobs";
import { JobCard } from "@/components/JobCard";

export default function SavedJobsPage() {
  const supabase = useRef(createClient()).current;
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true); setError(null); setJobs([]);
      try {
      const { data: sess, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!live) return;
      const uid = sess.session?.user.id ?? null;
      setViewerId(uid);
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
      if ((session?.user.id ?? null) !== viewerId) { live = false; setViewerId(session?.user.id ?? null); setRetry(n => n + 1); }
    });
    return () => { live = false; listener.subscription.unsubscribe(); };
  }, [supabase, retry, viewerId]);

  return (
    <div>
      <div className="flex items-center gap-3 px-1 pb-4">
        <Link href="/jobs" className="text-sm text-muted hover:text-ink">← Jobs</Link>
        <h1 className="font-display text-xl text-porcelain">Saved jobs</h1>
      </div>
      {loading ? (
        <p className="py-16 text-center text-sm text-muted">Loading</p>
      ) : error ? (
        <div role="alert" className="py-12 text-center"><p className="text-sm text-ink">{error}</p><button onClick={() => setRetry(n => n + 1)} className="mt-3 min-h-11 rounded-full bg-pearl px-5 font-semibold text-on-pearl">Try again</button></div>
      ) : !viewerId ? (
        <p className="py-16 text-center text-sm text-muted">Sign in to view your saved jobs.</p>
      ) : jobs.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">Jobs you save will appear here.</p>
      ) : (
        <div className="border-t border-ink/10">
          {jobs.map((j) => (
            <JobCard key={j.id} job={j} initiallySaved viewerId={viewerId} />
          ))}
        </div>
      )}
    </div>
  );
}
