"use client";

import { saveApplicationStatus, saveInterview, type ApplicantCursor } from "../../../../shared/hiring";

import { ApplicationCvLink } from "@/components/ApplicationCvLink";

import { RecruiterFunnel, RecruiterRail } from "@/components/RecruiterFunnel";
import { StudioLoadError } from "../LoadError";
import { RECRUITER_STAGES, RECRUITER_COLUMNS, RECRUITER_STAGE_LABEL, recruiterStage, recruitingCountSummary, interviewLocalInput, futureInterviewIso } from "@/lib/recruiting";
import { useRouter } from "next/navigation";
import { displayImageUrl } from "@/lib/media";
import { StudioRailPortal } from "@/components/StudioRailPortal";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Briefcase, Calendar, ExternalLink, MessageCircle, Phone, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { can } from "@/lib/studio";
import { useStudio } from "@/components/StudioShell";

type Job = { id: string; title: string; company: string; location: string | null; category: string; job_type: string | null; remote_type: string | null; deadline: string | null; created_at: string; urgent: boolean; closed: boolean; counts: Record<string, number> };
type Applicant = { id: string; status: string; applied_at: string; updated_at: string; cover_note: string | null; cover_letter: string | null; cv_url: string | null; cv_name: string | null; phone: string | null; portfolio_url: string | null; interview_at: string | null; interview_location: string | null; applicant_id: string; name: string; username: string | null; avatar_url: string | null; bio: string | null; location: string | null; tags: string[]; notes: { id: string; body: string; created_at: string; author: string | null }[] };

const STAGES = RECRUITER_STAGES;
// The pipeline reads left to right, so each column carries a colour that warms
// as a candidate advances and goes red only at the end.
const STAGE_BAR: Record<string, string> = {
  applied: "bg-ink/15",
  screening: "bg-ink/30",
  interview: "bg-pearl/50",
  offer: "bg-pearl",
  hired: "bg-success",
  rejected: "bg-danger/40",
  withdrawn: "bg-ink/20",
  other: "bg-ink/20",
};
const STAGE_LABEL = RECRUITER_STAGE_LABEL;

