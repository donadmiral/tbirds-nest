"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [supabase] = useState(() => createClient());
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: new URL("/reset-password", window.location.origin).href,
      });
      if (resetError) throw resetError;
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not request a reset link. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-xl text-ink">Reset your password</h1>
        {sent ? (
          <p role="status" className="mt-4 text-[14px] leading-relaxed text-ink/70">
            If an account uses that email address, you will receive a password reset link. Open it in this browser to choose a new password.
          </p>
        ) : (
          <form onSubmit={requestReset} className="mt-4 flex flex-col gap-3">
            <p className="text-[14px] leading-relaxed text-ink/70">Enter the email address for your account.</p>
            <label htmlFor="reset-email" className="text-sm text-ink">Email address</label>
            <input id="reset-email" type="email" required autoComplete="email" autoCapitalize="none"
              value={email} onChange={(event) => setEmail(event.target.value)}
              className="rounded-md bg-surface px-4 py-3 text-[15px] text-ink outline-none focus:bg-surface-elevated" />
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <button type="submit" disabled={pending || !email.trim()}
              className="rounded-md bg-navy px-5 py-3 text-[15px] font-semibold text-white disabled:opacity-40">
              {pending ? "Requesting link..." : "Send reset link"}
            </button>
          </form>
        )}
        <Link href="/login" className="mt-6 inline-block text-sm font-semibold text-ink underline">Back to sign in</Link>
      </div>
    </main>
  );
}
