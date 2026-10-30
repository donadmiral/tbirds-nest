"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { createClient } from "./supabase/client";
import { errorMessage } from "./errors";
import { useViewerIdentity } from "./useViewerIdentity";
import { withTimeout } from "./withTimeout";

type Client = ReturnType<typeof createClient>;
type Loader<T> = (client: Client, owner: string) => Promise<T>;
type Result<T> = { owner: string; epoch: number; load: Loader<T>; revision: number; data: T | null; error: string };

/**
 * Account-owned settings data. Changing accounts, filters or retry generation
 * hides the old result immediately. Only the current request may publish.
 */
export function useAccountResource<T>(load: Loader<T>, empty: T) {
  const [client] = useState(createClient);
  const identity = useViewerIdentity();
  const owner = identity.viewer?.id ?? null, epoch = identity.epoch;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Result<T> | null>(null);
  const scope = useMemo(() => ({ owner, epoch, load, revision }), [owner, epoch, load, revision]);
  const activeScope = useRef(scope);
  useLayoutEffect(() => { activeScope.current = scope; }, [scope]);

  useEffect(() => {
    if (!owner || identity.loading) return;
    let cancelled = false;
    void withTimeout(load(client, owner)).then(data => {
      if (!cancelled) setResult({ owner, epoch, load, revision, data, error: "" });
    }).catch(cause => {
      if (!cancelled) setResult({ owner, epoch, load, revision, data: null, error: errorMessage(cause, "This information could not load. Please try again.") });
    });
    return () => { cancelled = true; };
  }, [client, owner, epoch, identity.loading, load, revision]);

  const current = result?.owner === owner && result?.epoch === epoch && result?.load === load && result?.revision === revision ? result : null;
  const reload = useCallback(() => setRevision(value => value + 1), []);
  const setData = (next: SetStateAction<T>) => setResult(previous => {
    if (activeScope.current !== scope || !previous || previous.owner !== owner || previous.epoch !== epoch || previous.load !== load || previous.revision !== revision) return previous;
    return { ...previous, data: typeof next === "function" ? (next as (value: T) => T)(previous.data ?? empty) : next };
  });
  const assertOwner = async () => {
    const { data, error } = await withTimeout(client.auth.getUser());
    if (activeScope.current !== scope || error || !owner || data.user?.id !== owner) throw new Error("Your account changed. Reload this page before continuing.");
    return owner;
  };
  return {
    client, owner, viewer: identity.viewer, setData, assertOwner,
    data: current?.data ?? empty,
    loading: identity.loading || (!!owner && !current),
    error: identity.error || current?.error || "",
    reload,
    retry: identity.error ? identity.retry : reload,
  };
}
