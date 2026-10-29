import type { SupabaseClient } from "@supabase/supabase-js";

export type FollowState = "none" | "following" | "requested" | "self" | "unknown";
export type FollowSnapshot = { state: FollowState; pending: boolean; error: string | null };
export const UNKNOWN_FOLLOW: FollowSnapshot = { state: "unknown", pending: false, error: null };

// All cards observe the same viewer/target pair. A session change invalidates
// pending reads and writes before the next viewer can see their results.
export function createFollowStore(client: SupabaseClient) {
  let viewer: string | null = null;
  let generation = 0;
  let started = false;
  let sessionReady: Promise<void> | null = null;
  const entries = new Map<string, FollowSnapshot>();
  const listeners = new Map<string, Set<() => void>>();
  const reads = new Map<string, Promise<void>>();
  const emit = (id: string) => listeners.get(id)?.forEach((fn) => fn());
  const put = (id: string, value: FollowSnapshot) => { entries.set(id, value); emit(id); };
  const snapshot = (id: string) => entries.get(id) ?? UNKNOWN_FOLLOW;

  function setViewer(id: string | null) {
    if (viewer === id) return;
    viewer = id;
    generation++;
    entries.clear();
    reads.clear();
    listeners.forEach((_, target) => emit(target));
    // Never make Supabase calls inside onAuthStateChange's auth lock.
    setTimeout(() => listeners.forEach((_, target) => { void ensure(target); }), 0);
  }

  function start() {
    if (started) return;
    started = true;
    let authObserved = false;
    let ready!: () => void;
    sessionReady = new Promise<void>((resolve) => { ready = resolve; });
    client.auth.onAuthStateChange((_event, session) => {
      authObserved = true;
      setViewer(session?.user.id ?? null);
      ready();
    });
    void client.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      if (!authObserved) setViewer(data.session?.user.id ?? null);
    }).catch(() => { /* A later auth event can restore the session. */ }).finally(ready);
  }

  async function ensure(id: string): Promise<void> {
    start();
    await sessionReady;
    if (!viewer || !id) return;
    if (viewer === id) { put(id, { state: "self", pending: false, error: null }); return; }
    if (snapshot(id).state !== "unknown") return;
    const existing = reads.get(id);
    if (existing) return existing;
    const owner = viewer;
    const version = generation;
    const current = () => generation === version && viewer === owner;
    put(id, { state: "unknown", pending: true, error: null });
    const work = (async () => {
      try {
        const [follow, request] = await Promise.all([
          client.from("follows").select("id", { count: "exact", head: true }).eq("follower_id", owner).eq("following_id", id),
          client.from("follow_requests").select("id", { count: "exact", head: true }).eq("requester_id", owner).eq("target_id", id).eq("status", "pending"),
        ]);
        if (follow.error || request.error) throw follow.error || request.error;
        if (current()) put(id, { state: (follow.count ?? 0) > 0 ? "following" : (request.count ?? 0) > 0 ? "requested" : "none", pending: false, error: null });
      } catch {
        if (current()) put(id, { state: "unknown", pending: false, error: "Could not load follow status. Try again." });
      } finally {
        if (current()) reads.delete(id);
      }
    })();
    reads.set(id, work);
    return work;
  }

  async function toggle(id: string) {
    const before = snapshot(id);
    if (!viewer || before.pending || before.state === "self") return;
    if (before.state === "unknown") { await ensure(id); return; }
    const version = generation;
    put(id, { state: before.state === "none" ? "following" : "none", pending: true, error: null });
    try {
      const { data, error } = await client.rpc("handle_follow_action", { p_target_id: id });
      if (error) throw error;
      const action = (data as { action?: string } | null)?.action;
      const state: FollowState | null = action === "followed" ? "following" : action === "requested" ? "requested" : action === "unfollowed" || action === "request_cancelled" ? "none" : null;
      if (!state) throw new Error("Unknown follow response");
      if (generation === version) put(id, { state, pending: false, error: null });
    } catch {
      // A toggle cannot safely be retried after an ambiguous network failure:
      // read the server state before the user can make another change.
      if (generation === version) {
        put(id, { state: "unknown", pending: false, error: "Could not confirm that change. Try again." });
        await ensure(id);
      }
    }
  }

  return {
    snapshot, ensure, toggle,
    subscribe(id: string, listener: () => void) {
      const group = listeners.get(id) ?? new Set<() => void>();
      group.add(listener);
      listeners.set(id, group);
      start();
      return () => { group.delete(listener); if (!group.size) listeners.delete(id); };
    },
  };
}
