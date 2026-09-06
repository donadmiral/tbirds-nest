"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/ui";
type AccountClass = "personal" | "creator" | "business";
const ACCOUNT_CLASSES: AccountClass[] = ["personal", "creator", "business"];

// The same four root classes as the phone. Verification stays a separate label;
// recruiter, seller, advertiser and moderator are organization permissions.
const COPY: Record<AccountClass, { title: string; desc: string }> = {
  personal: { title: "Personal", desc: "A person sharing with their circle." },
  creator: { title: "Creator", desc: "Public figure, artist, athlete, journalist, educator or influencer. Adds creator insights." },
  business: { title: "Business", desc: "Opens the Studio on this account: catalogue, storefront, inbox, ads and team. Verification is applied for separately." },
};

export default function AccountTypePage() {
  const sb = createClient();
  const [uid, setUid] = useState<string | null>(null);
  const [current, setCurrent] = useState<AccountClass>("personal");
  const [saving, setSaving] = useState<AccountClass | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: sess } = await sb.auth.getSession();
      const id = sess.session?.user.id ?? null; setUid(id);
      if (!id) return;
      const { data } = await sb.from("profiles").select("account_class, account_type").eq("id", id).maybeSingle();
      if (data) setCurrent(data.account_type === "business" ? "business" : data.account_class === "creator" ? "creator" : "personal");
    })();
  }, []);

  async function choose(c: AccountClass) {
    if (!uid || saving) return;
    setSaving(c); setErr(null);
    const patch = c === "business" ? { account_type: "business", account_class: "organization" } : { account_type: "personal", account_class: c };
    const { error } = await sb.from("profiles").update(patch).eq("id", uid);
    if (!error && c === "business") {
      const { data: bp } = await sb.from("business_profiles").select("id").eq("profile_id", uid).limit(1).maybeSingle();
      if (!bp) { await sb.from("business_profiles").insert({ owner_id: uid, profile_id: uid, name: "My business" }); }
    }
    if (error) setErr(error.message); else setCurrent(c);
    setSaving(null);
  }

  return (
    <div className="mx-auto max-w-[640px] px-4 pb-16">
      <PageHeader title="Account type" subtitle="Which kind of account this is" />
      <p className="mb-4 text-[13.5px] text-ink/60">Switch any time; nothing is deleted. Business opens the Studio on this account. Verification is applied for separately.</p>
      <div className="flex flex-col gap-2.5">
        {ACCOUNT_CLASSES.map((c) => {
          const on = current === c;
          return (
            <button key={c} type="button" onClick={() => choose(c)} disabled={!!saving}
              className={"flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors " + (on ? "border-ink bg-[#C9BFB0]/25" : "border-ink/12 bg-white hover:border-ink/30")}>
              <span className={"mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 " + (on ? "border-ink bg-ink" : "border-ink/30")} />
              <span className="min-w-0">
                <span className="block text-[15px] font-extrabold text-ink">{COPY[c].title}{saving === c ? " ..." : ""}</span>
                <span className="block text-[13px] leading-snug text-ink/60">{COPY[c].desc}</span>
              </span>
            </button>
          );
        })}
      </div>
      {err ? <p className="mt-3 text-[13px] text-red-700">{err}</p> : null}
    </div>
  );
}
