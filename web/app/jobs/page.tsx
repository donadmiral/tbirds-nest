"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Bookmark, Send, Plus, Search, MessageCircle, Briefcase, Building2, Clock, GraduationCap, Handshake, Rocket, Laptop, FileText, CalendarDays, ArrowRight, MapPin, X, SearchX } from "lucide-react";
import styles from "./JobsWorkspace.module.css";
import { createClient } from "@/lib/supabase/client";
import { type JobRow, isJobDeadlinePassed } from "@/lib/jobs";
import { JobCard } from "@/components/JobCard";
import { getNavigationStore } from "@/lib/navigationCache";
import { JOBS_NAVIGATION_KEY, JOB_SAVE_CHANGED, type JobsNavigationMemory, type JobSaveChange } from "@/lib/jobsNavigation";
import { withTimeout } from "@/lib/withTimeout";

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

function salaryNum(s: string | null): number {
  if (!s) return 0;
  const m = s.replace(/,/g, "").match(/\d+/g);
  return m ? Math.max(...m.map(Number)) : 0;
}

export default function JobsPage() {
  const [navigationStore] = useState(getNavigationStore);
  const session = useSyncExternalStore(navigationStore.subscribe, navigationStore.getSnapshot, navigationStore.getServerSnapshot);
  return <JobsWorkspace key={session.revision} navigationStore={navigationStore} session={session} />;
}

