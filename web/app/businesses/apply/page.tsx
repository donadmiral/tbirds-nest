"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Briefcase } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type App = { id: string; company_name: string; status: string; decision_reason: string | null };
type Avail = "idle" | "checking" | "free" | "taken" | "invalid";

export default function BusinessApplyPage() {
  const supabase = useRef(createClient()).current;
  const [uid, setUid] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [regInfo, setRegInfo] = useState("");
  const [handle, setHandle] = useState("");
  const [handleState, setHandleState] = useState<Avail>("idle");
  const [busy, setBusy] = useState(false);
  const [apps, setApps] = useState<App[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (me: string) => {
    const { data } = await supabase.from("business_applications").select("id, company_name, status, decision_reason")
      .eq("applicant_id", me).order("created_at", { ascending: false }).limit(5);
    setApps(data ?? []);
  }, [supabase]);

  useEffect(() => {
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const me = auth.user?.id ?? null;
      setUid(me);
      if (me) await load(me);
      setReady(true);
    })();
  }, [supabase, load]);

  const checkHandle = (v: string) => {
    const clean = v.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    setHandle(clean);
    if (timer.current) clearTimeout(timer.current);
    if (!clean) { setHandleState("idle"); return; }
    if (!/^[a-z0-9_]{3,30}$/.test(clean)) { setHandleState("invalid"); return; }
    if (!uid) return; // availability confirmed at review time when applying signed out, same as the phone
    setHandleState("checking");
    timer.current = setTimeout(async () => {
      const { data } = await supabase.rpc("is_username_available", { p_username: clean });
      setHandleState(data ? "free" : "taken");
    }, 400);
  };

  const submit = async () => {
    if (busy) return;
    if (!companyName.trim() || !description.trim() || !email.trim() || !handle) {
      alert("Company name, what you do, a contact email and a desired @ are required.");
      return;
    }
    if (handleState === "taken" || handleState === "invalid") {
      alert("Pick an available handle: 3 to 30 characters, letters, numbers and underscores.");
      return;
    }
    setBusy(true);
    const payload = {
      company_name: companyName.trim(), category: category.trim() || null, description: description.trim(),
      contact_email: email.trim(), contact_phone: phone.trim() || null, website: website.trim() || null,
      registration_info: regInfo.trim() || null, desired_username: handle,
    };
    if (!uid) {
      const { data, error } = await supabase.functions.invoke("business-apply", { body: payload });
      setBusy(false);
      const errMsg = error ? ((data as { error?: string } | null)?.error || "Could not send the application.") : (data as { error?: string } | null)?.error;
      if (errMsg) { alert(errMsg); return; }
      setCompanyName(""); setCategory(""); setDescription(""); setEmail(""); setPhone(""); setWebsite(""); setRegInfo(""); setHandle(""); setHandleState("idle");
      alert("Application sent. The Platinum Circles operations team reviews every business application. On approval your business account is created with its own @, the space-grey seal, and a setup code sent to your contact email.");
      return;
    }
    const { error } = await supabase.from("business_applications").insert({ applicant_id: uid, ...payload });
    setBusy(false);
    if (error) { alert("Could not send: " + error.message); return; }
    setCompanyName(""); setCategory(""); setDescription(""); setEmail(""); setPhone(""); setWebsite(""); setRegInfo(""); setHandle(""); setHandleState("idle");
    await load(uid);
    alert("Application sent. The outcome will appear here, and on approval your business account is created with its own @ and the space-grey seal.");
  };

  const hint = handleState === "checking" ? ["Checking...", "text-ink/45"] : handleState === "free" ? ["Available", "text-success"] : handleState === "taken" ? ["That handle is taken", "text-red-500"] : handleState === "invalid" ? ["3 to 30 characters. Lowercase letters, numbers, underscores.", "text-red-500"] : ["", ""];

  const input = "mb-2.5 w-full rounded-lg border border-ink/15 px-3.5 py-2.5 text-[14px] text-ink outline-none focus:border-ink/40";
  const pillCls = (status: string) => status === "approved" ? "bg-success/10 text-success" : status === "rejected" ? "bg-red-500/10 text-red-500" : "bg-amber-500/10 text-amber-700";
  const pillLabel = (status: string) => status === "approved" ? "Approved" : status === "rejected" ? "Declined" : "Under review";

  if (!ready) return <div className="mx-auto max-w-[560px] px-1"><p className="py-10 text-center text-sm text-ink/40">Loading</p></div>;

  return (
    <div className="mx-auto max-w-[560px] px-1">
      <Link href="/settings" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"><ArrowLeft size={14} /> Settings</Link>
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><Briefcase size={19} className="text-pearl" /> Business account</h1>
      <p className="pb-5 text-[13px] leading-relaxed text-ink/50">A business gets its own separate account with its own @ and the space-grey seal. Tell us who you are — a person on the operations team reviews every application. You will be the first owner and can add your team after approval.</p>

      <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Company or business name" className={input} />
      <input value={category} onChange={e => setCategory(e.target.value)} placeholder="What industry (e.g. Fintech, Retail, Media)" className={input} />
      <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What the business does, who runs it, and why it belongs on Platinum Circles" className={input + " h-24"} />
      <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Business contact email" className={input} />
      <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Business phone (optional)" className={input} />
      <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="Website (optional)" className={input} />
      <input value={regInfo} onChange={e => setRegInfo(e.target.value)} placeholder="Registration or license details (optional)" className={input} />
      <input value={handle} onChange={e => checkHandle(e.target.value)} placeholder="Desired @ for the business" className={input} />
      {hint[0] ? <p className={"mb-3 -mt-1.5 pl-1 text-[12px] font-semibold " + hint[1]}>{hint[0]}</p> : null}

      <button onClick={submit} disabled={busy} className="w-full rounded-xl bg-ink py-3 text-[14px] font-bold text-white disabled:opacity-40">{busy ? "Sending" : "Send application"}</button>

      {apps.length ? <p className="mb-2 mt-7 text-[11px] font-semibold uppercase tracking-wide text-ink/40">Your applications</p> : null}
      {apps.map(a => (
        <div key={a.id} className="mb-2 rounded-xl border border-ink/10 p-3">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-ink">{a.company_name}</span>
            <span className={"shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold " + pillCls(a.status)}>{pillLabel(a.status)}</span>
          </span>
          {a.decision_reason ? <p className="mt-2 text-[12.5px] leading-relaxed text-ink/70">{a.decision_reason}</p> : null}
        </div>
      ))}
    </div>
  );
}