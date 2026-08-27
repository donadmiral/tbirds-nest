"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Briefcase, Check, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const CATEGORIES = ["Retail", "Food & Drink", "Technology", "Services", "Health & Beauty", "Education", "Transport", "Construction", "Agriculture", "Finance", "Entertainment", "Fashion", "Property", "Other"];
type Avail = "idle" | "checking" | "free" | "taken" | "invalid";

export default function NewBusinessPage() {
  const supabase = useRef(createClient()).current;
  const router = useRouter();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [avail, setAvail] = useState<Avail>("idle");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const u = username.trim().toLowerCase();
    if (!u) { setAvail("idle"); return; }
    if (!/^[a-z0-9_]{3,30}$/.test(u)) { setAvail("invalid"); return; }
    setAvail("checking");
    timer.current = setTimeout(async () => {
      const { data, error } = await supabase.rpc("is_username_available", { p_username: u });
      if (error) { setAvail("idle"); return; }
      setAvail(data ? "free" : "taken");
    }, 450);
  }, [username, supabase]);

  const canCreate = name.trim().length >= 2 && avail === "free" && !!category && !creating;

  const create = async () => {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("create-business", {
      body: { name: name.trim(), username: username.trim().toLowerCase(), category },
    });
    setCreating(false);
    if (error) {
      let reason = error.message;
      try { const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context; if (ctx?.json) { const parsed = await ctx.json(); if (parsed?.error) reason = parsed.error; } } catch { /* keep original */ }
      setError(reason);
      return;
    }
    const biz = (data as { business?: { username?: string; name?: string } } | null)?.business;
    router.push(biz?.username ? "/" + biz.username : "/businesses");
  };

  const hint = avail === "checking" ? ["Checking...", "text-ink/45"] : avail === "free" ? ["Available", "text-success"] : avail === "taken" ? ["Already taken", "text-red-500"] : avail === "invalid" ? ["3 to 30 characters. Lowercase letters, numbers, underscores.", "text-ink/45"] : ["This becomes the business @handle.", "text-ink/35"];

  return (
    <div className="mx-auto max-w-[520px] px-1">
      <div className="flex items-center justify-between pb-4">
        <Link href="/businesses" className="inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"><ArrowLeft size={14} /> Businesses</Link>
        <button onClick={create} disabled={!canCreate} className="rounded-full bg-ink px-4 py-1.5 text-[13.5px] font-bold text-white disabled:opacity-40">{creating ? "Creating" : "Create"}</button>
      </div>
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><Briefcase size={19} className="text-pearl" /> New business</h1>
      <p className="pb-6 text-[13px] leading-relaxed text-ink/50">A business gets its own profile, followers, posts and chats. You stay signed in as yourself and choose who to post as.</p>

      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink/40">Business name</p>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Pearl Group" className="mb-5 w-full rounded-lg border border-ink/15 px-3.5 py-2.5 text-[14px] text-ink outline-none focus:border-ink/40" />

      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink/40">Username</p>
      <div className="mb-1.5 flex items-center gap-1.5 rounded-lg border border-ink/15 px-3.5 py-2.5">
        <span className="text-[14px] font-semibold text-ink/40">@</span>
        <input value={username} onChange={e => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())} placeholder="pearlgroup" className="w-full text-[14px] text-ink outline-none" />
        {avail === "free" ? <Check size={15} className="shrink-0 text-success" /> : avail === "taken" ? <X size={15} className="shrink-0 text-red-500" /> : null}
      </div>
      <p className={"mb-5 text-[12px] " + hint[1]}>{hint[0]}</p>

      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink/40">Category</p>
      <div className="mb-6 flex flex-wrap gap-1.5">
        {CATEGORIES.map(c => (
          <button key={c} onClick={() => setCategory(c)} className={"rounded-full border px-3 py-1.5 text-[12.5px] font-semibold " + (category === c ? "border-ink bg-ink text-white" : "border-ink/15 text-ink/60")}>{c}</button>
        ))}
      </div>

      <div className="rounded-lg border border-ink/10 bg-ink/[0.02] p-3">
        <p className="text-[12px] leading-relaxed text-ink/50">Nobody signs in as a business. Access is managed by adding people to its team from Studio Settings, so you never share a password.</p>
      </div>
      {error ? <p className="mt-3 text-[13px] text-red-500">{error}</p> : null}
    </div>
  );
}