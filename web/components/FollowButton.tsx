"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type FState = "none" | "following" | "requested" | "self" | "unknown";
const cache = new Map<string, FState>();
let uidCache: string | null | undefined;

async function getUid(): Promise<string | null> {
  if (uidCache !== undefined) return uidCache;
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  uidCache = data.session?.user.id ?? null;
  return uidCache;
}

async function hydrate(authorId: string): Promise<FState> {
  const uid = await getUid();
  if (!uid) return "unknown";
  if (uid === authorId) return "self";
  const supabase = createClient();
  const [f, r] = await Promise.all([
    supabase.from("follows").select("id", { count: "exact", head: true }).eq("follower_id", uid).eq("following_id", authorId),
    supabase.from("follow_requests").select("id", { count: "exact", head: true }).eq("requester_id", uid).eq("target_id", authorId).eq("status", "pending"),
  ]);
  if ((f.count ?? 0) > 0) return "following";
  if ((r.count ?? 0) > 0) return "requested";
  return "none";
}

export function FollowButton({ authorId, size = "sm" }: { authorId: string | null | undefined; size?: "sm" | "md" }) {
  const [state, setState] = useState<FState>(cache.get(authorId ?? "") ?? "unknown");

  useEffect(() => {
    if (!authorId) return;
    const cached = cache.get(authorId);
    if (cached) { setState(cached); return; }
    hydrate(authorId).then((s) => { cache.set(authorId, s); setState(s); });
  }, [authorId]);

  if (!authorId || state === "self" || state === "unknown") return null;

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!authorId) return;
    const supabase = createClient();
    const prev = state;
    // Optimistic paint; private targets come back as 'requested' and the truth wins.
    setState(prev === "none" ? "following" : "none");
    const { data, error } = await supabase.rpc("handle_follow_action", { p_target_id: authorId });
    if (error) { setState(prev); return; }
    const action = (data as { action?: string } | null)?.action;
    const next: FState = action === "followed" ? "following" : action === "requested" ? "requested" : action ? "none" : prev;
    cache.set(authorId, next);
    setState(next);
  }

  const label = state === "following" ? "Following" : state === "requested" ? "Requested" : "Follow";
  const cls = size === "md" ? "px-4 py-2 text-[13px]" : "px-3 py-1 text-[12px]";
  return (
    <button onClick={toggle}
      className={"shrink-0 rounded-full font-semibold transition-colors " + cls + " " +
        (state === "none" ? "bg-pearl text-ink hover:opacity-90" : "bg-surface text-ink/70 hover:bg-surface-elevated")}
    >
      {label}
    </button>
  );
}