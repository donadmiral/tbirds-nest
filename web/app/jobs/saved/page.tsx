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

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id ?? null;
      setViewerId(uid);
      if (!uid) { setLoading(false); return; }
      const { data: savedRows } = await supabase.from("job_saves").select("job_id").eq("user_id", uid);
      const ids = (savedRows ?? []).map((r) => r.job_id);
      if (ids.length === 0) { setJobs([]); setLoading(false); return; }
      const { data } = await supabase.from("jobs").select("*").in("id", ids).order("created_at", { ascending: false });
      setJobs((data ?? []) as JobRow[]);
      setLoading(false);
    })();
  }, [supabase]);

  return (
    <div>
      <div className="flex items-center gap-3 px-1 pb-4">
        <Link href="/jobs" className="text-sm text-white/50 hover:text-white">← Jobs</Link>
        <h1 className="font-display text-xl text-porcelain">Saved jobs</h1>
      </div>
      {loading ? (
        <p className="py-16 text-center text-sm text-white/40">Loading</p>
      ) : jobs.length === 0 ? (
        <p className="py-16 text-center text-sm text-white/40">Jobs you save will appear here.</p>
      ) : (
        <div className="border-t border-white/10">
          {jobs.map((j) => (
            <JobCard key={j.id} job={j} initiallySaved viewerId={viewerId} />
          ))}
        </div>
      )}
    </div>
  );
}