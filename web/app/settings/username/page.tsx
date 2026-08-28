"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, AtSign } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Check = "idle" | "checking" | "free" | "taken" | "invalid";

export default function ChangeUsernamePage() {
  const supabase = useRef(createClient()).current;
  const router = useRouter();
  const [current, setCurrent] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [state, setState] = useState<Check>("idle");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useState(() => {
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase.from("profiles").select("username").eq("id", auth.user.id).single();
      setCurrent(data?.username ?? null);
    })();
  });

  const check = (v: string) => {
    const clean = v.trim().toLowerCase();
    setHandle(clean);
    if (timer.current) clearTimeout(timer.current);
    if (!clean || clean === (current || "").toLowerCase()) { setState("idle"); return; }
    if (!/^[a-z0-9_]{3,30}$/.test(clean)) { setState("invalid"); return; }
    setState("checking");
    timer.current = setTimeout(async () => {
      const { data } = await supabase.rpc("is_username_available", { p_username: clean });
      setState(data ? "free" : "taken");
    }, 350);
  };

  const save = async () => {
    if (state !== "free" || busy) return;
    setBusy(true);
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from("profiles").update({ username: handle }).eq("id", auth.user?.id);
    setBusy(false);
    if (error) { alert("Could not change: " + error.message); return; }
    router.push("/" + handle);
  };

  const hint = state === "checking" ? "Checking..." : state === "free" ? "@" + handle + " is available" : state === "taken" ? "That handle is taken" : state === "invalid" ? "3-30 chars: a-z, 0-9, _" : "";
  const hintColor = state === "free" ? "text-success" : state === "checking" ? "text-ink/50" : "text-red-500";

  return (
    <div className="mx-auto max-w-[480px] px-1">
      <Link href="/settings" aria-label="Back to Settings" className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink/60 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"><ArrowLeft size={19} /></Link>
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><AtSign size={19} className="text-pearl" /> Username</h1>
      <p className="pb-5 text-[13px] text-ink/50">Your handle is how people find and mention you. You are currently <span className="font-semibold text-ink">@{current || "-"}</span>. Changing it releases the old one.</p>
      <input value={handle} onChange={e => check(e.target.value)} autoCapitalize="none" autoCorrect="off" placeholder="New username" className="w-full rounded-lg border border-ink/15 px-3.5 py-2.5 text-[14px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
      {hint ? <p className={"mt-1.5 pl-1 text-[12px] font-semibold " + hintColor}>{hint}</p> : null}
      <button onClick={save} disabled={busy || state !== "free"} className="mt-4 w-full rounded-full bg-ink py-3 text-[14px] font-bold text-white transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">{busy ? "Saving" : "Change username"}</button>
    </div>
  );
}
