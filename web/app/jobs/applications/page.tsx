"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { type JobRow } from "@/lib/jobs";
import { timeAgo } from "@/lib/feed";

// Mirrors STATUS_META in src/services/jobsService.ts (labels and colors).
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  applied:     { label: "Applied",     color: "#2563EB", bg: "#EFF6FF" },
  viewed:      { label: "Viewed",      color: "#7C3AED", bg: "#F5F3FF" },
  shortlisted: { label: "Shortlisted", color: "#059669", bg: "#ECFDF5" },
  interview:   { label: "Interview",   color: "#D97706", bg: "#FFFBEB" },
  rejected:    { label: "Rejected",    color: "#DC2626", bg: "#FEF2F2" },
  accepted:    { label: "Accepted",    color: "#059669", bg: "#ECFDF5" },
};

type AppRow = { id: string; job_id: string; status: string; applied_at?: string | null; created_at?: string | null; job?: JobRow | null };

export default function MyApplicationsPage() {
  const supabase = useRef(createClient()).current;
  const [apps, setApps] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id ?? null;
      if (!uid) { setLoading(false); return; }
      const { data: rows } = await supabase
        .from("job_applications")
        .select("id, job_id, status, applied_at, created_at")
        .eq("applicant_id", uid)
        .order("created_at", { ascending: false });
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
        <Link href="/jobs" className="text-sm text-white/50 hover:text-white">← Jobs</Link>
        <h1 className="font-display text-xl text-porcelain">My applications</h1>
      </div>
      {loading ? (
        <p className="py-16 text-center text-sm text-white/40">Loading</p>
      ) : apps.length === 0 ? (
        <p className="py-16 text-center text-sm text-white/40">Roles you apply for show up here with their status.</p>
      ) : (
        <div className="border-t border-white/10">
          {apps.map((a) => {
            const meta = STATUS_META[a.status] || STATUS_META.applied;
            return (
              <Link key={a.id} href={"/jobs/" + a.job_id} className="flex items-center gap-4 border-b border-white/10 px-1 py-4 transition-colors hover:bg-surface">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-white">{a.job?.title ?? "Job"}</span>
                  <span className="block truncate text-[13px] text-white/60">{a.job?.company}</span>
                  <span className="block text-[12px] text-white/40">{timeAgo(a.applied_at || a.created_at || new Date().toISOString())}</span>
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