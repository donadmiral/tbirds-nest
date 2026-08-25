"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, BarChart3 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { pct } from "@/lib/studio";

type Day = { day: string; reach: number; impressions: number; engagements: number; followers: number; messages: number; posts: number; market_chats: number; offers: number; payments: number; paid_usd: number; paid_zwg: number; applications: number; ad_impressions: number; ad_clicks: number };
type Totals = Record<string, number>;
type TopPost = { post_id: string; content: string; created_at: string; likes: number; comments: number; reposts: number; views: number; score: number; thumb: string | null; products: number };
type Insights = { days: number; series: Day[]; current: Totals; previous: Totals; top_posts: TopPost[]; funnel: { commerce: { chats: number; offers: number; payments: number }; recruiting: { applications: number; interviews: number; hired: number } } };

const METRICS: { key: keyof Day; label: string; cumulative?: boolean }[] = [
  { key: "impressions", label: "Impressions" }, { key: "reach", label: "Reach" }, { key: "engagements", label: "Engagements" },
  { key: "followers", label: "Followers", cumulative: true }, { key: "messages", label: "Messages" }, { key: "market_chats", label: "Market chats" },
  { key: "payments", label: "Payments" }, { key: "applications", label: "Applications" }, { key: "ad_impressions", label: "Ad impressions" }, { key: "ad_clicks", label: "Ad clicks" },
];

function Line({ data, label }: { data: number[]; label: string }) {
  const w = 300, h = 80, pad = 6;
  const max = Math.max(1, ...data), min = Math.min(...data, 0);
  const pts = data.map((v, i) => [pad + (i / Math.max(1, data.length - 1)) * (w - pad * 2), h - pad - ((v - min) / Math.max(1, max - min)) * (h - pad * 2)]);
  const d = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = d + " L" + pts[pts.length - 1]?.[0].toFixed(1) + " " + (h - pad) + " L" + pad + " " + (h - pad) + " Z";
  return (
    <svg viewBox={"0 0 " + w + " " + h} className="h-20 w-full" role="img" aria-label={label}>
      {data.length > 1 ? <path d={area} fill="currentColor" className="text-pearl/15" /> : null}
      {data.length > 1 ? <path d={d} fill="none" stroke="currentColor" strokeWidth="2" className="text-pearl" /> : null}
      {pts.length ? <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill="currentColor" className="text-pearl" /> : null}
    </svg>
  );
}

