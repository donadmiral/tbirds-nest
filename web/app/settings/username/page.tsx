"use client";

import { useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";
import { AtSign } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Check = "idle" | "checking" | "free" | "taken" | "invalid" | "error";

export default function ChangeUsernamePage() {
  const [supabase] = useState(createClient);
  const router = useRouter();
  const [current, setCurrent] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [state, setState] = useState<Check>("idle");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const version = useRef(0);
  const available = useRef<string | null>(null);
  const viewer = useRef<string | null>(null);
  const mounted = useRef(false);
  const saving = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void (async () => {
      try {
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (!active || authError || !auth.user) return;
        const { data, error } = await supabase.from("profiles").select("username").eq("id", auth.user.id).single();
        if (!active || error || !data) return;
        viewer.current = auth.user.id;
        setCurrent(data.username ?? null);
      } catch { /* A later save reports that the account could not be loaded. */ }
    })();
    return () => {
      active = false;
      mounted.current = false;
      version.current += 1;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [supabase]);

  const check = (v: string) => {
    if (saving.current) return;
    const requestVersion = version.current += 1;
    available.current = null;
    const clean = v.trim().toLowerCase();
    setHandle(clean);
    if (timer.current) clearTimeout(timer.current);
    if (!clean || clean === (current || "").toLowerCase()) { setState("idle"); return; }
    if (!/^[a-z0-9_]{3,30}$/.test(clean)) { setState("invalid"); return; }
    setState("checking");
    timer.current = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc("is_username_available", { p_username: clean });
        if (!mounted.current || requestVersion !== version.current) return;
        if (error || typeof data !== "boolean") { setState("error"); return; }
        available.current = data ? clean : null;
        setState(data ? "free" : "taken");
      } catch {
        if (mounted.current && requestVersion === version.current) setState("error");
      }
    }, 350);
  };

  const save = async () => {
    if (state !== "free" || available.current !== handle || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (!mounted.current) return;
      if (authError || !auth.user) throw new Error("Please sign in again.");
      if (!viewer.current || viewer.current !== auth.user.id) throw new Error("Reload this page to confirm your account, then try again.");
      const { data, error } = await supabase.from("profiles")
        .update({ username: handle }).eq("id", auth.user.id)
        .select("id, username").maybeSingle();
      if (!mounted.current) return;
      if (error) throw error;
      if (data?.id !== auth.user.id || data?.username !== handle) throw new Error("Your username was not saved. Please try again.");
      setCurrent(handle);
      available.current = null;
      setState("idle");
      router.replace("/" + encodeURIComponent(handle));
      router.refresh();
    } catch (error) {
      if (mounted.current) alert("Could not change: " + (error instanceof Error ? error.message : (error as { message?: string })?.message || "Please try again."));
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const hint = state === "checking" ? "Checking..." : state === "free" ? "@" + handle + " is available" : state === "taken" ? "That handle is taken" : state === "invalid" ? "3-30 chars: a-z, 0-9, _" : state === "error" ? "Could not check availability. Edit the username to try again." : "";
  const hintColor = state === "free" ? "text-success" : state === "checking" ? "text-muted" : "text-danger";

  return (
    <div className="mx-auto max-w-[480px] px-1">
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><AtSign size={19} className="text-accent" /> Username</h1>
      <p className="pb-5 text-[13px] text-muted">Your handle is how people find and mention you. You are currently <span className="font-semibold text-ink">@{current || "-"}</span>. Changing it releases the old one.</p>
      <input value={handle} onChange={e => check(e.target.value)} disabled={busy} aria-label="New username" autoCapitalize="none" autoCorrect="off" placeholder="New username" className="w-full rounded-lg border border-ink/15 px-3.5 py-2.5 text-[14px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
      {hint ? <p className={"mt-1.5 pl-1 text-[12px] font-semibold " + hintColor}>{hint}</p> : null}
      <button onClick={save} disabled={busy || state !== "free"} className="mt-4 w-full rounded-full bg-ink py-3 text-[14px] font-bold text-white transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">{busy ? "Saving" : "Change username"}</button>
    </div>
  );
}
