import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { jobMeta, type JobRow } from "@/lib/jobs";
import { ApplyPanel } from "@/components/ApplyPanel";
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

export default async function JobPage({ params }: Params) {
  const { id } = await params;
  const j = await loadJob(id);

  if (!j) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="font-display text-2xl text-porcelain">This job is not available</h1>
        <p className="text-sm text-white/50">It may have been closed or removed.</p>
        <Link href="/jobs" className="mt-2 rounded-md bg-pearl px-5 py-2.5 text-sm font-semibold text-ink">Browse jobs</Link>
      </main>
    );
  }

  const deadlinePassed = j.deadline ? new Date(j.deadline).getTime() < Date.now() : false;

  return (
    <main className="mx-auto min-h-screen w-full max-w-[640px] px-4 py-6">
      <Link href="/jobs" className="mb-6 inline-block text-sm text-white/50 hover:text-white">← Jobs</Link>
      <header className="px-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-white">{j.title}</h1>
          {j.urgent ? <span className="rounded-sm bg-danger/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger">Urgent</span> : null}
        </div>
        <p className="mt-1 text-[16px] text-white/80">{j.company}</p>
        {jobMeta(j) ? <p className="mt-1 text-[14px] text-white/50">{jobMeta(j)}</p> : null}
        <p className="mt-1 text-[13px] text-white/40">
          Posted {timeAgo(j.created_at)}
          {j.deadline ? " · " + (deadlinePassed ? "Deadline passed" : "Apply by " + new Date(j.deadline).toLocaleDateString()) : ""}
          {j.visa_sponsorship ? " · Visa sponsorship" : ""}
        </p>
      </header>
      <div className="mt-6 px-1">
        {deadlinePassed ? (
          <p className="rounded-md bg-surface px-4 py-3 text-[14px] text-white/60">The application deadline has passed.</p>
        ) : (
          <ApplyPanel jobId={j.id} applyUrl={j.apply_url} />
        )}
      </div>
      <article className="mt-8 whitespace-pre-wrap border-t border-white/10 px-1 pt-6 text-[15px] leading-relaxed text-white/90">
        {j.description}
      </article>
    </main>
  );
}