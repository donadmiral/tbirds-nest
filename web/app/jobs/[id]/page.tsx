import { profilePath } from "@/lib/profileLookup";
import { cache } from "react";
import { isJobId } from "../../../../shared/hiring";
import type { Metadata } from "next";
import { displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Users, Briefcase, Bookmark, Send } from "lucide-react";
import styles from "../JobsWorkspace.module.css";
import { createClient } from "@/lib/supabase/server";
import { type JobRow, isJobDeadlinePassed } from "@/lib/jobs";
import { ApplyPanel } from "@/components/ApplyPanel";
import { JobActions } from "@/components/JobActions";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { RelativeTime } from "@/components/RelativeTime";

type Params = { params: Promise<{ id: string }> };

const loadJob = cache(async (id: string) => {
  if (!isJobId(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("jobs").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("The job could not be loaded. Please try again.");
  return data as JobRow | null;
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const j = await loadJob(id);
  if (!j) return { title: "Jobs on Platinum Circles" };
  const desc = (j.description ?? "").slice(0, 150);
  return {
    title: j.title + " at " + j.company + " | Platinum Circles Jobs",
    description: desc,
    openGraph: { title: j.title + " at " + j.company, description: desc },
  };
}

function daysLeft(deadline: string | null): number | null {
  if (!deadline) return null;
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000);
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className={styles.fact}><dt>{label}</dt><dd>{value}</dd></div>
  );
}

export default async function JobPage({ params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const viewerId = userData.user?.id ?? null;
  const j = await loadJob(id);

  if (!j) {
    return (
      <main className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
        <h1 className="font-display text-2xl text-porcelain">This job is not available</h1>
        <p className="text-sm text-muted">It may have been closed or removed.</p>
        <Link href="/jobs" className="mt-2 rounded-full bg-pearl px-5 py-2.5 text-sm font-bold text-on-pearl transition-opacity duration-[140ms] hover:opacity-90">Browse jobs</Link>
      </main>
    );
  }

  const [posterRes, savedRes, applicantsRes, relatedRes] = await Promise.all([
    supabase.from("profiles").select("id, full_name, username, avatar_url, is_verified, verified_tier").eq("id", j.posted_by).maybeSingle(),
    viewerId ? supabase.from("job_saves").select("job_id").eq("user_id", viewerId).eq("job_id", id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    viewerId === j.posted_by ? supabase.from("job_applications").select("id", { count: "exact", head: true }).eq("job_id", id) : Promise.resolve({ count: null }),
    j.category ? supabase.from("jobs").select("id, title, company, location").eq("category", j.category).neq("id", id).or(`deadline.is.null,deadline.gt.${new Date().toISOString()}`).order("created_at", { ascending: false }).limit(3) : Promise.resolve({ data: [] }),
  ]);
  if (savedRes.error) throw new Error("Your saved job state could not be checked. Please try again.");
  const poster = posterRes.data;

  const dLeft = daysLeft(j.deadline);
  const deadlinePassed = isJobDeadlinePassed(j.deadline);
  const place = j.remote_type === "remote" ? "Remote"
    : j.remote_type === "hybrid" ? [j.location, "Hybrid"].filter(Boolean).join(" · ")
    : (j.location || "On site");
  const catLabel = String(j.category || "role").replace(/_/g, " ");
  const expLabel = j.experience_level ? j.experience_level.charAt(0).toUpperCase() + j.experience_level.slice(1) : null;
  const isOwn = viewerId === j.posted_by;

  return (
    <div className={styles.workspace}>
      <Link href="/jobs" className={styles.back}><ArrowLeft size={17} aria-hidden /> Back to Jobs</Link>
      <div className={styles.detail}>
        <div className={styles.detailMain}>
          <header className={styles.panel + " " + styles.hero}>
            <div className={styles.actions + " mb-4"}><span className={styles.companyIcon} aria-hidden><Briefcase size={24} strokeWidth={1.7} /></span>{j.urgent ? <span className={styles.badge}>Urgent hiring</span> : null}</div>
            <h1>{j.title}</h1><p className={styles.company}>{j.company}{j.verified ? <VerifiedBadge tier="business" size={16} /> : null}</p>
            <p className={styles.meta}>Posted <RelativeTime dateTime={j.created_at} />{j.applications_count > 0 ? " · " + j.applications_count + " applicants" : ""}{dLeft !== null ? " · " + (deadlinePassed ? "Deadline passed" : dLeft === 0 ? "Closes today" : dLeft + " days left") : ""}</p>
            <dl className={styles.facts}><Fact label="Workplace" value={place} /><Fact label="Type" value={catLabel} /><Fact label="Experience" value={expLabel} /><Fact label="Industry" value={j.industry} /><Fact label="Salary" value={j.salary_range} /><Fact label="Visa" value={j.visa_sponsorship ? "Sponsorship available" : null} /></dl>
            <div className="mt-5"><JobActions jobId={j.id} posterId={j.posted_by} initiallySaved={!!savedRes.data} viewerId={viewerId} /></div>
          </header>
          <section className={styles.panel}><h2>Role overview</h2><article className={styles.body}>{j.description}</article></section>
          {(j as JobRow & { benefits?: string | null }).benefits ? <section className={styles.panel}><h2>Benefits</h2><p className={styles.body}>{(j as JobRow & { benefits?: string | null }).benefits}</p></section> : null}
          {poster ? <section className={styles.panel}><h2>Posted by</h2><Link href={profilePath(poster.username, j.posted_by)} className={styles.person}>
            {poster.avatar_url ? <img src={displayImageUrl(poster.avatar_url, 200) ?? poster.avatar_url} alt="" /> : <span aria-hidden>{(poster.full_name ?? "?").charAt(0).toUpperCase()}</span>}
            <span className="min-w-0 flex-1"><strong>{poster.full_name}{poster.is_verified ? <VerifiedBadge tier={poster.verified_tier} size={14} /> : null}</strong><small>{poster.username ? "@" + poster.username : "View profile"}</small></span><ArrowRight size={17} aria-hidden />
          </Link></section> : null}
        </div>
        <aside className={styles.detailSide} aria-label={isOwn ? "Hiring tools" : "Application and related roles"}>
          <section className={styles.panel}><h2>{isOwn ? "Hiring workspace" : "Your application"}</h2>
            {isOwn ? <><p>Review the people who have applied and manage their next steps.</p><Link href={"/jobs/" + j.id + "/applicants"} className={styles.primary + " mt-4"}><Users size={17} aria-hidden />Manage applicants{typeof applicantsRes.count === "number" ? " (" + applicantsRes.count + ")" : ""}</Link></> : deadlinePassed ? <p className={styles.notice}>The application deadline has passed.</p> : <ApplyPanel key={j.id} jobId={j.id} applyUrl={j.apply_url} deadline={j.deadline} jobTitle={j.title} company={j.company} />}
          </section>
          <section className={styles.panel}><h2>Keep your search moving</h2><Link className={styles.careerLink} href="/jobs/applications"><Send size={18} aria-hidden /><span><strong>My applications</strong><small>Check your application status</small></span><ArrowRight size={15} aria-hidden /></Link><Link className={styles.careerLink} href="/jobs/saved"><Bookmark size={18} aria-hidden /><span><strong>Saved jobs</strong><small>Return to your shortlist</small></span><ArrowRight size={15} aria-hidden /></Link></section>
          {(relatedRes.data ?? []).length > 0 ? <section className={styles.panel}><h2>Similar roles</h2>{(relatedRes.data ?? []).map(role => <Link key={role.id} href={"/jobs/" + role.id} className={styles.careerLink}><span><strong>{role.title}</strong><small>{role.company}{role.location ? " · " + role.location : ""}</small></span><ArrowRight size={16} aria-hidden /></Link>)}</section> : null}
        </aside>
      </div>
    </div>
  );
}
