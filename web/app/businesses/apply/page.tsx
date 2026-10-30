"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Briefcase } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type App = { id: string; company_name: string; status: string; decision_reason: string | null };
type Avail = "idle" | "checking" | "free" | "taken" | "invalid" | "error";

export default function BusinessApplyPage() {
  const [supabase] = useState(createClient);
  const [uid, setUid] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [regInfo, setRegInfo] = useState("");
  const [handle, setHandle] = useState("");
  const [handleState, setHandleState] = useState<Avail>("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [apps, setApps] = useState<App[]>([]);
  const live = useRef(false);
  const account = useRef<string | null | undefined>(undefined);
  const accountVersion = useRef(0);
  const readVersion = useRef(0);
  const handleVersion = useRef(0);
  const actionVersion = useRef(0);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetForm = useCallback(() => {
    handleVersion.current++;
    if (timer.current) clearTimeout(timer.current);
    setCompanyName(""); setCategory(""); setDescription(""); setEmail("");
    setPhone(""); setWebsite(""); setRegInfo(""); setHandle(""); setHandleState("idle");
  }, []);

  const updateAccount = useCallback((next: string | null) => {
    if (next === account.current) return;
    account.current = next;
    accountVersion.current++;
    actionVersion.current++;
    pending.current = false;
    setUid(next); setApps([]); setBusy(null); setActionError(null); setNotice(null);
    resetForm();
  }, [resetForm]);

  const load = useCallback(async () => {
    if (!live.current) return;
    const request = ++readVersion.current;
    const current = () => live.current && request === readVersion.current;
    setLoading(true); setReadError(null);
    let confirmingAccount = true;
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (!current()) return;
      if (authError && authError.name !== "AuthSessionMissingError") throw authError;
      const me = auth.user?.id ?? null;
      updateAccount(me);
      setReady(true);
      if (!me) return;
      confirmingAccount = false;
      const { data, error } = await supabase.from("business_applications")
        .select("id, company_name, status, decision_reason")
        .eq("applicant_id", me).order("created_at", { ascending: false }).limit(5);
      if (!current()) return;
      if (error || !Array.isArray(data)) throw error || new Error("Missing application history");
      setApps(data);
    } catch {
      if (current()) setReadError(confirmingAccount
        ? "Your account could not be confirmed. Please try again."
        : "Applications could not be loaded. Please try again.");
    } finally {
      if (current()) { setLoading(false); setReady(true); }
    }
  }, [supabase, updateAccount]);

  useEffect(() => {
    live.current = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!live.current) return;
      const next = session?.user.id ?? null;
      if (next === account.current) return;
      readVersion.current++;
      updateAccount(next);
      setReadError(null); setReady(true); setLoading(!!next);
      // Leave the auth callback before starting another Supabase request.
      const version = accountVersion.current;
      queueMicrotask(() => { if (live.current && version === accountVersion.current && next) void load(); });
    });
    void load();
    return () => {
      live.current = false;
      readVersion.current++; handleVersion.current++; actionVersion.current++;
      if (timer.current) clearTimeout(timer.current);
      subscription.unsubscribe();
    };
  }, [supabase, load, updateAccount]);

  const openBusiness = async (applicationId: string) => {
    const owner = account.current;
    if (pending.current || !owner || !live.current) return;
    const request = ++actionVersion.current;
    const version = accountVersion.current;
    const current = () => live.current && request === actionVersion.current && version === accountVersion.current;
    pending.current = true; setBusy(applicationId); setActionError(null); setNotice(null);
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (!current()) return;
      if (authError || auth.user?.id !== owner) throw new Error("Personal account changed");
      const result = await supabase.functions.invoke("business-owner-access", { body: { application_id: applicationId } });
      if (!current()) return;
      if (result.error || !result.data?.token_hash) throw new Error("Business owner access could not be confirmed");
      const { data: latest, error: latestError } = await supabase.auth.getUser();
      if (!current()) return;
      if (latestError || latest.user?.id !== owner) throw new Error("Personal account changed");
      // This call intentionally switches to the approved business account.
      const verified = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: result.data.token_hash });
      if (!live.current) return;
      if (verified.error) throw verified.error;
      window.location.assign("/home");
    } catch {
      if (current()) setActionError("Business access could not be confirmed. Refresh this page and try again.");
    } finally {
      if (current()) { pending.current = false; setBusy(null); }
    }
  };

  const checkHandle = (value: string) => {
    if (pending.current || !live.current) return;
    const request = ++handleVersion.current;
    const version = accountVersion.current;
    const clean = value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    setHandle(clean);
    if (timer.current) clearTimeout(timer.current);
    if (!clean) { setHandleState("idle"); return; }
    if (!/^[a-z0-9_]{3,30}$/.test(clean)) { setHandleState("invalid"); return; }
    if (!account.current) { setHandleState("idle"); return; }
    setHandleState("checking");
    const current = () => live.current && request === handleVersion.current && version === accountVersion.current;
    timer.current = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc("is_username_available", { p_username: clean });
        if (!current()) return;
        if (error || typeof data !== "boolean") { setHandleState("error"); return; }
        setHandleState(data ? "free" : "taken");
      } catch {
        if (current()) setHandleState("error");
      }
    }, 400);
  };

  const submit = async () => {
    if (pending.current || !live.current) return;
    const owner = account.current;
    setActionError(null); setNotice(null);
    if (!owner) { setActionError("Sign in to your personal account before applying. It will become the verified owner of your business."); return; }
    if (!companyName.trim() || !description.trim() || !email.trim() || !handle) {
      setActionError("Company name, what you do, a contact email and a desired @ are required."); return;
    }
    if (!/^[a-z0-9_]{3,30}$/.test(handle) || handleState === "taken") {
      setActionError("Pick an available handle: 3 to 30 characters, letters, numbers and underscores."); return;
    }
    const request = ++actionVersion.current;
    const version = accountVersion.current;
    const current = () => live.current && request === actionVersion.current && version === accountVersion.current;
    pending.current = true; setBusy("submit");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (!current()) return;
      if (authError || auth.user?.id !== owner) throw new Error("Personal account changed");
      const payload = {
        company_name: companyName.trim(), category: category.trim() || null, description: description.trim(),
        contact_email: email.trim(), contact_phone: phone.trim() || null, website: website.trim() || null,
        registration_info: regInfo.trim() || null, desired_username: handle,
      };
      const { error } = await supabase.from("business_applications").insert({ applicant_id: owner, ...payload });
      if (!current()) return;
      if (error) throw error;
      resetForm();
      setNotice("Application sent. The outcome will appear in your applications below.");
      void load();
    } catch {
      if (current()) setActionError("Your application could not be sent. Your details are still here. Confirm your personal account and try again.");
    } finally {
      if (current()) { pending.current = false; setBusy(null); }
    }
  };

  const hint = handleState === "checking" ? "Checking availability..."
    : handleState === "free" ? "Available now" : handleState === "taken" ? "That handle is taken"
    : handleState === "invalid" ? "Use 3 to 30 lowercase letters, numbers or underscores."
    : handleState === "error" ? "Could not check availability. Please try again." : "Use 3 to 30 lowercase letters, numbers or underscores.";
  const hintColor = handleState === "free" ? "text-success" : ["taken", "invalid", "error"].includes(handleState) ? "text-danger" : "text-muted";
  const input = "mb-3 w-full rounded-lg border border-ink/15 bg-surface px-3.5 py-2.5 text-[14px] text-ink outline-none focus:border-ink/40 disabled:opacity-60";
  const label = "mb-1.5 block text-[13px] font-semibold text-ink";
  const pillCls = (status: string) => status === "approved" ? "bg-success/10 text-success" : status === "rejected" ? "bg-danger/10 text-danger" : "bg-warn/10 text-warn";
  const pillLabel = (status: string) => status === "approved" ? "Approved" : status === "rejected" ? "Declined" : "Under review";

  if (!ready) return <div className="mx-auto max-w-[560px] px-1"><p role="status" className="py-10 text-center text-sm text-muted">Loading</p></div>;

  return (
    <div className="mx-auto max-w-[560px] px-1">
      <Link href="/settings" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"><ArrowLeft size={14} aria-hidden="true" /> Settings</Link>
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><Briefcase size={19} aria-hidden="true" className="text-accent" /> Business account</h1>
      <p className="pb-5 text-[13px] leading-relaxed text-muted">A business gets its own separate account with its own @ and the space-grey seal. Tell us who you are. A person on the operations team reviews every application. You will be the first owner and can add your team after approval.</p>
      {!uid && !readError ? <p className="mb-4 text-sm text-muted"><Link href="/login" className="underline">Sign in to your personal account</Link> before applying. It will become the verified owner of your business.</p> : null}

      <form onSubmit={event => { event.preventDefault(); void submit(); }} aria-label="Business application" aria-busy={busy === "submit"}>
        <p className="mb-3 text-xs text-muted">All fields are required unless marked optional.</p>
        <fieldset disabled={busy !== null}>
          <label htmlFor="business-name" className={label}>Company or business name</label>
          <input id="business-name" name="company_name" required autoComplete="organization" value={companyName} onChange={e => setCompanyName(e.target.value)} className={input} />
          <label htmlFor="business-category" className={label}>Industry (optional)</label>
          <input id="business-category" name="category" value={category} onChange={e => setCategory(e.target.value)} placeholder="For example, Fintech, Retail or Media" className={input} />
          <label htmlFor="business-description" className={label}>About the business</label>
          <textarea id="business-description" name="description" required value={description} onChange={e => setDescription(e.target.value)} placeholder="What the business does, who runs it, and why it belongs on Platinum Circles" className={input + " min-h-24"} />
          <label htmlFor="business-email" className={label}>Business contact email</label>
          <input id="business-email" name="contact_email" required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className={input} />
          <label htmlFor="business-phone" className={label}>Business phone (optional)</label>
          <input id="business-phone" name="contact_phone" type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} className={input} />
          <label htmlFor="business-website" className={label}>Website (optional)</label>
          <input id="business-website" name="website" inputMode="url" autoComplete="url" value={website} onChange={e => setWebsite(e.target.value)} className={input} />
          <label htmlFor="business-registration" className={label}>Registration or license details (optional)</label>
          <input id="business-registration" name="registration_info" value={regInfo} onChange={e => setRegInfo(e.target.value)} className={input} />
          <label htmlFor="business-handle" className={label}>Desired @ for the business</label>
          <input id="business-handle" name="desired_username" required pattern="[a-z0-9_]{3,30}" maxLength={30} autoCapitalize="none" autoCorrect="off" spellCheck={false} value={handle} onChange={e => checkHandle(e.target.value)} aria-describedby="business-handle-hint" aria-invalid={handleState === "invalid" || handleState === "taken"} className={input} />
          <p id="business-handle-hint" role="status" aria-live="polite" className={"mb-3 text-xs " + hintColor}>{hint}</p>
          {handleState === "error" ? <button type="button" onClick={() => checkHandle(handle)} className="mb-3 text-sm text-ink underline">Retry availability</button> : null}
          <button type="submit" disabled={!uid} className="w-full rounded-xl bg-ink py-3 text-[14px] font-bold text-white disabled:opacity-40">{busy === "submit" ? "Sending..." : "Send application"}</button>
        </fieldset>
      </form>
      {actionError ? <p role="alert" className="mt-3 text-sm text-danger">{actionError}</p> : null}
      {notice ? <p role="status" className="mt-3 text-sm text-success">{notice}</p> : null}

      {uid || readError ? <section className="mt-7" aria-labelledby="business-applications-heading" aria-busy={loading}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="business-applications-heading" className="text-[11px] font-semibold uppercase tracking-wide text-muted">Your latest applications</h2>
          <button type="button" disabled={loading || busy !== null} onClick={() => { void load(); }} className="text-sm text-ink underline disabled:opacity-40">Refresh</button>
        </div>
        {readError ? <p role="alert" className="mb-3 text-sm text-danger">{readError} <button type="button" disabled={loading || busy !== null} onClick={() => { void load(); }} className="underline">Retry</button></p> : null}
        {loading ? <p role="status" className="mb-3 text-sm text-muted">Loading applications...</p> : null}
        {!loading && !readError && apps.length === 0 ? <p className="text-sm text-muted">You have no applications yet.</p> : null}
        {apps.map(a => (
          <div key={a.id} className="mb-2 rounded-xl border border-ink/10 p-3">
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 break-words text-[13.5px] font-bold text-ink">{a.company_name}</span>
              <span className={"shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold " + pillCls(a.status)}>{pillLabel(a.status)}</span>
            </span>
            {a.status === "approved" ? <button type="button" disabled={busy !== null} onClick={() => { void openBusiness(a.id); }} className="mt-2 text-sm font-semibold text-ink underline disabled:opacity-40">{busy === a.id ? "Opening business..." : "Open business"}</button> : null}
            {a.decision_reason ? <p className="mt-2 text-[12.5px] leading-relaxed text-ink/70">{a.status === "approved" ? "Approved. Open your business to manage access." : a.decision_reason}</p> : null}
          </div>
        ))}
      </section> : null}
    </div>
  );
}
