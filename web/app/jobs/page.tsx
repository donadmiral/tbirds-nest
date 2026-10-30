"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bookmark, Send, Plus, Search, MessageCircle, Briefcase, Building2, Clock, GraduationCap, Handshake, Rocket, Laptop, FileText, CalendarDays, ArrowRight, MapPin, X, SearchX } from "lucide-react";
import styles from "./JobsWorkspace.module.css";
import { createClient } from "@/lib/supabase/client";
import { type JobRow, type PosterLite } from "@/lib/jobs";
import { JobCard } from "@/components/JobCard";

const SCOPE_TABS = [
  { id: "all", label: "All locations" },
  { id: "primary", label: "Near me" },
  { id: "global", label: "Remote" },
] as const;

const CATEGORY_TABS = [
  { id: "all", label: "All Jobs", icon: Briefcase },
  { id: "full_time", label: "Full Time", icon: Building2 },
  { id: "part_time", label: "Part Time", icon: Clock },
  { id: "internship", label: "Internships", icon: GraduationCap },
  { id: "volunteering", label: "Volunteering", icon: Handshake },
  { id: "startup", label: "Startups", icon: Rocket },
  { id: "freelance", label: "Freelance", icon: Laptop },
  { id: "contract", label: "Contract", icon: FileText },
  { id: "temporary", label: "Temporary", icon: CalendarDays },
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
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const account = useRef<string | null>(null);

  const load = useCallback(async () => {
    const token = ++generation.current;
    setLoading(true);
    setError(null);
    try {
    const { data: sess, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (token !== generation.current) return;
    const uid = sess.session?.user.id ?? null;
    account.current = uid;
    setViewerId(uid);
    const [jobsRes, savedRes, profRes] = await Promise.all([
      supabase.from("jobs").select("*").or(`deadline.is.null,deadline.gt.${new Date().toISOString()}`).order("created_at", { ascending: false }).limit(100),
      uid ? supabase.from("job_saves").select("job_id").eq("user_id", uid) : Promise.resolve({ data: [], error: null }),
      uid ? supabase.from("profiles").select("location").eq("id", uid).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    if (jobsRes.error) throw jobsRes.error;
    if (savedRes.error) throw savedRes.error;
    if (profRes.error) throw profRes.error;
    if (token !== generation.current) return;
    const rows = (jobsRes.data ?? []) as Row[];
    const posterIds = Array.from(new Set(rows.map((j) => j.posted_by).filter(Boolean)));
    if (posterIds.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", posterIds);
      const map = new Map((profiles ?? []).map((p) => [p.id, p as PosterLite]));
      rows.forEach((j) => (j.profile = map.get(j.posted_by) ?? null));
    }
    if (token !== generation.current) return;
    setJobs(rows);
    setSavedIds(new Set(((savedRes.data ?? []) as { job_id: string }[]).map((r) => r.job_id)));
    setMyCity(String((profRes.data as { location?: string } | null)?.location || "").trim().split(",")[0].trim());
    } catch {
      if (token === generation.current) setError("Jobs could not be loaded. Check your connection and try again.");
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (next !== account.current) {
        account.current = next;
        generation.current += 1;
        setJobs([]); setSavedIds(new Set()); setMyCity(""); setViewerId(next);
        void load();
      }
    });
    return () => { ++generation.current; listener.subscription.unsubscribe(); };
  }, [load, supabase]);

  const shown = useMemo(() => {
    let out = jobs;
    if (scope === "global") out = out.filter((j) => j.remote_type === "remote");
    if (scope === "primary") out = myCity.length >= 3 ? out.filter((j) => (j.location || "").toLowerCase().includes(myCity.toLowerCase())) : [];
    if (category !== "all") out = out.filter((j) => j.category === category);
    const term = search.trim().toLowerCase();
    if (term) out = out.filter((j) => (j.title + " " + j.company + " " + (j.description || "")).toLowerCase().includes(term));
    const sorted = [...out];
    if (sort === "popular") sorted.sort((a, b) => (b.applications_count || 0) - (a.applications_count || 0));
    if (sort === "salary") sorted.sort((a, b) => salaryNum(b.salary_range) - salaryNum(a.salary_range));
    if (sort === "urgent") sorted.sort((a, b) => Number(b.urgent) - Number(a.urgent));
    return sorted;
  }, [jobs, scope, category, search, sort, myCity]);

  const filtersActive = scope !== "all" || category !== "all" || !!search.trim() || sort !== "recent";
  const clearFilters = () => { setScope("all"); setCategory("all"); setSearch(""); setSort("recent"); };

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <div><h1>Jobs</h1><p>Find your next role, keep track of applications, and connect with employers.</p></div>
        <div className={styles.actions}>
          <Link href="/jobs/messages" className={styles.button}><MessageCircle size={17} aria-hidden /> Messages</Link>
          <Link href="/jobs/new" className={styles.primary}><Plus size={17} aria-hidden /> Post a job</Link>
        </div>
      </header>
      <nav className={styles.tabs} aria-label="Jobs navigation">
        <Link href="/jobs" aria-current="page">Discover</Link>
        <Link href="/jobs/saved"><Bookmark size={16} aria-hidden /> Saved jobs</Link>
        <Link href="/jobs/applications"><Send size={16} aria-hidden /> My applications</Link>
      </nav>
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Search size={18} aria-hidden />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search jobs, skills or companies" aria-label="Search jobs" />
          {search ? <button type="button" className={styles.iconButton} aria-label="Clear job search" onClick={() => setSearch("")}><X size={16} aria-hidden /></button> : null}
        </div>
        <select aria-label="Job location" value={scope} onChange={e => setScope(e.target.value as typeof scope)}>{SCOPE_TABS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
        <select aria-label="Sort jobs" value={sort} onChange={e => setSort(e.target.value as typeof sort)}>{SORT_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
      </div>
      <div className={styles.categories} role="group" aria-label="Job type">
        {CATEGORY_TABS.map(({id, label, icon: Icon}) => <button type="button" key={id} aria-pressed={category === id} onClick={() => setCategory(id)}><Icon size={16} strokeWidth={1.7} aria-hidden />{label}</button>)}
      </div>
      <div className={styles.layout}>
        <section aria-label="Available jobs">
          <div className={styles.results}><span role="status">{loading ? "Finding roles…" : !error ? shown.length + (shown.length === 1 ? " role shown" : " roles shown") : "Jobs unavailable"}</span>{filtersActive ? <button type="button" onClick={clearFilters}>Clear filters</button> : null}</div>
          {loading ? <div className={styles.state} role="status"><Briefcase size={28} aria-hidden /><p>Loading jobs…</p></div>
            : error ? <div className={styles.state} role="alert"><SearchX size={28} aria-hidden /><h2>We couldn’t load jobs</h2><p>{error}</p><button onClick={() => void load()} className={styles.primary}>Try again</button></div>
            : scope === "primary" && myCity.length < 3 ? <div className={styles.state}><MapPin size={28} aria-hidden /><h2>Find work near you</h2><p>Add your city to your profile to find roles nearby.</p><div className={styles.actions}><Link href="/settings/profile" className={styles.primary}>Add your city</Link><button onClick={() => setScope("all")} className={styles.button}>Browse all jobs</button></div></div>
            : shown.length === 0 ? <div className={styles.state}><SearchX size={28} aria-hidden /><h2>No matching roles</h2><p>Try another search or clear your filters to see more opportunities.</p><button onClick={clearFilters} className={styles.button}>Clear filters</button></div>
            : <div className={styles.list}>{shown.map(job => <JobCard key={(viewerId ?? "guest") + job.id} job={job} initiallySaved={savedIds.has(job.id)} viewerId={viewerId} onSavedChange={on => setSavedIds(previous => { const next = new Set(previous); if (on) next.add(job.id); else next.delete(job.id); return next; })} />)}</div>}
        </section>
        <aside className={styles.career} aria-label="Your job search">
          <section className={styles.panel}><h2>Your next opportunity</h2><p>Keep your search together, from the first saved role to your next conversation.</p>
            <Link className={styles.careerLink} href="/jobs/applications"><Send size={20} aria-hidden /><span><strong>My applications</strong><small>Updates and interview details</small></span><ArrowRight size={16} aria-hidden /></Link>
            <Link className={styles.careerLink} href="/jobs/saved"><Bookmark size={20} aria-hidden /><span><strong>Saved jobs</strong><small>Revisit the roles that interest you</small></span><ArrowRight size={16} aria-hidden /></Link>
            <Link className={styles.careerLink} href="/settings/profile"><FileText size={20} aria-hidden /><span><strong>Your profile</strong><small>Help employers get to know you</small></span><ArrowRight size={16} aria-hidden /></Link>
          </section>
          <section className={styles.panel}><h2>Find your next teammate</h2><p>Publish a role and review applications from its job page.</p><Link className={styles.button} href="/jobs/new"><Plus size={16} aria-hidden />Post a job</Link></section>
        </aside>
      </div>
    </div>
  );
}
