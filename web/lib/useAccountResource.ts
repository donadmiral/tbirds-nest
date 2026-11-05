"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type SetStateAction } from "react";
import { createClient } from "./supabase/client";
import { errorMessage, isAccessDeniedError } from "./errors";
import { useViewerIdentity } from "./useViewerIdentity";
import { withTimeout } from "./withTimeout";
import { getNavigationStore } from "./navigationCache";
import { getAccountResourceCache } from "./accountResourceCache";

type Client = ReturnType<typeof createClient>;
type Loader<T> = (client: Client, owner: string) => Promise<T>;
type Result<T> = { owner: string; epoch: number; load: Loader<T>; cacheScope: string | null; cacheKey: string | undefined; revision: number; data: T | null; hasData: boolean; error: string; refreshError: string };
const noSubscribe = () => () => {};
const emptySession = { owner: null, scope: null, revision: 0, initialized: false, changed: false };
const noSession = () => emptySession;
const noRevision = () => 0;


/**
 * Account-owned settings data. Account/session/filter changes hide old values
 * immediately. A same-scope reload keeps its last result until it is replaced.
 */
export function useAccountResource<T>(load: Loader<T>, empty: T, options: { cacheKey?: string } = {}) {
  const [client] = useState(createClient);
  const identity = useViewerIdentity();
  const epoch = identity.epoch;
  const cacheKey = options.cacheKey, remembered = !!cacheKey;
  const navigation = useMemo(() => remembered ? getNavigationStore() : null, [remembered]);
  const memory = useMemo(() => remembered ? getAccountResourceCache() : null, [remembered]);
  const session = useSyncExternalStore(navigation?.subscribe ?? noSubscribe, navigation?.getSnapshot ?? noSession, navigation?.getServerSnapshot ?? noSession);
  useSyncExternalStore(memory?.subscribe ?? noSubscribe, memory?.getSnapshot ?? noRevision, memory?.getServerSnapshot ?? noRevision);
  const owner = identity.viewer?.id ?? (identity.loading && session.initialized ? session.owner : null);
  const cacheScope = owner && session.owner === owner && session.initialized ? session.scope : null;
  const cached = cacheKey && !identity.error ? memory?.read<T>(cacheScope, cacheKey) : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Result<T> | null>(null);
  const mutationRevision = useRef(0);
  const scope = useMemo(() => ({ owner, epoch, load, revision, cacheScope, cacheKey }), [owner, epoch, load, revision, cacheScope, cacheKey]);
  const activeScope = useRef(scope);
  useLayoutEffect(() => { activeScope.current = scope; }, [scope]);

  useEffect(() => {
    if (!owner || identity.loading || (remembered && !cacheScope)) return;
    let cancelled = false;
    const mutation = mutationRevision.current;
    const current = () => !cancelled && activeScope.current === scope && mutationRevision.current === mutation;
    const fetch = () => withTimeout(Promise.resolve().then(() => load(client, owner)));
    void (memory && cacheKey ? memory.fetch(cacheScope, cacheKey, fetch) : fetch()).then(data => {
      setResult(previous => current() ? { owner, epoch, load, cacheScope, cacheKey, revision, data, hasData: true, error: "", refreshError: "" } : previous);
    }).catch(cause => {
      if (!current()) return;
      if (isAccessDeniedError(cause) && cacheKey) memory?.remove(cacheScope, cacheKey);
      setResult(previous => {
        if (!current()) return previous;
        const message = errorMessage(cause, "This information could not load. Please try again.");
        if (!isAccessDeniedError(cause) && previous?.owner === owner && previous.epoch === epoch && previous.load === load && previous.cacheScope === cacheScope && previous.cacheKey === cacheKey && previous.hasData) {
          return { ...previous, revision, error: "", refreshError: message };
        }
        const saved = cacheKey ? memory?.read<T>(cacheScope, cacheKey) : null;
        return { owner, epoch, load, cacheScope, cacheKey, revision, data: saved?.data ?? null, hasData: !!saved, error: saved ? "" : message, refreshError: saved ? message : "" };
      });
    });
    return () => { cancelled = true; };
  }, [client, owner, epoch, identity.loading, load, revision, scope, memory, cacheKey, cacheScope, remembered]);

  const current = !identity.loading && !identity.error && result?.owner === owner && result?.epoch === epoch && result?.load === load && result?.cacheScope === cacheScope && result?.cacheKey === cacheKey ? result : null;
  const settled = current?.revision === revision;
  const hasData = !!cached || !!current?.hasData;
  const reload = useCallback(() => setRevision(value => value + 1), []);
  const setData = (next: SetStateAction<T>) => setResult(previous => {
    if (activeScope.current !== scope || !owner) return previous;
    const saved = cacheKey ? memory?.read<T>(cacheScope, cacheKey) : null;
    const valid = previous?.hasData && previous.owner === owner && previous.epoch === epoch && previous.load === load && previous.cacheScope === cacheScope && previous.cacheKey === cacheKey;
    if (!saved && !valid) return previous;
    // A confirmed local mutation is newer than any read already in flight.
    // Check inside the updater so a queued write cannot cross a scope change.
    const value = saved ? saved.data : previous?.data ?? empty;
    const data = typeof next === "function" ? (next as (value: T) => T)(value) : next;
    mutationRevision.current += 1;
    if (cacheKey) queueMicrotask(() => { if (activeScope.current === scope) memory?.write(cacheScope, cacheKey, data); });
    return { owner, epoch, load, cacheScope, cacheKey, revision, data, hasData: true, error: "", refreshError: "" };
  });
  const assertOwner = async () => {
    const { data, error } = await withTimeout(client.auth.getUser());
    if (activeScope.current !== scope || error || !owner || data.user?.id !== owner) throw new Error("Your account changed. Reload this page before continuing.");
    return owner;
  };
  return {
    client, owner, viewer: identity.viewer, setData, assertOwner,
    data: cached ? cached.data : current?.data ?? empty,
    loading: (identity.loading && !cached) || (!!owner && !settled && !hasData),
    refreshing: !!owner && !settled && hasData,
    error: identity.error || (settled ? current?.error : "") || "",
    refreshError: settled ? current?.refreshError || "" : "",
    reload,
    retry: identity.error ? identity.retry : reload,
  };
}
