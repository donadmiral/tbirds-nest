"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [supabase] = useState(() => createClient());
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // The existing browser client completes the PKCE recovery-code exchange
    // during initialization. Validate the resulting user before showing the form.
    void supabase.auth.getUser().then(({ data, error: authError }) => {
      if (active) setAuthenticated(!authError && Boolean(data.user));
    }).catch(() => {
      if (active) setAuthenticated(false);
    }).finally(() => {
      if (active) setChecking(false);
    });
    return () => { active = false; };
  }, [supabase]);

  async function savePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !authenticated) return;
    if (password.length < 6) { setError("Password needs at least 6 characters."); return; }
    if (password !== confirmation) { setError("The passwords do not match."); return; }
    setPending(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setPassword("");
      setConfirmation("");
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not update your password. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-xl text-ink">Choose a new password</h1>
        {checking ? <p role="status" className="mt-4 text-sm text-ink/70">Checking your reset link...</p>
          : saved ? <p role="status" className="mt-4 text-sm text-ink/70">Your password has been updated. You can sign in with the new password.</p>
          : !authenticated ? (
            <div className="mt-4 text-sm text-ink/70">
              <p role="alert">This reset link is missing, expired, or could not be verified. Request a new link and open it in the same browser.</p>
              <Link href="/forgot-password" className="mt-3 inline-block font-semibold text-ink underline">Request a new reset link</Link>
            </div>
          ) : (
            <form onSubmit={savePassword} className="mt-4 flex flex-col gap-3">
              <label htmlFor="new-password" className="text-sm text-ink">New password</label>
              <input id="new-password" type="password" required minLength={6} autoComplete="new-password"
                value={password} onChange={(event) => setPassword(event.target.value)}
                className="rounded-md bg-surface px-4 py-3 text-[15px] text-ink outline-none focus:bg-surface-elevated" />
              <label htmlFor="confirm-password" className="text-sm text-ink">Confirm new password</label>
              <input id="confirm-password" type="password" required minLength={6} autoComplete="new-password"
                value={confirmation} onChange={(event) => setConfirmation(event.target.value)}
                className="rounded-md bg-surface px-4 py-3 text-[15px] text-ink outline-none focus:bg-surface-elevated" />
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              <button type="submit" disabled={pending || password.length < 6 || !confirmation}
                className="rounded-md bg-navy px-5 py-3 text-[15px] font-semibold text-white disabled:opacity-40">
                {pending ? "Updating password..." : "Update password"}
              </button>
            </form>
          )}
        <Link href="/login" className="mt-6 inline-block text-sm font-semibold text-ink underline">Back to sign in</Link>
      </div>
    </main>
  );
}
