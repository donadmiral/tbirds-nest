"use client";

import { ApplicationCvLink } from "@/components/ApplicationCvLink";
import { profilePath } from "@/lib/profileLookup";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FileText, Phone, Link2, CalendarClock, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { timeAgo } from "@/lib/feed";
import { STATUS_META, APPLICATION_STATUS_ORDER, type ApplicationStatus } from "@/lib/jobs";

const STATUS_ORDER = APPLICATION_STATUS_ORDER;

type AppRow = {
  id: string; job_id: string; applicant_id: string; status: ApplicationStatus;
  cover_note: string | null; cv_url: string | null; cv_name: string | null;
  applicant_phone: string | null; portfolio_url: string | null;
  interview_at: string | null; interview_location: string | null;
  applied_at: string;
  profile?: { id: string; full_name: string | null; username: string | null; avatar_url: string | null } | null;
};

export default function ApplicantsPage() {
  const { id: jobId } = useParams<{ id: string }>();
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [jobTitle, setJobTitle] = useState("");
  const [apps, setApps] = useState<AppRow[]>([]);
  const [filter, setFilter] = useState("all");
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [when, setWhen] = useState("");
  const [where, setWhere] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const pending = useRef(new Set<string>());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const token = ++request.current;
    try {
      const { data: sess, error: sessionError } = await supabase.auth.getSession();
      if (token !== request.current) return;
      setLoading(true); setError(null);
      if (sessionError) throw sessionError;
      const uid = sess.session?.user.id ?? null;
      const { data: job, error: jobError } = await supabase.from("jobs").select("id, title, posted_by").eq("id", jobId).maybeSingle();
      if (jobError) throw jobError;
      if (token !== request.current) return;
      if (!job || !uid || job.posted_by !== uid) { setAllowed(false); return; }
      setJobTitle(job.title);
      setAllowed(true);
      const { data: rows, error: appsError } = await supabase
        .from("job_applications")
        .select("id, job_id, applicant_id, status, cover_note, cv_url, cv_name, applicant_phone, portfolio_url, interview_at, interview_location, applied_at")
        .eq("job_id", jobId)
        .order("applied_at", { ascending: false });
      if (appsError) throw appsError;
      const list = (rows ?? []) as AppRow[];
      const ids = Array.from(new Set(list.map((a) => a.applicant_id)));
      if (ids.length > 0) {
        const { data: profiles, error: profilesError } = await supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", ids);
        if (profilesError) throw profilesError;
        const map = new Map((profiles ?? []).map((p) => [p.id, p]));
        list.forEach((a) => (a.profile = map.get(a.applicant_id) ?? null));
      }
      if (token !== request.current) return;
      const fresh = list.filter((a) => a.status === "applied").map((a) => a.id);
      if (fresh.length > 0) {
        const { data: viewed, error: viewedError } = await supabase.from("job_applications")
          .update({ status: "viewed" }).in("id", fresh).eq("status", "applied").select("id");
        if (token !== request.current) return;
        if (viewedError) setError("Applicants loaded, but their viewed status could not be saved. Please retry.");
        const viewedIds = new Set((viewed ?? []).map((row) => row.id));
        list.forEach((app) => { if (viewedIds.has(app.id)) app.status = "viewed"; });
      }
      setApps(list);
    } catch (reason) {
      if (token === request.current) setError(reason instanceof Error ? reason.message : "Could not load applicants. Please try again.");
    } finally {
      if (token === request.current) setLoading(false);
    }
  }, [supabase, jobId]);

  useEffect(() => {
    // Skip a fetch if React cleans up this effect before its queued start.
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; request.current += 1; };
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: apps.length };
    STATUS_ORDER.forEach((s) => (c[s] = apps.filter((a) => a.status === s).length));
    return c;
  }, [apps]);

  const shown = useMemo(() => (filter === "all" ? apps : apps.filter((a) => a.status === filter)), [apps, filter]);

  async function setStatus(app: AppRow, status: ApplicationStatus, extra?: { interview_at?: string; interview_location?: string | null }): Promise<boolean> {
    if (app.status === "withdrawn" || status === "withdrawn" || pending.current.has(app.id)) return false;
    pending.current.add(app.id);
    setPendingIds(new Set(pending.current));
    const prev = { status: app.status, interview_at: app.interview_at, interview_location: app.interview_location };
    setApps((l) => l.map((x) => (x.id === app.id ? { ...x, status, ...(extra ?? {}) } : x)));
    try {
      const { error } = await supabase.from("job_applications").update({ status, ...(extra ?? {}) })
        .eq("id", app.id).neq("status", "withdrawn").select("id").single();
      if (error) throw error;
      return true;
    } catch (reason) {
      setApps((l) => l.map((x) => (x.id === app.id ? { ...x, ...prev } : x)));
      alert("Could not update application. Please refresh and try again. " + (reason instanceof Error ? reason.message : ""));
      return false;
    } finally {
      pending.current.delete(app.id);
      setPendingIds(new Set(pending.current));
    }
  }

  if (allowed === false) {
    return (
      <div className="px-1 py-16 text-center">
        <p className="text-[15px] text-ink/70">Only the poster of this job can view its applicants.</p>
        <Link href="/jobs" className="mt-3 inline-block rounded-md bg-pearl px-5 py-2.5 text-sm font-semibold text-on-pearl">Back to jobs</Link>
      </div>
    );
  }

  return (
    <div className="px-1">
      <Link href={"/jobs/" + jobId} className="mb-4 inline-block text-sm text-muted hover:text-ink">← {jobTitle || "Job"}</Link>
      <h1 className="font-display text-xl text-porcelain">Applicants</h1>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
        {["all", ...STATUS_ORDER].map((s) => (
          <button key={s}
            onClick={() => setFilter(s)}
            className={"shrink-0 rounded-md px-3 py-1.5 text-[13px] transition-colors " + (filter === s ? "bg-surface-elevated font-semibold text-ink" : "bg-surface text-ink/60 hover:text-ink")}
          >
            {s === "all" ? "All" : STATUS_META[s as ApplicationStatus].label} {counts[s] ? "(" + counts[s] + ")" : ""}
          </button>
        ))}
      </div>

      {error ? <p role="alert" className="py-3 text-sm text-danger">{error} <button onClick={() => { setLoading(true); void load(); }} className="underline">Retry</button></p> : null}
      {loading ? (
        <p className="py-16 text-center text-sm text-muted">Loading</p>
      ) : shown.length === 0 && !error ? (
        <p className="py-16 text-center text-sm text-muted">{filter === "all" ? "Applications will appear here as they come in." : "Move applicants here from their status menu."}</p>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          {shown.map((a) => {
            const meta = STATUS_META[a.status] || { label: a.status, color: "#6B7280", bg: "#F3F4F6" };
            return (
              <div key={a.id} className="rounded-lg border border-ink/10 p-4">
                <div className="flex items-center gap-3">
                  <Link href={profilePath(a.profile?.username, a.applicant_id)} className="shrink-0">
                    {a.profile?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={displayImageUrl(a.profile.avatar_url, 200) ?? a.profile.avatar_url} alt="" className="h-11 w-11 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-navy text-sm font-semibold text-white">
                        {(a.profile?.full_name ?? "?").charAt(0).toUpperCase()}
                      </span>
                    )}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link href={profilePath(a.profile?.username, a.applicant_id)} className="block truncate text-[15px] font-semibold text-ink hover:underline">
                      {a.profile?.full_name ?? "Member"} <VerifiedBadge userId={a.profile?.id} size={13} />
                    </Link>
                    <p className="text-[12px] text-muted">{a.profile?.username ? "@" + a.profile.username + " · " : ""}{timeAgo(a.applied_at)}</p>
                  </div>
                  <select value={a.status} disabled={a.status === "withdrawn" || pendingIds.has(a.id)}
                    onChange={(e) => {
                      if (e.target.value === "interview") { setScheduling(a.id); setWhen(""); setWhere(""); }
                      else void setStatus(a, e.target.value as ApplicationStatus);
                    }}
                    className="shrink-0 rounded-full border-0 px-3 py-1 text-[12px] font-semibold outline-none"
                    style={{ color: meta.color, backgroundColor: meta.bg }}
                  >
                    {STATUS_ORDER.filter((s) => s !== "withdrawn" || a.status === "withdrawn").map((s) => (
                      <option key={s} value={s} className="bg-white text-black">{STATUS_META[s].label}</option>
                    ))}
                  </select>
                </div>

                {a.cover_note ? <p className="mt-3 whitespace-pre-wrap text-[14px] text-ink/80">{a.cover_note}</p> : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={async () => { const { data, error } = await supabase.rpc("start_dm_ctx", { p_receiver_id: a.applicant_id, p_context: "jobs", p_ref_id: jobId }); if (error || !data) { alert("Could not open the conversation. Please try again."); return; } router.push("/jobs/messages?c=" + data); }} className="flex items-center gap-1.5 rounded-md bg-pearl/15 px-3 py-1.5 text-[13px] font-semibold text-accent hover:bg-pearl/25">
                    <MessageCircle size={14} /> Message
                  </button>
                  {a.cv_url ? (
                    <ApplicationCvLink reference={a.cv_url} name={a.cv_name} />
                  ) : null}
                  {a.applicant_phone ? (
                    <span className="flex items-center gap-1.5 rounded-md bg-surface px-3 py-1.5 text-[13px] text-ink/70"><Phone size={14} /> {a.applicant_phone}</span>
                  ) : null}
                  {a.portfolio_url ? (
                    <a href={a.portfolio_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-md bg-surface px-3 py-1.5 text-[13px] text-ink/80 hover:bg-surface-elevated">
                      <Link2 size={14} /> Portfolio
                    </a>
                  ) : null}
                </div>

                {a.interview_at ? (
                  <p className="mt-3 flex items-center gap-1.5 text-[13px] font-semibold text-success">
                    <CalendarClock size={15} /> Interview {new Date(a.interview_at).toLocaleString()}{a.interview_location ? " · " + a.interview_location : ""}
                  </p>
                ) : null}

                {scheduling === a.id ? (
                  <div className="mt-3 flex flex-col gap-2 rounded-md bg-surface p-3">
                    <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="rounded-md bg-surface-elevated px-3 py-2 text-[13px] text-ink outline-none" />
                    <input value={where} onChange={(e) => setWhere(e.target.value)} placeholder="Location or link" className="rounded-md bg-surface-elevated px-3 py-2 text-[13px] text-ink placeholder:text-muted outline-none" />
                    <div className="flex gap-2">
                      <button disabled={pendingIds.has(a.id)} onClick={async () => {
                          const interviewAt = new Date(when);
                          if (!when || !Number.isFinite(interviewAt.getTime()) || interviewAt.getTime() <= Date.now()) { alert("Choose a future interview time."); return; }
                          if (await setStatus(a, "interview", { interview_at: interviewAt.toISOString(), interview_location: where.trim() || null })) setScheduling(null);
                        }}
                        className="rounded-md bg-pearl px-4 py-2 text-[13px] font-semibold text-on-pearl"
                      >
                        Schedule interview
                      </button>
                      <button onClick={() => setScheduling(null)} className="rounded-md bg-surface-elevated px-4 py-2 text-[13px] text-ink">Cancel</button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}