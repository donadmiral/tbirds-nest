"use client";
// The one tier lookup on web: ids are batched into a single query and cached
// for the session, so a name or a seal anywhere can be right with only an id.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Tier = { verified: boolean; tier: string | null };
const cache = new Map<string, Tier>();
const waiting = new Map<string, Set<(t: Tier) => void>>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  const ids = Array.from(waiting.keys()).filter((id) => !cache.has(id));
  if (!ids.length) return;
  const supabase = createClient();
  supabase.from("profiles").select("id, is_verified, verified_tier").in("id", ids).then(({ data }) => {
    const got = new Set<string>();
    ((data ?? []) as { id: string; is_verified: boolean | null; verified_tier: string | null }[]).forEach((r) => { cache.set(r.id, { verified: !!r.is_verified, tier: r.verified_tier ?? null }); got.add(r.id); });
    ids.forEach((id) => { if (!got.has(id)) cache.set(id, { verified: false, tier: null }); });
    ids.forEach((id) => { const t = cache.get(id)!; waiting.get(id)?.forEach((fn) => fn(t)); waiting.delete(id); });
  });
}

export function lookupTier(id: string, cb: (t: Tier) => void) {
  const hit = cache.get(id); if (hit) { cb(hit); return; }
  if (!waiting.has(id)) waiting.set(id, new Set()); waiting.get(id)!.add(cb);
  if (!timer) timer = setTimeout(flush, 40);
}

export function useTier(userId?: string | null): Tier | null {
  const [t, setT] = useState<Tier | null>(userId ? cache.get(userId) ?? null : null);
  useEffect(() => { if (!userId) return; let alive = true; lookupTier(userId, (v) => { if (alive) setT(v); }); return () => { alive = false; }; }, [userId]);
  return t;
}