"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Briefcase, Bookmark, Share2, Check, MapPin, Clock } from "lucide-react";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { createClient } from "@/lib/supabase/client";
import { type JobRow, type PosterLite } from "@/lib/jobs";
import { RelativeTime } from "@/components/RelativeTime";
import { saveJobForSession } from "@/lib/jobsNavigation";
import styles from "@/app/jobs/JobsWorkspace.module.css";

type JobCardProps = {
  job: JobRow & { profile?: PosterLite | null };
  initiallySaved: boolean;
  viewerId: string | null;
  onSavedChange?: (saved: boolean) => void;
};
export function JobCard(props: JobCardProps) {
  return <JobCardContent key={`${props.viewerId ?? "guest"}:${props.job.id}`} {...props} />;
}
function JobCardContent({ job, initiallySaved, viewerId, onSavedChange }: JobCardProps) {
  const [supabase] = useState(createClient);
  const router = useRouter();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const saved = optimistic ?? initiallySaved;
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const generation = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    generation.current += 1;
    return () => { generation.current += 1; if (copyTimer.current) clearTimeout(copyTimer.current); };
  }, []);

  async function toggleSave() {
    if (!viewerId) { router.push("/login"); return; }
    if (saving.current) return;
    const token = generation.current;
    saving.current = true; setPending(true); setError("");
    const next = !saved; setOptimistic(next);
    try {
      await saveJobForSession(supabase, viewerId, job.id, next, () => token === generation.current);
      if (token === generation.current) { onSavedChange?.(next); if (onSavedChange) setOptimistic(null); }
    } catch {
      if (token === generation.current) { setOptimistic(saved); setError("We couldn’t save that change. Try again."); }
    } finally { if (token === generation.current) { saving.current = false; setPending(false); } }
  }

  async function share() {
    const token = generation.current;
    const url = window.location.origin + "/jobs/" + job.id;
    setError("");
    try {
      if (navigator.share) {
        try { await navigator.share({ title: job.title + " at " + job.company, url }); return; }
        catch (reason) { if (reason instanceof Error && reason.name === "AbortError") return; }
      }
      await navigator.clipboard.writeText(url);
      if (token !== generation.current) return;
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch { if (token === generation.current) setError("The link couldn’t be copied. Open the role and copy its address to share it."); }
  }
  const location = job.remote_type === "remote" ? "Remote" : [job.location, job.remote_type === "hybrid" ? "Hybrid" : null].filter(Boolean).join(" · ");
  return (
    <article className={styles.jobCard}>
      <span className={styles.companyIcon} aria-hidden><Briefcase size={23} strokeWidth={1.7} /></span>
      <div className={styles.jobCopy}>
        <h2><Link href={"/jobs/" + job.id}>{job.title}</Link></h2>
        <p className={styles.company}>{job.company}{job.verified ? <VerifiedBadge tier="business" size={14} /> : null}</p>
        <div className={styles.meta}>
          {location ? <span><MapPin size={13} aria-hidden />{location}</span> : null}
          {job.category ? <span><Briefcase size={13} aria-hidden />{job.category.replaceAll("_", " ")}</span> : null}
        </div>
        {job.salary_range ? <span className={styles.salary}>{job.salary_range}</span> : null}
        <div className={styles.meta}><span><Clock size={13} aria-hidden /><RelativeTime dateTime={job.created_at} /></span>{job.applications_count > 0 ? <span>{job.applications_count} applicants</span> : null}{job.urgent ? <span className={styles.badge}>Urgent hiring</span> : null}{job.visa_sponsorship ? <span className={styles.badge}>Visa sponsorship</span> : null}</div>
      </div>
      <div className={styles.cardActions}>
        <button type="button" onClick={() => void toggleSave()} disabled={pending} aria-pressed={saved} aria-label={(saved ? "Unsave " : "Save ") + job.title} title={saved ? "Unsave job" : "Save job"} className={styles.iconButton}><Bookmark size={19} strokeWidth={1.7} fill={saved ? "currentColor" : "none"} aria-hidden /></button>
        <button type="button" onClick={() => void share()} aria-label={"Share " + job.title} title="Share job" className={styles.iconButton}>{copied ? <Check size={19} aria-hidden /> : <Share2 size={19} strokeWidth={1.7} aria-hidden />}</button>
      </div>
      {error ? <p role="alert" className={styles.status + " " + styles.error}>{error}</p> : copied ? <p role="status" className={styles.status}>Job link copied.</p> : null}
    </article>
  );
}
