"use client";
// Apply for verification, the web twin of the phone's ApplyVerificationScreen.
// Writes the same verification_applications rows, so the admin's verification
// desk sees applications from either platform in one queue.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BadgeCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

import { currentVerificationStatus, prepareVerificationEvidence, verificationError, type VerificationApplication, type VerificationProfile } from "../../../../shared/verification";

const CATEGORIES = [
  "Musician & Artist", "Athlete & Sport", "Media & Journalist", "Creator & Entertainer",
  "Academic & Educator", "Business Executive & Founder", "Author & Public Voice", "Other",
];
type Tier = "public_figure" | "official" | "business";

export default function VerificationPage() {
  const supabase = useRef(createClient()).current;
  const [uid, setUid] = useState<string | null>(null);
  const [isBusiness, setIsBusiness] = useState(false);
  const [existing, setExisting] = useState<VerificationApplication | null | undefined>(undefined);
  const [currentProfile, setCurrentProfile] = useState<VerificationProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const [tier, setTier] = useState<Tier>("public_figure");
  const [category, setCategory] = useState<string | null>(null);
  const [links, setLinks] = useState("");
  const [statement, setStatement] = useState("");
  const [office, setOffice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoadError(null);
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      const id = auth.user?.id ?? null;
      if (generation !== loadGeneration.current) return;
      setUid(id);
      if (!id) { setExisting(null); setCurrentProfile(null); return; }
      const [profileResult, appResult] = await Promise.all([
        supabase.from("profiles").select("account_type,is_verified,verified_tier").eq("id", id).single(),
        supabase.from("verification_applications").select("status,created_at,tier,decision_reason").eq("applicant_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (appResult.error) throw appResult.error;
      if (generation !== loadGeneration.current) return;
      setCurrentProfile(profileResult.data);
      const biz = profileResult.data.account_type === "business";
      setIsBusiness(biz);
      setTier(value => biz ? "business" : value === "business" ? "public_figure" : value);
      setExisting(appResult.data ?? null);
    } catch (failure) {
      if (generation === loadGeneration.current) setLoadError(verificationError(failure));
    }
  }, [supabase]);
  useEffect(() => {
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", refresh);
    return () => { ++loadGeneration.current; document.removeEventListener("visibilitychange", refresh); };
  }, [load]);

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (!uid) { setError("Sign in first."); return; }
    setBusy(true);
    try {
      const evidence = prepareVerificationEvidence(tier, category, statement, links, office);
      const { error: err } = await supabase.from("verification_applications").insert({
        applicant_id: uid,
        tier,
        category: tier === "public_figure" ? category : tier === "official" ? "Official" : "Business",
        evidence,
      });
      if (err) throw err;
      await load();
    } catch (e: unknown) {
      setError(verificationError(e));
    } finally { setBusy(false); }
  };

  const field = "w-full rounded-xl border border-ink/12 bg-white px-3 py-2.5 text-[14px] text-ink outline-none placeholder:text-muted focus:border-pearl";
  const status = currentVerificationStatus(existing ?? null, currentProfile);
  const pending = status === "approved" || status === "submitted" || status === "under_review";

  return (
    <div className="mx-auto max-w-[640px] px-4 py-6">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"><ArrowLeft size={14} /> Settings</Link>
      <h1 className="mt-4 flex items-center gap-2 font-display text-[24px] font-bold text-ink"><BadgeCheck size={22} className="text-accent" /> Apply for verification</h1>
      <p className="mt-1 text-[13.5px] text-ink/60">A verified seal tells people the account is who it says it is. Applications are reviewed by a person, and you hear back in the app.</p>

      {loadError ? <div role="alert" className="mt-6 rounded-xl border border-ink/15 p-4"><p>{loadError}</p><button onClick={() => void load()} className="mt-2 underline">Retry</button></div> : existing === undefined ? <p role="status" className="mt-6 text-muted">Loading verification…</p> : !uid ? <p className="mt-6">Sign in to apply for verification.</p> : pending ? (
        <div className="mt-6 rounded-2xl border border-ink/10 bg-surface p-4">
          <p className="text-[14px] font-semibold text-ink">{status === "approved" ? "Approved" : "Under review"}</p>
          <p className="mt-1 text-[13px] text-ink/60">{status === "approved" ? "Your seal is live." : "Your application is in the queue. You'll be notified when it's decided."}</p>
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          {status === "rejected" || status === "revoked" ? <div role="status" className="rounded-xl border border-ink/15 p-4"><p className="font-semibold">{status === "revoked" ? "Verification is no longer active." : "Your application was not approved."}</p>{status === "rejected" && existing?.decision_reason ? <p className="mt-1 text-sm">{existing.decision_reason}</p> : null}<p className="mt-1 text-sm">You can submit updated evidence below or contact support in Settings.</p></div> : null}
          {!isBusiness ? (
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">I am</p>
              <div className="mt-2 flex gap-2">
                {([["public_figure", "A public figure"], ["official", "An official"]] as [Tier, string][]).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setTier(k)} className={"rounded-full border px-3.5 py-1.5 text-[13px] font-semibold " + (tier === k ? "border-ink bg-ink text-white" : "border-ink/15 text-ink/70 hover:border-ink/40")}>{label}</button>
                ))}
              </div>
            </div>
          ) : null}
          {tier === "public_figure" ? (
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Category</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button key={c} type="button" onClick={() => setCategory(c)} className={"rounded-full border px-3 py-1 text-[12.5px] font-semibold " + (category === c ? "border-ink bg-ink text-white" : "border-ink/15 text-ink/70 hover:border-ink/40")}>{c}</button>
                ))}
              </div>
            </div>
          ) : null}
          {tier === "official" ? (
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Office or position</p>
              <input value={office} maxLength={200} onChange={(e) => setOffice(e.target.value)} placeholder="e.g. Member of Parliament, Harare" className={field + " mt-2"} />
            </div>
          ) : null}
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Your case</p>
            <textarea value={statement} onChange={(e) => setStatement(e.target.value)} rows={4} maxLength={2000} placeholder={isBusiness ? "Registration number, how long established, public footprint..." : "Your reach, your work, why people look for you here..."} className={field + " mt-2 resize-none"} />
          </div>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Evidence links (1–8), one per line</p>
            <textarea value={links} onChange={(e) => setLinks(e.target.value)} rows={3} placeholder={"https://example.com/official-profile\nhttps://example.com/press-coverage"} className={field + " mt-2 resize-none"} />
          </div>
          <p className="text-[12px] text-muted">Link to public evidence of your identity and authority. Do not include identity documents or private credentials. Verification is not an endorsement.</p>
          {error ? <p className="text-[13px] text-danger">{error}</p> : null}
          <button type="button" disabled={busy} onClick={submit} className="rounded-full bg-ink px-5 py-2.5 text-[14px] font-bold text-white transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-50">{busy ? "Submitting" : "Submit application"}</button>
        </div>
      )}
    </div>
  );
}