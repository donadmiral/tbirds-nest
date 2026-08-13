"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, BarChart3 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { StoryAvatar } from "@/components/StoryAvatar";

type Liker = { id: string; full_name: string | null; username: string | null; avatar_url?: string | null };
type Insights = {
  reach: number;
  likes: number;
  comments: number;
  reposts: number;
  bookmarks: number;
  engagements: number;
  engagement_rate: number | null;
  posted_at: string;
  video: { unique_viewers: number; total_plays: number; avg_seconds: number } | null;
  recent_likers: Liker[];
};

function fmt(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

export function InsightsModal({ postId, onClose }: { postId: string; onClose: () => void }) {
  const supabase = useRef(createClient()).current;
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("get_post_insights", { p_post_id: postId }).then(({ data: res, error: err }) => {
      if (err) setError(err.message);
      else setData(res as Insights);
    });
  }, [supabase, postId]);

  const stat = (value: string, label: string) => (
    <div className="rounded-lg bg-surface px-3 py-2.5 text-center">
      <p className="text-[17px] font-semibold text-white">{value}</p>
      <p className="text-[11px] text-white/45">{label}</p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl border border-white/10 bg-navy p-5">
        <div className="flex items-center justify-between pb-3">
          <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-white"><BarChart3 size={16} className="text-pearl" /> Post insights</h2>
          <button onClick={onClose} title="Close" className="rounded-full p-1 text-white/50 hover:bg-surface hover:text-white"><X size={16} /></button>
        </div>

        {error ? (
          <p className="py-10 text-center text-[13px] text-danger">{error}</p>
        ) : !data ? (
          <p className="py-10 text-center text-sm text-white/40">Loading</p>
        ) : (
          <>
            <div className="rounded-xl border border-white/10 p-4 text-center">
              <p className="text-3xl font-semibold text-pearl">{fmt(data.reach)}</p>
              <p className="text-[13px] text-white/50">{data.reach === 1 ? "person saw this" : "people saw this"}</p>
              <p className="mt-2 text-[13px] text-white/70">
                {data.engagement_rate == null
                  ? "Not enough data for an engagement rate yet"
                  : Math.round(data.engagement_rate * 100) + "% of the people reached engaged"}
              </p>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2">
              {stat(fmt(data.likes), "Likes")}
              {stat(fmt(data.comments), "Comments")}
              {stat(fmt(data.reposts), "Reposts")}
              {stat(fmt(data.bookmarks), "Saves")}
            </div>

            {data.video ? (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {stat(fmt(data.video.unique_viewers), "Viewers")}
                {stat(fmt(data.video.total_plays), "Plays")}
                {stat(Math.round(data.video.avg_seconds) + "s", "Avg watch")}
              </div>
            ) : null}

            {data.recent_likers.length > 0 ? (
              <div className="mt-4">
                <p className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-white/40">Recently liked by</p>
                {data.recent_likers.map((p) => (
                  <Link key={p.id} href={p.username ? "/" + p.username : "#"} className="flex items-center gap-2.5 rounded-md px-1 py-1.5 transition-colors hover:bg-surface">
                    <StoryAvatar userId={p.id} name={p.full_name} avatarUrl={p.avatar_url} size={32} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-white">{p.full_name}</span>
                      <span className="block truncate text-[12px] text-white/45">@{p.username}</span>
                    </span>
                  </Link>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}