"use client";

/**
 * The hiring funnel.
 *
 * The board below shows who is in each stage. This shows the shape of the
 * whole thing: how many arrive, how many survive each step, and how long a
 * hire actually takes. Both read from the same applicant list, so they cannot
 * disagree.
 */
import { useMemo } from "react";
import { ChevronRight, Clock, Users } from "lucide-react";
import { Metric } from "@/components/Charts";
import { Panel } from "@/components/ui";

type Applicant = { id: string; status: string; applied_at: string; updated_at: string };
type Job = { id: string; title: string; closed: boolean; counts: Record<string, number> };

const FUNNEL = [
  { key: "applied", label: "Applied" },
  { key: "screening", label: "Screening" },
  { key: "interview", label: "Interview" },
  { key: "offer", label: "Offer" },
  { key: "hired", label: "Hired" },
] as const;

export function RecruiterFunnel({ apps, jobs }: { apps: Applicant[]; jobs: Job[] }) {
  const f = useMemo(() => {
    const counts = Object.fromEntries(FUNNEL.map((s) => [s.key, 0])) as Record<string, number>;
    for (const a of apps) if (a.status in counts) counts[a.status] += 1;

    // Everyone who reached a later stage passed through the earlier ones, so a
    // stage's funnel number is itself plus everything downstream. Counting only
    // who sits in a stage right now would show a funnel that widens.
    const cumulative: Record<string, number> = {};
    let running = 0;
    for (let i = FUNNEL.length - 1; i >= 0; i--) {
      running += counts[FUNNEL[i].key];
      cumulative[FUNNEL[i].key] = running;
    }

    const hired = apps.filter((a) => a.status === "hired");
    const days = hired
      .map((a) => (new Date(a.updated_at).getTime() - new Date(a.applied_at).getTime()) / 86400000)
      .filter((d) => d >= 0);
    const avgDays = days.length ? Math.round(days.reduce((x, y) => x + y, 0) / days.length) : null;

    const total = cumulative.applied || 0;
    return {
      cumulative,
      total,
      hired: counts.hired,
      rate: total > 0 ? (counts.hired / total) * 100 : 0,
      avgDays,
      openJobs: jobs.filter((j) => !j.closed).length,
    };
  }, [apps, jobs]);

  if (apps.length === 0 && f.openJobs === 0) return null;

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_300px]">
      <div className="rounded-2xl border border-ink/10 bg-white px-5 py-4">
        <h2 className="mb-3 text-[15px] font-semibold text-ink">Hiring funnel</h2>
        <div className="flex items-stretch gap-1 overflow-x-auto">
          {FUNNEL.map((s, i) => {
            const n = f.cumulative[s.key] ?? 0;
            const share = f.total > 0 ? (n / f.total) * 100 : 0;
            return (
              <div key={s.key} className="flex min-w-0 flex-1 items-center gap-1">
                <div className="min-w-0 flex-1 rounded-xl bg-surface/70 px-3 py-2.5">
                  <p className="truncate text-[11.5px] text-ink/45">{s.label}</p>
                  <Metric value={n} size={22} />
                  {/* A bar under each stage makes the drop-off legible without
                      a second chart. */}
                  <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-ink/8">
                    <div className="h-full rounded-full bg-pearl" style={{ width: Math.max(share, n > 0 ? 6 : 0) + "%" }} />
                  </div>
                </div>
                {i < FUNNEL.length - 1 ? <ChevronRight size={14} className="shrink-0 text-ink/20" /> : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
          <p className="flex items-center gap-1.5 text-[11.5px] text-ink/45">
            <Users size={12} /> Open roles
          </p>
          <Metric value={f.openJobs} size={24} />
          <p className="mt-0.5 text-[11.5px] text-ink/40">
            {f.total} {f.total === 1 ? "applicant" : "applicants"} in total
          </p>
        </div>

        <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
          <p className="flex items-center gap-1.5 text-[11.5px] text-ink/45">
            <Clock size={12} /> Time to hire
          </p>
          {f.avgDays === null ? (
            <>
              <p className="mt-0.5 text-[15px] font-semibold text-ink/30">Not yet</p>
              <p className="mt-0.5 text-[11.5px] text-ink/40">measured once someone is hired</p>
            </>
          ) : (
            <>
              <p className="mt-0.5 font-display text-[24px] leading-tight text-porcelain">{f.avgDays} days</p>
              <p className="mt-0.5 text-[11.5px] text-ink/40">
                average across {f.hired} {f.hired === 1 ? "hire" : "hires"}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The Recruiter rail: what needs a person today.
 *
 * Each line is a count of real applications in a real state. Nothing is a
 * suggested action or a score; if the number is zero the line does not appear,
 * so an empty rail means there is genuinely nothing waiting.
 */
export function RecruiterRail({
  apps,
  jobs,
}: {
  apps: (Applicant & { interview_at?: string | null; name?: string })[];
  jobs: Job[];
}) {
  const items = useMemo(() => {
    const now = Date.now();
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const interviewsToday = apps.filter(
      (a) => a.interview_at && new Date(a.interview_at).getTime() >= now && new Date(a.interview_at).getTime() <= endOfDay.getTime(),
    );
    const upcoming = apps
      .filter((a) => a.interview_at && new Date(a.interview_at).getTime() >= now)
      .sort((a, b) => new Date(a.interview_at!).getTime() - new Date(b.interview_at!).getTime())
      .slice(0, 3);

    return {
      upcoming,
      rows: [
        { n: interviewsToday.length, label: "interviews today" },
        { n: apps.filter((a) => a.status === "applied").length, label: "waiting on a first look" },
        { n: apps.filter((a) => a.status === "offer").length, label: "offers out" },
        { n: jobs.filter((j) => !j.closed && !(j.counts?.applied > 0)).length, label: "roles with no applicants" },
      ].filter((r) => r.n > 0),
    };
  }, [apps, jobs]);

  if (items.rows.length === 0 && items.upcoming.length === 0) return null;

  return (
    <>
      {items.rows.length > 0 ? (
        <Panel title="Needs a person">
          <div className="flex flex-col gap-2">
            {items.rows.map((r) => (
              <div key={r.label} className="flex items-baseline gap-2.5">
                <span className="font-display text-[17px] leading-none text-pearl-muted">{r.n}</span>
                <span className="min-w-0 flex-1 text-[13px] text-ink/70">{r.label}</span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {items.upcoming.length > 0 ? (
        <Panel title="Next interviews">
          <div className="flex flex-col gap-2.5">
            {items.upcoming.map((a) => (
              <div key={a.id}>
                <p className="truncate text-[13px] font-medium text-ink">{a.name ?? "Applicant"}</p>
                <p className="text-[11.5px] text-ink/45">
                  {new Date(a.interview_at!).toLocaleString([], {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </>
  );
}
