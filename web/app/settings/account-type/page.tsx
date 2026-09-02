"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/ui";
import { ACCOUNT_CLASSES, type AccountClass } from "@/lib/org";

// The same four root classes as the phone. Verification stays a separate label;
// recruiter, seller, advertiser and moderator are organization permissions.
const COPY: Record<AccountClass, { title: string; desc: string }> = {
  personal: { title: "Personal", desc: "A person sharing with their circle." },
  creator: { title: "Creator", desc: "Public figure, artist, athlete, journalist, educator or influencer. Unlocks creator insights." },
  organization: { title: "Organization", desc: "Business, government, nonprofit, media, school, employer or political account. Subtype and team are managed in Studio." },
  automated: { title: "Automated", desc: "A bot or service account. Labelled as automated on the profile." },
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
      const { data } = await sb.from("profiles").select("account_class").eq("id", id).maybeSingle();
      if (data?.account_class) setCurrent(data.account_class as AccountClass);
    })();
  }, []);

  async function choose(c: AccountClass) {
    if (!uid || saving) return;
    setSaving(c); setErr(null);
    const { error } = await sb.from("profiles").update({ account_class: c }).eq("id", uid);
    if (error) setErr(error.message); else setCurrent(c);
    setSaving(null);
  }

  return (
    <div className="mx-auto max-w-[640px] px-4 pb-16">
      <PageHeader title="Account type" subtitle="Which kind of account this is" />
      <p className="mb-4 text-[13.5px] text-ink/60">Verification is a label you apply for separately. Recruiter, seller, advertiser and moderator are team permissions inside an organization, not account types.</p>
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
