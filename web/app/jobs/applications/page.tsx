"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { type JobRow, STATUS_META } from "@/lib/jobs";
import { timeAgo } from "@/lib/feed";

type AppRow = { id: string; job_id: string; status: string; applied_at?: string | null; created_at?: string | null; job?: JobRow | null };

export default function MyApplicationsPage() {
  const [supabase] = useState(createClient);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id ?? null;
      if (!uid) { setLoading(false); return; }
      const { data: rows } = await supabase
        .from("job_applications")
        .select("id, job_id, status, applied_at")
        .eq("applicant_id", uid)
        .order("applied_at", { ascending: false });
      const list = (rows ?? []) as AppRow[];
      const ids = Array.from(new Set(list.map((a) => a.job_id)));
      if (ids.length > 0) {
        const { data: jobRows } = await supabase.from("jobs").select("*").in("id", ids);
        const map = new Map(((jobRows ?? []) as JobRow[]).map((j) => [j.id, j]));
        list.forEach((a) => (a.job = map.get(a.job_id) ?? null));
      }
      setApps(list);
      setLoading(false);
    })();
  }, [supabase]);

  return (
    <div>
      <div className="flex items-center gap-3 px-1 pb-4">
        <Link href="/jobs" className="text-sm text-ink/50 hover:text-ink">← Jobs</Link>
        <h1 className="font-display text-xl text-porcelain">My applications</h1>
      </div>
      {loading ? (
        <p className="py-16 text-center text-sm text-ink/40">Loading</p>
      ) : apps.length === 0 ? (
        <p className="py-16 text-center text-sm text-ink/40">Roles you apply for show up here with their status.</p>
      ) : (
        <div className="border-t border-ink/10">
          {apps.map((a) => {
            const meta = STATUS_META[a.status as keyof typeof STATUS_META] || { label: a.status, color: "#6B7280", bg: "#F3F4F6" };
            return (
              <Link key={a.id} href={"/jobs/" + a.job_id} className="flex items-center gap-4 border-b border-ink/10 px-1 py-4 transition-colors hover:bg-surface">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink">{a.job?.title ?? "Job"}</span>
                  <span className="block truncate text-[13px] text-ink/60">{a.job?.company}</span>
                  <span className="block text-[12px] text-ink/40">{timeAgo(a.applied_at || a.created_at || new Date().toISOString())}</span>
                </span>
                <span className="shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold" style={{ color: meta.color, backgroundColor: meta.bg }}>
                  {meta.label}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}