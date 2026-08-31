"use client";

/**
 * The Commerce overview.
 *
 * Everything here is derived from the orders and listings the desk already
 * loaded, so it costs no extra queries and can never disagree with the tables
 * below it. Money is grouped by currency rather than summed across them: this
 * business takes both USD and ZWG, and one blended number would be a lie.
 */
import { useMemo } from "react";
import Link from "next/link";
import { TrendingUp, Package, Clock } from "lucide-react";
import { TrendChart, Metric } from "@/components/Charts";
import { Panel } from "@/components/ui";

type Order = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  payer_name: string;
  listing_title: string | null;
  listing_image: string | null;
};
type Listing = {
  id: string;
  title: string;
  price: number;
  currency: string;
  images: string[];
  status: string;
  sold_count: number;
  pending_offers: number;
};

const DAYS = 30;

export function CommerceOverview({ orders, listings }: { orders: Order[]; listings: Listing[] }) {
  const stats = useMemo(() => {
    const since = Date.now() - DAYS * 86400000;
    const paid = orders.filter((o) => o.status === "completed" || o.status === "paid");
    const recent = paid.filter((o) => new Date(o.created_at).getTime() >= since);

    // Grouped by currency. Adding USD to ZWG would produce a number that means
    // nothing, however tidy it looks in a card.
    const byCurrency = new Map<string, { total: number; count: number }>();
    for (const o of recent) {
      const cur = byCurrency.get(o.currency) ?? { total: 0, count: 0 };
      cur.total += Number(o.amount || 0);
      cur.count += 1;
      byCurrency.set(o.currency, cur);
    }

    const buckets = new Map<string, number>();
    for (let i = DAYS - 1; i >= 0; i--) {
      buckets.set(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10), 0);
    }
    const primary = [...byCurrency.entries()].sort((a, b) => b[1].total - a[1].total)[0]?.[0] ?? null;
    for (const o of recent) {
      if (primary && o.currency !== primary) continue;
      const k = o.created_at.slice(0, 10);
      if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + Number(o.amount || 0));
    }

    return {
      byCurrency: [...byCurrency.entries()],
      primary,
      series: [...buckets.entries()],
      pending: orders.filter((o) => o.status === "pending").length,
      awaiting: listings.reduce((n, l) => n + (l.pending_offers || 0), 0),
      live: listings.filter((l) => l.status === "available").length,
    };
  }, [orders, listings]);

  const bestSellers = useMemo(
    () => listings.filter((l) => (l.sold_count || 0) > 0).sort((a, b) => b.sold_count - a.sold_count).slice(0, 4),
    [listings],
  );

  const money = (n: number, cur: string) =>
    cur + " " + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="mb-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.byCurrency.length > 0 ? (
          stats.byCurrency.slice(0, 2).map(([cur, v]) => (
            <div key={cur} className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
              <p className="text-[11.5px] text-ink/45">Revenue, {DAYS} days</p>
              <p className="mt-0.5 font-display text-[24px] leading-tight text-porcelain">{money(v.total, cur)}</p>
              <p className="mt-0.5 text-[11.5px] text-ink/40">{v.count} {v.count === 1 ? "order" : "orders"}</p>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
            <p className="text-[11.5px] text-ink/45">Revenue, {DAYS} days</p>
            <Metric value={0} size={24} />
            <p className="mt-0.5 text-[11.5px] text-ink/40">no paid orders yet</p>
          </div>
        )}

        <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
          <p className="text-[11.5px] text-ink/45">Average order</p>
          {stats.byCurrency.length > 0 ? (
            <p className="mt-0.5 font-display text-[24px] leading-tight text-porcelain">
              {money(stats.byCurrency[0][1].total / Math.max(1, stats.byCurrency[0][1].count), stats.byCurrency[0][0])}
            </p>
          ) : (
            <Metric value={0} size={24} />
          )}
        </div>

        <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
          <p className="text-[11.5px] text-ink/45">Live listings</p>
          <Metric value={stats.live} size={24} />
          <p className="mt-0.5 text-[11.5px] text-ink/40">
            {stats.awaiting > 0 ? stats.awaiting + " with offers waiting" : "no offers waiting"}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
        <div className="rounded-2xl border border-ink/10 bg-white px-5 py-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[15px] font-semibold text-ink">
              Revenue over time{stats.primary ? ", " + stats.primary : ""}
            </h2>
            <span className="text-[11.5px] text-ink/40">last {DAYS} days</span>
          </div>
          <TrendChart
            series={[{ name: "Revenue", points: stats.series.map(([, v]) => v) }]}
            labels={stats.series.map(([d]) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}
            height={200}
            emptyLabel="No paid orders in this period"
          />
        </div>

        <Panel title="Best sellers" icon={<TrendingUp size={15} />}>
          {bestSellers.length === 0 ? (
            <p className="text-[13px] text-ink/45">Nothing has sold yet. Sales appear here as orders complete.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {bestSellers.map((l, i) => (
                <div key={l.id} className="flex items-center gap-3">
                  <span className="w-4 shrink-0 text-center font-display text-[15px] text-ink/35">{i + 1}</span>
                  {l.images?.[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.images[0]} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface text-ink/30">
                      <Package size={15} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{l.title}</span>
                    <span className="block text-[11.5px] text-ink/45">{money(Number(l.price || 0), l.currency)}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-ink/45">{l.sold_count} sold</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {stats.pending > 0 ? (
        <Link
          href="#orders"
          className="mt-3 flex items-center gap-2.5 rounded-2xl border border-pearl/40 bg-pearl/8 px-4 py-3 text-[13.5px] text-ink transition-colors duration-[140ms] hover:bg-pearl/12"
        >
          <Clock size={15} className="shrink-0 text-pearl" />
          <span className="font-semibold">{stats.pending}</span> {stats.pending === 1 ? "order is" : "orders are"} still
          pending payment
        </Link>
      ) : null}
    </div>
  );
}

/**
 * The Commerce rail: money you are owed, and orders that need a human.
 *
 * "Available" here means orders marked completed. Anything still pending is
 * shown separately rather than folded into the balance, because money that has
 * not cleared is not money you can spend.
 */
export function CommerceRail({ orders, listings }: { orders: Order[]; listings: Listing[] }) {
  const m = useMemo(() => {
    const cleared = new Map<string, number>();
    let pendingTotal = 0;
    let pendingCount = 0;
    for (const o of orders) {
      if (o.status === "completed") {
        cleared.set(o.currency, (cleared.get(o.currency) ?? 0) + Number(o.amount || 0));
      } else if (o.status === "pending") {
        pendingTotal += Number(o.amount || 0);
        pendingCount += 1;
      }
    }
    return {
      cleared: [...cleared.entries()].sort((a, b) => b[1] - a[1]),
      pendingCount,
      pendingTotal,
      offers: listings.filter((l) => (l.pending_offers || 0) > 0),
    };
  }, [orders, listings]);

  const money = (n: number, cur: string) =>
    cur + " " + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <>
      <Panel title="Balance">
        {m.cleared.length === 0 ? (
          <p className="text-[13px] text-ink/45">Nothing cleared yet. Completed orders add up here.</p>
        ) : (
          m.cleared.map(([cur, total]) => (
            <div key={cur} className="mb-1 last:mb-0">
              <p className="text-[11.5px] text-ink/45">Cleared, {cur}</p>
              <p className="font-display text-[24px] leading-tight text-porcelain">{money(total, cur)}</p>
            </div>
          ))
        )}
        {m.pendingCount > 0 ? (
          <p className="mt-2 border-t border-ink/8 pt-2 text-[12.5px] text-ink/55">
            <span className="font-semibold text-ink">{m.pendingCount}</span>{" "}
            {m.pendingCount === 1 ? "order" : "orders"} still pending
          </p>
        ) : null}
      </Panel>

      {m.offers.length > 0 ? (
        <Panel title="Offers waiting">
          <div className="flex flex-col gap-2">
            {m.offers.slice(0, 4).map((l) => (
              <div key={l.id} className="flex items-center gap-2.5">
                {l.images?.[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.images[0]} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className="h-8 w-8 shrink-0 rounded-lg bg-surface" />
                )}
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{l.title}</span>
                <span className="shrink-0 text-[12px] font-semibold text-pearl-muted">{l.pending_offers}</span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </>
  );
}