export default function InsightsPage() {
  const supabase = useRef(createClient()).current;
  const [days, setDays] = useState(30);
  const [ins, setIns] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("studio_insights", { p_days: days });
      if (error) { setErr(error.message); return; }
      setIns(data as Insights);
    } finally { setLoading(false); }
  }, [supabase, days]);
  useEffect(() => { void load(); }, [load]);

  if (err) return <p className="py-16 text-center text-sm text-red-400">{err}</p>;

  const cur = ins?.current || {}, prev = ins?.previous || {};
  const tiles: [string, number, number][] = ins ? [
    ["Impressions", cur.impressions, prev.impressions], ["Reach", cur.reach, prev.reach], ["Engagements", cur.engagements, prev.engagements],
    ["Followers gained", (cur.followers_end || 0) - (cur.followers_start || 0), 0], ["Messages", cur.messages, prev.messages], ["Market chats", cur.market_chats, prev.market_chats],
    ["Payments", cur.payments, prev.payments], ["Applications", cur.applications, prev.applications], ["Ad clicks", cur.ad_clicks, prev.ad_clicks],
  ] : [];

  return (
    <div className="max-w-[960px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-porcelain">Insights</h1>
          <p className="mt-1 text-[13px] text-ink/50">Rolled up nightly. Today is not included until tomorrow morning.</p>
        </div>
        <div className="flex gap-1 rounded-full bg-surface p-1">
          {[7, 30, 90].map(d => <button key={d} onClick={() => setDays(d)} className={"rounded-full px-3 py-1.5 text-[12.5px] font-semibold " + (days === d ? "bg-ink text-porcelain" : "text-ink/60")}>{d} days</button>)}
        </div>
      </div>

      {loading || !ins ? <p className="py-12 text-center text-sm text-ink/40">Loading</p> : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {tiles.map(([label, n, p]) => {
              const d = label === "Followers gained" ? 0 : pct(n || 0, p || 0);
              return (
                <div key={label} className="rounded-xl border border-ink/10 px-4 py-3">
                  <p className="text-[11.5px] text-ink/45">{label}</p>
                  <p className="mt-0.5 font-display text-[22px] text-porcelain">{Number(n || 0).toLocaleString()}</p>
                  {label !== "Followers gained" ? (
                    <p className={"mt-0.5 flex items-center gap-1 text-[11.5px] " + (d === 0 ? "text-ink/35" : d > 0 ? "text-success" : "text-red-400")}>
                      {d === 0 ? null : d > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{d === 0 ? "no change" : Math.abs(d) + "% vs prior " + days + " days"}
                    </p>
                  ) : <p className="mt-0.5 text-[11.5px] text-ink/35">{Number(cur.followers_end || 0).toLocaleString()} total</p>}
                </div>
              );
            })}
          </div>
          {(cur.paid_usd || cur.paid_zwg) ? <p className="mt-3 text-[13px] text-ink/60">Received: {cur.paid_usd ? "USD " + Number(cur.paid_usd).toLocaleString() : ""}{cur.paid_usd && cur.paid_zwg ? " · " : ""}{cur.paid_zwg ? "ZWG " + Number(cur.paid_zwg).toLocaleString() : ""}</p> : null}

          <h2 className="mb-2 mt-7 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Trends</h2>
          {ins.series.length < 2 ? <p className="rounded-xl border border-ink/10 px-4 py-5 text-[13.5px] text-ink/50">Trends appear after two nightly rollups.</p> : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {METRICS.map(m => {
                const data = ins.series.map(s => Number(s[m.key] || 0));
                const total = m.cumulative ? data[data.length - 1] : data.reduce((a, b) => a + b, 0);
                if (!m.cumulative && total === 0) return null;
                return (
                  <div key={m.key} className="rounded-xl border border-ink/10 px-4 py-3">
                    <div className="flex items-baseline justify-between"><p className="text-[12.5px] font-semibold text-ink">{m.label}</p><p className="text-[12px] text-ink/45">{total.toLocaleString()}{m.cumulative ? " now" : " in " + days + " days"}</p></div>
                    <Line data={data} label={m.label} />
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-7 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
            <div>
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Top content, last {days} days</h2>
              {ins.top_posts.length === 0 ? <p className="rounded-xl border border-ink/10 px-4 py-5 text-[13.5px] text-ink/50">No posts in this period.</p> : ins.top_posts.map((p, i) => (
                <Link key={p.post_id} href={"/post/" + p.post_id} className="mb-2 flex items-center gap-3 rounded-xl border border-ink/10 px-3 py-2.5 transition-colors hover:bg-surface">
                  <span className="w-5 text-center font-display text-[15px] text-ink/40">{i + 1}</span>
                  {p.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumb} alt="" className="h-11 w-11 rounded-lg object-cover" />
                  ) : <span className="h-11 w-11 rounded-lg bg-surface" />}
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-[13.5px] text-ink">{p.content || "Media post"}</span>
                    <span className="block text-[11.5px] text-ink/45">{new Date(p.created_at).toLocaleDateString()} · {p.views} views · {p.likes} likes · {p.comments} comments · {p.reposts} reposts{p.products ? " · " + p.products + " products" : ""}</span>
                  </span>
                </Link>
              ))}
            </div>
            <div>
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Funnels</h2>
              <div className="rounded-xl border border-ink/10 px-4 py-3">
                <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink"><BarChart3 size={13} className="text-pearl" /> Commerce</p>
                {[["Market conversations", ins.funnel.commerce.chats], ["Offers received", ins.funnel.commerce.offers], ["Payments", ins.funnel.commerce.payments]].map(([l, n], i, arr) => {
                  const base = Number(arr[0][1]) || 1;
                  return <div key={String(l)} className="mt-2"><div className="flex justify-between text-[12px] text-ink/60"><span>{l}</span><span>{Number(n).toLocaleString()}</span></div><div className="mt-1 h-1.5 rounded-full bg-surface"><div className="h-1.5 rounded-full bg-pearl" style={{ width: Math.max(2, Math.min(100, (Number(n) / base) * 100)) + "%" }} /></div></div>;
                })}
              </div>
              <div className="mt-3 rounded-xl border border-ink/10 px-4 py-3">
                <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink"><BarChart3 size={13} className="text-pearl" /> Recruiting</p>
                {[["Applications", ins.funnel.recruiting.applications], ["Reached interview", ins.funnel.recruiting.interviews], ["Hired", ins.funnel.recruiting.hired]].map(([l, n], i, arr) => {
                  const base = Number(arr[0][1]) || 1;
                  return <div key={String(l)} className="mt-2"><div className="flex justify-between text-[12px] text-ink/60"><span>{l}</span><span>{Number(n).toLocaleString()}</span></div><div className="mt-1 h-1.5 rounded-full bg-surface"><div className="h-1.5 rounded-full bg-pearl" style={{ width: Math.max(2, Math.min(100, (Number(n) / base) * 100)) + "%" }} /></div></div>;
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
