"use client";
// Which posts carry a poll, found in one batched query per feed page.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
const known = new Map<string, boolean>();
const waiting = new Map<string, Set<(v: boolean) => void>>();
let timer: ReturnType<typeof setTimeout> | null = null;
function flush() {
  timer = null;
  const ids = Array.from(waiting.keys()).filter((id) => !known.has(id));
  if (!ids.length) return;
  createClient().from("post_polls").select("post_id").in("post_id", ids).then(({ data }) => {
    const has = new Set(((data ?? []) as { post_id: string }[]).map((r) => r.post_id));
    ids.forEach((id) => { known.set(id, has.has(id)); waiting.get(id)?.forEach((fn) => fn(has.has(id))); waiting.delete(id); });
  });
}
export function usePollFlag(postId: string, hint?: boolean): boolean {
  const [v, setV] = useState<boolean>(hint ?? known.get(postId) ?? false);
  useEffect(() => {
    if (hint) { setV(true); return; }
    const hit = known.get(postId); if (hit !== undefined) { setV(hit); return; }
    let alive = true;
    if (!waiting.has(postId)) waiting.set(postId, new Set()); waiting.get(postId)!.add((x) => { if (alive) setV(x); });
    if (!timer) timer = setTimeout(flush, 40);
    return () => { alive = false; };
  }, [postId, hint]);
  return v;
}