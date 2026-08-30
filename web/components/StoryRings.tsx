"use client";

import { useEffect, useState } from "react";
import { displayImageUrl } from "@/lib/media";
import { getCatchupFeed, type CatchupUser } from "@/lib/stories";
import { createClient } from "@/lib/supabase/client";
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
  const [myAvatar, setMyAvatar] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getCatchupFeed(30, mode).then((u) => { setUsers(u); setReady(true); });
  }, [mode]);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) return;
      const { data } = await supabase.from("profiles").select("avatar_url").eq("id", uid).maybeSingle();
      setMyAvatar(data?.avatar_url ?? null);
    })();
  }, []);

  if (!ready) return null;

  return (
    <>
      <style>{"@keyframes platinumspin { to { transform: rotate(360deg); } }"}</style>
      <div className="mb-4 flex gap-4 overflow-x-auto rounded-2xl border border-ink/10 bg-white px-4 py-4">
        <a href="/story/new" className="flex w-16 shrink-0 flex-col items-center gap-1.5">
          {/* Your own face with a plus on it, rather than an empty dashed
              circle: it reads as "add to your story" instead of as a gap. */}
          <span className="relative block h-[62px] w-[62px]">
            {myAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={myAvatar} alt="" className="h-full w-full rounded-full border border-ink/10 object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center rounded-full bg-surface text-ink/40">+</span>
            )}
            <span className="absolute -bottom-0.5 -right-0.5 flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-white bg-pearl text-[15px] leading-none text-ink">+</span>
          </span>
          <span className="w-full truncate text-center text-[11px] text-ink/60">Your story</span>
        </a>
        {users.map((u, i) => (
          <button key={u.user_id} onClick={() => setOpenAt(i)} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
            <span className="relative block h-[62px] w-[62px]">
              <PlatinumRingWeb userId={u.user_id} size={62} active={!!u.has_unseen} />
              <span className="absolute inset-[4px] overflow-hidden rounded-full bg-ink">
                {u.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayImageUrl(u.avatar_url, 160) ?? u.avatar_url} alt="" className="h-full w-full rounded-full object-cover" />
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