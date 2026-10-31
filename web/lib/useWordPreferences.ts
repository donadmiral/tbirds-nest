"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getNavigationStore } from "@/lib/navigationCache";
import { withTimeout } from "@/lib/withTimeout";
import { navigationSessionIdentity } from "../../shared/navigationCache";

/** A whole-array preference may only be edited after its existing value is known. */
export function useWordPreferences(field: "hidden_words" | "muted_words") {
  const [supabase] = useState(createClient);
  const [store] = useState(getNavigationStore);
  const [words, setWords] = useState<string[] | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const readRevision = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const writeController = useRef<AbortController | null>(null);
  const verifiedSession = useRef<{ scope: string; identity: string | null } | null>(null);
  const writing = useRef(false);

  const load = useCallback(async () => {
    const version = ++readRevision.current, lifecycle = generation.current;
    const started = store.getSnapshot(), controller = new AbortController();
    let scope = started.scope;
    readController.current?.abort(); readController.current = controller;
    const current = () => mounted.current && lifecycle === generation.current && version === readRevision.current && (!scope || store.getSnapshot().scope === scope);
    try {
      const { data, error: sessionError } = await withTimeout(supabase.auth.getSession());
      const session = data.session, navigation = store.getSnapshot();
      if (!current() || sessionError || !session?.access_token || navigation.owner !== session.user.id || !navigation.scope) throw new Error("Sign in to load your word settings.");
      scope = navigation.scope;
      const auth = await withTimeout(supabase.auth.getUser(session.access_token));
      if (!current() || auth.error || auth.data.user?.id !== session.user.id) throw new Error("Sign in to load your word settings.");
      const id = session.user.id;
      const result = await withTimeout(supabase.from("profiles").select(field).eq("id", id)
        .setHeader("Authorization", `Bearer ${session.access_token}`).abortSignal(controller.signal).maybeSingle());
      if (result.error || !result.data) throw result.error || new Error("Profile unavailable");
      const value = (result.data as unknown as Record<string, unknown>)[field];
      if (value != null && (!Array.isArray(value) || value.some(word => typeof word !== "string"))) throw new Error("Invalid word settings");
      if (current()) {
        verifiedSession.current = { scope, identity: navigationSessionIdentity(session) };
        setUid(id); setWords((value as string[] | null) ?? []); setError(null); setLoadError(null);
        return true;
      }
    } catch {
      if (current()) setLoadError("Could not load your word settings. Please try again before making changes.");
    } finally {
      controller.abort();
      if (readController.current === controller) readController.current = null;
      if (current()) setLoading(false);
    }
    return false;
  }, [field, store, supabase]);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    let previous = store.getSnapshot();
    const unsubscribe = store.subscribe(() => {
      const next = store.getSnapshot(), changed = previous.initialized && previous.revision !== next.revision;
      previous = next;
      if (!changed) return;
      generation.current += 1; readRevision.current += 1; verifiedSession.current = null;
      readController.current?.abort(); writeController.current?.abort();
      readController.current = null; writeController.current = null; writing.current = false;
      setWords(null); setUid(null); setLoading(false); setSaving(false); setError(null);
      setLoadError("Your account changed. Reload your word settings before making changes.");
    });
    // Skip the first request when a render is cleaned up before its queued start.
    queueMicrotask(() => { if (active) void load(); });
    return () => {
      active = false; mounted.current = false; generation.current += 1; unsubscribe();
      readController.current?.abort(); writeController.current?.abort();
      readController.current = null; writeController.current = null; writing.current = false; verifiedSession.current = null;
    };
  }, [load, store]);

  const ready = words !== null && !!uid && !loading && !loadError;
  const save = async (next: string[]) => {
    const approved = verifiedSession.current;
    if (!ready || !uid || writing.current || !approved || store.getSnapshot().scope !== approved.scope) return false;
    writing.current = true; setSaving(true); setError(null);
    const version = generation.current, controller = new AbortController();
    writeController.current = controller;
    let dispatched = false;
    const current = () => mounted.current && version === generation.current && store.getSnapshot().scope === approved.scope;
    try {
      const session = await withTimeout(supabase.auth.getSession());
      const signedIn = session.data.session;
      if (!current() || session.error || !signedIn?.access_token || signedIn.user.id !== uid || navigationSessionIdentity(signedIn) !== approved.identity) throw new Error("Your account changed. Reopen these settings.");
      dispatched = true;
      const result = await withTimeout(supabase.from("profiles").update({ [field]: next }).eq("id", uid)
        .setHeader("Authorization", `Bearer ${signedIn.access_token}`).abortSignal(controller.signal));
      if (result.error) throw result.error;
      if (!current()) return false;
      setWords(next); return true;
    } catch {
      controller.abort();
      if (current()) {
        setError("Could not save your word settings. Your changes have not been confirmed.");
        if (dispatched) {
          // Cancellation cannot establish whether the server committed. Never
          // replay the write or edit a guessed list: first read saved settings.
          setLoading(true); setLoadError(null);
          const reconciled = await load();
          if (current()) setError(reconciled
            ? "Could not save your word settings with confirmation. The latest saved list is shown; review it before trying again."
            : "Could not save your word settings with confirmation. Reload the saved list before making more changes.");
        }
      }
      return false;
    } finally {
      controller.abort();
      if (writeController.current === controller) {
        writeController.current = null; writing.current = false;
        if (current()) setSaving(false);
      }
    }
  };
  const retry = () => { setLoading(true); setLoadError(null); return load(); };
  return { words: words ?? [], loading, loadError, error, ready, saving, retry, save };
}
