"use client";
// Two-factor with an authenticator app, the web twin of the phone screen.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Factor = { id: string; status: string };

export default function TwoFactorPage() {
  const supabase = useRef(createClient()).current;
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((((data?.totp as unknown) as Factor[]) || []).filter((f) => f.status === "verified"));
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const start = async () => {
    setMsg(null);
    const { data: all } = await supabase.auth.mfa.listFactors();
    for (const f of (((all?.totp as unknown) as Factor[]) || [])) { if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id }); }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Platinum Circles" });
    if (error || !data) { setMsg(error?.message || "Could not start"); return; }
    const totp = (data as unknown as { totp?: { qr_code?: string; secret?: string } }).totp;
    setEnrolling({ id: data.id, qr: totp?.qr_code || "", secret: totp?.secret || "" }); setCode("");
  };
  const confirm = async () => {
    if (!enrolling) return;
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: enrolling.id });
    if (chErr || !ch) { setMsg(chErr?.message || "Could not confirm"); return; }
    const { error } = await supabase.auth.mfa.verify({ factorId: enrolling.id, challengeId: ch.id, code: code.trim() });
    if (error) { setMsg("Wrong code. " + error.message); return; }
    setEnrolling(null); setCode(""); setMsg("Two-factor is on."); load();
  };
  const turnOff = async (f: Factor) => {
    const entered = window.prompt("Enter the current code from your authenticator app to turn two-factor off.");
    if (!entered) return;
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: f.id });
    if (chErr || !ch) { setMsg(chErr?.message || "Could not verify"); return; }
    const { error: vErr } = await supabase.auth.mfa.verify({ factorId: f.id, challengeId: ch.id, code: entered.trim() });
    if (vErr) { setMsg("Wrong code."); return; }
    const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    if (error) { setMsg(error.message); return; }
    setMsg("Two-factor is off."); load();
  };
  const on = factors.length > 0;
  const btn = "rounded-full bg-ink px-5 py-2.5 text-[14px] font-bold text-white hover:opacity-90";

  return (
    <div className="mx-auto max-w-[640px] px-4 py-6">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"><ArrowLeft size={14} /> Settings</Link>
      <h1 className="mt-4 flex items-center gap-2 font-display text-[24px] font-bold text-ink"><ShieldCheck size={22} className="text-pearl" /> Two-factor authentication</h1>
      {enrolling ? (
        <div className="mt-5">
          <p className="text-[13.5px] text-ink/60">Scan this with Google Authenticator, Authy or any authenticator app, then enter the six-digit code it shows.</p>
          {enrolling.qr ? <div className="mt-4 inline-block rounded-2xl bg-white p-3" dangerouslySetInnerHTML={{ __html: enrolling.qr }} /> : null}
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-ink/50">Can't scan? Enter this key by hand</p>
          <p className="mt-1 select-all text-[14px] font-bold tracking-wider text-ink">{enrolling.secret}</p>
          <div className="mt-4 flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" inputMode="numeric" maxLength={6} className="w-40 rounded-xl border border-ink/12 bg-white px-3 py-2.5 text-center text-[16px] tracking-[0.3em] text-ink outline-none focus:border-pearl" />
            <button type="button" onClick={confirm} className={btn}>Confirm and turn on</button>
            <button type="button" onClick={async () => { await supabase.auth.mfa.unenroll({ factorId: enrolling.id }); setEnrolling(null); }} className="text-[13px] text-ink/60 hover:text-ink">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-ink/10 bg-surface p-4">
          <p className="text-[15px] font-bold text-ink">{on ? "On" : "Off"}</p>
          <p className="mt-1 text-[13.5px] text-ink/60">{on ? "Every sign-in asks for a code from your authenticator app after your password." : "Add a second step to signing in: a code from an authenticator app on your phone."}</p>
          <div className="mt-3">{on ? factors.map((f) => <button key={f.id} type="button" onClick={() => turnOff(f)} className="rounded-full bg-red-50 px-5 py-2.5 text-[14px] font-bold text-red-600 hover:opacity-90">Turn off</button>) : <button type="button" onClick={start} className={btn}>Turn on</button>}</div>
        </div>
      )}
      {msg ? <p className="mt-3 text-[13px] text-ink/70">{msg}</p> : null}
    </div>
  );
}