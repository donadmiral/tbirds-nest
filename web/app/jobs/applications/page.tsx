"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { type JobRow, STATUS_META, APPLICATION_STATUS_ORDER } from "@/lib/jobs";
import { timeAgo } from "@/lib/feed";

type AppRow = {
  id: string; job_id: string; status: string; applied_at: string | null;
  interview_at: string | null; interview_location: string | null; job?: JobRow | null;
};
const PAGE_SIZE = 50;

export default function MyApplicationsPage() {
  const [supabase] = useState(createClient);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [filter, setFilter] = useState("all");
  const [hasMore, setHasMore] = useState(false);
  const request = useRef(0);
  const offset = useRef(0);
  const pending = useRef(false);
  const account = useRef<string | null>(null);
  const retryAppend = useRef(false);

  const load = useCallback(async (append = false) => {
    if (append && pending.current) return;
    const token = ++request.current;
    retryAppend.current = append;
    pending.current = true;
    setLoading(true); setError(null);
    try {
      const { data: sess, error: sessionError } = await supabase.auth.getSession();
      if (token !== request.current) return;
      if (sessionError) throw sessionError;
      const uid = sess.session?.user.id ?? null;
      if (uid !== account.current) {
        account.current = uid; offset.current = 0; append = false; setApps([]);
      }
      setSignedOut(!uid);
      if (!uid) { setApps([]); setHasMore(false); return; }
      const start = append ? offset.current : 0;
      let query = supabase.from("job_applications")
        .select("id, job_id, status, applied_at, interview_at, interview_location")
        .eq("applicant_id", uid)
        .order("applied_at", { ascending: false }).order("id", { ascending: false });
      if (filter !== "all") query = query.eq("status", filter);
      const { data: rows, error: appsError } = await query.range(start, start + PAGE_SIZE);
      if (appsError) throw appsError;
      const page = (rows ?? []) as AppRow[];
      const list = page.slice(0, PAGE_SIZE);
      const ids = Array.from(new Set(list.map(a => a.job_id)));
      if (ids.length > 0) {
        const { data: jobRows, error: jobsError } = await supabase.from("jobs").select("*").in("id", ids);
        if (jobsError) throw jobsError;
        const map = new Map(((jobRows ?? []) as JobRow[]).map(j => [j.id, j]));
        list.forEach(a => { a.job = map.get(a.job_id) ?? null; });
      }
      if (token !== request.current) return;
      offset.current = start + list.length;
      setHasMore(page.length > PAGE_SIZE);
      setApps(previous => append ? [...previous, ...list.filter(row => !previous.some(a => a.id === row.id))] : list);
    } catch {
      if (token === request.current) setError("Applications could not be loaded. Please try again.");
    } finally {
      if (token === request.current) { pending.current = false; setLoading(false); }
    }
  }, [supabase, filter]);

  useEffect(() => {
    let live = true;
    offset.current = 0;
    queueMicrotask(() => { if (live) void load(); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user.id ?? null;
      if (uid === account.current) return;
      request.current++; account.current = uid; offset.current = 0; pending.current = false;
      setApps([]); setHasMore(false); setError(null); setSignedOut(!uid);
      // Leave the auth callback before calling another Supabase method.
      queueMicrotask(() => { if (live) void load(); });
    });
    return () => { live = false; request.current++; pending.current = false; subscription.unsubscribe(); };
  }, [load, supabase]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-1 pb-4">
        <Link href="/jobs" className="text-sm text-ink/50 hover:text-ink">← Jobs</Link>
        <h1 className="font-display text-xl text-porcelain">My applications</h1>
        <select aria-label="Filter applications by status" value={filter} onChange={e => { request.current++; setApps([]); setHasMore(false); setFilter(e.target.value); }} className="ml-auto rounded-md border border-ink/15 bg-surface px-3 py-2 text-sm text-ink">
          <option value="all">All statuses</option>
          {APPLICATION_STATUS_ORDER.map(status => <option key={status} value={status}>{STATUS_META[status].label}</option>)}
        </select>
        <button onClick={() => { void load(); }} disabled={loading} className="text-sm text-ink/60 underline disabled:opacity-40">Refresh</button>
      </div>
      {error ? <p role="alert" className="py-3 text-sm text-danger">{error} <button disabled={loading} onClick={() => { void load(retryAppend.current); }} className="underline">Retry</button></p> : null}
      {signedOut ? <p className="py-16 text-center text-sm text-ink/50"><Link href="/login" className="underline">Sign in</Link> to see your applications.</p>
        : loading && apps.length === 0 ? <p role="status" className="py-16 text-center text-sm text-ink/40">Loading</p>
        : apps.length === 0 && !error ? <p className="py-16 text-center text-sm text-ink/40">{filter === "all" ? "Roles you apply for show up here with their status." : "No applications with this status."}</p>
        : <div className="border-t border-ink/10">
          {apps.map(a => {
            const meta = STATUS_META[a.status as keyof typeof STATUS_META] || { label: a.status, color: "#6B7280", bg: "#F3F4F6" };
            const date = a.applied_at && Number.isFinite(Date.parse(a.applied_at)) ? timeAgo(a.applied_at) : "Date unavailable";
            return (
              <Link key={a.id} href={"/jobs/" + a.job_id} className="flex items-center gap-4 border-b border-ink/10 px-1 py-4 transition-colors hover:bg-surface">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink">{a.job?.title ?? "Job no longer available"}</span>
                  {a.job ? <span className="block truncate text-[13px] text-ink/60">{[a.job.company, a.job.location].filter(Boolean).join(" · ")}</span> : null}
                  <span className="block text-[12px] text-ink/40">Applied {date}</span>
                  {a.status === "interview" && a.interview_at && Number.isFinite(Date.parse(a.interview_at)) ? <span className="mt-1 block text-[12px] text-ink/60">Interview {new Date(a.interview_at).toLocaleString()}{a.interview_location ? " · " + a.interview_location : ""}</span> : null}
                </span>
                <span className="shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold" style={{ color: meta.color, backgroundColor: meta.bg }}>{meta.label}</span>
              </Link>
            );
          })}
        </div>}
      {hasMore && !signedOut ? <button disabled={loading} onClick={() => { void load(true); }} className="my-4 rounded-md bg-surface px-4 py-2 text-sm text-ink disabled:opacity-40">{loading ? "Loading" : "Load more"}</button> : null}
    </div>
  );
}
