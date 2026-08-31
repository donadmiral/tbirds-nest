"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FileText, Phone, Link2, CalendarClock, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/feed";

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  applied:     { label: "Applied",     color: "#2563EB", bg: "#EFF6FF" },
  viewed:      { label: "Viewed",      color: "#7C3AED", bg: "#F5F3FF" },
  shortlisted: { label: "Shortlisted", color: "#059669", bg: "#ECFDF5" },
  interview:   { label: "Interview",   color: "#D97706", bg: "#FFFBEB" },
  accepted:    { label: "Accepted",    color: "#059669", bg: "#ECFDF5" },
  rejected:    { label: "Rejected",    color: "#DC2626", bg: "#FEF2F2" },
};
const STATUS_ORDER = ["applied", "viewed", "shortlisted", "interview", "accepted", "rejected"];

type AppRow = {
  id: string; job_id: string; applicant_id: string; status: string;
  cover_note: string | null; cv_url: string | null; cv_name: string | null;
  applicant_phone: string | null; portfolio_url: string | null;
  interview_at: string | null; interview_location: string | null;
  created_at?: string | null;
  profile?: { id: string; full_name: string | null; username: string | null; avatar_url: string | null } | null;
};

export default function ApplicantsPage() {
  const { id: jobId } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = useRef(createClient()).current;
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [jobTitle, setJobTitle] = useState("");
  const [apps, setApps] = useState<AppRow[]>([]);
  const [filter, setFilter] = useState("all");
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [when, setWhen] = useState("");
  const [where, setWhere] = useState("");

  const load = useCallback(async () => {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id ?? null;
    const { data: job } = await supabase.from("jobs").select("id, title, posted_by").eq("id", jobId).maybeSingle();
    if (!job || !uid || job.posted_by !== uid) { setAllowed(false); return; }
    setJobTitle(job.title);
    setAllowed(true);
    const { data: rows } = await supabase
      .from("job_applications")
      .select("id, job_id, applicant_id, status, cover_note, cv_url, cv_name, applicant_phone, portfolio_url, interview_at, interview_location, created_at")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false });
    const list = (rows ?? []) as AppRow[];
    const ids = Array.from(new Set(list.map((a) => a.applicant_id)));
    if (ids.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", ids);
      const map = new Map((profiles ?? []).map((p) => [p.id, p]));
      list.forEach((a) => (a.profile = map.get(a.applicant_id) ?? null));
    }
    setApps(list);
    const fresh = list.filter((a) => a.status === "applied").map((a) => a.id);
    if (fresh.length > 0) {
      await supabase.from("job_applications").update({ status: "viewed" }).in("id", fresh);
      setApps((l) => l.map((a) => (fresh.includes(a.id) ? { ...a, status: "viewed" } : a)));
    }
  }, [supabase, jobId]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: apps.length };
    STATUS_ORDER.forEach((s) => (c[s] = apps.filter((a) => a.status === s).length));
    return c;
  }, [apps]);

  const shown = useMemo(() => (filter === "all" ? apps : apps.filter((a) => a.status === filter)), [apps, filter]);

  async function setStatus(app: AppRow, status: string, extra?: { interview_at?: string; interview_location?: string | null }) {
    const prev = { status: app.status, interview_at: app.interview_at, interview_location: app.interview_location };
    setApps((l) => l.map((x) => (x.id === app.id ? { ...x, status, ...(extra ?? {}) } : x)));
    const { error } = await supabase.from("job_applications").update({ status, ...(extra ?? {}) }).eq("id", app.id);
    if (error) {
      setApps((l) => l.map((x) => (x.id === app.id ? { ...x, ...prev } : x)));
      alert("Could not update: " + error.message);
    }
  }

  if (allowed === false) {
    return (
      <div className="px-1 py-16 text-center">
        <p className="text-[15px] text-ink/70">Only the poster of this job can view its applicants.</p>
        <Link href="/jobs" className="mt-3 inline-block rounded-md bg-pearl px-5 py-2.5 text-sm font-semibold text-ink">Back to jobs</Link>
      </div>
    );
  }

  return (
    <div className="px-1">
      <Link href={"/jobs/" + jobId} className="mb-4 inline-block text-sm text-ink/50 hover:text-ink">← {jobTitle || "Job"}</Link>
      <h1 className="font-display text-xl text-porcelain">Applicants</h1>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
        {["all", ...STATUS_ORDER].map((s) => (
          <button key={s}
            onClick={() => setFilter(s)}
            className={"shrink-0 rounded-md px-3 py-1.5 text-[13px] transition-colors " + (filter === s ? "bg-surface-elevated font-semibold text-ink" : "bg-surface text-ink/60 hover:text-ink")}
          >
            {s === "all" ? "All" : STATUS_META[s].label} {counts[s] ? "(" + counts[s] + ")" : ""}
          </button>
        ))}
      </div>

      {allowed === null ? (
        <p className="py-16 text-center text-sm text-ink/40">Loading</p>
      ) : shown.length === 0 ? (
        <p className="py-16 text-center text-sm text-ink/40">{filter === "all" ? "Applications will appear here as they come in." : "Move applicants here from their status menu."}</p>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          {shown.map((a) => {
            const meta = STATUS_META[a.status] || STATUS_META.applied;
            return (
              <div key={a.id} className="rounded-lg border border-ink/10 p-4">
                <div className="flex items-center gap-3">
                  <Link href={a.profile?.username ? "/" + a.profile.username : "#"} className="shrink-0">
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
                    <Link href={a.profile?.username ? "/" + a.profile.username : "#"} className="block truncate text-[15px] font-semibold text-ink hover:underline">
                      {a.profile?.full_name ?? "Member"}
                    </Link>
                    <p className="text-[12px] text-ink/40">@{a.profile?.username} · {timeAgo(a.created_at || new Date().toISOString())}</p>
                  </div>
                  <select value={a.status}
                    onChange={(e) => {
                      if (e.target.value === "interview") { setScheduling(a.id); setWhen(""); setWhere(""); }
                      else setStatus(a, e.target.value);
                    }}
                    className="shrink-0 rounded-full border-0 px-3 py-1 text-[12px] font-semibold outline-none"
                    style={{ color: meta.color, backgroundColor: meta.bg }}
                  >
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s} className="bg-white text-black">{STATUS_META[s].label}</option>
                    ))}
                  </select>
                </div>

                {a.cover_note ? <p className="mt-3 whitespace-pre-wrap text-[14px] text-ink/80">{a.cover_note}</p> : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={async () => { const { data } = await supabase.rpc("start_dm_ctx", { p_receiver_id: a.applicant_id, p_context: "jobs", p_ref_id: jobId }); if (data) router.push("/jobs/messages?c=" + data); }} className="flex items-center gap-1.5 rounded-md bg-pearl/15 px-3 py-1.5 text-[13px] font-semibold text-pearl hover:bg-pearl/25">
                    <MessageCircle size={14} /> Message
                  </button>
                  {a.cv_url ? (
                    <a href={a.cv_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-md bg-surface px-3 py-1.5 text-[13px] text-ink/80 hover:bg-surface-elevated">
                      <FileText size={14} /> {a.cv_name || "CV"}
                    </a>
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
                    <input value={where} onChange={(e) => setWhere(e.target.value)} placeholder="Location or link" className="rounded-md bg-surface-elevated px-3 py-2 text-[13px] text-ink placeholder:text-ink/30 outline-none" />
                    <div className="flex gap-2">
                      <button onClick={() => {
                          if (!when) return;
                          setStatus(a, "interview", { interview_at: new Date(when).toISOString(), interview_location: where.trim() || null });
                          setScheduling(null);
                        }}
                        className="rounded-md bg-pearl px-4 py-2 text-[13px] font-semibold text-ink"
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