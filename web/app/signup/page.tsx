"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const input = "rounded-md bg-surface px-4 py-3 text-[15px] text-white placeholder:text-white/30 outline-none focus:bg-surface-elevated";

export default function SignUpPage() {
  const supabase = useRef(createClient()).current;
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function signUp() {
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = fullName.trim();
    if (pending || !cleanEmail || !cleanName || password.length < 6) {
      if (password.length > 0 && password.length < 6) setError("Password needs at least 6 characters.");
      return;
    }
    setPending(true);
    setError(null);
    const { error: err } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        emailRedirectTo: window.location.origin + "/login",
        data: { full_name: cleanName, account_type: "personal" },
      },
    });
    if (err && /already/i.test(err.message)) {
      await supabase.auth.resend({ type: "signup", email: cleanEmail, options: { emailRedirectTo: window.location.origin + "/login" } });
      setSent(true);
      setPending(false);
      return;
    }
    if (err) { setError(err.message); setPending(false); return; }
    setSent(true);
    setPending(false);
  }

  if (sent) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <span className="mx-auto mb-4 block h-10 w-10 rounded-full border-2 border-pearl" aria-hidden />
          <h1 className="font-display text-xl text-porcelain">Check your email</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-white/60">
            We sent a verification link to <span className="text-white">{email.trim().toLowerCase()}</span>. Open it, then sign in.
          </p>
          <Link href="/login" className="mt-6 inline-block rounded-md bg-pearl px-6 py-3 text-[15px] font-semibold text-ink">Go to sign in</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="h-9 w-9 rounded-full border-2 border-pearl" aria-hidden />
          <div>
            <h1 className="font-display text-xl text-porcelain">Create your account</h1>
            <p className="text-[12px] text-white/50">Join Platinum Circles</p>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <input className={input} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" />
          <input className={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" autoCapitalize="none" />
          <input className={input} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") signUp(); }} placeholder="Password, at least 6 characters" type="password" />
          {error ? <p className="text-[13px] text-danger">{error}</p> : null}
          <button onClick={signUp}
            disabled={pending || !fullName.trim() || !email.trim() || password.length < 6}
            className="rounded-md bg-pearl px-5 py-3 text-[15px] font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {pending ? "Creating" : "Create account"}
          </button>
        </div>
        <p className="mt-6 text-[13px] text-white/50">
          Already a member? <Link href="/login" className="text-pearl hover:underline">Sign in</Link>
        </p>
        <p className="mt-2 text-[13px] text-white/50">
          Company representative? <Link href="/business-login" className="text-pearl hover:underline">Business sign-in</Link>
        </p>
      </div>
    </main>
  );
}