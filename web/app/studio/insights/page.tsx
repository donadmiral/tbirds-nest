"use client";

import { StudioRailPortal } from "@/components/StudioRailPortal";
import { Panel } from "@/components/ui";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, BarChart3 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { pct } from "@/lib/studio";
import { Sparkline, TrendChart, Metric } from "@/components/Charts";

type Day = { day: string; reach: number; impressions: number; engagements: number; followers: number; messages: number; posts: number; market_chats: number; offers: number; payments: number; paid_usd: number; paid_zwg: number; applications: number; ad_impressions: number; ad_clicks: number };
type Totals = Record<string, number>;
type TopPost = { post_id: string; content: string; created_at: string; likes: number; comments: number; reposts: number; views: number; score: number; thumb: string | null; products: number };
type Insights = { days: number; series: Day[]; current: Totals; previous: Totals; top_posts: TopPost[]; funnel: { commerce: { chats: number; offers: number; payments: number }; recruiting: { applications: number; interviews: number; hired: number } } };

const METRICS: { key: keyof Day; label: string; cumulative?: boolean }[] = [
  { key: "impressions", label: "Impressions" }, { key: "reach", label: "Reach" }, { key: "engagements", label: "Engagements" },
  { key: "followers", label: "Followers", cumulative: true }, { key: "messages", label: "Messages" }, { key: "market_chats", label: "Market chats" },
  { key: "payments", label: "Payments" }, { key: "applications", label: "Applications" }, { key: "ad_impressions", label: "Ad impressions" }, { key: "ad_clicks", label: "Ad clicks" },
];