export default function RecruiterPage() {
  const { me } = useStudio();
  const router = useRouter();
  const [supabase] = useState(createClient);
  const recruiter = can(me?.role ?? null, "recruit");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [apps, setApps] = useState<Applicant[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [appCursor, setAppCursor] = useState<ApplicantCursor | null>(null); const [hasMoreApps, setHasMoreApps] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [interviewsToday, setInterviewsToday] = useState(0); const [nextInterviews, setNextInterviews] = useState<{id:string;name:string;interview_at:string}[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingApps, setLoadingApps] = useState(false);
  const [sel, setSel] = useState<Applicant | null>(null);
  const [note, setNote] = useState("");
  const [tagText, setTagText] = useState("");
  const [ivAt, setIvAt] = useState("");
  const [ivLoc, setIvLoc] = useState("");
  const [busy, setBusy] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const mounted = useRef(true);
  const jobsRequest = useRef(0);
  const appsRequest = useRef(0);
  const activeJob = useRef<{ id: string | null }>({ id: null });
  const activeApplicant = useRef<{ id: string | null }>({ id: null });
  const actionPending = useRef(false);

  const selectApplicant = (app: Applicant | null) => {
    activeApplicant.current = { id: app?.id ?? null };
    setSel(app);
    setNote("");
    setIvAt(interviewLocalInput(app?.interview_at ?? null));
    setIvLoc(app?.interview_location || "");
    setTagText(app?.tags.join(", ") || "");
    setActionError(null);
  };
  const selectJob = useCallback((id: string | null) => {
    if (activeJob.current.id === id) return;
    activeJob.current = { id };
    appsRequest.current += 1;
    activeApplicant.current = { id: null };
    setJobId(id); setApps([]); setCounts({}); setAppCursor(null); setHasMoreApps(false); setStatusFilter('all'); setNextInterviews([]); setInterviewsToday(0); setSel(null); setNote(""); setActionError(null); setAppsError(null);
    setLoadingApps(!!id);
  }, []);

  const loadJobs = useCallback(async () => {
    const request = ++jobsRequest.current;
    setLoading(true); setJobsError(null);
    try {
      const { data, error } = await supabase.rpc("studio_jobs");
      if (error) throw error;
      if (!mounted.current || request !== jobsRequest.current) return;
      const list = (data as Job[]) ?? [];
      setJobs(list);
      if (!list.some(j => j.id === activeJob.current.id)) selectJob(list[0]?.id ?? null);
    } catch {
      if (mounted.current && request === jobsRequest.current) setJobsError("Jobs could not be loaded. Please try again.");
    } finally {
      if (mounted.current && request === jobsRequest.current) setLoading(false);
    }
  }, [supabase, selectJob]);
  const loadApps = useCallback(async (id: string, cursor: ApplicantCursor | null = null) => {
    const context = activeJob.current;
    if (context.id !== id) return;
    const request = ++appsRequest.current;
    const current = () => mounted.current && context === activeJob.current && request === appsRequest.current;
    setLoadingApps(true); setAppsError(null);
    try {
      const { data, error } = await supabase.rpc("studio_applicant_page", { p_job: id, p_status: statusFilter, p_before_at: cursor?.applied_at ?? null, p_before_id: cursor?.id ?? null, p_limit: 25 });
      if (error) throw error;
      if (!current()) return;
      if (!data || !Array.isArray(data.applications) || !data.counts) throw new Error('Incomplete applicant response');
      const list: Applicant[] = data.applications.map((row: Applicant & { applicant?: { full_name?: string; username?: string; avatar_url?: string; bio?: string; location?: string } }) => ({ ...row, name: row.applicant?.full_name || row.name || 'Applicant', username: row.applicant?.username ?? row.username ?? null, avatar_url: row.applicant?.avatar_url ?? row.avatar_url ?? null, bio: row.applicant?.bio ?? row.bio ?? null, location: row.applicant?.location ?? row.location ?? null, tags: row.tags ?? [], notes: row.notes ?? [] }));
      setApps(old => cursor ? [...new Map([...old, ...list].map(row => [row.id, row])).values()] : list);
      setCounts(data.counts); setAppCursor(data.cursor); setHasMoreApps(!!data.has_more);
      setNextInterviews(data.next_interviews ?? []); setInterviewsToday(data.interviews_today ?? 0);
      setSel(s => s ? list.find(a => a.id === s.id) || (cursor ? s : null) : null);
    } catch {
      if (current()) setAppsError("Applicants could not be loaded. Please try again.");
    } finally { if (current()) setLoadingApps(false); }
  }, [supabase, statusFilter]);
  useEffect(() => {
    const pending = [jobsRequest, appsRequest]; let live = true;
    mounted.current = true;
    queueMicrotask(() => { if (live && recruiter) void loadJobs(); });
    return () => { live = false; mounted.current = false; pending.forEach(version => version.current++); };
  }, [recruiter, loadJobs]);
  useEffect(() => {
    let live = true;
    queueMicrotask(() => { if (live && jobId && recruiter) void loadApps(jobId); });
    return () => { live = false; };
  }, [jobId, recruiter, loadApps]);

  const job = jobs.find(j => j.id === jobId) || null;
  const completeCounts = recruitingCountSummary(counts);
  const filterApplicants = (status: string) => {
    activeJob.current = { id: jobId }; appsRequest.current++; setStatusFilter(status); setApps([]); setAppCursor(null); setHasMoreApps(false); selectApplicant(null);
  };

  const act = async (fn: () => PromiseLike<{ error: unknown }>, success?: () => void) => {
    if (actionPending.current) return;
    const context = activeJob.current;
    const applicant = activeApplicant.current;
    actionPending.current = true; setBusy(true); setActionError(null);
    try {
      const { error } = await fn();
      if (error) throw error;
      if (!mounted.current || context !== activeJob.current) return;
      if (applicant === activeApplicant.current) success?.();
      if (context.id) await loadApps(context.id);
      if (mounted.current && context === activeJob.current) await loadJobs();
    } catch {
      if (mounted.current && context === activeJob.current && applicant === activeApplicant.current) setActionError("The action could not be confirmed. Refresh the applicants before trying again.");
    } finally { actionPending.current = false; if (mounted.current) setBusy(false); }
  };
  const setStage = (a: Applicant, status: string) => {
    if (a.status === "withdrawn" || !STAGES.some(s => s === status)) return;
    if ((status === "rejected" || status === "hired") && !confirm((status === "rejected" ? "Reject " : "Mark as hired: ") + a.name + "? They will be notified.")) return;
    void act(async () => { await saveApplicationStatus(supabase, a, status); return { error: null }; });
  };
  const schedule = (a: Applicant) => {
    const date = futureInterviewIso(ivAt);
    if (a.status === "withdrawn") return;
    if (!date) { setActionError("Choose a future interview date and time."); return; }
    void act(async () => { await saveInterview(supabase, a, date, ivLoc.trim() || null); return { error: null }; });
  };
  const addNote = (a: Applicant) => {
    if (!note.trim()) return;
    const submitted = note;
    void act(() => supabase.rpc("studio_add_note", { p_application: a.id, p_body: submitted.trim() }), () => setNote(current => current === submitted ? "" : current));
  };
  const saveTags = (a: Applicant) => {
    void act(() => supabase.rpc("studio_set_tags", { p_application: a.id, p_tags: tagText.split(",").map(t => t.trim()).filter(Boolean) }));
  };
  const message = async (a: Applicant) => {
    if (!job || actionPending.current) return;
    const context = activeJob.current;
    const applicant = activeApplicant.current;
    actionPending.current = true; setBusy(true); setActionError(null);
    try {
      const { data, error } = await supabase.rpc("start_dm_ctx", { p_receiver_id: a.applicant_id, p_context: "jobs", p_ref_id: job.id });
      if (error || typeof data !== "string" || !data) throw error || new Error("Missing conversation");
      if (mounted.current && context === activeJob.current && applicant === activeApplicant.current) router.push("/jobs/messages?c=" + encodeURIComponent(data));
    } catch {
      if (mounted.current && context === activeJob.current && applicant === activeApplicant.current) setActionError("The conversation could not be opened. Please try again.");
    } finally { actionPending.current = false; if (mounted.current) setBusy(false); }
  };
  const toggleClose = (j: Job) => {
    if (!confirm(j.closed ? "Reopen this job?" : "Close this job? It stops accepting applications.")) return;
    void act(() => supabase.rpc("studio_close_job", { p_job: j.id, p_close: !j.closed }));
  };

  if (!recruiter) return <p className="py-16 text-center text-sm text-muted">Your Studio role does not include recruiting. Ask the owner for the recruiter role.</p>;

  return (
    <div className="max-w-[1100px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[21px] leading-tight text-porcelain">Recruiter</h1>
          <p className="mt-1 text-[13px] text-muted">Every application moves through one pipeline. Candidates hear from you on offer, hire, rejection and interviews.</p>
        </div>
        <Link href="/jobs/new" className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3.5 py-2 text-[13px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90"><Plus size={14} /> Post a job</Link>
      </div>

      <StudioLoadError message={jobsError} retry={() => { void loadJobs(); }} busy={loading} />
      {loading && jobs.length === 0 ? <p className="py-12 text-center text-sm text-muted">Loading</p> : jobs.length === 0 ? (jobsError ? null :
        <p className="py-12 text-center text-sm text-muted">No jobs posted yet. Post one from Jobs and the applications land here.</p>
      ) : (
        <>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {jobs.map(j => (
              <button key={j.id} onClick={() => selectJob(j.id)} aria-pressed={jobId === j.id} className={"shrink-0 rounded-lg border px-3.5 py-2 text-left transition-colors duration-[140ms] " + (jobId === j.id ? "border-pearl bg-surface" : "border-ink/10 hover:bg-surface")}>
                <span className="flex items-center gap-2 text-[13.5px] font-semibold text-ink"><Briefcase size={13} className={j.closed ? "text-muted" : "text-accent"} /> {j.title}{j.closed ? <span className="text-[10px] uppercase text-muted">closed</span> : null}</span>
                <span className="mt-0.5 block text-[11.5px] text-muted">{j.counts.total} applicants · {j.counts.interview} interviewing · {j.counts.hired} hired</span>
              </button>
            ))}
          </div>

          {job ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              <span>{job.company}{job.location ? " · " + job.location : ""}{job.job_type ? " · " + job.job_type : ""}{job.remote_type ? " · " + job.remote_type : ""}</span>
              <span>· posted {new Date(job.created_at).toLocaleDateString()}</span>
              {job.deadline ? <span>· {job.closed ? "closed" : "closes"} {new Date(job.deadline).toLocaleDateString()}</span> : null}
              <Link href={"/jobs/" + job.id} className="text-accent">View listing</Link>
              <button disabled={busy} onClick={() => toggleClose(job)} className="ml-auto rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink">{job.closed ? "Reopen job" : "Close job"}</button>
            </div>
          ) : null}

          <StudioLoadError message={appsError} retry={() => { if (jobId) void loadApps(jobId); }} busy={loadingApps} />
          <StudioLoadError message={actionError} retry={() => { setActionError(null); if (jobId) void loadApps(jobId); }} busy={loadingApps || busy} />
          {!loadingApps && !appsError ? <>
            <StudioRailPortal><RecruiterRail apps={apps} jobs={jobs} counts={counts} nextInterviews={nextInterviews} interviewsToday={interviewsToday} /></StudioRailPortal>
            <RecruiterFunnel apps={apps} jobs={jobs} counts={counts} />
          </> : null}

          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm"><label>Show applications <select aria-label="Filter application status" value={statusFilter} onChange={e => filterApplicants(e.target.value)} className="ml-2 rounded-lg border border-ink/15 bg-white p-2"><option value="all">All stages</option>{Object.keys(counts).filter(key => ['applied','viewed','shortlisted','screening','interview','offer','hired','accepted','rejected','withdrawn'].includes(key)).map(key => <option key={key} value={key}>{STAGE_LABEL[recruiterStage(key)] || key}{key !== recruiterStage(key) ? ' (' + key + ')' : ''} · {counts[key]}</option>)}</select></label><span className="text-muted">{apps.length} loaded · {completeCounts.total} applications in this role</span>{hasMoreApps && <button disabled={loadingApps} onClick={() => jobId && void loadApps(jobId, appCursor)} className="rounded-lg bg-surface px-3 py-2">Load more applicants</button>}</div>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
            <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:thin]">
              {RECRUITER_COLUMNS.filter(st => st !== "other" || completeCounts.counts.other > 0).map(st => {
                const col = apps.filter(a => recruiterStage(a.status) === st);
                return (
                  <div key={st} className="w-[168px] shrink-0 rounded-2xl border border-ink/10 bg-white p-2">
                    <span className={"mb-2 block h-[3px] w-full rounded-full " + STAGE_BAR[st]} aria-hidden />
                    <p className="mb-1.5 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wide text-muted"><span>{STAGE_LABEL[st]}</span><span className="tabular-nums" title="All applications in this stage">{completeCounts.counts[st] ?? 0}</span></p>
                    {loadingApps ? <p className="px-1 text-[12px] text-muted">Loading</p> : col.length === 0 && !appsError ? (
                      <p className="px-1 pb-1 text-[11.5px] leading-snug text-muted break-words">
                        {(completeCounts.counts[st] ?? 0) > 0 ? "Choose this stage in the filter or load more applicants to view them." : st === "applied" ? "New applications land here" : st === "rejected" ? "Nobody rejected" : "Nobody at this stage"}
                      </p>
                    ) : col.map(a => (
                      <button key={a.id} onClick={() => selectApplicant(a)} aria-pressed={sel?.id === a.id} className={"mb-1.5 w-full rounded-lg border p-2 text-left transition-colors duration-[140ms] hover:bg-surface " + (sel?.id === a.id ? "border-pearl" : "border-ink/10")}>
                        <span className="flex items-center gap-2">
                          {a.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={displayImageUrl(a.avatar_url, 200) ?? a.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                          ) : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy text-[11px] font-semibold text-white">{a.name.charAt(0)}</span>}
                          <span className="min-w-0"><span className="block truncate text-[12.5px] font-semibold text-ink">{a.name}</span><span className="block text-[10.5px] text-muted">{new Date(a.applied_at).toLocaleDateString()}</span></span>
                        </span>
                        {a.tags.length ? <span className="mt-1 block truncate text-[10.5px] text-accent">{a.tags.join(" · ")}</span> : null}
                        {a.interview_at && st === "interview" ? <span className="mt-1 block text-[10.5px] text-muted">{new Date(a.interview_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span> : null}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>

            <aside className="sticky top-[88px] min-w-0 max-h-[calc(100vh-110px)] overflow-y-auto overflow-x-hidden break-words rounded-2xl border border-ink/10 bg-white p-4">
              {!sel ? <p className="text-[13px] text-muted">Select an applicant to see their application, move them, schedule an interview or leave notes.</p> : (
                <>
                  <div className="flex items-start gap-3.5">
                    {sel.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={displayImageUrl(sel.avatar_url, 200) ?? sel.avatar_url} alt="" className="h-14 w-14 rounded-full object-cover" />
                    ) : <span className="flex h-14 w-14 items-center justify-center rounded-full bg-navy text-[17px] font-semibold text-white">{sel.name.charAt(0)}</span>}
                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] font-semibold text-ink">{sel.name}</p>
                      <p className="text-[12px] text-muted">{sel.username ? "@" + sel.username : ""}{sel.location ? " · " + sel.location : ""}</p>
                    </div>
                    <button onClick={() => selectApplicant(null)} className="rounded-full p-1 text-muted transition-colors duration-[140ms] hover:bg-surface" aria-label="Close"><X size={15} /></button>
                  </div>
                  {sel.bio ? <p className="mt-2 text-[12.5px] text-ink/60">{sel.bio}</p> : null}
                  <div className="mt-3 flex items-center gap-2 text-[11.5px] text-muted">
                    <span className={"rounded-full px-2 py-0.5 font-semibold " + (sel.status === "hired" ? "bg-success/15 text-success" : sel.status === "rejected" ? "bg-danger/10 text-danger" : "bg-pearl/20 text-pearl-muted")}>{STAGE_LABEL[sel.status as keyof typeof STAGE_LABEL] ?? sel.status}</span>
                    <span>Applied {new Date(sel.applied_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                    {sel.phone ? <span>· {sel.phone}</span> : null}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      disabled={busy}
                      onClick={() => { void message(sel); }}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-ink px-3 py-2 text-[12.5px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40"
                    >
                      Message
                    </button>
                    {sel.username ? (
                      <Link href={"/" + sel.username} className="flex flex-1 items-center justify-center rounded-full border border-ink/15 px-3 py-2 text-[12.5px] font-semibold text-ink/70 transition-colors duration-[140ms] hover:bg-surface hover:text-ink">View profile</Link>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {sel.username ? <Link href={"/" + sel.username} className="inline-flex items-center gap-1 rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink"><ExternalLink size={12} /> Profile</Link> : null}
                    <button disabled={busy} onClick={() => { void message(sel); }} className="inline-flex items-center gap-1 rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink"><MessageCircle size={12} /> Message</button>
                    {sel.cv_url ? <ApplicationCvLink reference={sel.cv_url} name={sel.cv_name} /> : null}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {sel.portfolio_url && /^https?:\/\//i.test(sel.portfolio_url) ? <a href={sel.portfolio_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink"><ExternalLink size={12} /> Portfolio</a> : null}
                    {sel.phone ? <a href={"tel:" + sel.phone} className="inline-flex items-center gap-1 rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink"><Phone size={12} /> {sel.phone}</a> : null}
                  </div>
                  {sel.cover_letter || sel.cover_note ? (
                    <div className="mt-3 rounded-lg bg-surface p-3">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Cover letter</p>
                      <p className="whitespace-pre-wrap text-[12.5px] text-ink/80">{sel.cover_letter || sel.cover_note}</p>
                    </div>
                  ) : null}

                  <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">Stage</p>
                  <div className="flex flex-wrap gap-1.5">
                    {STAGES.map(st => (
                      <button key={st} disabled={busy || sel.status === "withdrawn" || recruiterStage(sel.status) === st} onClick={() => setStage(sel, st)}
                        className={"rounded-full px-2.5 py-1 text-[12px] font-semibold transition-colors duration-[140ms] disabled:opacity-100 " + (sel.status === st ? "bg-ink text-white" : st === "rejected" ? "bg-danger/10 text-danger" : st === "hired" ? "bg-success/15 text-success" : "bg-surface text-ink/60 hover:text-ink")}>{STAGE_LABEL[st]}</button>
                    ))}
                  </div>

                  <p className="mb-1.5 mt-4 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted"><Calendar size={11} /> Interview</p>
                  <input aria-label="Interview date and time" disabled={sel.status === "withdrawn"} type="datetime-local" value={ivAt} onChange={e => setIvAt(e.target.value)} className="w-full rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
                  <input aria-label="Interview location or video link" disabled={sel.status === "withdrawn"} value={ivLoc} onChange={e => setIvLoc(e.target.value)} placeholder="Location or video link" className="mt-1.5 w-full rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
                  <button onClick={() => schedule(sel)} disabled={busy || !ivAt || sel.status === "withdrawn"} className="mt-1.5 rounded-md bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">{sel.interview_at ? "Update and notify" : "Schedule and notify"}</button>

                  <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">Tags</p>
                  <div className="flex gap-1.5">
                    <input aria-label="Applicant tags" disabled={busy} value={tagText} onChange={e => setTagText(e.target.value)} onBlur={() => saveTags(sel)} placeholder="strong, local, needs visa" className="w-full rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
                  </div>

                  <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">Team notes</p>
                  {sel.notes.map(n => (
                    <div key={n.id} className="mb-1.5 rounded-lg bg-surface p-2">
                      <p className="text-[12.5px] text-ink/80">{n.body}</p>
                      <p className="mt-0.5 text-[10.5px] text-muted">{n.author || "Team"} · {new Date(n.created_at).toLocaleString()}</p>
                    </div>
                  ))}
                  <div className="flex gap-1.5">
                    <input aria-label="Team note" value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addNote(sel); }} placeholder="Add a note, only your team sees it" className="w-full rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
                    <button onClick={() => addNote(sel)} disabled={busy || !note.trim()} className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">Add</button>
                  </div>
                </>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
