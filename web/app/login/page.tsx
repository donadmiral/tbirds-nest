"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      if (identifier.includes("@") && identifier.includes(".")) {
        const { error } = await supabase.auth.signInWithPassword({
          email: identifier.trim(),
          password,
        });
        if (error) throw new Error("Invalid email or password");
      } else {
        const { data, error } = await supabase.functions.invoke(
          "sign-in-with-username",
          { body: { username: identifier, password } }
        );
        if (error || !data?.session)
          throw new Error("Invalid username or password");
        const { error: setErr } = await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        if (setErr) throw setErr;
      }
      router.push("/home");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center gap-5">
          <div
            className="h-14 w-14 rounded-full border-2 border-pearl"
            style={{ boxShadow: "0 0 40px rgba(201, 191, 176, 0.25)" }}
            aria-hidden
          />
          <h1 className="font-display text-3xl tracking-wide text-porcelain">
            Platinum Circles
          </h1>
        </div>
        <form onSubmit={signIn} className="flex flex-col gap-3">
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="Username or email"
            autoComplete="username"
            autoCapitalize="none"
            className="rounded-md bg-surface px-4 py-3 text-[15px] text-white placeholder:text-white/30 outline-none focus:bg-surface-elevated"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            className="rounded-md bg-surface px-4 py-3 text-[15px] text-white placeholder:text-white/30 outline-none focus:bg-surface-elevated"
          />
          {error ? (
            <p className="text-sm text-danger">{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={pending || !identifier || !password}
            className="mt-2 rounded-md bg-pearl px-4 py-3 text-[15px] font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {pending ? "Signing in" : "Sign in"}
          </button>
        <p className="mt-6 text-[13px] text-white/50">New here? <a href="/signup" className="text-pearl hover:underline">Create an account</a></p>
        <p className="mt-2 text-[13px] text-white/50">Company representative? <a href="/business-login" className="text-pearl hover:underline">Business sign-in</a></p>
        </form>
        <p className="mt-8 text-center text-sm text-white/40">
          New here? Create your account in the Platinum Circles app.
        </p>
      </div>
    </main>
  );
}