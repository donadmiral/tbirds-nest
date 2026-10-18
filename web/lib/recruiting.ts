export const RECRUITER_STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected"] as const;
export const RECRUITER_COLUMNS = [...RECRUITER_STAGES, "withdrawn", "other"] as const;

export const RECRUITER_STAGE_LABEL: Record<string, string> = {
  applied: "New", screening: "Screening", interview: "Interview", offer: "Offer",
  hired: "Hired", rejected: "Rejected", withdrawn: "Withdrawn", other: "Other",
};

// Match studio_stage while keeping withdrawn and unknown states visible.
export function recruiterStage(status: string): string {
  if (status === "viewed") return "applied";
  if (status === "shortlisted") return "screening";
  if (status === "accepted") return "hired";
  return RECRUITER_COLUMNS.some(stage => stage === status) ? status : "other";
}

export function recruitingSummary(apps: { status: string }[]) {
  const counts: Record<string, number> = Object.fromEntries(RECRUITER_COLUMNS.map(stage => [stage, 0]));
  for (const app of apps) counts[recruiterStage(app.status)] += 1;
  return { counts, total: apps.length, hired: counts.hired, rate: apps.length ? counts.hired / apps.length * 100 : 0 };
}

export function interviewLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function futureInterviewIso(value: string, now = Date.now()): string | null {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) && date.getTime() > now ? date.toISOString() : null;
}
