"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bookmark, Send, Plus, Search, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { type JobRow, type PosterLite } from "@/lib/jobs";
import { JobCard } from "@/components/JobCard";

const SCOPE_TABS = [
  { id: "all", label: "All Zimbabwe" },
  { id: "primary", label: "Near me" },
  { id: "global", label: "Remote" },
] as const;

const CATEGORY_TABS = [
  { id: "all", label: "All Jobs", emoji: "💼" },
  { id: "full_time", label: "Full Time", emoji: "🏢" },
  { id: "part_time", label: "Part Time", emoji: "⏰" },
  { id: "internship", label: "Internships", emoji: "🎓" },
  { id: "volunteering", label: "Volunteering", emoji: "🤝" },
  { id: "startup", label: "Startups", emoji: "🚀" },
  { id: "freelance", label: "Freelance", emoji: "💻" },
  { id: "contract", label: "Contract", emoji: "📄" },
  { id: "temporary", label: "Temporary", emoji: "🗓️" },
] as const;

const SORT_OPTIONS = [
  { id: "recent", label: "Most Recent" },
  { id: "popular", label: "Most Applied" },
  { id: "salary", label: "Highest Pay" },
  { id: "urgent", label: "Urgent Hiring" },
] as const;

type Row = JobRow & { profile?: PosterLite | null };

function salaryNum(s: string | null): number {
  if (!s) return 0;
  const m = s.replace(/,/g, "").match(/\d+/g);
  return m ? Math.max(...m.map(Number)) : 0;
}

export default function JobsPage() {
  const supabase = useRef(createClient()).current;
  const [jobs, setJobs] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [myCity, setMyCity] = useState("");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<(typeof SCOPE_TABS)[number]["id"]>("all");
  const [category, setCategory] = useState<string>("all");
  const [sort, setSort] = useState<(typeof SORT_OPTIONS)[number]["id"]>("recent");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id ?? null;
    setViewerId(uid);
    const [jobsRes, savedRes, profRes] = await Promise.all([
      supabase.from("jobs").select("*").order("created_at", { ascending: false }).limit(100),
      uid ? supabase.from("job_saves").select("job_id").eq("user_id", uid) : Promise.resolve({ data: [] }),
      uid ? supabase.from("profiles").select("location").eq("id", uid).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const rows = (jobsRes.data ?? []) as Row[];
    const posterIds = Array.from(new Set(rows.map((j) => j.posted_by).filter(Boolean)));
    if (posterIds.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", posterIds);
      const map = new Map((profiles ?? []).map((p) => [p.id, p as PosterLite]));
      rows.forEach((j) => (j.profile = map.get(j.posted_by) ?? null));
    }
    setJobs(rows);
    setSavedIds(new Set(((savedRes.data ?? []) as { job_id: string }[]).map((r) => r.job_id)));
    setMyCity(String((profRes.data as { location?: string } | null)?.location || "").trim().split(",")[0].trim());
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    let out = jobs;
    if (scope === "global") out = out.filter((j) => j.remote_type === "remote");
    if (scope === "primary" && myCity.length >= 3) out = out.filter((j) => (j.location || "").toLowerCase().includes(myCity.toLowerCase()));
    if (category !== "all") out = out.filter((j) => j.category === category);
    const term = search.trim().toLowerCase();
    if (term) out = out.filter((j) => (j.title + " " + j.company + " " + (j.description || "")).toLowerCase().includes(term));
    const sorted = [...out];
    if (sort === "popular") sorted.sort((a, b) => (b.applications_count || 0) - (a.applications_count || 0));
    if (sort === "salary") sorted.sort((a, b) => salaryNum(b.salary_range) - salaryNum(a.salary_range));
    if (sort === "urgent") sorted.sort((a, b) => Number(b.urgent) - Number(a.urgent));
    return sorted;
  }, [jobs, scope, category, search, sort, myCity]);

  return (
    <div>
      <div className="flex items-center justify-between px-1 pb-3">
        <h1 className="font-display text-2xl text-porcelain">Jobs</h1>
        <div className="flex items-center gap-1">
          <Link href="/jobs/messages" title="Job messages" className="rounded-md p-2 text-white/60 transition-colors hover:bg-surface hover:text-white"><MessageCircle size={19} /></Link>
          <Link href="/jobs/applications" title="My applications" className="rounded-md p-2 text-white/60 transition-colors hover:bg-surface hover:text-white"><Send size={19} /></Link>
          <Link href="/jobs/saved" title="Saved jobs" className="rounded-md p-2 text-white/60 transition-colors hover:bg-surface hover:text-white"><Bookmark size={19} /></Link>
          <Link href="/jobs/new" className="ml-1 flex items-center gap-1.5 rounded-md bg-pearl px-3 py-2 text-[13px] font-semibold text-ink transition-opacity hover:opacity-90"><Plus size={16} /> Post a job</Link>
        </div>
      </div>

      <div className="relative px-1">
        <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
        <input value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search jobs by title, keyword, or company"
          className="w-full rounded-md bg-surface py-3 pl-10 pr-4 text-[14px] text-white placeholder:text-white/30 outline-none focus:bg-surface-elevated"
        />
      </div>

      <div className="mt-3 flex gap-2 px-1">
        {SCOPE_TABS.map((t) => (
          <button key={t.id}
            onClick={() => setScope(t.id)}
            className={"rounded-md px-3 py-1.5 text-[13px] transition-colors " + (scope === t.id ? "bg-pearl font-semibold text-ink" : "bg-surface text-white/70 hover:text-white")}
          >
            {t.label}
          </button>
        ))}
        <select value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="ml-auto rounded-md bg-surface px-2 py-1.5 text-[13px] text-white/80 outline-none"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.id} value={o.id} className="bg-navy">{o.label}</option>
          ))}
        </select>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto px-1 pb-2">
        {CATEGORY_TABS.map((t) => (
          <button key={t.id}
            onClick={() => setCategory(t.id)}
            className={"shrink-0 rounded-md px-3 py-1.5 text-[13px] transition-colors " + (category === t.id ? "bg-surface-elevated font-semibold text-white" : "bg-surface text-white/60 hover:text-white")}
          >
            {t.emoji} {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="py-16 text-center text-sm text-white/40">Loading jobs</p>
      ) : shown.length === 0 ? (
        <p className="py-16 text-center text-sm text-white/40">No jobs match. Try clearing the filters.</p>
      ) : (
        <div className="border-t border-white/10">
          {shown.map((j) => (
            <JobCard key={j.id} job={j} initiallySaved={savedIds.has(j.id)} viewerId={viewerId} />
          ))}
        </div>
      )}
    </div>
  );
}