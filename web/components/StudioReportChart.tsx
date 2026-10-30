"use client";

import { useId, useState } from "react";
import styles from "./StudioWorkspace.module.css";

/** One zero-based scale and exact reported values. Missing days stay missing. */
export function StudioReportChart({ points, label }: { points: { day: string; value: number }[]; label: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const title = useId();
  const valid = points.filter(point => Number.isFinite(point.value) && Number.isFinite(Date.parse(point.day))).sort((a, b) => a.day.localeCompare(b.day));
  if (!valid.length) return <p className={styles.empty}>Daily reports are not available for this period yet.</p>;
  const W = 760, H = 218, left = 56, right = 14, top = 14, bottom = 34;
  const highest = Math.max(...valid.map(point => point.value), 1);
  const scale = 10 ** Math.floor(Math.log10(highest));
  const max = highest <= 10 ? Math.ceil(highest) : Math.ceil(highest / scale) * scale;
  const firstTime = Date.parse(valid[0].day), lastTime = Date.parse(valid[valid.length - 1].day);
  const x = (day: string) => left + (lastTime === firstTime ? .5 : (Date.parse(day) - firstTime) / (lastTime - firstTime)) * (W - left - right);
  const y = (value: number) => H - bottom - Math.max(0, value) / max * (H - top - bottom);
  const d = valid.map((point, index) => `${index ? "L" : "M"}${x(point.day)},${y(point.value)}`).join(" ");
  const active = valid.find(point => point.day === selected) ?? valid[valid.length - 1];
  const dayLabel = (day: string) => new Date(day + (day.length === 10 ? "T12:00:00Z" : "")).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return <div>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs"><span className="font-semibold">{label}</span><span aria-live="polite" className="text-muted">{dayLabel(active.day)} · <strong className="text-ink">{active.value.toLocaleString()}</strong></span></div>
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-labelledby={title}>
      <title id={title}>{label} by reported day. Exact values are available in the daily data table.</title>
      {[0, 1 / 3, 2 / 3, 1].map(tick => <g key={tick}><line x1={left} x2={W - right} y1={y(max * tick)} y2={y(max * tick)} stroke="var(--chrome-border)"/><text x={left - 9} y={y(max * tick) + 4} fontSize="11" textAnchor="end" fill="var(--color-muted)">{Math.round(max * tick).toLocaleString()}</text></g>)}
      {valid.length > 1 ? <path d={`${d} L${x(valid[valid.length - 1].day)},${H - bottom} L${x(valid[0].day)},${H - bottom} Z`} fill="var(--color-pearl)" opacity=".08"/> : null}
      <path d={d} fill="none" stroke="var(--color-pearl)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
      {valid.map(point => <circle key={point.day} cx={x(point.day)} cy={y(point.value)} r={point.day === active.day ? 4 : 2.5} fill="var(--color-pearl)"/>)}
      <text x={left} y={H - 5} fontSize="11" fill="var(--color-muted)">{dayLabel(valid[0].day)}</text>
      <text x={W - right} y={H - 5} fontSize="11" textAnchor="end" fill="var(--color-muted)">{dayLabel(valid[valid.length - 1].day)}</text>
    </svg>
    <label className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">Inspect reported day<select aria-label="Inspect reported day" className="rounded-lg border border-ink/15 bg-transparent px-3 py-2 text-ink" value={active.day} onChange={event => setSelected(event.target.value)}>{valid.map(point => <option value={point.day} key={point.day}>{dayLabel(point.day)}</option>)}</select></label>
    <details className="mt-4"><summary className="cursor-pointer text-xs font-semibold">View daily data</summary><div className={`${styles.tableScroll} mt-3 max-h-80`}><table className={styles.table}><caption className="sr-only">{label} for each reported day</caption><thead><tr><th scope="col">Day</th><th scope="col">{label}</th></tr></thead><tbody>{valid.map(point => <tr key={point.day}><th scope="row">{point.day}</th><td>{point.value.toLocaleString()}</td></tr>)}</tbody></table></div></details>
  </div>;
}
