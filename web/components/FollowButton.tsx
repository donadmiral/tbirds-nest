"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

import { useCallback, useSyncExternalStore } from "react";
import { createFollowStore, UNKNOWN_FOLLOW } from "@/lib/followState";

let store: ReturnType<typeof createFollowStore> | undefined;
function followStore() { return store ??= createFollowStore(createClient()); }

export function FollowButton({ authorId, size = "sm" }: { authorId: string | null | undefined; size?: "sm" | "md" }) {
  const shared = followStore();
  const id = authorId ?? "";
  const subscribe = useCallback((listener: () => void) => shared.subscribe(id, listener), [shared, id]);
  const getSnapshot = useCallback(() => shared.snapshot(id), [shared, id]);
  const { state, pending, error } = useSyncExternalStore(subscribe, getSnapshot, () => UNKNOWN_FOLLOW);
  useEffect(() => { if (id) void shared.ensure(id); }, [shared, id]);

  if (!authorId || state === "self" || (state === "unknown" && !error)) return null;

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    void shared.toggle(id);
  }

  const label = error && state === "unknown" ? "Retry" : state === "following" ? "Following" : state === "requested" ? "Requested" : "Follow";
  const cls = size === "md" ? "px-4 py-2 text-[13px]" : "px-3 py-1 text-[12px]";
  return (
    <button onClick={toggle} disabled={pending} aria-busy={pending} title={error ?? undefined}
      className={"shrink-0 rounded-full font-semibold transition-colors " + cls + " " +
        (state === "none" ? "bg-pearl text-ink hover:opacity-90" : "bg-surface text-ink/70 hover:bg-surface-elevated")}
    >
      {label}
    </button>
  );
}