"use client";
// Download your data: one JSON of everything on the account.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function DownloadPage() {
  const supabase = useRef(createClient()).current;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const guard = useRef({ alive: true, generation: 0, owner: null as string | null, busy: false });
  useEffect(() => {
    guard.current.alive = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const owner = session?.user.id ?? null;
      if (owner !== guard.current.owner) {
        guard.current.owner = owner;
        guard.current.generation++;
        guard.current.busy = false;
        setBusy(false);
        setMsg(null);
      }
    });
    return () => { guard.current.alive = false; guard.current.generation++; subscription.unsubscribe(); };
  }, [supabase]);
  const run = async () => {
    if (guard.current.busy) return;
    guard.current.busy = true;
    let generation = guard.current.generation;
    setBusy(true); setMsg(null);
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (!guard.current.alive || generation !== guard.current.generation) return;
      if (authError || !auth.user) throw new Error("Sign in to download your data.");
      const owner = auth.user.id;
      if (guard.current.owner && guard.current.owner !== owner) throw new Error("Your account changed. Please retry.");
      guard.current.owner = owner;
      generation = guard.current.generation;
      const { data, error } = await supabase.functions.invoke("export-my-data", { body: {} });
      if (!guard.current.alive || generation !== guard.current.generation || guard.current.owner !== owner) return;
      if (error) {
        const detail = await error.context?.json?.().catch(() => null);
        throw new Error(detail?.error || "Your archive could not be prepared. Please retry.");
      }
      if (data?.export_status !== "complete" || data?.account?.id !== owner) {
        throw new Error("A complete archive was not confirmed. Please retry.");
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "platinum-circles-data-" + new Date().toISOString().slice(0, 10) + ".json"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setMsg("Your file is downloading.");
    } catch (e: unknown) {
      if (guard.current.alive && generation === guard.current.generation) setMsg((e as { message?: string })?.message || "Could not export.");
    } finally {
      if (guard.current.alive && generation === guard.current.generation) { guard.current.busy = false; setBusy(false); }
    }
  };
  return (
    <div className="mx-auto max-w-[640px] px-4 py-6">
      <h1 className="mt-4 flex items-center gap-2 font-display text-[24px] font-bold text-ink"><Download size={22} className="text-accent" /> Download your data</h1>
      <p className="mt-1 text-[13.5px] text-ink/60">One file with your profile, posts, comments, likes, saves, follows, stories, the messages you sent, listings, applications and support tickets. Only you can request it, and only for your own account.</p>
      <button type="button" onClick={run} disabled={busy} className="mt-5 rounded-full bg-ink px-5 py-2.5 text-[14px] font-bold text-white hover:opacity-90 disabled:opacity-50">{busy ? "Preparing" : "Download"}</button>
      {msg ? <p role="status" className="mt-3 text-[13px] text-ink/70">{msg}</p> : null}
    </div>
  );
}
