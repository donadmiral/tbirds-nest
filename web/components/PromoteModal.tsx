"use client";

import { useState } from "react";
import { Megaphone, X } from "lucide-react";
import { createPromo } from "@/lib/ads";

export function PromoteModal({ postId, onClose }: { postId: string; onClose: () => void }) {
  const [label, setLabel] = useState("Sponsored");
  const [days, setDays] = useState<string>("7");
  const [cap, setCap] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function promote() {
    if (pending) return;
    setPending(true);
    setError(null);
    const d = Number(days);
    const endsAt = d > 0 ? new Date(Date.now() + d * 86400000).toISOString() : null;
    const totalCap = cap.trim() ? Number(cap.replace(/,/g, "")) || null : null;
    const id = await createPromo(postId, { label, endsAt, totalCap });
    setPending(false);
    if (!id) { setError("Could not start the promotion."); return; }
    setDone(true);
    setTimeout(onClose, 1100);
  }

  const input = "rounded-md bg-surface px-3 py-2.5 text-[14px] text-white placeholder:text-white/30 outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-xl border border-white/10 bg-navy p-5">
        <div className="flex items-center justify-between pb-3">
          <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-white"><Megaphone size={16} className="text-pearl" /> Promote this post</h2>
          <button onClick={onClose} title="Close" className="rounded-full p-1 text-white/50 hover:bg-surface hover:text-white"><X size={16} /></button>
        </div>
        {done ? (
          <p className="py-8 text-center text-[14px] text-success">Promotion is live. Track it in Ads.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="text-[12px] text-white/50">
              Label shown on the ad
              <input className={input + " mt-1 w-full"} value={label} onChange={(e) => setLabel(e.target.value)} />
            </label>
            <label className="text-[12px] text-white/50">
              Run for
              <select className={input + " mt-1 w-full"} value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="1" className="bg-navy">1 day</option>
                <option value="7" className="bg-navy">7 days</option>
                <option value="30" className="bg-navy">30 days</option>
                <option value="0" className="bg-navy">Until I stop it</option>
              </select>
            </label>
            <label className="text-[12px] text-white/50">
              Impression cap, optional
              <input className={input + " mt-1 w-full"} inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="e.g. 5000" />
            </label>
            {error ? <p className="text-[13px] text-danger">{error}</p> : null}
            <button onClick={promote} disabled={pending} className="rounded-md bg-pearl px-5 py-2.5 text-[14px] font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-40">
              {pending ? "Starting" : "Start promotion"}
            </button>
            <p className="text-[11px] leading-relaxed text-white/35">The post stays organic on your profile. The promotion additionally places it as Sponsored in eligible feeds. Pause or end it anytime from Ads. Billing and audience targeting arrive with Ads Manager.</p>
          </div>
        )}
      </div>
    </div>
  );
}