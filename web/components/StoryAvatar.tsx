"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getRingUsers, invalidateRings, type CatchupUser } from "@/lib/stories";
import { StoryViewer } from "@/components/StoryViewer";

import { displayImageUrl } from "@/lib/media";
import { getNavigationStore } from '@/lib/navigationCache';
import { storyNavigationMemory } from '@/lib/storyNavigation';

export function StoryAvatar({ userId, name, avatarUrl, size = 44, href }: {
  userId: string | null | undefined;
  name: string | null | undefined;
  avatarUrl: string | null | undefined;
  size?: number;
  href?: string | null;
}) {
  const [raw, setRaw] = useState(false);
  const [store] = useState(getNavigationStore);
  const session = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const [saved, setSaved] = useState<{ scope: string; users: CatchupUser[] } | null>(() => storyNavigationMemory());
  const users = saved?.scope === session.scope ? saved.users : [];
  const [open, setOpen] = useState<{ scope: string; userId: string } | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    let off = false;
    mounted.current = true;
    const scope = session.scope;
    if (scope && !session.changed) void getRingUsers().then(value => { if (!off && store.getSnapshot().scope === scope) setSaved({ scope, users: value }); });
    return () => { off = true; mounted.current = false; };
  }, [session.scope, session.changed, store]);

  const idx = userId ? users.findIndex((u) => u.user_id === userId) : -1;
  const ring = idx >= 0 ? (users[idx].has_unseen ? "unseen" : "seen") : "none";

  const face = avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={raw ? avatarUrl! : displayImageUrl(avatarUrl, 200)!} onError={() => setRaw(true)} alt="" style={{ width: size, height: size }} className="rounded-full object-cover" />
  ) : (
    <span style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size / 2.8)) }} className="flex items-center justify-center rounded-full bg-navy font-semibold text-white">
      {(name ?? "?").charAt(0).toUpperCase()}
    </span>
  );

  const wrapped = ring === "none" ? (
    <span className="block shrink-0">{face}</span>
  ) : (
    <span className={"block shrink-0 rounded-full p-[2px] " + (ring === "unseen" ? "bg-gradient-to-br from-pearl via-porcelain to-pearl" : "bg-ink/25")}>
      <span className="block rounded-full bg-ink p-[1.5px]">{face}</span>
    </span>
  );

  if (ring !== "none") {
    return (
      <>
        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (session.scope && userId && store.getSnapshot().scope === session.scope) setOpen({ scope: session.scope, userId }); }} className="shrink-0" title="View story">
          {wrapped}
        </button>
        {open && open.scope === session.scope && open.userId === userId ? (
          <StoryViewer users={users}
            startIndex={idx}
            onClose={() => {
              setOpen(null); invalidateRings();
              const scope = session.scope;
              if (scope) void getRingUsers(true).then(value => { if (mounted.current && store.getSnapshot().scope === scope) setSaved({ scope, users: value }); });
            }}
          />
        ) : null}
      </>
    );
  }

  if (href) {
    return <Link href={href} className="shrink-0" onClick={(e) => e.stopPropagation()}>{wrapped}</Link>;
  }
  return wrapped;
}
