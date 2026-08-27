"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Strike = { id: string; level: string; reason: string | null; created_at: string };
const LEVEL_LABEL: Record<string, string> = { warn: "Warning", restrict: "Restriction", suspend: "Suspension", ban: "Ban" };

export default function AccountStandingPage() {
  const supabase = useRef(createClient()).current;
  const [rows, setRows] = useState<Strike[] | null>(null);
  const [restrictedUntil, setRestrictedUntil] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) { setRows([]); return; }
      const [{ data: strikes }, { data: prof }] = await Promise.all([
        supabase.from("member_strikes").select("id, level, reason, created_at").order("created_at", { ascending: false }).limit(20),
        supabase.from("profiles").select("restricted_until").eq("id", auth.user.id).single(),
      ]);
      setRows((strikes as Strike[]) ?? []);
      setRestrictedUntil(prof?.restricted_until ?? null);
    })();
  }, [supabase]);

  const restrictionActive = !!restrictedUntil && new Date(restrictedUntil).getTime() > Date.now();
  const severe = (l: string) => l === "suspend" || l === "ban";

  return (
    <div className="mx-auto max-w-[560px] px-1">
      <Link href="/settings" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"><ArrowLeft size={14} /> Settings</Link>
      <h1 className="pb-1 font-display text-xl text-porcelain">Account standing</h1>
      <p className="pb-5 text-[13px] text-ink/50">Every strike issued against your account, or a clean bill when there is nothing.</p>
      {rows === null ? <p className="py-10 text-center text-sm text-ink/40">Loading</p> : (
        <>
          {restrictionActive ? (
            <div className="mb-5 flex items-center gap-2 rounded-xl border border-amber-300/50 bg-amber-50 p-3">
              <AlertTriangle size={16} className="shrink-0 text-amber-700" />
              <p className="text-[12.5px] font-semibold text-amber-700">Posting and listing are restricted until {new Date(restrictedUntil!).toLocaleString()}. The limit lifts automatically.</p>
            </div>
          ) : (
            <div className="mb-5 flex items-center gap-2 rounded-xl border border-success/30 bg-success/5 p-3">
              <CheckCircle2 size={16} className="shrink-0 text-success" />
              <p className="text-[12.5px] font-semibold text-success">{rows.length ? "No active restriction on the account." : "Good standing. No strikes on this account."}</p>
            </div>
          )}
          {rows.length ? <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink/40">Record</p> : null}
          {rows.map(r => (
            <div key={r.id} className="mb-2 flex items-start gap-3 rounded-xl border border-ink/10 p-3">
              <span className={"shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold " + (severe(r.level) ? "bg-red-500/10 text-red-500" : "bg-amber-500/10 text-amber-700")}>{LEVEL_LABEL[r.level] || "Warning"}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-ink">{r.reason || "No reason recorded"}</p>
                <p className="mt-1 text-[11px] text-ink/40">{new Date(r.created_at).toLocaleString()}</p>
              </div>
            </div>
          ))}
          <p className="mt-4 text-[11.5px] leading-relaxed text-ink/40">Strikes are issued by Platinum Circles operations when the rules are broken. If you believe one is wrong, write to the team from Contact support.</p>
        </>
      )}
    </div>
  );
}
