import type { SupabaseClient } from "@supabase/supabase-js";

export type PostInteractionSeed = { liked: boolean; bookmarked: boolean; likesCount: number; bookmarksCount?: number };
export type PostInteractionSnapshot = PostInteractionSeed & { bookmarksCount: number; pending: boolean; error: string | null; uncertain: boolean };
type Kind = "like" | "bookmark";
type Actions = Record<Kind, (id: string, on: boolean, viewer: string, isCurrent?: () => boolean) => Promise<boolean>>;
type Entry = { value: PostInteractionSnapshot | null; listeners: Set<() => void>; version: number; touched: boolean; reconcile: boolean };
const EMPTY: PostInteractionSnapshot = { liked: false, bookmarked: false, likesCount: 0, bookmarksCount: 0, pending: false, error: null, uncertain: false };

// Feed seeds avoid additional reads on launch. After any mutation, all mounted
// card/viewer copies share one confirmed snapshot, never independent deltas.
export function createPostInteractionStore(client: SupabaseClient, actions: Actions) {
  const entries = new Map<string, Entry>();
  let viewer: string | null | undefined;
  let generation = 0;
  let ready: Promise<void> | null = null;

  function entry(id: string) {
    let result = entries.get(id);
    if (!result) {
      // Keep a bounded cache for back-navigation, without evicting live posts.
      if (entries.size >= 200) for (const [key, value] of entries) {
        if (!value.listeners.size && !value.value?.pending) { entries.delete(key); break; }
      }
      result = { value: null, listeners: new Set(), version: 0, touched: generation > 1, reconcile: false };
      entries.set(id, result);
    }
    return result;
  }
  function put(target: Entry, value: PostInteractionSnapshot) {
    target.value = value;
    target.listeners.forEach((listener) => listener());
  }
  function setViewer(next: string | null) {
    if (viewer === next) return;
    const initial = viewer === undefined;
    viewer = next;
    generation++;
    if (initial && next) return;
    entries.forEach((target) => {
      if (!initial) target.version++;
      target.touched = true;
      put(target, { ...EMPTY, likesCount: target.value?.likesCount ?? 0, bookmarksCount: target.value?.bookmarksCount ?? 0, uncertain: !!next,
        pending: initial && !!target.value?.pending });
    });
    // Auth callbacks hold the auth lock. Defer session/database work until it exits.
    if (next) setTimeout(() => entries.forEach((target, id) => {
      if (target.listeners.size && target.value?.uncertain) void refresh(id);
    }), 0);
  }
  function start() {
    if (ready) return;
    let resolve!: () => void;
    ready = new Promise<void>((done) => { resolve = done; });
    let observed = false;
    client.auth.onAuthStateChange((_event, session) => {
      observed = true;
      setViewer(session?.user.id ?? null);
      resolve();
    });
    void client.auth.getSession().then(({ data, error }) => {
      if (!observed) setViewer(error ? null : data.session?.user.id ?? null);
    }).catch(() => { if (!observed) setViewer(null); }).finally(resolve);
  }
  async function currentViewer() {
    const epoch = generation;
    const { data, error } = await client.auth.getSession();
    if (epoch !== generation) return null;
    if (error) throw error;
    const id = data.session?.user.id ?? null;
    setViewer(id);
    return id;
  }
  async function read(id: string, owner: string): Promise<PostInteractionSeed & { bookmarksCount: number }> {
    const [post, like, bookmark] = await Promise.all([
      client.from("posts").select("likes_count, bookmarks_count").eq("id", id).maybeSingle(),
      client.from("post_likes").select("post_id").eq("post_id", id).eq("user_id", owner).maybeSingle(),
      client.from("post_bookmarks").select("post_id").eq("post_id", id).eq("user_id", owner).maybeSingle(),
    ]);
    if (post.error || like.error || bookmark.error || !post.data
      || !Number.isSafeInteger(post.data.likes_count) || post.data.likes_count < 0
      || !Number.isSafeInteger(post.data.bookmarks_count) || post.data.bookmarks_count < 0
      || (like.data && like.data.post_id !== id) || (bookmark.data && bookmark.data.post_id !== id)) {
      throw new Error("Could not confirm post interactions");
    }
    return { liked: !!like.data, bookmarked: !!bookmark.data, likesCount: post.data.likes_count, bookmarksCount: post.data.bookmarks_count };
  }

  async function run(id: string, mutation?: { kind: Kind; on: boolean }) {
    if (!id) return;
    const target = entry(id);
    if (target.value?.pending) return;
    // An uncertain outcome must be read back, never blindly retried as a write.
    if (target.value?.uncertain) mutation = undefined;
    const before = target.value ?? EMPTY;
    const version = ++target.version;
    target.touched = true;
    put(target, { ...before, pending: true, error: null });
    start();
    await ready;
    const epoch = generation;
    const current = () => generation === epoch && target.version === version && entries.get(id) === target;
    if (!current()) return;
    try {
      const owner = await currentViewer();
      if (!current()) return;
      if (!owner) {
        put(target, { ...EMPTY, likesCount: before.likesCount, bookmarksCount: before.bookmarksCount, error: "Sign in to like or save posts." });
        return;
      }
      if (mutation) {
        const optimistic = { ...before, pending: true, error: null };
        if (mutation.kind === "like") {
          optimistic.liked = mutation.on;
          optimistic.likesCount = Math.max(0, before.likesCount + (mutation.on === before.liked ? 0 : mutation.on ? 1 : -1));
        } else {
          optimistic.bookmarked = mutation.on;
          optimistic.bookmarksCount = Math.max(0, before.bookmarksCount + (mutation.on === before.bookmarked ? 0 : mutation.on ? 1 : -1));
        }
        put(target, optimistic);
        // The shared helper checks this expected owner before writing. Whether
        // it returns false or throws, read back: the server may have committed.
        try { await actions[mutation.kind](id, mutation.on, owner, current); } catch { /* Reconcile below. */ }
        if (!current()) {
          // A dispatched write may settle after A→B→A. Do not apply its old
          // response, but read again after settlement for the current account.
          const latest = entries.get(id);
          if (latest && viewer === owner && generation !== epoch) latest.reconcile = true;
          return;
        }
      }
      const confirmed = await read(id, owner);
      if (!current() || await currentViewer() !== owner || !current()) return;
      const matches = !mutation || (mutation.kind === "like" ? confirmed.liked : confirmed.bookmarked) === mutation.on;
      put(target, { ...confirmed, pending: false, uncertain: false,
        error: matches ? null : `Could not update ${mutation!.kind === "like" ? "your like" : "your saved post"}. Please try again.` });
    } catch {
      if (current()) put(target, { ...before, pending: false, uncertain: true,
        error: "Could not confirm this change. Check the status before trying again." });
    } finally {
      const latest = entries.get(id);
      if (latest?.reconcile && !latest.value?.pending) {
        latest.reconcile = false;
        if (latest.listeners.size && viewer) void refresh(id);
        else if (latest.value) latest.value = { ...latest.value, uncertain: true };
      }
    }
  }
  async function refresh(id: string) { await run(id); }

  return {
    snapshot: (id: string) => entries.get(id)?.value ?? null,
    seed(id: string, seed: PostInteractionSeed) {
      if (!id) return;
      const target = entry(id);
      if (!target.touched) put(target, { ...seed, likesCount: Math.max(0, seed.likesCount),
        bookmarksCount: Math.max(0, seed.bookmarksCount ?? target.value?.bookmarksCount ?? 0), pending: false, error: null, uncertain: false });
      else if (!target.value) {
        put(target, { ...EMPTY, likesCount: Math.max(0, seed.likesCount), bookmarksCount: Math.max(0, seed.bookmarksCount ?? 0), uncertain: !!viewer });
        if (viewer && target.listeners.size) void refresh(id);
      }
    },
    subscribe(id: string, listener: () => void) {
      if (!id) return () => {};
      const target = entry(id);
      const remount = target.listeners.size === 0;
      target.listeners.add(listener);
      start();
      // Saved or another device may have changed this post since unmount.
      // A pending write stays in charge until its own readback has completed.
      if (viewer && (target.value?.uncertain || (remount && target.touched && target.value))) void refresh(id);
      return () => {
        target.listeners.delete(listener);
        // Let an already-dispatched write finish and reconcile in the cache.
        // Remounting must not read pre-commit state as a confirmed result.
      };
    },
    set: (id: string, kind: Kind, on: boolean) => run(id, { kind, on }),
    refresh,
  };
}
