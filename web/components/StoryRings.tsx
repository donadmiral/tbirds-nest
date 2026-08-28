"use client";

import { useEffect, useState } from "react";
import { getCatchupFeed, type CatchupUser } from "@/lib/stories";
import { StoryViewer } from "@/components/StoryViewer";

// Port of the phone's PlatinumRing: platinum gradient base circle plus a
// rotating pale-glow arc (19% of the circumference) while unseen stories
// exist; a still platinum hairline once everything is seen.
const PLATINUM_GLOW = "#F5F0E8";
const PLATINUM_START = "#C9BFB0";
const PLATINUM_END = "#A89F91";

function hashSpeed(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return 3500 + (Math.abs(hash) % 1500);
}

function PlatinumRingWeb({ userId, size, active }: { userId: string; size: number; active: boolean }) {
  const center = size / 2;
  const radius = center - 2;
  const circumference = 2 * Math.PI * radius;
  const arcDash = circumference * 0.19;
  const gid = "platg_" + userId.replace(/[^a-zA-Z0-9_]/g, "_");
  return (
    <svg width={size} height={size} viewBox={"0 0 " + size + " " + size} className="absolute inset-0" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={PLATINUM_START} />
          <stop offset="100%" stopColor={PLATINUM_END} />
        </linearGradient>
      </defs>
      <circle cx={center} cy={center} r={radius} fill="none" stroke={"url(#" + gid + ")"} strokeWidth={active ? 2 : 1.5} opacity={active ? 1 : 0.55} />
      {active ? (
        <g style={{ transformOrigin: "center", animation: "platinumspin " + hashSpeed(userId) + "ms linear infinite" }}>
          <circle cx={center} cy={center} r={radius} fill="none" stroke={PLATINUM_GLOW} strokeWidth={2.5} strokeLinecap="round" strokeDasharray={arcDash + " " + (circumference - arcDash)} />
        </g>
      ) : null}
    </svg>
  );
}

export function StoryRings({ mode = "all" }: { mode?: string } = {}) {
  const [users, setUsers] = useState<CatchupUser[]>([]);
  const [openAt, setOpenAt] = useState<number | null>(null);

  useEffect(() => {
    getCatchupFeed(30, mode).then(setUsers);
  }, [mode]);

  if (users.length === 0) return null;

  return (
    <>
      <style>{"@keyframes platinumspin { to { transform: rotate(360deg); } }"}</style>
      <div className="flex gap-4 overflow-x-auto px-1 pb-3 pt-1">
        <a href="/story/new" className="flex w-16 shrink-0 flex-col items-center gap-1.5">
          <span className="flex h-[60px] w-[60px] items-center justify-center rounded-full border-2 border-dashed border-pearl text-ink/50">+</span>
          <span className="w-full truncate text-center text-[11px] text-ink/60">Your story</span>
        </a>
        {users.map((u, i) => (
          <button key={u.user_id} onClick={() => setOpenAt(i)} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
            <span className="relative block h-[62px] w-[62px]">
              <PlatinumRingWeb userId={u.user_id} size={62} active={!!u.has_unseen} />
              <span className="absolute inset-[4px] overflow-hidden rounded-full bg-ink">
                {u.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u.avatar_url} alt="" className="h-full w-full rounded-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center rounded-full bg-navy text-lg font-semibold text-white">
                    {(u.full_name ?? "?").charAt(0).toUpperCase()}
                  </span>
                )}
              </span>
            </span>
            <span className={"w-full truncate text-center text-[11px] " + (u.has_unseen ? "text-ink" : "text-ink/50")}>
              {u.full_name?.split(" ")[0] ?? u.username}
            </span>
          </button>
        ))}
      </div>
      {openAt !== null ? (
        <StoryViewer users={users} startIndex={openAt} onClose={() => { setOpenAt(null); getCatchupFeed(30, mode).then(setUsers); }} />
      ) : null}
    </>
  );
}