"use client";

import Link from "next/link";
import { StoryAvatar } from "@/components/StoryAvatar";
import { useState } from "react";
import { Briefcase, Bookmark, Share2, Check } from "lucide-react";
import { VerifiedBadge } from "@/components/VerifiedBadge";
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
    <Link href={"/jobs/" + job.id} className="flex gap-4 border-b border-ink/10 px-1 py-5 transition-colors duration-[140ms] hover:bg-surface">
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-navy text-white">
        <Briefcase size={22} strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[16px] font-semibold text-ink">{job.title}</span>
          {job.urgent ? <span className="rounded-sm bg-danger/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger">Urgent</span> : null}
          {job.visa_sponsorship ? <span className="rounded-sm bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink/60">Visa</span> : null}
        </span>
        <span className="flex items-center gap-1.5 truncate text-[14px] text-ink/70">{job.profile?.id ? <StoryAvatar userId={job.profile.id} name={job.profile.full_name} avatarUrl={job.profile.avatar_url} size={38} /> : null}{job.company}{job.verified ? <VerifiedBadge tier="business" size={13} /> : null}</span>
        {jobMeta(job) ? <span className="block truncate text-[13px] text-ink/50">{jobMeta(job)}</span> : null}
        <span className="mt-1 block text-[12px] text-ink/40">
          {timeAgo(job.created_at)}{job.applications_count > 0 ? " · " + job.applications_count + " applicants" : ""}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <button onClick={toggleSave} title={saved ? "Unsave" : "Save"} className={"rounded-full p-2 transition-colors duration-[140ms] " + (saved ? "text-pearl hover:bg-pearl/10" : "text-ink/40 hover:bg-ink/[0.06] hover:text-ink")}>
          <Bookmark size={18} fill={saved ? "currentColor" : "none"} />
        </button>
        <button onClick={share} title="Share" className="rounded-full p-2 text-ink/40 transition-colors duration-[140ms] hover:bg-ink/[0.06] hover:text-ink">
          {copied ? <Check size={18} className="text-success" /> : <Share2 size={18} />}
        </button>
      </span>
    </Link>
  );
}