// Plain-language comparison, same as the phone: percentages on small counts
// mislead, so the line always says the actual prior number.
function compareText(n: number, p: number, prior: string): string {
  if (n === 0 && p === 0) return "nothing yet";
  if (n === p) return "same as " + prior;
  return (n > p ? "up from " : "down from ") + p.toLocaleString() + " in " + prior;
}
const HINT: Record<string, string> = {
  Impressions: "Times your content was shown", Reach: "People who saw your content", Engagements: "Likes, comments, shares and saves",
  "Followers gained": "New followers in the period", Messages: "Received in your inbox", "Market chats": "Buyer conversations started",
  Payments: "Payments received in chat", Applications: "Applications to your jobs", "Ad clicks": "Taps on your ads",
};

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
      {ins ? (
        <StudioRailPortal>
          <>
            {/* studio_insights already returns these funnels and the page never
                showed them. They answer "did any of this turn into money or a
                hire", which is the question the numbers above only hint at. */}
            {ins.funnel.commerce.chats + ins.funnel.commerce.offers + ins.funnel.commerce.payments > 0 ? (
              <Panel title="Selling" action="Commerce" actionHref="/studio/commerce">
                <div className="flex flex-col gap-1.5">
                  {[
                    ["Market chats", ins.funnel.commerce.chats],
                    ["Offers made", ins.funnel.commerce.offers],
                    ["Payments", ins.funnel.commerce.payments],
                  ].map(([label, n]) => (
                    <div key={String(label)} className="flex items-baseline justify-between text-[13px]">
                      <span className="text-ink/65">{label}</span>
                      <span className="tabular-nums font-semibold text-ink">{Number(n).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            ) : null}

            {ins.funnel.recruiting.applications + ins.funnel.recruiting.interviews + ins.funnel.recruiting.hired > 0 ? (
              <Panel title="Hiring" action="Recruiter" actionHref="/studio/recruiter">
                <div className="flex flex-col gap-1.5">
                  {[
                    ["Applications", ins.funnel.recruiting.applications],
                    ["Interviews", ins.funnel.recruiting.interviews],
                    ["Hired", ins.funnel.recruiting.hired],
                  ].map(([label, n]) => (
                    <div key={String(label)} className="flex items-baseline justify-between text-[13px]">
                      <span className="text-ink/65">{label}</span>
                      <span className="tabular-nums font-semibold text-ink">{Number(n).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            ) : null}

            {ins.top_posts.length > 0 ? (
              <Panel title="Best performing" action="Content" actionHref="/studio/content">
                <div className="flex flex-col gap-2.5">
                  {ins.top_posts.slice(0, 3).map((t, i) => (
                    <div key={t.post_id} className="flex gap-2.5">
                      <span className="w-3 shrink-0 text-center font-display text-[13px] text-ink/30">{i + 1}</span>
                      {t.thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={t.thumb} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 block text-[12.5px] leading-snug text-ink">{t.content || "Media post"}</span>
                        <span className="mt-0.5 block text-[11px] text-ink/40">
                          {(Number(t.likes || 0) + Number(t.comments || 0) + Number(t.reposts || 0)).toLocaleString()} engagements
                          {t.views ? " \u00b7 " + Number(t.views).toLocaleString() + " views" : ""}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>
            ) : null}
          </>
        </StudioRailPortal>
      ) : null}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[21px] leading-tight text-porcelain">Insights</h1>
          <p className="mt-1 text-[13px] text-ink/50">Rolled up nightly. Today is not included until tomorrow morning.</p>
        </div>
        <div className="flex gap-1 rounded-full bg-surface p-1">
          {[7, 30, 90].map(d => <button key={d} onClick={() => setDays(d)} className={"rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors duration-[140ms] " + (days === d ? "bg-ink text-white" : "text-ink/60")}>{d} days</button>)}
        </div>
      </div>

      {loading || !ins ? <p className="py-12 text-center text-sm text-ink/40">Loading</p> : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {tiles.map(([label, n, p]) => {
              const d = label === "Followers gained" ? 0 : pct(n || 0, p || 0);
              return (
                <div key={label} className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
                  <p className="text-[11.5px] text-ink/45">{label}</p>
                  <p className="text-[10.5px] text-ink/30">{HINT[label] || ""}</p>
                  <div className="mt-0.5"><Metric value={Number(n || 0)} size={24} /></div>
                  {label !== "Followers gained" ? (
                    <p className={"mt-0.5 flex items-center gap-1 text-[11.5px] " + (d === 0 ? "text-ink/35" : d > 0 ? "text-success" : "text-red-400")}>
                      {d === 0 ? null : d > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{compareText(Number(n || 0), Number(p || 0), "the " + days + " days before")}
                    </p>
                  ) : <p className="mt-0.5 text-[11.5px] text-ink/35">{Number(cur.followers_end || 0).toLocaleString()} total</p>}
                </div>
              );
            })}
          </div>
          {(cur.paid_usd || cur.paid_zwg) ? <p className="mt-3 text-[13px] text-ink/60">Received: {cur.paid_usd ? "USD " + Number(cur.paid_usd).toLocaleString() : ""}{cur.paid_usd && cur.paid_zwg ? " · " : ""}{cur.paid_zwg ? "ZWG " + Number(cur.paid_zwg).toLocaleString() : ""}</p> : null}

          {/* Reach against engagement at full width, because the relationship
              between the two is the thing worth reading. The per-metric
              sparklines below answer a different question, one at a time. */}
          {ins.series.length >= 2 ? (
            <div className="mt-7 rounded-2xl border border-ink/10 bg-white px-5 py-4">
              <h2 className="mb-3 text-[15px] font-semibold text-ink">Reach and engagement over time</h2>
              <TrendChart
                series={[
                  { name: "Reach", points: ins.series.map((d) => Number(d.reach || 0)) },
                  { name: "Engagements", points: ins.series.map((d) => Number(d.engagements || 0)), tone: "ink" },
                ]}
                labels={ins.series.map((d) => new Date(d.day).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}
              />
            </div>
          ) : null}

          <h2 className="mb-2 mt-7 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Every metric</h2>
          {ins.series.length < 2 ? <p className="rounded-2xl border border-ink/10 bg-white px-4 py-5 text-[13.5px] text-ink/50">Trends appear after two nightly rollups.</p> : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {METRICS.map(m => {
                const data = ins.series.map(s => Number(s[m.key] || 0));
                const total = m.cumulative ? data[data.length - 1] : data.reduce((a, b) => a + b, 0);
                if (!m.cumulative && total === 0) return null;
                return (
                  <div key={m.key} className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
                    <div className="flex items-baseline justify-between"><p className="text-[12.5px] font-semibold text-ink">{m.label}</p><p className="text-[12px] text-ink/45">{total.toLocaleString()}{m.cumulative ? " now" : " in " + days + " days"}</p></div>
                    <Sparkline points={data} height={64} />
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-7 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(240px,300px)]">
            <div>
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Top content, last {days} days</h2>
              {ins.top_posts.length === 0 ? <p className="rounded-2xl border border-ink/10 bg-white px-4 py-5 text-[13.5px] text-ink/50">No posts in this period.</p> : ins.top_posts.map((p, i) => (
                <Link key={p.post_id} href={"/post/" + p.post_id} className="mb-2 flex items-center gap-3.5 rounded-2xl border border-ink/10 bg-white px-3.5 py-3 transition-colors duration-[140ms] hover:bg-surface">
                  <span className="w-5 text-center font-display text-[15px] text-ink/40">{i + 1}</span>
                  {p.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumb} alt="" className="h-14 w-14 rounded-lg object-cover" />
                  ) : <span className="h-14 w-14 rounded-lg bg-surface" />}
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-[13.5px] text-ink">{p.content || "Media post"}</span>
                    <span className="block text-[11.5px] text-ink/45">{new Date(p.created_at).toLocaleDateString()} · {p.views} views · {p.likes} likes · {p.comments} comments · {p.reposts} reposts{p.products ? " · " + p.products + " products" : ""}</span>
                  </span>
                </Link>
              ))}
            </div>
            <div>
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Funnels</h2>
              <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
                <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink"><BarChart3 size={13} className="text-pearl" /> Commerce</p>
                {[["Market conversations", ins.funnel.commerce.chats], ["Offers received", ins.funnel.commerce.offers], ["Payments", ins.funnel.commerce.payments]].map(([l, n], i, arr) => {
                  const base = Number(arr[0][1]) || 1;
                  return <div key={String(l)} className="mt-2"><div className="flex justify-between text-[12px] text-ink/60"><span>{l}</span><span>{Number(n).toLocaleString()}</span></div><div className="mt-1 h-1.5 rounded-full bg-surface"><div className="h-1.5 rounded-full bg-pearl" style={{ width: Math.max(2, Math.min(100, (Number(n) / base) * 100)) + "%" }} /></div></div>;
                })}
              </div>
              <div className="mt-3 rounded-2xl border border-ink/10 bg-white px-4 py-3">
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