"use client";
// Which posts carry a poll, found in one batched query per feed page.
import { useCallback, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
const known = new Map<string, boolean>();
const waiting = new Map<string, Set<() => void>>();
let timer: ReturnType<typeof setTimeout> | null = null;
function flush() {
  timer = null;
  const ids = Array.from(waiting.keys()).filter(id => !known.has(id));
  if (!ids.length) return;
  void createClient().from("post_polls").select("post_id").in("post_id", ids).then(({ data, error }) => {
    // A failed query must not permanently mark every poll as absent.
    if (error) return;
    const has = new Set(((data ?? []) as { post_id: string }[]).map(row => row.post_id));
    ids.forEach(id => { known.set(id, has.has(id)); waiting.get(id)?.forEach(listener => listener()); });
  }, () => { /* A later subscription can retry after connectivity recovers. */ });
}
export function usePollFlag(postId: string, hint?: boolean): boolean {
  const subscribe = useCallback((listener: () => void) => {
    if (hint !== undefined || known.has(postId)) return () => {};
    if (!waiting.has(postId)) waiting.set(postId, new Set());
    waiting.get(postId)!.add(listener);
    if (!timer) timer = setTimeout(flush, 40);
    const online = () => { if(!known.has(postId) && !timer) timer=setTimeout(flush,40); };
    window.addEventListener("online",online);
    return () => { const listeners=waiting.get(postId);listeners?.delete(listener);if(!listeners?.size)waiting.delete(postId);window.removeEventListener("online",online); };
  }, [postId,hint]);
  const snapshot=useCallback(()=>hint ?? known.get(postId) ?? false,[postId,hint]);
  const server=useCallback(()=>hint ?? false,[hint]);
  return useSyncExternalStore(subscribe,snapshot,server);
}
