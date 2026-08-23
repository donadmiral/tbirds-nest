"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const DEVICE_KEY = "pc_business_device_id";

function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "web-unknown-device";
  }
}

export default function BusinessLoginPage() {
  const supabase = useRef(createClient()).current;
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    if (pending || !handle.trim() || !code.trim()) return;
    setPending(true);
    setError(null);
    const { data, error: fnErr } = await supabase.functions.invoke("business-signin", {
      body: { handle: handle.trim(), code: code.trim(), device_id: getDeviceId(), device_label: "Web browser" },
    });
    if (fnErr) {
      let msg = fnErr.message;
      try {
        const ctx = (fnErr as { context?: Response }).context;
        if (ctx) { const j = await ctx.json(); if (j?.error) msg = j.error; }
      } catch { /* keep the generic message */ }
      setError(msg);
      setPending(false);
      return;
    }
    const tokenHash = (data as { token_hash?: string } | null)?.token_hash;
    if (!tokenHash) { setError((data as { error?: string } | null)?.error || "Sign-in did not return a session."); setPending(false); return; }
    const { error: vErr } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (vErr) { setError(vErr.message); setPending(false); return; }
    router.push("/home");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy text-pearl"><Building2 size={20} /></span>
          <div>
            <h1 className="font-display text-xl text-porcelain">Business sign-in</h1>
            <p className="text-[12px] text-white/50">For company representatives</p>
          </div>
        </div>

        <p className="mb-5 text-[13px] leading-relaxed text-white/60">
          Enter your business handle and your personal access code. This works only on devices your company has registered. The first device a business uses is trusted automatically.
        </p>

        <div className="flex flex-col gap-3">
          <input value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="Business handle"
            autoCapitalize="none"
            className="rounded-md bg-surface px-4 py-3 text-[15px] text-white placeholder:text-white/30 outline-none focus:bg-surface-elevated"
          />
          <input value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") signIn(); }}
            placeholder="Your access code"
            type="password"
            className="rounded-md bg-surface px-4 py-3 text-[15px] text-white placeholder:text-white/30 outline-none focus:bg-surface-elevated"
          />
          {error ? <p className="text-[13px] text-danger">{error}</p> : null}
          <button onClick={signIn}
            disabled={pending || !handle.trim() || !code.trim()}
            className="rounded-md bg-pearl px-5 py-3 text-[15px] font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {pending ? "Signing in" : "Sign in as the business"}
          </button>
        </div>

        <p className="mt-5 text-[12px] leading-relaxed text-white/40">
          Every sign-in is recorded with the member and device. Access is revocable by the company at any moment.
        </p>
        <p className="mt-6 text-[13px] text-white/50">
          Personal account? <Link href="/login" className="text-pearl hover:underline">Sign in here</Link>
        </p>
      </div>
    </main>
  );
}