"use client";

import Link from "next/link";
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
    <main className="flex min-h-screen w-full flex-col md:flex-row" style={{ background: "#FFFFFF" }}>
      <section className="relative flex items-center justify-center px-8 py-10 md:w-1/2 md:py-0" style={{ background: "radial-gradient(120% 90% at 30% 20%, #1A3466 0%, #0B1E3D 60%, #081633 100%)" }} aria-hidden>
        <div className="relative w-[240px] md:w-[420px]">
          <div className="absolute left-1/2 -bottom-8 h-16 w-3/4 -translate-x-1/2 rounded-full" style={{ background: "rgba(0,0,0,0.55)", filter: "blur(22px)" }} />
          <img src="/brand/mark-navy.png" alt="" className="relative block w-full" style={{ filter: "drop-shadow(0 30px 40px rgba(0,0,0,0.45))" }} />
        </div>
      </section>
      <section className="flex flex-1 items-center justify-center px-6 py-12 md:py-0">
        <form onSubmit={signIn} className="flex w-full max-w-[380px] flex-col">
          <img src="/brand/wordmark-light.png" alt="Platinum Circles" className="mb-10 h-[34px] w-auto self-start" />
          <div className="flex flex-col gap-3">
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="Username or email"
              autoComplete="username"
              autoCapitalize="none"
              className="h-[54px] rounded-[14px] px-4 text-[15px] outline-none"
              style={{ background: "#FAFAF9", border: "1px solid rgba(11,30,61,0.10)", color: "#0B1E3D" }}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              className="h-[54px] rounded-[14px] px-4 text-[15px] outline-none"
              style={{ background: "#FAFAF9", border: "1px solid rgba(11,30,61,0.10)", color: "#0B1E3D" }}
            />
            {error ? <p className="text-sm" style={{ color: "#B3261E" }}>{error}</p> : null}
            <Link href="/forgot-password" className="self-end px-1 py-1 text-[13.5px] font-semibold" style={{ color: "rgba(11,30,61,0.55)" }}>Forgot password</Link>
            <button
              type="submit"
              disabled={pending || !identifier || !password}
              className="h-[54px] rounded-[14px] text-[16px] font-extrabold transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: "#0B1E3D", color: "#F5F3EF" }}
            >
              {pending ? "Signing in" : "Sign in"}
            </button>
          </div>
          <div className="mt-8 flex items-center justify-between text-[13.5px]" style={{ color: "rgba(11,30,61,0.55)" }}>
            <span>New here? <Link href="/signup" className="font-extrabold" style={{ color: "#0B1E3D" }}>Create an account</Link></span>
            <Link href="/business-login" className="text-[12.5px] font-semibold">Business sign-in</Link>
          </div>
        </form>
      </section>
    </main>
  );
}