"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Briefcase, Calendar, ExternalLink, FileText, MessageCircle, Phone, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { can } from "@/lib/studio";
import { useStudio } from "@/components/StudioShell";

type Job = { id: string; title: string; company: string; location: string | null; category: string; job_type: string | null; remote_type: string | null; deadline: string | null; created_at: string; urgent: boolean; closed: boolean; counts: Record<string, number> };
type Applicant = { id: string; status: string; applied_at: string; updated_at: string; cover_note: string | null; cover_letter: string | null; cv_url: string | null; cv_name: string | null; phone: string | null; portfolio_url: string | null; interview_at: string | null; interview_location: string | null; applicant_id: string; name: string; username: string | null; avatar_url: string | null; bio: string | null; location: string | null; tags: string[]; notes: { id: string; body: string; created_at: string; author: string | null }[] };

const STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected"] as const;
const STAGE_LABEL: Record<string, string> = { applied: "New", screening: "Screening", interview: "Interview", offer: "Offer", hired: "Hired", rejected: "Rejected" };
const toLocalInput = (iso: string | null) => iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";

export default function RecruiterPage() {
  const { me } = useStudio();
  const supabase = useRef(createClient()).current;
  const recruiter = can(me?.role ?? null, "recruit");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [apps, setApps] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingApps, setLoadingApps] = useState(false);
  const [sel, setSel] = useState<Applicant | null>(null);
  const [note, setNote] = useState("");
  const [tagText, setTagText] = useState("");
  const [ivAt, setIvAt] = useState("");
  const [ivLoc, setIvLoc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("studio_jobs");
      if (error) { setErr(error.message); return; }
      const list = (data as Job[]) ?? [];
      setJobs(list);
      if (!jobId && list.length) setJobId(list[0].id);
    } finally { setLoading(false); }
  }, [supabase, jobId]);
  const loadApps = useCallback(async (id: string) => {
    setLoadingApps(true);
    try {
      const { data, error } = await supabase.rpc("studio_applicants", { p_job: id });
      if (error) { setErr(error.message); return; }
      const list = (data as Applicant[]) ?? [];
      setApps(list);
      setSel(s => s ? list.find(a => a.id === s.id) || null : null);
    } finally { setLoadingApps(false); }
  }, [supabase]);
  useEffect(() => { void loadJobs(); }, [loadJobs]);
  useEffect(() => { if (jobId) void loadApps(jobId); }, [jobId, loadApps]);
  useEffect(() => { if (sel) { setIvAt(toLocalInput(sel.interview_at)); setIvLoc(sel.interview_location || ""); setTagText(sel.tags.join(", ")); } }, [sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const job = jobs.find(j => j.id === jobId) || null;

  const act = async (fn: () => PromiseLike<{ error: any }>) => {
    if (busy) return;
    setBusy(true);
    try { const { error } = await fn(); if (error) throw error; if (jobId) await loadApps(jobId); await loadJobs(); }
    catch (e: any) { alert(e?.message || "Action failed."); }
    finally { setBusy(false); }
  };
  const setStage = (a: Applicant, status: string) => {
    if ((status === "rejected" || status === "hired") && !confirm((status === "rejected" ? "Reject " : "Mark as hired: ") + a.name + "? They will be notified.")) return;
    void act(() => supabase.rpc("studio_set_stage", { p_application: a.id, p_status: status }));
  };
  const schedule = (a: Applicant) => {
    if (!ivAt) { alert("Pick a date and time."); return; }
    void act(() => supabase.rpc("studio_schedule_interview", { p_application: a.id, p_at: new Date(ivAt).toISOString(), p_location: ivLoc || null }));
  };
  const addNote = (a: Applicant) => {
    if (!note.trim()) return;
    void act(async () => { const r = await supabase.rpc("studio_add_note", { p_application: a.id, p_body: note.trim() }); if (!r.error) setNote(""); return r; });
  };
  const saveTags = (a: Applicant) => {
    void act(() => supabase.rpc("studio_set_tags", { p_application: a.id, p_tags: tagText.split(",").map(t => t.trim()).filter(Boolean) }));
  };
  const message = async (a: Applicant) => {
    if (!job) return;
    const { data, error } = await supabase.rpc("start_dm_ctx", { p_receiver_id: a.applicant_id, p_context: "jobs", p_ref_id: job.id });
    if (error) { alert(error.message); return; }
    void data;
    window.location.href = "/messages";
  };
  const toggleClose = (j: Job) => {
    if (!confirm(j.closed ? "Reopen this job?" : "Close this job? It stops accepting applications.")) return;
    void act(() => supabase.rpc("studio_close_job", { p_job: j.id, p_close: !j.closed }));
  };

  if (!recruiter) return <p className="py-16 text-center text-sm text-ink/40">Your Studio role does not include recruiting. Ask the owner for the recruiter role.</p>;
  if (err) return <p className="py-16 text-center text-sm text-red-400">{err}</p>;

  return (
    <div className="max-w-[1100px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[21px] leading-tight text-porcelain">Recruiter</h1>
          <p className="mt-1 text-[13px] text-ink/50">Every application moves through one pipeline. Candidates hear from you on offer, hire, rejection and interviews.</p>
        </div>
        <Link href="/jobs" className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3.5 py-2 text-[13px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90"><Plus size={14} /> Post a job</Link>
      </div>

      {loading ? <p className="py-12 text-center text-sm text-ink/40">Loading</p> : jobs.length === 0 ? (
        <p className="py-12 text-center text-sm text-ink/40">No jobs posted yet. Post one from Jobs and the applications land here.</p>
      ) : (
        <>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {jobs.map(j => (
              <button key={j.id} onClick={() => { setJobId(j.id); setSel(null); }} className={"shrink-0 rounded-lg border px-3.5 py-2 text-left transition-colors duration-[140ms] " + (jobId === j.id ? "border-pearl bg-surface" : "border-ink/10 hover:bg-surface")}>
                <span className="flex items-center gap-2 text-[13.5px] font-semibold text-ink"><Briefcase size={13} className={j.closed ? "text-ink/30" : "text-pearl"} /> {j.title}{j.closed ? <span className="text-[10px] uppercase text-ink/40">closed</span> : null}</span>
                <span className="mt-0.5 block text-[11.5px] text-ink/45">{j.counts.total} applicants · {j.counts.interview} interviewing · {j.counts.hired} hired</span>
              </button>
            ))}
          </div>

          {job ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink/55">
              <span>{job.company}{job.location ? " · " + job.location : ""}{job.job_type ? " · " + job.job_type : ""}{job.remote_type ? " · " + job.remote_type : ""}</span>
              <span>· posted {new Date(job.created_at).toLocaleDateString()}</span>
              {job.deadline ? <span>· {job.closed ? "closed" : "closes"} {new Date(job.deadline).toLocaleDateString()}</span> : null}
              <Link href={"/jobs?job=" + job.id} className="text-pearl">View listing</Link>
              <button onClick={() => toggleClose(job)} className="ml-auto rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink">{job.closed ? "Reopen job" : "Close job"}</button>
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
              {STAGES.map(st => {
                const col = apps.filter(a => a.status === st);
                return (
                  <div key={st} className="rounded-2xl border border-ink/10 bg-white p-2">
                    <p className="mb-1.5 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wide text-ink/45"><span>{STAGE_LABEL[st]}</span><span>{col.length}</span></p>
                    {loadingApps ? <p className="px-1 text-[12px] text-ink/30">Loading</p> : col.map(a => (
                      <button key={a.id} onClick={() => setSel(a)} className={"mb-1.5 w-full rounded-lg border p-2 text-left transition-colors duration-[140ms] hover:bg-surface " + (sel?.id === a.id ? "border-pearl" : "border-ink/10")}>
                        <span className="flex items-center gap-2">
                          {a.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={a.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                          ) : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy text-[11px] font-semibold text-white">{a.name.charAt(0)}</span>}
                          <span className="min-w-0"><span className="block truncate text-[12.5px] font-semibold text-ink">{a.name}</span><span className="block text-[10.5px] text-ink/40">{new Date(a.applied_at).toLocaleDateString()}</span></span>
                        </span>
                        {a.tags.length ? <span className="mt-1 block truncate text-[10.5px] text-pearl">{a.tags.join(" · ")}</span> : null}
                        {a.interview_at && st === "interview" ? <span className="mt-1 block text-[10.5px] text-ink/50">{new Date(a.interview_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span> : null}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>

            <aside className="rounded-2xl border border-ink/10 bg-white p-4">
              {!sel ? <p className="text-[13px] text-ink/45">Select an applicant to see their application, move them, schedule an interview or leave notes.</p> : (
                <>
                  <div className="flex items-start gap-3.5">
                    {sel.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sel.avatar_url} alt="" className="h-14 w-14 rounded-full object-cover" />
                    ) : <span className="flex h-14 w-14 items-center justify-center rounded-full bg-navy text-[17px] font-semibold text-white">{sel.name.charAt(0)}</span>}
                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] font-semibold text-ink">{sel.name}</p>
                      <p className="text-[12px] text-ink/45">{sel.username ? "@" + sel.username : ""}{sel.location ? " · " + sel.location : ""}</p>
                    </div>
                    <button onClick={() => setSel(null)} className="rounded-full p-1 text-ink/40 transition-colors duration-[140ms] hover:bg-surface" aria-label="Close"><X size={15} /></button>
                  </div>
                  {sel.bio ? <p className="mt-2 text-[12.5px] text-ink/60">{sel.bio}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {sel.username ? <Link href={"/" + sel.username} className="inline-flex items-center gap-1 rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink"><ExternalLink size={12} /> Profile</Link> : null}
                    <button onClick={() => message(sel)} className="inline-flex items-center gap-1 rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink"><MessageCircle size={12} /> Message</button>
                    {sel.cv_url ? <a href={sel.cv_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink"><FileText size={12} /> {sel.cv_name || "CV"}</a> : null}
                    {sel.portfolio_url ? <a href={sel.portfolio_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink"><ExternalLink size={12} /> Portfolio</a> : null}
                    {sel.phone ? <a href={"tel:" + sel.phone} className="inline-flex items-center gap-1 rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink"><Phone size={12} /> {sel.phone}</a> : null}
                  </div>
                  {sel.cover_letter || sel.cover_note ? (
                    <div className="mt-3 rounded-lg bg-surface p-3">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink/40">Cover letter</p>
                      <p className="whitespace-pre-wrap text-[12.5px] text-ink/80">{sel.cover_letter || sel.cover_note}</p>
                    </div>
                  ) : null}

                  <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink/40">Stage</p>
                  <div className="flex flex-wrap gap-1.5">
                    {STAGES.map(st => (
                      <button key={st} disabled={busy || sel.status === st} onClick={() => setStage(sel, st)}
                        className={"rounded-full px-2.5 py-1 text-[12px] font-semibold transition-colors duration-[140ms] disabled:opacity-100 " + (sel.status === st ? "bg-ink text-white" : st === "rejected" ? "bg-red-500/10 text-red-400" : st === "hired" ? "bg-success/15 text-success" : "bg-surface text-ink/60 hover:text-ink")}>{STAGE_LABEL[st]}</button>
                    ))}
                  </div>

                  <p className="mb-1.5 mt-4 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink/40"><Calendar size={11} /> Interview</p>
                  <input type="datetime-local" value={ivAt} onChange={e => setIvAt(e.target.value)} className="w-full rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
                  <input value={ivLoc} onChange={e => setIvLoc(e.target.value)} placeholder="Location or video link" className="mt-1.5 w-full rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
                  <button onClick={() => schedule(sel)} disabled={busy || !ivAt} className="mt-1.5 rounded-md bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">{sel.interview_at ? "Update and notify" : "Schedule and notify"}</button>

                  <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink/40">Tags</p>
                  <div className="flex gap-1.5">
                    <input value={tagText} onChange={e => setTagText(e.target.value)} onBlur={() => saveTags(sel)} placeholder="strong, local, needs visa" className="w-full rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
                  </div>

                  <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink/40">Team notes</p>
                  {sel.notes.map(n => (
                    <div key={n.id} className="mb-1.5 rounded-lg bg-surface p-2">
                      <p className="text-[12.5px] text-ink/80">{n.body}</p>
                      <p className="mt-0.5 text-[10.5px] text-ink/40">{n.author || "Team"} · {new Date(n.created_at).toLocaleString()}</p>
                    </div>
                  ))}
                  <div className="flex gap-1.5">
                    <input value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addNote(sel); }} placeholder="Add a note, only your team sees it" className="w-full rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
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