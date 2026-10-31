"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { displayImageUrl } from "@/lib/media";
import type { CatchupUser } from "@/lib/stories";
import { getNavigationStore } from "@/lib/navigationCache";
import { loadStoryNavigation, storyNavigationMemory } from "@/lib/storyNavigation";
import { StoryViewer } from "@/components/StoryViewer";

// Match the phone's platinum gradient ring, subdued after stories are seen.
const PLATINUM_START = "#C9BFB0";
const PLATINUM_END = "#A89F91";

function PlatinumRingWeb({ userId, size, active }: { userId: string; size: number; active: boolean }) {
  const center = size / 2;
  const radius = center - 2;
  const gid = "platg_" + userId.replace(/[^a-zA-Z0-9_]/g, "_");
  return (
    <svg width={size} height={size} viewBox={"0 0 " + size + " " + size} className="absolute inset-0" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={PLATINUM_START} />
          <stop offset="100%" stopColor={PLATINUM_END} />
        </linearGradient>
      </defs>
      <circle cx={center} cy={center} r={radius} fill="none" stroke={"url(#" + gid + ")"} strokeWidth={active ? 2.5 : 1.5} opacity={active ? 1 : 0.4} />
    </svg>
  );
}

export function StoryRings({ mode = "all" }: { mode?: string } = {}) {
  const [store] = useState(getNavigationStore);
  const session = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const [memory, setMemory] = useState(() => storyNavigationMemory(mode));
  const currentMemory = memory?.scope === session.scope && memory.mode === mode ? memory : storyNavigationMemory(mode);
  const users = currentMemory?.users.slice(0, 30) ?? [], spot = currentMemory?.spot ?? [];
  const myId = session.owner, myAvatar = currentMemory?.avatar ?? null;
  const [viewer, setViewer] = useState<{ scope: string; users: CatchupUser[]; index: number; initialStoryId?: string } | null>(null);
  const [error, setError] = useState<{ scope: string; mode: string } | null>(null);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!session.scope || !session.owner || session.changed) return;
    const scope = session.scope;
    let alive = true, generation = 0;
    const refresh = async () => {
      const request = ++generation;
      const current = () => alive && generation === request && store.getSnapshot().scope === scope;
      try {
        const result = await loadStoryNavigation(mode, true);
        if (current()) { setMemory(result); setError(null); }
      } catch {
        if (current()) setError({ scope, mode });
      }
    };
    refreshRef.current = () => { void refresh(); };
    void refresh();
    const visible = () => { if (!document.hidden) void refresh(); };
    const timer = window.setInterval(visible, 30000);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false; generation++; clearInterval(timer);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [mode, session.scope, session.owner, session.changed, store]);

  // Capture the selected sequence: a background rank refresh must not move the
  // open viewer to another person's story while someone is watching.
  const openAt = (index: number) => {
    if (!session.scope || store.getSnapshot().scope !== session.scope) return;
    setViewer({ scope: session.scope, users: [...users, ...spot], index, initialStoryId: index >= users.length ? spot[index - users.length]?.latest_story_id : undefined });
  };
  const closeViewer = useCallback(() => { setViewer(null); refreshRef.current(); }, []);

  // Your own stories live under Your story, not as a second person in the row.
  const mineIdx = myId ? users.findIndex((u) => u.user_id === myId) : -1;
  const mine = mineIdx >= 0 ? users[mineIdx] : null;
  const ownAvatar = (
    <span className="relative block h-[62px] w-[62px]">
      {mine && myId ? <PlatinumRingWeb userId={myId} size={62} active={false} /> : null}
      {myAvatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={myAvatar} alt="" className="h-full w-full rounded-full border border-ink/10 object-cover" />
      ) : <span className="flex h-full w-full items-center justify-center rounded-full bg-surface text-muted">+</span>}
    </span>
  );

  return (
    <>
      <div className="relative mb-4 flex min-h-[118px] gap-4 overflow-x-auto rounded-2xl border border-ink/10 bg-white px-4 py-4" aria-label="Stories">
        {error?.scope === session.scope && error.mode === mode ? <button type="button" onClick={() => refreshRef.current()} className="absolute right-2 top-1 rounded bg-surface px-2 py-1 text-[10px] text-muted" aria-label="Retry story refresh">Stories could not refresh · Retry</button> : null}
        <div className="relative w-16 shrink-0">
          {mine ? <button type="button" onClick={() => openAt(mineIdx)} aria-label="View your story" className="flex w-full flex-col items-center gap-1.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
            {ownAvatar}
            <span className="w-full truncate text-center text-[11px] text-muted">Your story</span>
          </button> : <Link href="/story/new" aria-label="Add to your story" className="flex w-full flex-col items-center gap-1.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
            {ownAvatar}
            <span className="w-full truncate text-center text-[11px] text-muted">Your story</span>
          </Link>}
          <Link href="/story/new" aria-label="Create a story" className="absolute -right-3 top-[31px] flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"><span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-white bg-pearl text-[15px] leading-none text-on-pearl" aria-hidden="true">+</span></Link>
        </div>
        {[...users, ...spot].map((u, i) => (u.user_id === myId ? null : (
          <Fragment key={u.user_id}>
          {i === users.length && spot.length > 0 ? <span className="my-2 w-px shrink-0 self-stretch bg-ink/10" title="Spotlight: public stories from people you don't follow" aria-hidden /> : null}
          <button onClick={() => openAt(i)} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
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
              {i >= users.length ? <span className="absolute -bottom-0.5 -right-0.5 flex h-[20px] w-[20px] items-center justify-center rounded-full border-2 border-white bg-white text-[11px] leading-none" aria-label="Spotlight">{"\uD83D\uDD25"}</span> : null}
            </span>
            <span className={"w-full truncate text-center text-[11px] " + (u.has_unseen ? "text-ink" : "text-muted")}>
              {u.full_name?.split(" ")[0] ?? u.username}
            </span>
          </button>
          </Fragment>
        )))}
      </div>
      {viewer && viewer.scope === session.scope ? (
        <StoryViewer users={viewer.users} startIndex={viewer.index} initialStoryId={viewer.initialStoryId} onClose={closeViewer} />
      ) : null}
    </>
  );
}
