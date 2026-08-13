"use client";

import { useEffect, useState } from "react";
import { getCatchupFeed, type CatchupUser } from "@/lib/stories";
import { StoryViewer } from "@/components/StoryViewer";

export function StoryRings({ mode = "all" }: { mode?: string } = {}) {
  const [users, setUsers] = useState<CatchupUser[]>([]);
  const [openAt, setOpenAt] = useState<number | null>(null);

  useEffect(() => {
    getCatchupFeed(30, mode).then(setUsers);
  }, [mode]);

  if (users.length === 0) return null;

  return (
    <>
      <div className="flex gap-4 overflow-x-auto px-1 pb-3 pt-1">
        {users.map((u, i) => (
          <button key={u.user_id} onClick={() => setOpenAt(i)} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
            <span className={"rounded-full p-[2.5px] " + (u.has_unseen ? "bg-gradient-to-br from-pearl via-porcelain to-pearl" : "bg-white/20")}>
              <span className="block rounded-full bg-ink p-[2px]">
                {u.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u.avatar_url} alt="" className="h-14 w-14 rounded-full object-cover" />
                ) : (
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-navy text-lg font-semibold text-porcelain">
                    {(u.full_name ?? "?").charAt(0).toUpperCase()}
                  </span>
                )}
              </span>
            </span>
            <span className={"w-full truncate text-center text-[11px] " + (u.has_unseen ? "text-white" : "text-white/50")}>
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