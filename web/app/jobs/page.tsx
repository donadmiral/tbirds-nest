"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Briefcase } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { jobMeta, type JobRow, type PosterLite } from "@/lib/jobs";
import { timeAgo } from "@/lib/feed";

const TABS = [
  { key: "all", label: "All jobs" },
  { key: "remote", label: "Remote" },
] as const;

export default function JobsPage() {
  const supabase = useRef(createClient()).current;
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("all");
  const [jobs, setJobs] = useState<(JobRow & { profile?: PosterLite | null })[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("jobs").select("*").order("created_at", { ascending: false }).limit(50);
    if (tab === "remote") q = q.eq("remote_type", "remote");
    const { data } = await q;
    const rows = (data ?? []) as (JobRow & { profile?: PosterLite | null })[];
    const posterIds = Array.from(new Set(rows.map((j) => j.posted_by).filter(Boolean)));
    if (posterIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, username, avatar_url")
        .in("id", posterIds);
      const map = new Map((profiles ?? []).map((p) => [p.id, p as PosterLite]));
      rows.forEach((j) => (j.profile = map.get(j.posted_by) ?? null));
    }
    setJobs(rows);
    setLoading(false);
  }, [supabase, tab]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-1 flex border-b border-white/10 bg-ink/90 px-1 backdrop-blur">
        {TABS.map((t) => (
          <button key={t.key}
            onClick={() => setTab(t.key)}
            className={"flex-1 py-4 text-[15px] transition-colors " + (tab === t.key ? "font-semibold text-white" : "text-white/50 hover:text-white/80")}
          >
            <span className={"border-b-2 pb-3 " + (tab === t.key ? "border-pearl" : "border-transparent")}>{t.label}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="py-16 text-center text-sm text-white/40">Loading jobs</p>
      ) : jobs.length === 0 ? (
        <p className="py-16 text-center text-sm text-white/40">No jobs posted yet.</p>
      ) : (
        <div>
          {jobs.map((j) => (
            <Link key={j.id}
              href={"/jobs/" + j.id}
              className="flex gap-4 border-b border-white/10 px-1 py-5 transition-colors hover:bg-surface"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-navy text-porcelain">
                <Briefcase size={20} strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[16px] font-semibold text-white">{j.title}</span>
                  {j.urgent ? <span className="rounded-sm bg-danger/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger">Urgent</span> : null}
                </span>
                <span className="block truncate text-[14px] text-white/70">{j.company}</span>
                {jobMeta(j) ? <span className="block truncate text-[13px] text-white/50">{jobMeta(j)}</span> : null}
                <span className="mt-1 block text-[12px] text-white/40">
                  {timeAgo(j.created_at)}{j.applications_count > 0 ? " · " + j.applications_count + " applicants" : ""}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}