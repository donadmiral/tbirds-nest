"use client";

// Current application states. Historical progression requires an event log.
import { useEffect, useMemo, useState } from "react";
import { Users } from "lucide-react";
import { Metric } from "@/components/Charts";
import { RECRUITER_COLUMNS, RECRUITER_STAGE_LABEL, recruitingSummary, recruiterStage } from "@/lib/recruiting";
import { Panel } from "@/components/ui";

type Applicant = { id: string; status: string; applied_at: string; updated_at: string };
type Job = { id: string; title: string; closed: boolean; counts: Record<string, number> };

const FUNNEL = RECRUITER_COLUMNS.map(key => ({ key, label: RECRUITER_STAGE_LABEL[key] }));

export function RecruiterFunnel({ apps, jobs }: { apps: Applicant[]; jobs: Job[] }) {
  const f = useMemo(() => ({
    ...recruitingSummary(apps),
    openJobs: jobs.filter(j => !j.closed).length,
  }), [apps, jobs]);

  if (apps.length === 0 && f.openJobs === 0) return null;

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,300px)]">
      <div className="rounded-2xl border border-ink/10 bg-white px-5 py-4">
        <h2 className="mb-3 text-[15px] font-semibold text-ink">Current hiring stages</h2>
        <div className="flex items-stretch gap-1 overflow-x-auto">
          {FUNNEL.filter(s => s.key !== "other" || f.counts.other > 0).map((s) => {
            const n = f.counts[s.key] ?? 0;
            const share = f.total > 0 ? (n / f.total) * 100 : 0;
            return (
              <div key={s.key} className="flex min-w-[92px] flex-1 items-center gap-1">
                <div className="min-w-0 flex-1 rounded-xl bg-surface/70 px-3 py-2.5">
                  <p className="truncate text-[11.5px] text-muted">{s.label}</p>
                  <Metric value={n} size={22} />
                  {/* Share of all applications in this current stage. */}
                  <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-ink/8">
                    <div className="h-full rounded-full bg-pearl" style={{ width: Math.max(share, n > 0 ? 6 : 0) + "%" }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
          <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
            <Users size={12} /> Open roles
          </p>
          <Metric value={f.openJobs} size={24} />
          <p className="mt-0.5 text-[11.5px] text-muted">
            {f.total} {f.total === 1 ? "application" : "applications"} for this role
          </p>
        </div>

        <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
          <p className="text-[11.5px] text-muted">Hired for this role</p>
          <Metric value={f.hired} size={24} />
          <p className="mt-0.5 text-[11.5px] text-muted">{f.total ? f.rate.toFixed(1) + "% of applications" : "No applications yet"}</p>
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
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const items = useMemo(() => {
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const interviewsToday = apps.filter(
      (a) => recruiterStage(a.status) === "interview" && a.interview_at && new Date(a.interview_at).getTime() >= now && new Date(a.interview_at).getTime() <= endOfDay.getTime(),
    );
    const upcoming = apps
      .filter((a) => recruiterStage(a.status) === "interview" && a.interview_at && new Date(a.interview_at).getTime() >= now)
      .sort((a, b) => new Date(a.interview_at!).getTime() - new Date(b.interview_at!).getTime())
      .slice(0, 3);

    return {
      upcoming,
      rows: [
        { n: interviewsToday.length, label: "interviews today" },
        { n: apps.filter((a) => a.status === "applied").length, label: "in the new application stage" },
        { n: apps.filter((a) => a.status === "offer").length, label: "offers out" },
        { n: jobs.filter((j) => !j.closed && j.counts?.total === 0).length, label: "roles with no applicants" },
      ].filter((r) => r.n > 0),
    };
  }, [apps, jobs, now]);

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
                <p className="text-[11.5px] text-muted">
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
