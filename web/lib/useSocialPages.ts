"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { createPagedCollection } from "@/lib/socialPages";
import { hydratePostMedia } from "@/lib/contentMedia";
import { withTimeout } from "@/lib/withTimeout";

export function useSocialPages<T extends object>(rpc: string, args: Record<string, unknown>, options: {
  key?: string; size?: number; enabled?: boolean;
} = {}) {
  const [client] = useState(createClient);
  const serialized = JSON.stringify(args);
  const { key = "id", size = 20, enabled = true } = options;
  const postMedia = ["get_profile_posts_page", "get_community_posts_page", "get_discover_page"].includes(rpc);
  const reader = useMemo(() => createPagedCollection<T>({
    size,
    key: (item) => String((item as Record<string, unknown>)[key]),
    fetchPage: async (offset, limit, asOf) => {
      const { data, error } = await withTimeout(client.rpc(rpc, {
        ...JSON.parse(serialized), p_offset: offset, p_limit: limit, p_as_of: asOf,
      }));
      if (error) throw new Error("Could not load this page. Please try again.");
      const rows = (data ?? []) as T[];
      return postMedia ? withTimeout(hydratePostMedia(rows, client)) : rows;
    },
  }), [client, rpc, serialized, key, size, postMedia]);
  const state = useSyncExternalStore(reader.subscribe, reader.snapshot, reader.snapshot);
  useEffect(() => {
    if (!enabled) { reader.reset(); return; }
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
  }, [client, enabled, reader]);
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
      try {
        const hydrated = await withTimeout(hydratePostMedia(expiring, client));
        if (!alive || version !== reader.version()) return;
        const byId = new Map(hydrated.map((row) => [String((row as Record<string, unknown>)[key]), row]));
        reader.setItems((previous) => previous.map((row) => byId.get(String((row as Record<string, unknown>)[key])) ?? row));
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
