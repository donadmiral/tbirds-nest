"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { createClient } from "./supabase/client";
import { errorMessage, isAccessDeniedError } from "./errors";
import { useViewerIdentity } from "./useViewerIdentity";
import { withTimeout } from "./withTimeout";

type Client = ReturnType<typeof createClient>;
type Loader<T> = (client: Client, owner: string) => Promise<T>;
type Result<T> = { owner: string; epoch: number; load: Loader<T>; revision: number; data: T | null; hasData: boolean; error: string; refreshError: string };


/**
 * Account-owned settings data. Account/session/filter changes hide old values
 * immediately. A same-scope reload keeps its last result until it is replaced.
 */
export function useAccountResource<T>(load: Loader<T>, empty: T) {
  const [client] = useState(createClient);
  const identity = useViewerIdentity();
  const owner = identity.viewer?.id ?? null, epoch = identity.epoch;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Result<T> | null>(null);
  const mutationRevision = useRef(0);
  const scope = useMemo(() => ({ owner, epoch, load, revision }), [owner, epoch, load, revision]);
  const activeScope = useRef(scope);
  useLayoutEffect(() => { activeScope.current = scope; }, [scope]);

  useEffect(() => {
    if (!owner || identity.loading) return;
    let cancelled = false;
    const mutation = mutationRevision.current;
    const current = () => !cancelled && activeScope.current === scope && mutationRevision.current === mutation;
    void withTimeout(Promise.resolve().then(() => load(client, owner))).then(data => {
      setResult(previous => current() ? { owner, epoch, load, revision, data, hasData: true, error: "", refreshError: "" } : previous);
    }).catch(cause => {
      setResult(previous => {
        if (!current()) return previous;
        const message = errorMessage(cause, "This information could not load. Please try again.");
        if (!isAccessDeniedError(cause) && previous?.owner === owner && previous.epoch === epoch && previous.load === load && previous.hasData) {
          return { ...previous, revision, error: "", refreshError: message };
        }
        return { owner, epoch, load, revision, data: null, hasData: false, error: message, refreshError: "" };
      });
    });
    return () => { cancelled = true; };
  }, [client, owner, epoch, identity.loading, load, revision, scope]);

  const current = !identity.loading && !identity.error && result?.owner === owner && result?.epoch === epoch && result?.load === load ? result : null;
  const settled = current?.revision === revision;
  const reload = useCallback(() => setRevision(value => value + 1), []);
  const setData = (next: SetStateAction<T>) => setResult(previous => {
    if (activeScope.current !== scope || !previous?.hasData || previous.owner !== owner || previous.epoch !== epoch || previous.load !== load) return previous;
    // A confirmed local mutation is newer than any read already in flight.
    // Check inside the updater so a queued write cannot cross a scope change.
    const data = typeof next === "function" ? (next as (value: T) => T)(previous.data ?? empty) : next;
    mutationRevision.current += 1;
    return { ...previous, revision, data, error: "", refreshError: "" };
  });
  const assertOwner = async () => {
    const { data, error } = await withTimeout(client.auth.getUser());
    if (activeScope.current !== scope || error || !owner || data.user?.id !== owner) throw new Error("Your account changed. Reload this page before continuing.");
    return owner;
  };
  return {
    client, owner, viewer: identity.viewer, setData, assertOwner,
    data: current?.data ?? empty,
    loading: identity.loading || (!!owner && !settled && !current?.hasData),
    refreshing: !!owner && !settled && !!current?.hasData,
    error: identity.error || (settled ? current?.error : "") || "",
    refreshError: settled ? current?.refreshError || "" : "",
    reload,
    retry: identity.error ? identity.retry : reload,
  };
}
