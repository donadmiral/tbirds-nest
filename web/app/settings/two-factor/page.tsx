"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAccountResource } from "@/lib/useAccountResource";
import { useViewerIdentity } from "@/lib/useViewerIdentity";
import { withTimeout } from "@/lib/withTimeout";
import { errorMessage } from "@/lib/errors";
import { ErrorState } from "@/components/ErrorState";

type Factor = { id: string; status: string };
async function fetchFactors(client: ReturnType<typeof createClient>): Promise<Factor[]> {
  const { data, error } = await client.auth.mfa.listFactors();
  if (error) throw error;
  return data.totp.filter(factor => factor.status === "verified");
}

export default function TwoFactorPage() {
  const identity = useViewerIdentity();
  if (identity.loading) return <p role="status" className="p-6 text-muted">Checking your account…</p>;
  if (identity.error) return <ErrorState title={identity.error} onRetry={identity.retry} />;
  if (!identity.viewer) return <p className="p-6 text-muted">Sign in to manage two-factor authentication.</p>;
  return <TwoFactorSettings key={identity.viewer.id} />;
}

function TwoFactorSettings() {
  const { client, data: factors, loading, error, retry, assertOwner } = useAccountResource(fetchFactors, []);
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const current = async () => {
    if (!live.current) throw new Error("This security screen is closed.");
    await assertOwner();
    if (!live.current) throw new Error("This security screen is closed.");
  };
  const run = async (action: () => Promise<void>) => {
    if (lock.current || !live.current) return;
    lock.current = true; setBusy(true); setFailure(null); setMessage(null);
    try { await current(); await action(); }
    catch (cause) { if (live.current) setFailure(errorMessage(cause, "This security change could not be confirmed. Please try again.")); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };

  const start = () => run(async () => {
    const { data: existing, error: readError } = await withTimeout(client.auth.mfa.listFactors());
    if (readError) throw readError;
    // An interrupted enrolment cannot recover its secret. Remove only this
    // application's unfinished factor before creating its replacement.
    for (const factor of existing.totp) {
      if (factor.status === "verified" || factor.friendly_name !== "Platinum Circles") continue;
      await current();
      const { error: removeError } = await withTimeout(client.auth.mfa.unenroll({ factorId: factor.id }));
      if (removeError) throw removeError;
    }
    await current();
    const { data, error: enrollError } = await withTimeout(client.auth.mfa.enroll({ factorType: "totp", friendlyName: "Platinum Circles" }));
    if (enrollError) throw enrollError;
    await current();
    setEnrolling({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret }); setCode("");
  });
  const confirm = () => run(async () => {
    if (!enrolling || !/^\d{6}$/.test(code)) throw new Error("Enter the six-digit code from your authenticator app.");
    const { data: challenge, error: challengeError } = await withTimeout(client.auth.mfa.challenge({ factorId: enrolling.id }));
    if (challengeError) throw challengeError;
    await current();
    const { error: verifyError } = await withTimeout(client.auth.mfa.verify({ factorId: enrolling.id, challengeId: challenge.id, code }));
    if (verifyError) throw verifyError;
    await current();
    setEnrolling(null); setCode(""); setMessage("Two-factor authentication is on."); retry();
  });
  const cancel = () => run(async () => {
    if (!enrolling) return;
    const { error: cancelError } = await withTimeout(client.auth.mfa.unenroll({ factorId: enrolling.id }));
    if (cancelError) throw cancelError;
    await current();
    setEnrolling(null); setCode(""); setMessage("Setup cancelled."); retry();
  });
  const turnOff = (factor: Factor) => {
    if (busy) return;
    const entered = window.prompt("Enter the current code from your authenticator app to remove this authenticator.");
    if (entered === null) return;
    void run(async () => {
      if (!/^\d{6}$/.test(entered.trim())) throw new Error("Enter a six-digit authenticator code.");
      const { data: challenge, error: challengeError } = await withTimeout(client.auth.mfa.challenge({ factorId: factor.id }));
      if (challengeError) throw challengeError;
      await current();
      const { error: verifyError } = await withTimeout(client.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code: entered.trim() }));
      if (verifyError) throw verifyError;
      await current();
      const { error: removeError } = await withTimeout(client.auth.mfa.unenroll({ factorId: factor.id }));
      if (removeError) throw removeError;
      await current();
      setMessage("Authenticator removed."); retry();
    });
  };
  const on = factors.length > 0;
  const button = "rounded-full bg-ink px-5 py-2.5 text-[14px] font-bold text-white hover:opacity-90 disabled:opacity-40";

  return <div className="mx-auto max-w-[640px] px-4 py-6">
    <h1 className="mt-4 flex items-center gap-2 font-display text-[24px] font-bold text-ink"><ShieldCheck size={22} className="text-accent" /> Two-factor authentication</h1>
    {error ? <ErrorState title={error} onRetry={retry} /> : loading ? <p role="status" className="py-6 text-muted">Loading authenticators…</p> : enrolling ? <div className="mt-5">
      <p className="text-[13.5px] text-ink/60">Scan this with your authenticator app, then enter the six-digit code it shows.</p>
      {enrolling.qr ? <div className="mt-4 inline-block rounded-2xl bg-white p-3"><Image src={enrolling.qr} alt="QR code to set up your authenticator" width={240} height={240} unoptimized /></div> : null}
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Cannot scan? Enter this key by hand</p>
      <p className="mt-1 select-all break-all text-[14px] font-bold tracking-wider text-ink">{enrolling.secret}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <input aria-label="Authenticator code" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} disabled={busy} placeholder="6-digit code" inputMode="numeric" maxLength={6} className="w-40 rounded-xl border border-ink/12 bg-white px-3 py-2.5 text-center text-[16px] tracking-[0.3em] text-ink" />
        <button type="button" onClick={confirm} disabled={busy || code.length !== 6} className={button}>Confirm and turn on</button>
        <button type="button" onClick={cancel} disabled={busy} className="text-[13px] text-ink/60 hover:text-ink disabled:opacity-40">Cancel</button>
      </div>
    </div> : <div className="mt-5 rounded-2xl border border-ink/10 bg-surface p-4">
      <p className="text-[15px] font-bold text-ink">{on ? "On" : "Off"}</p>
      <p className="mt-1 text-[13.5px] text-ink/60">{on ? "Your account has a verified authenticator for the additional sign-in step." : "Add a second step to signing in: a code from an authenticator app on your phone."}</p>
      <div className="mt-3">{on ? factors.map(factor => <button key={factor.id} type="button" onClick={() => turnOff(factor)} disabled={busy} className="rounded-full bg-red-50 px-5 py-2.5 text-[14px] font-bold text-danger hover:opacity-90 disabled:opacity-40">Remove authenticator</button>) : <button type="button" onClick={start} disabled={busy} className={button}>Turn on</button>}</div>
    </div>}
    {failure ? <p role="alert" className="mt-3 text-[13px] text-danger">{failure}</p> : null}
    {message ? <p role="status" className="mt-3 text-[13px] text-ink/70">{message}</p> : null}
  </div>;
}
