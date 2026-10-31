"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Megaphone, Pause, Play, Square, Plus, ArrowLeft, ExternalLink } from "lucide-react";
import { myPromos, myPromoPerformance, promoDeliveryStatus, setPromoStatus, type Promo, type PromoDay } from "@/lib/ads";
import { createClient } from "@/lib/supabase/client";
import { TrendChart } from "@/components/Charts";
import { EmptyState, Panel } from "@/components/ui";

export default function AdsPage() {
  const [supabase] = useState(() => createClient());
  const [promos, setPromos] = useState<Promo[] | null>(null);
  const [series, setSeries] = useState<PromoDay[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [asOf, setAsOf] = useState(() => Date.now());
  const account = useRef<string | null | undefined>(undefined);
  const accountVersion = useRef(0);
  const rowRequest = useRef(0);
  const chartRequest = useRef(0);
  const mutations = useRef(new Set<string>());

  const load = useCallback(async (uid: string) => {
    const request = rowRequest.current += 1;
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await myPromos(uid);
      if (request === rowRequest.current) {
        setPromos(rows);
        setAsOf(Date.now());
      }
    } catch {
      if (request === rowRequest.current) setLoadError("Promotions could not be refreshed. The last loaded details may be out of date.");
    } finally {
      if (request === rowRequest.current) setLoading(false);
    }
  }, []);

  const loadChart = useCallback(async (uid: string) => {
    const request = chartRequest.current += 1;
    setChartLoading(true);
    setChartError(null);
    try {
      const days = await myPromoPerformance(uid);
      if (request === chartRequest.current) setSeries(days);
    } catch (error) {
      if (request === chartRequest.current) {
        setSeries(null);
        setChartError(error instanceof Error ? error.message : "Performance could not be loaded.");
      }
    } finally {
      if (request === chartRequest.current) setChartLoading(false);
    }
  }, []);

  useEffect(() => {
    const revision = accountVersion;
    const rows = rowRequest;
    const chart = chartRequest;
    let alive = true;
    let authEvent = false;
    const changeAccount = (uid: string | null) => {
      if (!alive || account.current === uid) return;
      account.current = uid;
      accountVersion.current += 1;
      rowRequest.current += 1;
      chartRequest.current += 1;
      mutations.current.clear();
      setBusyIds([]);
      setPromos(null);
      setSeries(null);
      setActionError(null);
      setChartError(null);
      if (!uid) {
        setLoading(false);
        setChartLoading(false);
        setLoadError("Sign in to view your promotions.");
        return;
      }
      void load(uid);
      void loadChart(uid);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      authEvent = true;
      changeAccount(session?.user.id ?? null);
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!authEvent) changeAccount(error ? null : data.session?.user.id ?? null);
    }, () => { if (!authEvent) changeAccount(null); });
    return () => {
      alive = false;
      account.current = undefined;
      revision.current += 1;
      rows.current += 1;
      chart.current += 1;
      subscription.unsubscribe();
    };
  }, [supabase, load, loadChart]);

  const refresh = () => {
    if (!account.current) return;
    setActionError(null);
    void load(account.current);
    void loadChart(account.current);
  };

  const totals = (promos ?? []).reduce(
    (acc, p) => ({ impressions: acc.impressions + p.impressions_count, clicks: acc.clicks + p.clicks_count, active: acc.active + (promoDeliveryStatus(p, asOf) === "Active" ? 1 : 0) }),
    { impressions: 0, clicks: 0, active: 0 },
  );
  const ctr = totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) + "%" : "\u2014";

  async function setStatus(p: Promo, status: Promo["status"]) {
    const uid = account.current;
    if (!uid || uid !== p.advertiser_id || loading || mutations.current.has(p.id)) return;
    const version = accountVersion.current;
    mutations.current.add(p.id);
    setBusyIds([...mutations.current]);
    setActionError(null);
    try {
      const ok = await setPromoStatus(p.id, status, uid, p.status);
      if (version !== accountVersion.current) return;
      if (!ok) throw new Error("Unconfirmed change");
      setPromos(rows => rows?.map(row => row.id === p.id ? { ...row, status } : row) ?? null);
    } catch {
      if (version === accountVersion.current) setActionError("The change could not be confirmed. Refresh your promotions before trying again.");
    } finally {
      if (version === accountVersion.current) {
        mutations.current.delete(p.id);
        setBusyIds([...mutations.current]);
      }
    }
  }

  const chip = (s: string) => s === "active" ? "bg-success/15 text-success" : s === "paused" ? "bg-pearl/15 text-accent" : "bg-surface text-muted";

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
                <p className="text-[11.5px] text-muted">{c.label}</p>
                <p className="mt-0.5 font-display text-[24px] leading-tight text-porcelain">{c.v}</p>
              </div>
            ))}
          </div>

          <div className="mb-4">
            <Panel title="Performance, last 30 days (UTC)">
              {chartError ? <p role="alert" className="text-[13px] text-danger">{chartError} <button disabled={chartLoading} onClick={() => account.current && void loadChart(account.current)} className="font-semibold underline">Try again</button></p> : chartLoading ? <p className="text-sm text-muted">Loading performance</p> : series ? <TrendChart
                series={[
                  { name: "Impressions", points: series.map((d) => d.impressions) },
                  { name: "Clicks", points: series.map((d) => d.clicks), tone: "ink" },
                ]}
                labels={series.map((d) => new Date(d.day + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }))}
              /> : null}
              <p className="mt-2 text-[11.5px] text-muted">Each signed-in viewer counts once per promotion for impressions and once for clicks. Figures update when you refresh.</p>
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
          <span><span className="font-semibold text-ink">Measure</span>: refresh to see the latest impressions, clicks and click rate.</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={refresh} disabled={loading || chartLoading || busyIds.length > 0} className="rounded-full border border-ink/15 px-4 py-2 text-[13px] font-semibold text-ink/70 disabled:opacity-40">{loading || chartLoading ? "Refreshing" : "Refresh"}</button>
          <Link href="/ads/new" className="flex items-center gap-1.5 rounded-full bg-pearl px-4 py-2 text-[13px] font-bold text-on-pearl transition-opacity duration-[140ms] hover:opacity-90">
            <Plus size={14} /> Create an ad
          </Link>
          <Link href="/studio/ads" className="rounded-full border border-ink/15 px-4 py-2 text-[13px] font-semibold text-ink/70 transition-colors duration-[140ms] hover:bg-surface hover:text-ink">
            Campaigns with budgets, in Studio
          </Link>
        </div>
      </div>

      <div className="hidden">
        <Link href="/home" title="Back to the feed" className="rounded-full p-1.5 text-muted transition-colors duration-[140ms] hover:bg-surface hover:text-ink"><ArrowLeft size={18} /></Link>
        <h1 className="flex items-center gap-2 font-display text-xl text-porcelain"><Megaphone size={19} className="text-accent" /> Ads</h1>
      </div>
      <p className="pb-3 text-[13px] text-muted">Promotions place your content as Sponsored in eligible feeds.</p>
      <Link href="/ads/new" className="mb-5 inline-flex items-center gap-1.5 rounded-full bg-pearl px-4 py-2.5 text-[13px] font-bold text-on-pearl transition-opacity duration-[140ms] hover:opacity-90"><Plus size={15} /> Create a promotion</Link>

      {loadError ? <p role="alert" className="mb-3 text-[13px] text-danger">{loadError} <button type="button" disabled={loading} onClick={refresh} className="font-semibold underline">Try again</button></p> : null}
      {actionError ? <p role="alert" className="mb-3 text-[13px] text-danger">{actionError}</p> : null}
      {promos === null && loading ? (
        <p className="py-14 text-center text-sm text-muted">Loading</p>
      ) : promos === null ? null : promos.length === 0 ? (
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
          const delivery = promoDeliveryStatus(p, asOf);
          return (
            <div key={p.id} className="mb-3 rounded-2xl border border-ink/10 bg-white p-4">
              <div className="flex items-center gap-2">
                <span className={"rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase " + chip(delivery.toLowerCase())}>{delivery}</span>
                <span className="text-[12px] text-muted">{p.label}</span>
                <span className="ml-auto text-[12px] text-muted">
                  {new Date(p.starts_at).toLocaleDateString()}{p.ends_at ? " – " + new Date(p.ends_at).toLocaleDateString() : ""}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-surface px-3 py-2.5 text-center">
                  <p className="text-[16px] font-semibold text-ink">{p.impressions_count.toLocaleString()}</p>
                  <p className="text-[11px] text-muted">Impressions{p.total_cap ? " / " + p.total_cap.toLocaleString() : ""}</p>
                </div>
                <div className="rounded-lg bg-surface px-3 py-2.5 text-center">
                  <p className="text-[16px] font-semibold text-ink">{p.clicks_count.toLocaleString()}</p>
                  <p className="text-[11px] text-muted">Clicks</p>
                </div>
                <div className="rounded-lg bg-surface px-3 py-2.5 text-center">
                  <p className="text-[16px] font-semibold text-accent">{ctr}</p>
                  <p className="text-[11px] text-muted">CTR</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Link href={"/post/" + p.post_id} className="flex items-center gap-1 text-[12.5px] font-semibold text-accent hover:underline">
                  <ExternalLink size={12} /> Open the promoted post
                </Link>
                <span className="ml-auto flex gap-1.5">
                  {p.status === "active" ? (
                    <button disabled={loading || !!actionError || busyIds.includes(p.id)} onClick={() => setStatus(p, "paused")} className="flex items-center gap-1 rounded-md bg-surface px-2.5 py-1.5 text-[12px] text-ink transition-colors duration-[140ms] hover:bg-surface-elevated" title="Stop showing this ad, keep its numbers"><Pause size={12} /> Pause</button>
                  ) : p.status === "paused" ? (
                    <button disabled={loading || !!actionError || busyIds.includes(p.id)} onClick={() => setStatus(p, "active")} className="flex items-center gap-1 rounded-md bg-success/20 px-2.5 py-1.5 text-[12px] font-semibold text-success transition-opacity duration-[140ms] hover:opacity-80" title="Start showing this ad again"><Play size={12} /> Resume</button>
                  ) : null}
                  {p.status !== "ended" ? (
                    <button disabled={loading || !!actionError || busyIds.includes(p.id)} onClick={() => { if (window.confirm("End this promotion permanently?")) setStatus(p, "ended"); }} className="flex items-center gap-1 rounded-md bg-danger/15 px-2.5 py-1.5 text-[12px] font-semibold text-danger transition-opacity duration-[140ms] hover:opacity-80" title="Finish this ad for good"><Square size={12} /> End</button>
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