function JobsWorkspace({ navigationStore, session }: { navigationStore: ReturnType<typeof getNavigationStore>; session: ReturnType<ReturnType<typeof getNavigationStore>['getSnapshot']> }) {
  const [supabase] = useState(createClient);
  const [initial] = useState(() => navigationStore.cache.read<JobsNavigationMemory>(session.scope, JOBS_NAVIGATION_KEY));
  const [jobs, setJobs] = useState<JobRow[]>(() => (initial?.jobs ?? []).filter(job => !isJobDeadlinePassed(job.deadline)));
  const [loaded, setLoaded] = useState(initial?.loaded ?? false);
  const [loading, setLoading] = useState(!initial?.loaded);
  const [viewerId, setViewerId] = useState<string | null>(session.owner);
  const [myCity, setMyCity] = useState(initial?.myCity ?? "");
  const [savedIds, setSavedIds] = useState(() => new Set(initial?.savedIds ?? []));
  const [scope, setScope] = useState<(typeof SCOPE_TABS)[number]["id"]>(initial?.scope ?? "all");
  const [category, setCategory] = useState(initial?.category ?? "all");
  const [sort, setSort] = useState<(typeof SORT_OPTIONS)[number]["id"]>(initial?.sort ?? "recent");
  const [search, setSearch] = useState(initial?.search ?? "");
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const saveRevision = useRef(0);
  const savedChanges = useRef(new Map<string, { revision: number; saved: boolean }>());
  const lastScroll = useRef(initial?.scrollTop ?? 0);

  const load = useCallback(() => {
    if (pending.current) return pending.current;
    const token = generation.current += 1;
    const controller = request.current = new AbortController();
    const savedAtStart = saveRevision.current;
    const current = () => token === generation.current && !controller.signal.aborted && navigationStore.getSnapshot().revision === session.revision;
    setLoading(true);
    setError(null);
    const work = (async () => {
    try {
    const { data: sess, error: sessionError } = await withTimeout(supabase.auth.getSession());
    if (sessionError) throw sessionError;
    if (!current()) return;
    const uid = sess.session?.user.id ?? null;
    if (session.initialized && uid !== session.owner) throw new Error('The account changed.');
    setViewerId(uid);
    const jobsQuery = supabase.from("jobs").select("*").or(`deadline.is.null,deadline.gt.${new Date().toISOString()}`).order("created_at", { ascending: false }).limit(100).abortSignal(controller.signal);
    const savedQuery = uid ? supabase.from("job_saves").select("job_id").eq("user_id", uid).abortSignal(controller.signal) : null;
    const profileQuery = uid ? supabase.from("profiles").select("location").eq("id", uid).abortSignal(controller.signal).maybeSingle() : null;
    if (sess.session?.access_token) {
      const authorization = `Bearer ${sess.session.access_token}`;
      jobsQuery.setHeader('Authorization', authorization); savedQuery?.setHeader('Authorization', authorization); profileQuery?.setHeader('Authorization', authorization);
    }
    const [jobsRes, savedRes, profRes] = await withTimeout(Promise.all([
      jobsQuery, savedQuery ?? Promise.resolve({ data: [], error: null }), profileQuery ?? Promise.resolve({ data: null, error: null }),
    ]));
    if (jobsRes.error) throw jobsRes.error;
    if (savedRes.error) throw savedRes.error;
    if (profRes.error) throw profRes.error;
    if (!current()) return;
    setJobs((jobsRes.data ?? []) as JobRow[]);
    const saved = new Set(((savedRes.data ?? []) as { job_id: string }[]).map((r) => r.job_id));
    for (const [id, change] of savedChanges.current) {
      if (change.revision > savedAtStart) { if (change.saved) saved.add(id); else saved.delete(id); }
      else savedChanges.current.delete(id);
    }
    setSavedIds(saved);
    setMyCity(String((profRes.data as { location?: string } | null)?.location || "").trim().split(",")[0].trim());
    setLoaded(true);
    } catch {
      if (current()) setError("Jobs could not be loaded. Check your connection and try again.");
      controller.abort();
    } finally {
      if (token === generation.current && navigationStore.getSnapshot().revision === session.revision) setLoading(false);
    }
    })();
    pending.current = work;
    void work.finally(() => { if (pending.current === work) pending.current = null; if (request.current === controller) request.current = null; });
    return work;
  }, [supabase, navigationStore, session.revision, session.initialized, session.owner]);

  useEffect(() => {
    void load();
    const refresh = () => { if (!document.hidden) void load(); };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { generation.current += 1; request.current?.abort(); pending.current = null; window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [load]);

  useLayoutEffect(() => {
    if (initial?.loaded) window.scrollTo({ top: initial.scrollTop, behavior: 'instant' });
    const remember = () => { if (window.location.pathname === '/jobs') lastScroll.current = window.scrollY; };
    window.addEventListener('scroll', remember, { passive: true });
    return () => window.removeEventListener('scroll', remember);
  }, [initial]);
  useLayoutEffect(() => {
    navigationStore.cache.save<JobsNavigationMemory>(session.scope, JOBS_NAVIGATION_KEY, { jobs, loaded, savedIds: [...savedIds], myCity, scope, category, sort, search, scrollTop: lastScroll.current });
    return () => {
      // A confirmed card save may update the cache just before unmount. Only
      // update scroll here, rather than writing an older closure over that save.
      const memory = navigationStore.cache.read<JobsNavigationMemory>(session.scope, JOBS_NAVIGATION_KEY);
      if (memory) navigationStore.cache.save(session.scope, JOBS_NAVIGATION_KEY, { ...memory, scrollTop: lastScroll.current });
    };
  }, [navigationStore, session.scope, jobs, loaded, savedIds, myCity, scope, category, sort, search]);
  const savedChanged = useCallback((jobId: string, saved: boolean) => {
    savedChanges.current.set(jobId, { revision: ++saveRevision.current, saved });
    setSavedIds(previous => { if (previous.has(jobId) === saved) return previous; const next = new Set(previous); if (saved) next.add(jobId); else next.delete(jobId); return next; });
  }, []);
  useEffect(() => {
    const confirmed = (event: Event) => {
      const change = (event as CustomEvent<JobSaveChange>).detail;
      if (change?.ownerId === session.owner && change.scope === session.scope && navigationStore.getSnapshot().revision === session.revision) savedChanged(change.jobId, change.saved);
    };
    window.addEventListener(JOB_SAVE_CHANGED, confirmed);
    return () => window.removeEventListener(JOB_SAVE_CHANGED, confirmed);
  }, [navigationStore, session.owner, session.scope, session.revision, savedChanged]);

  const shown = useMemo(() => {
    let out = jobs.filter(job => !isJobDeadlinePassed(job.deadline));
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
          <div className={styles.results}><span role="status">{loading && !loaded ? "Finding roles…" : loaded || !error ? shown.length + (shown.length === 1 ? " role shown" : " roles shown") : "Jobs unavailable"}</span>{filtersActive ? <button type="button" onClick={clearFilters}>Clear filters</button> : null}</div>
          {error && loaded ? <div role="alert" className={styles.status}><p>{error}</p><button onClick={() => void load()} className={styles.button}>Try again</button></div> : null}
          {loading && !loaded ? <div className={styles.state} role="status"><Briefcase size={28} aria-hidden /><p>Loading jobs…</p></div>
            : error && !loaded ? <div className={styles.state} role="alert"><SearchX size={28} aria-hidden /><h2>We couldn’t load jobs</h2><p>{error}</p><button onClick={() => void load()} className={styles.primary}>Try again</button></div>
            : scope === "primary" && myCity.length < 3 ? <div className={styles.state}><MapPin size={28} aria-hidden /><h2>Find work near you</h2><p>Add your city to your profile to find roles nearby.</p><div className={styles.actions}><Link href="/settings/profile" className={styles.primary}>Add your city</Link><button onClick={() => setScope("all")} className={styles.button}>Browse all jobs</button></div></div>
            : shown.length === 0 ? <div className={styles.state}><SearchX size={28} aria-hidden /><h2>No matching roles</h2><p>Try another search or clear your filters to see more opportunities.</p><button onClick={clearFilters} className={styles.button}>Clear filters</button></div>
            : <div className={styles.list}>{shown.map(job => <JobCard key={(viewerId ?? "guest") + job.id} job={job} initiallySaved={savedIds.has(job.id)} viewerId={viewerId} onSavedChange={saved => savedChanged(job.id, saved)} />)}</div>}
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
