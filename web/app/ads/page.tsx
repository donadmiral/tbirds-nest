"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Megaphone, Pause, Play, Square, Plus, ArrowLeft, ExternalLink } from "lucide-react";
import { myPromos, setPromoStatus, type Promo } from "@/lib/ads";
import { createClient } from "@/lib/supabase/client";
import { TrendChart } from "@/components/Charts";
import { EmptyState, Panel } from "@/components/ui";

type Day = { day: string; impressions: number; clicks: number };

export default function AdsPage() {
  const [promos, setPromos] = useState<Promo[] | null>(null);
  const [series, setSeries] = useState<Day[]>([]);

  const load = useCallback(() => { myPromos().then(setPromos); }, []);
  useEffect(() => { load(); }, [load]);

  // The promo rows carry lifetime totals only, so the shape over time comes
  // from the raw events. RLS already limits these to promos you advertise, so
  // no extra filtering is needed here.
  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const since = new Date(Date.now() - 30 * 86400000);
      const { data } = await supabase
        .from("ad_events")
        .select("kind, created_at")
        .gte("created_at", since.toISOString())
        .order("created_at");
      const byDay = new Map<string, Day>();
      for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        byDay.set(d, { day: d, impressions: 0, clicks: 0 });
      }
      for (const e of ((data ?? []) as { kind: string; created_at: string }[])) {
        const key = e.created_at.slice(0, 10);
        const row = byDay.get(key);
        if (!row) continue;
        if (e.kind === "click") row.clicks++;
        else row.impressions++;
      }
      setSeries(Array.from(byDay.values()));
    })();
  }, []);

  const totals = (promos ?? []).reduce(
    (acc, p) => ({ impressions: acc.impressions + p.impressions_count, clicks: acc.clicks + p.clicks_count, active: acc.active + (p.status === "active" ? 1 : 0) }),
    { impressions: 0, clicks: 0, active: 0 },
  );
  const ctr = totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) + "%" : "\u2014";

  async function setStatus(p: Promo, status: Promo["status"]) {
    setPromos((l) => (l ?? []).map((x) => (x.id === p.id ? { ...x, status } : x)));
    const ok = await setPromoStatus(p.id, status);
    if (!ok) load();
  }

  const chip = (s: string) => s === "active" ? "bg-success/15 text-success" : s === "paused" ? "bg-pearl/15 text-pearl" : "bg-surface text-ink/40";

  return (
    <div>
      {promos && promos.length > 0 ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Impressions", v: totals.impressions.toLocaleString() },
              { label: "Clicks", v: totals.clicks.toLocaleString() },
              { label: "Click rate", v: ctr },
              { label: "Active campaigns", v: String(totals.active) },
            ].map((c) => (
              <div key={c.label} className="rounded-2xl border border-ink/10 bg-white px-4 py-3.5">
                <p className="text-[11.5px] text-ink/45">{c.label}</p>
                <p className="mt-0.5 font-display text-[24px] leading-tight text-porcelain">{c.v}</p>
              </div>
            ))}
          </div>

          <div className="mb-4">
            <Panel title="Performance, last 30 days">
              <TrendChart
                series={[
                  { name: "Impressions", points: series.map((d) => d.impressions) },
                  { name: "Clicks", points: series.map((d) => d.clicks), tone: "ink" },
                ]}
                labels={series.map((d) => new Date(d.day).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}
              />
            </Panel>
          </div>
        </>
      ) : null}

      <div className="mb-4 rounded-2xl border border-ink/10 bg-white px-5 py-4">
        <h1 className="font-display text-[21px] leading-tight text-porcelain">Ads</h1>
        <p className="mt-1 text-[13.5px] leading-6 text-ink/60">
          An ad is one of your posts shown as <span className="font-semibold text-ink">Sponsored</span> in other people&apos;s feeds.
          You pick the post, set how long it runs and how many people see it, and it starts immediately.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 text-[12.5px] text-ink/60 sm:grid-cols-3">
          <span><span className="font-semibold text-ink">Create</span>: choose a post below, or open any post and pick Promote.</span>
          <span><span className="font-semibold text-ink">Manage</span>: pause, resume or end each ad from its card.</span>
          <span><span className="font-semibold text-ink">Measure</span>: impressions, clicks and click rate update live.</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/ads/new" className="flex items-center gap-1.5 rounded-full bg-pearl px-4 py-2 text-[13px] font-bold text-ink transition-opacity duration-[140ms] hover:opacity-90">
            <Plus size={14} /> Create an ad
          </Link>
          <Link href="/studio/ads" className="rounded-full border border-ink/15 px-4 py-2 text-[13px] font-semibold text-ink/70 transition-colors duration-[140ms] hover:bg-surface hover:text-ink">
            Campaigns with budgets, in Studio
          </Link>
        </div>
      </div>

      <div className="hidden">
        <Link href="/home" title="Back to the feed" className="rounded-full p-1.5 text-ink/50 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"><ArrowLeft size={18} /></Link>
        <h1 className="flex items-center gap-2 font-display text-xl text-porcelain"><Megaphone size={19} className="text-pearl" /> Ads</h1>
      </div>
      <p className="pb-3 text-[13px] text-ink/50">Promotions place your content as Sponsored in eligible feeds.</p>
      <Link href="/ads/new" className="mb-5 inline-flex items-center gap-1.5 rounded-full bg-pearl px-4 py-2.5 text-[13px] font-bold text-ink transition-opacity duration-[140ms] hover:opacity-90"><Plus size={15} /> Create a promotion</Link>

      {promos === null ? (
        <p className="py-14 text-center text-sm text-ink/40">Loading</p>
      ) : promos.length === 0 ? (
        <EmptyState
          icon={<Megaphone size={19} />}
          title="No campaigns yet"
          line="Promote a post and it appears here with its impressions, clicks and click rate."
          action="Go to your posts"
          actionHref="/home"
        />
      ) : (
        promos.map((p) => {
          const ctr = p.impressions_count > 0 ? ((p.clicks_count / p.impressions_count) * 100).toFixed(1) + "%" : "—";
          return (
            <div key={p.id} className="mb-3 rounded-2xl border border-ink/10 bg-white p-4">
              <div className="flex items-center gap-2">
                <span className={"rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase " + chip(p.status)}>{p.status}</span>
                <span className="text-[12px] text-ink/40">{p.label}</span>
                <span className="ml-auto text-[12px] text-ink/40">
                  {new Date(p.starts_at).toLocaleDateString()}{p.ends_at ? " – " + new Date(p.ends_at).toLocaleDateString() : ""}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-surface px-3 py-2.5 text-center">
                  <p className="text-[16px] font-semibold text-ink">{p.impressions_count.toLocaleString()}</p>
                  <p className="text-[11px] text-ink/45">Impressions{p.total_cap ? " / " + p.total_cap.toLocaleString() : ""}</p>
                </div>
                <div className="rounded-lg bg-surface px-3 py-2.5 text-center">
                  <p className="text-[16px] font-semibold text-ink">{p.clicks_count.toLocaleString()}</p>
                  <p className="text-[11px] text-ink/45">Clicks</p>
                </div>
                <div className="rounded-lg bg-surface px-3 py-2.5 text-center">
                  <p className="text-[16px] font-semibold text-pearl">{ctr}</p>
                  <p className="text-[11px] text-ink/45">CTR</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Link href={"/post/" + p.post_id} className="flex items-center gap-1 text-[12.5px] font-semibold text-pearl hover:underline">
                  <ExternalLink size={12} /> Open the promoted post
                </Link>
                <span className="ml-auto flex gap-1.5">
                  {p.status === "active" ? (
                    <button onClick={() => setStatus(p, "paused")} className="flex items-center gap-1 rounded-md bg-surface px-2.5 py-1.5 text-[12px] text-ink transition-colors duration-[140ms] hover:bg-surface-elevated" title="Stop showing this ad, keep its numbers"><Pause size={12} /> Pause</button>
                  ) : p.status === "paused" ? (
                    <button onClick={() => setStatus(p, "active")} className="flex items-center gap-1 rounded-md bg-success/20 px-2.5 py-1.5 text-[12px] font-semibold text-success transition-opacity duration-[140ms] hover:opacity-80" title="Start showing this ad again"><Play size={12} /> Resume</button>
                  ) : null}
                  {p.status !== "ended" ? (
                    <button onClick={() => { if (window.confirm("End this promotion permanently?")) setStatus(p, "ended"); }} className="flex items-center gap-1 rounded-md bg-danger/15 px-2.5 py-1.5 text-[12px] font-semibold text-danger transition-opacity duration-[140ms] hover:opacity-80" title="Finish this ad for good"><Square size={12} /> End</button>
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