"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getRingUsers, invalidateRings, type CatchupUser } from "@/lib/stories";
import { StoryViewer } from "@/components/StoryViewer";

import { displayImageUrl } from "@/lib/media";

export function StoryAvatar({ userId, name, avatarUrl, size = 44, href }: {
  userId: string | null | undefined;
  name: string | null | undefined;
  avatarUrl: string | null | undefined;
  size?: number;
  href?: string | null;
}) {
  const [users, setUsers] = useState<CatchupUser[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let off = false;
    getRingUsers().then((u) => { if (!off) setUsers(u); });
    return () => { off = true; };
  }, []);

  const idx = userId ? users.findIndex((u) => u.user_id === userId) : -1;
  const ring = idx >= 0 ? (users[idx].has_unseen ? "unseen" : "seen") : "none";

  const face = avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={displayImageUrl(avatarUrl, 200)!} onError={(e) => { if (avatarUrl && e.currentTarget.src !== avatarUrl) e.currentTarget.src = avatarUrl; }} alt="" style={{ width: size, height: size }} className="rounded-full object-cover" />
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
        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }} className="shrink-0" title="View story">
          {wrapped}
        </button>
        {open ? (
          <StoryViewer users={users}
            startIndex={idx}
            onClose={() => { setOpen(false); invalidateRings(); getRingUsers(true).then(setUsers); }}
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