"use client";

import Link from "next/link";
import { useState } from "react";
import { Briefcase, Bookmark, Share2, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { jobMeta, type JobRow, type PosterLite } from "@/lib/jobs";
import { timeAgo } from "@/lib/feed";

export function JobCard({ job, initiallySaved, viewerId }: {
  job: JobRow & { profile?: PosterLite | null };
  initiallySaved: boolean;
  viewerId: string | null;
}) {
  const supabase = createClient();
  const [saved, setSaved] = useState(initiallySaved);
  const [copied, setCopied] = useState(false);

  async function toggleSave(e: React.MouseEvent) {
    e.preventDefault();
    if (!viewerId) return;
    const next = !saved;
    setSaved(next);
    const { error } = next
      ? await supabase.from("job_saves").insert({ user_id: viewerId, job_id: job.id })
      : await supabase.from("job_saves").delete().eq("user_id", viewerId).eq("job_id", job.id);
    if (error && !String(error.message || "").toLowerCase().includes("duplicate")) setSaved(!next);
  }

  async function share(e: React.MouseEvent) {
    e.preventDefault();
    const url = window.location.origin + "/jobs/" + job.id;
    const text = job.title + " at " + job.company;
    if (navigator.share) {
      try { await navigator.share({ title: text, url }); return; } catch { /* cancelled */ }
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Link href={"/jobs/" + job.id} className="flex gap-4 border-b border-white/10 px-1 py-5 transition-colors hover:bg-surface">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-navy text-porcelain">
        <Briefcase size={20} strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[16px] font-semibold text-white">{job.title}</span>
          {job.urgent ? <span className="rounded-sm bg-danger/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger">Urgent</span> : null}
          {job.visa_sponsorship ? <span className="rounded-sm bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/60">Visa</span> : null}
        </span>
        <span className="block truncate text-[14px] text-white/70">{job.company}</span>
        {jobMeta(job) ? <span className="block truncate text-[13px] text-white/50">{jobMeta(job)}</span> : null}
        <span className="mt-1 block text-[12px] text-white/40">
          {timeAgo(job.created_at)}{job.applications_count > 0 ? " · " + job.applications_count + " applicants" : ""}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-2">
        <button onClick={toggleSave} title={saved ? "Unsave" : "Save"} className={"rounded-md p-1.5 transition-colors " + (saved ? "text-pearl" : "text-white/40 hover:text-white")}>
          <Bookmark size={18} fill={saved ? "currentColor" : "none"} />
        </button>
        <button onClick={share} title="Share" className="rounded-md p-1.5 text-white/40 transition-colors hover:text-white">
          {copied ? <Check size={18} className="text-success" /> : <Share2 size={18} />}
        </button>
      </span>
    </Link>
  );
}