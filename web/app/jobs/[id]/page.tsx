import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { type JobRow } from "@/lib/jobs";
import { ApplyPanel } from "@/components/ApplyPanel";
import { JobActions } from "@/components/JobActions";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { timeAgo } from "@/lib/feed";

type Params = { params: Promise<{ id: string }> };

async function loadJob(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("jobs").select("*").eq("id", id).maybeSingle();
  return data as JobRow | null;
}

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
    <div className="rounded-md bg-surface px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-white/40">{label}</p>
      <p className="mt-0.5 text-[14px] text-white/90">{value}</p>
    </div>
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
        <p className="text-sm text-white/50">It may have been closed or removed.</p>
        <Link href="/jobs" className="mt-2 rounded-md bg-pearl px-5 py-2.5 text-sm font-semibold text-ink">Browse jobs</Link>
      </main>
    );
  }

  const [posterRes, savedRes, applicantsRes, relatedRes] = await Promise.all([
    supabase.from("profiles").select("id, full_name, username, avatar_url, is_verified, verified_tier").eq("id", j.posted_by).maybeSingle(),
    viewerId ? supabase.from("job_saves").select("job_id").eq("user_id", viewerId).eq("job_id", id).maybeSingle() : Promise.resolve({ data: null }),
    viewerId === j.posted_by ? supabase.from("job_applications").select("id", { count: "exact", head: true }).eq("job_id", id) : Promise.resolve({ count: null }),
    j.category ? supabase.from("jobs").select("id, title, company, location").eq("category", j.category).neq("id", id).order("created_at", { ascending: false }).limit(3) : Promise.resolve({ data: [] }),
  ]);
  const poster = posterRes.data;

  const dLeft = daysLeft(j.deadline);
  const deadlinePassed = dLeft !== null && dLeft < 0;
  const place = j.remote_type === "remote" ? "Remote"
    : j.remote_type === "hybrid" ? [j.location, "Hybrid"].filter(Boolean).join(" · ")
    : (j.location || "On site");
  const catLabel = String(j.category || "role").replace(/_/g, " ");
  const expLabel = j.experience_level ? j.experience_level.charAt(0).toUpperCase() + j.experience_level.slice(1) : null;
  const isOwn = viewerId === j.posted_by;

  return (
    <div className="px-1">
      <Link href="/jobs" className="mb-5 inline-block text-sm text-white/50 hover:text-white">← Jobs</Link>
      <header>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-white">{j.title}</h1>
          {j.urgent ? <span className="rounded-sm bg-danger/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger">Urgent</span> : null}
        </div>
        <p className="mt-1 flex items-center gap-1 text-[16px] text-white/80">
          {j.company}
          {j.verified ? <VerifiedBadge tier="business" size={15} /> : null}
        </p>
        <p className="mt-1 text-[13px] text-white/40">
          Posted {timeAgo(j.created_at)}
          {j.applications_count > 0 ? " · " + j.applications_count + " applicants" : ""}
          {dLeft !== null ? " · " + (deadlinePassed ? "Deadline passed" : dLeft === 0 ? "Closes today" : dLeft + " days left") : ""}
        </p>
      </header>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Fact label="Workplace" value={place} />
        <Fact label="Type" value={catLabel} />
        <Fact label="Experience" value={expLabel} />
        <Fact label="Industry" value={j.industry} />
        <Fact label="Salary" value={j.salary_range} />
        <Fact label="Visa" value={j.visa_sponsorship ? "Sponsorship available" : null} />
      </div>

      <div className="mt-4">
        <JobActions jobId={j.id} posterId={j.posted_by} initiallySaved={!!savedRes.data} viewerId={viewerId} />
      </div>

      {isOwn ? (
        <Link href={"/jobs/" + j.id + "/applicants"} className="mt-4 flex items-center gap-2 rounded-md border border-pearl/40 bg-pearl/10 px-4 py-3 text-[14px] font-semibold text-pearl transition-colors hover:bg-pearl/20">
          <Users size={17} /> Manage applicants{applicantsRes.count ? " (" + applicantsRes.count + ")" : ""}
        </Link>
      ) : (
        <div className="mt-5">
          {deadlinePassed ? (
            <p className="rounded-md bg-surface px-4 py-3 text-[14px] text-white/60">The application deadline has passed.</p>
          ) : (
            <ApplyPanel jobId={j.id} applyUrl={j.apply_url} />
          )}
        </div>
      )}

      <article className="mt-7 whitespace-pre-wrap border-t border-white/10 pt-6 text-[15px] leading-relaxed text-white/90">
        {j.description}
      </article>

      {(j as JobRow & { benefits?: string | null }).benefits ? (
        <section className="mt-6">
          <h2 className="text-[15px] font-semibold text-white">Benefits</h2>
          <p className="mt-1 whitespace-pre-wrap text-[14px] text-white/80">{(j as JobRow & { benefits?: string | null }).benefits}</p>
        </section>
      ) : null}

      {poster ? (
        <Link href={poster.username ? "/" + poster.username : "#"} className="mt-7 flex items-center gap-3 rounded-lg border border-white/10 p-4 transition-colors hover:bg-surface">
          {poster.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster.avatar_url} alt="" className="h-11 w-11 rounded-full object-cover" />
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-navy text-sm font-semibold text-porcelain">
              {(poster.full_name ?? "?").charAt(0).toUpperCase()}
            </span>
          )}
          <span className="min-w-0">
            <span className="flex items-center gap-1 text-[14px] font-semibold text-white">
              {poster.full_name}
              {poster.is_verified ? <VerifiedBadge tier={poster.verified_tier} size={14} /> : null}
            </span>
            <span className="block text-[13px] text-white/50">Posted this role · @{poster.username}</span>
          </span>
        </Link>
      ) : null}

      {(relatedRes.data ?? []).length > 0 ? (
        <section className="mt-7">
          <h2 className="text-[15px] font-semibold text-white">Similar roles</h2>
          <div className="mt-2 flex flex-col gap-2">
            {(relatedRes.data ?? []).map((r) => (
              <Link key={r.id} href={"/jobs/" + r.id} className="rounded-md bg-surface px-4 py-3 transition-colors hover:bg-surface-elevated">
                <span className="block text-[14px] font-medium text-white">{r.title}</span>
                <span className="block text-[13px] text-white/50">{r.company}{r.location ? " · " + r.location : ""}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}