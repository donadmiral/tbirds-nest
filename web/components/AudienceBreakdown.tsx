"use client";

/**
 * The audience breakdown.
 *
 * Three questions a donut answers better than a table: how your audience
 * splits, where they are, and how fast it is growing. All of it comes from the
 * summary the desk already loaded, plus the follower rows for the growth line.
 */
import { useMemo } from "react";
import { MapPin } from "lucide-react";
import { Panel } from "@/components/ui";
import { Sparkline } from "@/components/Charts";

type Summary = {
  followers: number;
  new_30d: number;
  customers: number;
  labels: Record<string, number>;
  top_cities: { city: string; n: number }[];
};
type Person = { id: string; followed_at: string };

// Distinct enough to read at small size, and none of them signal success or
// failure: these are categories, not results.
const SLICE = ["#C8A951", "#2F4157", "#7C8FA3", "#B9C4CE", "#5B6470", "#D9CBA6"];

export function AudienceBreakdown({ sum, people }: { sum: Summary; people: Person[] }) {
  const labels = useMemo(() => {
    const entries = Object.entries(sum.labels || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    const labelled = entries.reduce((n, [, v]) => n + v, 0);
    // Everyone without a label is still part of the audience, so the donut has
    // to account for them or the slices will not add up to the follower count.
    const unlabelled = Math.max(0, sum.followers - labelled);
    return unlabelled > 0 ? [...entries, ["No label", unlabelled] as [string, number]] : entries;
  }, [sum]);

  const total = labels.reduce((n, [, v]) => n + v, 0);

  const growth = useMemo(() => {
    const buckets = new Map<string, number>();
    for (let i = 29; i >= 0; i--) buckets.set(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10), 0);
    for (const p of people) {
      const k = (p.followed_at || "").slice(0, 10);
      if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + 1);
    }
    // Cumulative, because a follower count only goes up as the month runs.
    let running = Math.max(0, sum.followers - [...buckets.values()].reduce((a, b) => a + b, 0));
    return [...buckets.values()].map((n) => (running += n));
  }, [people, sum.followers]);

  if (sum.followers === 0) return null;

  // Donut geometry: one circle, one dash per slice, offset by what came before.
  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
      <Panel title="How they are labelled">
        <div className="flex items-center gap-4">
          <svg width="112" height="112" viewBox="0 0 112 112" className="shrink-0" aria-hidden>
            <circle cx="56" cy="56" r={R} fill="none" stroke="var(--color-surface-elevated)" strokeWidth="14" />
            {labels.map(([name, n], i) => {
              const len = total > 0 ? (n / total) * C : 0;
              const dash = <circle
                key={name}
                cx="56" cy="56" r={R} fill="none"
                stroke={SLICE[i % SLICE.length]}
                strokeWidth="14"
                strokeDasharray={len + " " + (C - len)}
                strokeDashoffset={-offset}
                transform="rotate(-90 56 56)"
              />;
              offset += len;
              return dash;
            })}
            <text x="56" y="52" textAnchor="middle" className="fill-porcelain font-display" style={{ fontSize: 19 }}>
              {sum.followers}
            </text>
            <text x="56" y="66" textAnchor="middle" className="fill-ink/45" style={{ fontSize: 9 }}>
              followers
            </text>
          </svg>
          <div className="min-w-0 flex-1">
            {labels.map(([name, n], i) => (
              <div key={name} className="flex items-center gap-2 py-0.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SLICE[i % SLICE.length] }} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] capitalize text-ink/75">{name}</span>
                <span className="shrink-0 text-[12px] tabular-nums text-ink/45">{n}</span>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <Panel title="Where they are" icon={<MapPin size={15} />}>
        {sum.top_cities.length === 0 ? (
          <p className="text-[13px] text-ink/45">No locations on file yet. Followers who set a location appear here.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sum.top_cities.slice(0, 6).map((c) => {
              const share = sum.followers > 0 ? (c.n / sum.followers) * 100 : 0;
              return (
                <div key={c.city}>
                  <div className="flex items-baseline justify-between text-[12.5px]">
                    <span className="min-w-0 truncate text-ink/75">{c.city}</span>
                    <span className="shrink-0 tabular-nums text-ink/45">{c.n}</span>
                  </div>
                  <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-surface">
                    <div className="h-full rounded-full bg-pearl" style={{ width: Math.max(share, 4) + "%" }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title="Growth, last 30 days">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[26px] leading-none text-porcelain">{sum.followers}</span>
          <span className="text-[12.5px] text-ink/45">
            {sum.new_30d > 0 ? "+" + sum.new_30d + " this month" : "no new followers this month"}
          </span>
        </div>
        <div className="mt-3">
          <Sparkline points={growth} height={56} />
        </div>
        {sum.customers > 0 ? (
          <p className="mt-2 text-[12.5px] text-ink/55">
            <span className="font-semibold text-ink">{sum.customers}</span> of them have paid you
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
