"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { type JobRow, STATUS_META, APPLICATION_STATUS_ORDER } from "@/lib/jobs";
import { RelativeTime } from "@/components/RelativeTime";
import { type ApplicantCursor, canWithdrawApplication, loadMyApplicationPage, mergeApplicants, withdrawApplication } from "../../../../shared/hiring";

type AppRow = {
  id: string; job_id: string; status: string; applied_at: string | null; updated_at: string | null;
  interview_at: string | null; interview_location: string | null; job?: JobRow | null;
};

export default function MyApplicationsPage() {
  const [supabase] = useState(createClient);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [filter, setFilter] = useState("all");
  const [hasMore, setHasMore] = useState(false);
  const [confirmWithdrawal, setConfirmWithdrawal] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const request = useRef(0);
  const cursor = useRef<ApplicantCursor | null>(null);
  const pending = useRef(false);
  const account = useRef<string | null>(null);
  const retryAppend = useRef(false);
  const withdrawalPending = useRef(false);
  const live = useRef(true);

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
        account.current = uid; cursor.current = null; append = false; setApps([]);
      }
      setSignedOut(!uid);
      if (!uid) { setApps([]); setHasMore(false); return; }
      const page = await loadMyApplicationPage<AppRow>(supabase, append ? cursor.current : null, filter);
      if (token !== request.current) return;
      cursor.current = page.cursor;
      setHasMore(page.has_more);
      setApps(previous => append ? mergeApplicants(previous, page.applications) : page.applications);
    } catch {
      if (token === request.current) setError("Applications could not be loaded. Please try again.");
    } finally {
      if (token === request.current) { pending.current = false; setLoading(false); }
    }
  }, [supabase, filter]);

  const withdraw = async (application: AppRow) => {
    const owner = account.current;
    if (!owner || withdrawalPending.current) return;
    withdrawalPending.current = true; setWithdrawing(application.id); setWithdrawError(null);
    try {
      const saved = await withdrawApplication(supabase, application);
      if (!live.current || account.current !== owner) return;
      request.current++; pending.current = false; setLoading(false);
      setApps(previous => previous.map(row => row.id === saved.id ? saved : row)
        .filter(row => filter === 'all' || row.status === filter));
      setConfirmWithdrawal(null);
    } catch (error) {
      if (live.current && account.current === owner) setWithdrawError(error instanceof Error ? error.message : 'Refresh and try again.');
    } finally {
      withdrawalPending.current = false;
      if (live.current && account.current === owner) setWithdrawing(null);
    }
  };

  useEffect(() => {
    let active = true;
    live.current = true; cursor.current = null;
    setConfirmWithdrawal(null); setWithdrawError(null);
    queueMicrotask(() => { if (active) void load(); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user.id ?? null;
      if (uid === account.current) return;
      request.current++; account.current = uid; cursor.current = null; pending.current = false;
      setApps([]); setHasMore(false); setError(null); setSignedOut(!uid);
      setConfirmWithdrawal(null); setWithdrawError(null); setWithdrawing(null);
      // Leave the auth callback before calling another Supabase method.
      queueMicrotask(() => { if (active) void load(); });
    });
    return () => { active = false; live.current = false; request.current++; pending.current = false; subscription.unsubscribe(); };
  }, [load, supabase]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-1 pb-4">
        <Link href="/jobs" className="text-sm text-muted hover:text-ink">← Jobs</Link>
        <h1 className="font-display text-xl text-porcelain">My applications</h1>
        <select disabled={withdrawing !== null} aria-label="Filter applications by status" value={filter} onChange={e => { request.current++; setApps([]); setHasMore(false); setFilter(e.target.value); }} className="ml-auto rounded-md border border-ink/15 bg-surface px-3 py-2 text-sm text-ink">
          <option value="all">All statuses</option>
          {APPLICATION_STATUS_ORDER.map(status => <option key={status} value={status}>{STATUS_META[status].label}</option>)}
        </select>
        <button onClick={() => { void load(); }} disabled={loading} className="text-sm text-ink/60 underline disabled:opacity-40">Refresh</button>
      </div>
      {error ? <p role="alert" className="py-3 text-sm text-danger">{error} <button disabled={loading} onClick={() => { void load(retryAppend.current); }} className="underline">Retry</button></p> : null}
      {withdrawError ? <p role="alert" className="py-3 text-sm text-danger">{withdrawError}</p> : null}
      {signedOut ? <p className="py-16 text-center text-sm text-muted"><Link href="/login" className="underline">Sign in</Link> to see your applications.</p>
        : loading && apps.length === 0 ? <p role="status" className="py-16 text-center text-sm text-muted">Loading</p>
        : apps.length === 0 && !error ? <p className="py-16 text-center text-sm text-muted">{filter === "all" ? "Roles you apply for show up here with their status." : "No applications with this status."}</p>
        : <div className="border-t border-ink/10">
          {apps.map(a => {
            const meta = STATUS_META[a.status as keyof typeof STATUS_META] || { label: a.status, color: "#6B7280", bg: "#F3F4F6" };
            const date = a.applied_at && Number.isFinite(Date.parse(a.applied_at)) ? <RelativeTime dateTime={a.applied_at} /> : "Date unavailable";
            return (
              <div key={a.id} className="border-b border-ink/10 px-1 py-4">
                <div className="flex items-center gap-4">
                <Link href={"/jobs/" + a.job_id} className="min-w-0 flex-1 transition-colors hover:bg-surface">
                  <span className="block truncate text-[15px] font-semibold text-ink">{a.job?.title ?? "Job no longer available"}</span>
                  {a.job ? <span className="block truncate text-[13px] text-ink/60">{[a.job.company, a.job.location].filter(Boolean).join(" · ")}</span> : null}
                  <span className="block text-[12px] text-muted">Applied {date}</span>
                  {a.status === "interview" && a.interview_at && Number.isFinite(Date.parse(a.interview_at)) ? <span className="mt-1 block text-[12px] text-ink/60">Interview {new Date(a.interview_at).toLocaleString()}{a.interview_location ? " · " + a.interview_location : ""}</span> : null}
                </Link>
                <span className="shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold" style={{ color: meta.color, backgroundColor: meta.bg }}>{meta.label}</span>
                </div>
                {canWithdrawApplication(a.status) ? <div className="mt-2 text-right text-sm text-muted">
                  {confirmWithdrawal === a.id ? <div className="rounded-lg border border-ink/10 p-3 text-left">
                    <p>Withdraw this application? The employer will be notified. Your history stays available, but this application cannot be reopened.</p>
                    <div className="mt-2 flex flex-wrap gap-4">
                      <button disabled={withdrawing !== null} onClick={() => void withdraw(a)} className="min-h-11 text-danger underline disabled:opacity-40">{withdrawing === a.id ? 'Withdrawing…' : 'Confirm withdrawal'}</button>
                      <button disabled={withdrawing !== null} onClick={() => setConfirmWithdrawal(null)} className="min-h-11 underline disabled:opacity-40">Keep application</button>
                    </div>
                  </div> : <button disabled={withdrawing !== null} onClick={() => { setConfirmWithdrawal(a.id); setWithdrawError(null); }} className="min-h-11 underline disabled:opacity-40">Withdraw application</button>}
                </div> : null}
              </div>
            );
          })}
        </div>}
      {hasMore && !signedOut ? <button disabled={loading} onClick={() => { void load(true); }} className="my-4 rounded-md bg-surface px-4 py-2 text-sm text-ink disabled:opacity-40">{loading ? "Loading" : "Load more"}</button> : null}
    </div>
  );
}
