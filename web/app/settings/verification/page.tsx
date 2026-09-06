"use client";
// Apply for verification, the web twin of the phone's ApplyVerificationScreen.
// Writes the same verification_applications rows, so the admin's verification
// desk sees applications from either platform in one queue.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BadgeCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const CATEGORIES = [
  "Musician & Artist", "Athlete & Sport", "Media & Journalist", "Creator & Entertainer",
  "Academic & Educator", "Business Executive & Founder", "Author & Public Voice", "Other",
];
type Tier = "public_figure" | "official" | "business";

export default function VerificationPage() {
  const supabase = useRef(createClient()).current;
  const [uid, setUid] = useState<string | null>(null);
  const [isBusiness, setIsBusiness] = useState(false);
  const [existing, setExisting] = useState<{ status?: string; created_at?: string; tier?: string } | null | undefined>(undefined);
  const [tier, setTier] = useState<Tier>("public_figure");
  const [category, setCategory] = useState<string | null>(null);
  const [links, setLinks] = useState("");
  const [statement, setStatement] = useState("");
  const [office, setOffice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const id = auth.user?.id ?? null;
      setUid(id);
      if (!id) { setExisting(null); return; }
      const { data: prof } = await supabase.from("profiles").select("account_type").eq("id", id).maybeSingle();
      const biz = prof?.account_type === "business";
      setIsBusiness(biz);
      if (biz) setTier("business");
      const { data } = await supabase.from("verification_applications").select("status, created_at, tier").eq("applicant_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      setExisting(data ?? null);
    })();
  }, [supabase]);

  const submit = async () => {
    setError(null);
    if (!uid) { setError("Sign in first."); return; }
    if (tier === "public_figure" && !category) { setError("Choose the category that fits you."); return; }
    if (tier === "official" && !office.trim()) { setError("State the office or position you hold."); return; }
    if (!statement.trim()) { setError("Write a short statement making your case."); return; }
    setBusy(true);
    try {
      const evidence = {
        links: links.split("\n").map((l) => l.trim()).filter(Boolean),
        statement: statement.trim(),
        ...(tier === "official" ? { office: office.trim() } : {}),
      };
      const { error: err } = await supabase.from("verification_applications").insert({
        applicant_id: uid,
        tier,
        category: tier === "public_figure" ? category : tier === "official" ? "Official" : "Business",
        evidence,
      });
      if (err) throw err;
      const { data } = await supabase.from("verification_applications").select("status, created_at, tier").eq("applicant_id", uid).order("created_at", { ascending: false }).limit(1).maybeSingle();
      setExisting(data ?? null);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message || "Could not submit. Try again.");
    } finally { setBusy(false); }
  };

  const field = "w-full rounded-xl border border-ink/12 bg-white px-3 py-2.5 text-[14px] text-ink outline-none placeholder:text-ink/35 focus:border-pearl";
  const pending = existing && existing.status !== "rejected";

  return (
    <div className="mx-auto max-w-[640px] px-4 py-6">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"><ArrowLeft size={14} /> Settings</Link>
      <h1 className="mt-4 flex items-center gap-2 font-display text-[24px] font-bold text-ink"><BadgeCheck size={22} className="text-pearl" /> Apply for verification</h1>
      <p className="mt-1 text-[13.5px] text-ink/60">A verified seal tells people the account is who it says it is. Applications are reviewed by a person, and you hear back in the app.</p>

      {existing === undefined ? null : pending ? (
        <div className="mt-6 rounded-2xl border border-ink/10 bg-surface p-4">
          <p className="text-[14px] font-semibold text-ink">{existing?.status === "approved" ? "Approved" : "Under review"}</p>
          <p className="mt-1 text-[13px] text-ink/60">{existing?.status === "approved" ? "Your seal is live." : "Your application is in the queue. You'll be notified when it's decided."}</p>
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          {!isBusiness ? (
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-ink/50">I am</p>
              <div className="mt-2 flex gap-2">
                {([["public_figure", "A public figure"], ["official", "An official"]] as [Tier, string][]).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setTier(k)} className={"rounded-full border px-3.5 py-1.5 text-[13px] font-semibold " + (tier === k ? "border-ink bg-ink text-white" : "border-ink/15 text-ink/70 hover:border-ink/40")}>{label}</button>
                ))}
              </div>
            </div>
          ) : null}
          {tier === "public_figure" ? (
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-ink/50">Category</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button key={c} type="button" onClick={() => setCategory(c)} className={"rounded-full border px-3 py-1 text-[12.5px] font-semibold " + (category === c ? "border-ink bg-ink text-white" : "border-ink/15 text-ink/70 hover:border-ink/40")}>{c}</button>
                ))}
              </div>
            </div>
          ) : null}
          {tier === "official" ? (
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-ink/50">Office or position</p>
              <input value={office} onChange={(e) => setOffice(e.target.value)} placeholder="e.g. Member of Parliament, Harare" className={field + " mt-2"} />
            </div>
          ) : null}
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-ink/50">Your case</p>
            <textarea value={statement} onChange={(e) => setStatement(e.target.value)} rows={4} placeholder={isBusiness ? "Registration number, how long established, public footprint..." : "Your reach, your work, why people look for you here..."} className={field + " mt-2 resize-none"} />
          </div>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-ink/50">Links, one per line</p>
            <textarea value={links} onChange={(e) => setLinks(e.target.value)} rows={3} placeholder={"Press coverage\nOfficial website\nOther profiles"} className={field + " mt-2 resize-none"} />
          </div>
          {error ? <p className="text-[13px] text-red-500">{error}</p> : null}
          <button type="button" disabled={busy} onClick={submit} className="rounded-full bg-ink px-5 py-2.5 text-[14px] font-bold text-white transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-50">{busy ? "Submitting" : "Submit application"}</button>
        </div>
      )}
    </div>
  );
}