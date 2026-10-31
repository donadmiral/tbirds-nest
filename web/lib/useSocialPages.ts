"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { createPagedCollection, type PageMemory } from "@/lib/socialPages";
import { hydratePostMedia } from "@/lib/contentMedia";
import { withTimeout } from "@/lib/withTimeout";
import { getProfileNavigationStore, profileNavigationKey, safeProfileMemoryRows } from "@/lib/profileNavigation";

export function useSocialPages<T extends object>(rpc: string, args: Record<string, unknown>, options: {
  key?: string; size?: number; enabled?: boolean; ownProfileId?: string;
} = {}) {
  const [client] = useState(createClient);
  const [navigationStore] = useState(getProfileNavigationStore);
  const session = useSyncExternalStore(navigationStore.subscribe, navigationStore.getSnapshot, navigationStore.getServerSnapshot);
  const serialized = JSON.stringify(args);
  const { key = "id", size = 20, enabled = true, ownProfileId } = options;
  const profileRevision = ownProfileId ? session.revision : 0;
  const cacheScope = ownProfileId && session.owner === ownProfileId ? session.scope : null;
  const cacheKey = ownProfileId ? profileNavigationKey(ownProfileId, 'posts') : '';
  const postMedia = ["get_profile_posts_page", "get_community_posts_page", "get_discover_page"].includes(rpc);
  const reader = useMemo(() => {
    const memory = cacheScope ? navigationStore.cache.read<PageMemory<T>>(cacheScope, cacheKey) : null;
    return createPagedCollection<T>({
      size,
      memory: memory ? { ...memory, items: safeProfileMemoryRows(memory.items) } : null,
      key: (item) => String((item as Record<string, unknown>)[key]),
      fetchPage: async (offset, limit, asOf, signal) => {
        const current = () => !signal?.aborted && (!ownProfileId || navigationStore.getSnapshot().revision === profileRevision);
        if (!current()) throw new Error("The profile session changed. Please try again.");
        const query = client.rpc(rpc, {
          ...JSON.parse(serialized), p_offset: offset, p_limit: limit, p_as_of: asOf,
        });
        const { data, error } = await withTimeout(signal ? query.abortSignal(signal) : query);
        if (!current()) throw new Error("The profile session changed. Please try again.");
        if (error) throw new Error("Could not load this page. Please try again.");
        const rows = (data ?? []) as T[];
        return postMedia ? withTimeout(hydratePostMedia(rows, client)) : rows;
      },
    });
  }, [client, rpc, serialized, key, size, postMedia, navigationStore, cacheScope, cacheKey, profileRevision, ownProfileId]);
  const state = useSyncExternalStore(reader.subscribe, reader.snapshot, reader.snapshot);
  useEffect(() => {
    if (!enabled) { reader.reset(); return; }
    if (ownProfileId) {
      if (!session.initialized) return;
      const remember = () => {
        if (reader.snapshot().loading || reader.snapshot().error) return;
        const memory = reader.remember();
        if (memory) navigationStore.cache.save(cacheScope, cacheKey, memory);
      };
      const unsubscribe = reader.subscribe(remember);
      const refresh = () => { void reader.refresh(); };
      const changed = () => { void reader.refresh(true); };
      const visible = () => { if (document.visibilityState === 'visible') refresh(); };
      const hidden = (event: Event) => {
        const postId = (event as CustomEvent<{ postId?: string }>).detail?.postId;
        if (postId) reader.setItems(rows => rows.filter(row => (row as Record<string, unknown>)[key] !== postId));
        changed();
      };
      refresh();
      window.addEventListener('pc-refresh-feed', changed);
      window.addEventListener('pc-feed-hidden', hidden);
      window.addEventListener('pc-feed-author-hidden', changed);
      document.addEventListener('visibilitychange', visible);
      return () => {
        unsubscribe(); reader.cancel();
        window.removeEventListener('pc-refresh-feed', changed);
        window.removeEventListener('pc-feed-hidden', hidden);
        window.removeEventListener('pc-feed-author-hidden', changed);
        document.removeEventListener('visibilitychange', visible);
      };
    }
    let alive = true;
    let uid: string | null | undefined;
    const bind = (next: string | null) => {
      if (!alive || uid === next) return;
      uid = next; reader.reset();
      queueMicrotask(() => { if (alive && uid === next) void reader.next(); });
    };
    const { data: auth } = client.auth.onAuthStateChange((_event, session) => bind(session?.user.id ?? null));
    withTimeout(client.auth.getSession()).then(({ data, error }) => {
      if (alive && uid === undefined) {
        // RPCs remain authoritative; an expired session yields the normal retry state.
        bind(error ? null : data.session?.user.id ?? null);
      }
    }, () => { if (alive && uid === undefined) bind(null); });
    return () => { alive = false; reader.cancel(); auth.subscription.unsubscribe(); };
  }, [client, enabled, reader, ownProfileId, session.initialized, navigationStore, cacheScope, cacheKey, key]);
  useEffect(() => {
    if (!postMedia || !enabled) return;
    let alive = true, pending = false;
    const renew = async () => {
      if (pending || document.visibilityState !== "visible") return;
      const snapshot = reader.snapshot().items;
      const expiring = snapshot.filter((row) => {
        const expiry = (row as Record<string, unknown>)._mediaExpiresAt;
        return typeof expiry === "number" && expiry <= Date.now() + 60000;
      });
      if (!expiring.length) return;
      pending = true;
      const version = reader.version();
      const original = new Map(expiring.map(row => [String((row as Record<string, unknown>)[key]), row]));
      try {
        const hydrated = await withTimeout(hydratePostMedia(expiring, client));
        if (!alive || version !== reader.version()) return;
        const byId = new Map(hydrated.map((row) => [String((row as Record<string, unknown>)[key]), row]));
        reader.setItems((previous) => previous.map((row) => {
          const id = String((row as Record<string, unknown>)[key]);
          return original.get(id) === row ? byId.get(id) ?? row : row;
        }));
      } catch { /* Expired capabilities fail closed; retry when connectivity returns. */ }
      finally { pending = false; }
    };
    const timer = setInterval(() => { void renew(); }, 60000);
    document.addEventListener("visibilitychange", renew);
    window.addEventListener("online", renew);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", renew); window.removeEventListener("online", renew); };
  }, [client, reader, postMedia, enabled, key]);
  return { ...state, loading: enabled && (state.loading || (state.items.length === 0 && state.hasMore && !state.error)), loadMore: reader.next, reload: reader.reload, setItems: reader.setItems, version: reader.version };
}
