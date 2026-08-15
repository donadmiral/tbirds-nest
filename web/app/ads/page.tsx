"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Link2 from "next/link";
import { Megaphone, Pause, Play, Square, Plus, ArrowLeft } from "lucide-react";
import { myPromos, setPromoStatus, type Promo } from "@/lib/ads";

export default function AdsPage() {
  const [promos, setPromos] = useState<Promo[] | null>(null);

  const load = useCallback(() => { myPromos().then(setPromos); }, []);
  useEffect(() => { load(); }, [load]);

  async function setStatus(p: Promo, status: Promo["status"]) {
    setPromos((l) => (l ?? []).map((x) => (x.id === p.id ? { ...x, status } : x)));
    const ok = await setPromoStatus(p.id, status);
    if (!ok) load();
  }

  const chip = (s: string) => s === "active" ? "bg-success/15 text-success" : s === "paused" ? "bg-pearl/15 text-pearl" : "bg-surface text-white/40";

  return (
    <div className="px-1">
      <div className="flex items-center gap-2 pb-1">
        <Link href="/home" title="Back to the feed" className="rounded-full p-1.5 text-white/50 transition-colors hover:bg-surface hover:text-white"><ArrowLeft size={18} /></Link>
        <h1 className="flex items-center gap-2 font-display text-xl text-porcelain"><Megaphone size={19} className="text-pearl" /> Ads</h1>
      </div>
      <p className="pb-3 text-[13px] text-white/50">Promotions place your content as Sponsored in eligible feeds.</p>
      <Link2 href="/ads/new" className="mb-5 inline-flex items-center gap-1.5 rounded-md bg-pearl px-4 py-2.5 text-[13px] font-semibold text-ink transition-opacity hover:opacity-90"><Plus size={15} /> Create a promotion</Link2>

      {promos === null ? (
        <p className="py-14 text-center text-sm text-white/40">Loading</p>
      ) : promos.length === 0 ? (
        <p className="py-14 text-center text-sm text-white/40">No promotions yet. Open one of your posts and choose Promote from its menu.</p>
      ) : (
        promos.map((p) => {
          const ctr = p.impressions_count > 0 ? ((p.clicks_count / p.impressions_count) * 100).toFixed(1) + "%" : "—";
          return (
            <div key={p.id} className="mb-3 rounded-xl border border-white/10 p-4">
              <div className="flex items-center gap-2">
                <span className={"rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase " + chip(p.status)}>{p.status}</span>
                <span className="text-[12px] text-white/40">{p.label}</span>
                <span className="ml-auto text-[12px] text-white/40">
                  {new Date(p.starts_at).toLocaleDateString()}{p.ends_at ? " – " + new Date(p.ends_at).toLocaleDateString() : ""}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-surface px-3 py-2.5 text-center">
                  <p className="text-[16px] font-semibold text-white">{p.impressions_count.toLocaleString()}</p>
                  <p className="text-[11px] text-white/45">Impressions{p.total_cap ? " / " + p.total_cap.toLocaleString() : ""}</p>
                </div>
                <div className="rounded-lg bg-surface px-3 py-2.5 text-center">
                  <p className="text-[16px] font-semibold text-white">{p.clicks_count.toLocaleString()}</p>
                  <p className="text-[11px] text-white/45">Clicks</p>
                </div>
                <div className="rounded-lg bg-surface px-3 py-2.5 text-center">
                  <p className="text-[16px] font-semibold text-pearl">{ctr}</p>
                  <p className="text-[11px] text-white/45">CTR</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Link href={"/post/" + p.post_id} className="text-[12px] text-pearl hover:underline">View the post</Link>
                <span className="ml-auto flex gap-1.5">
                  {p.status === "active" ? (
                    <button onClick={() => setStatus(p, "paused")} className="flex items-center gap-1 rounded-md bg-surface px-2.5 py-1.5 text-[12px] text-white hover:bg-surface-elevated"><Pause size={12} /> Pause</button>
                  ) : p.status === "paused" ? (
                    <button onClick={() => setStatus(p, "active")} className="flex items-center gap-1 rounded-md bg-success/20 px-2.5 py-1.5 text-[12px] font-semibold text-success"><Play size={12} /> Resume</button>
                  ) : null}
                  {p.status !== "ended" ? (
                    <button onClick={() => { if (window.confirm("End this promotion permanently?")) setStatus(p, "ended"); }} className="flex items-center gap-1 rounded-md bg-danger/15 px-2.5 py-1.5 text-[12px] font-semibold text-danger"><Square size={12} /> End</button>
                  ) : null}
                </span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}