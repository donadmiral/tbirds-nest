"use client";

/**
 * Chart primitives for Studio.
 *
 * Deliberately dependency-free. A charting library would add ~90kb to a page
 * that draws four shapes, and none of them match the tokens without a wrapper
 * anyway. These are plain SVG, sized by the container, coloured only from
 * globals.css so a token change reaches every chart.
 *
 * Every chart handles the two states real data actually arrives in: nothing
 * yet, and all-zeroes. Both draw a flat baseline rather than collapsing, so a
 * card never jumps in height when the numbers land.
 */

const PEARL = "var(--color-pearl)";
const PEARL_MUTED = "var(--color-pearl-muted)";
const INK = "var(--color-ink)";

function path(points: number[], w: number, h: number, pad = 2) {
  if (points.length === 0) return { line: "", area: "", last: null as null | { x: number; y: number } };
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const stepX = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const coords = points.map((v, i) => ({ x: pad + i * stepX, y: y(v) }));
  const line = coords.map((c, i) => (i === 0 ? "M" : "L") + c.x.toFixed(1) + " " + c.y.toFixed(1)).join(" ");
  const area = line + ` L${(pad + (points.length - 1) * stepX).toFixed(1)} ${h} L${pad} ${h} Z`;
  return { line, area, last: coords[coords.length - 1] };
}

/** The line inside a metric card. Reads as a trend, not as a chart. */
export function Sparkline({
  points,
  width = 120,
  height = 34,
  tone = "pearl",
}: {
  points: number[];
  width?: number;
  height?: number;
  tone?: "pearl" | "up" | "down";
}) {
  const stroke = tone === "up" ? "var(--color-success)" : tone === "down" ? "var(--color-danger)" : PEARL;
  const flat = points.length === 0 || points.every((p) => p === points[0]);
  const { line, area, last } = path(points.length ? points : [0, 0], width, height);
  const gid = "spark-" + tone;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity="0.18" />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {flat ? null : <path d={area} fill={`url(#${gid})`} />}
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity={flat ? 0.35 : 1} />
      {flat || !last ? null : <circle cx={last.x} cy={last.y} r="2.2" fill={stroke} />}
    </svg>
  );
}

/** Full-width trend with a date axis, for the insights desks. */
export function TrendChart({
  series,
  labels,
  height = 180,
}: {
  series: { name: string; points: number[]; tone?: "pearl" | "ink" }[];
  labels?: string[];
  height?: number;
}) {
  const W = 640;
  const H = height;
  const gridY = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={series.map((s) => s.name).join(", ")}>
        {gridY.map((g) => (
          <line key={g} x1="0" x2={W} y1={8 + g * (H - 34)} y2={8 + g * (H - 34)} stroke={INK} strokeOpacity="0.07" strokeWidth="1" />
        ))}
        {series.map((s, i) => {
          const stroke = s.tone === "ink" ? INK : PEARL;
          const { line, area } = path(s.points.length ? s.points : [0, 0], W, H - 26, 4);
          return (
            <g key={s.name}>
              {i === 0 ? <path d={area} fill={stroke} fillOpacity="0.07" /> : null}
              <path d={line} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" strokeOpacity={s.tone === "ink" ? 0.45 : 1} />
            </g>
          );
        })}
      </svg>
      {labels && labels.length > 1 ? (
        <div className="mt-1 flex justify-between text-[11px] text-ink/35">
          <span>{labels[0]}</span>
          <span>{labels[Math.floor(labels.length / 2)]}</span>
          <span>{labels[labels.length - 1]}</span>
        </div>
      ) : null}
      {series.length > 1 ? (
        <div className="mt-2 flex gap-4 text-[11.5px] text-ink/50">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <span className="h-[2px] w-4 rounded-full" style={{ background: s.tone === "ink" ? INK : PEARL, opacity: s.tone === "ink" ? 0.45 : 1 }} />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Ranked rows with a proportional bar. Used for locations, ages, referrers. */
export function RankedBars({ rows, unit }: { rows: { label: string; value: number }[]; unit?: string }) {
  const max = rows.length ? Math.max(...rows.map((r) => r.value)) || 1 : 1;
  if (rows.length === 0) return <p className="text-[13px] text-ink/40">Nothing to show yet.</p>;
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="truncate text-ink">{r.label}</span>
            <span className="ml-3 shrink-0 tabular-nums text-ink/45">
              {r.value.toLocaleString()}
              {unit ? " " + unit : ""}
            </span>
          </div>
          <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-surface">
            <div className="h-full rounded-full" style={{ width: Math.max((r.value / max) * 100, 2) + "%", background: PEARL }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A share-of-total ring. Segments beyond the fifth fold into "Other". */
export function DonutChart({ slices, size = 132 }: { slices: { label: string; value: number }[]; size?: number }) {
  const top = [...slices].sort((a, b) => b.value - a.value);
  const head = top.slice(0, 5);
  const restTotal = top.slice(5).reduce((n, s) => n + s.value, 0);
  const parts = restTotal > 0 ? [...head, { label: "Other", value: restTotal }] : head;
  const total = parts.reduce((n, s) => n + s.value, 0);
  if (total === 0) return <p className="text-[13px] text-ink/40">Nothing to show yet.</p>;

  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;
  const opacities = [1, 0.72, 0.52, 0.36, 0.24, 0.14];
  let offset = 0;

  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Share of total">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {parts.map((s, i) => {
            const len = (s.value / total) * c;
            const el = (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={PEARL}
                strokeOpacity={opacities[i] ?? 0.14}
                strokeWidth="14"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
        </g>
      </svg>
      <ul className="flex min-w-0 flex-col gap-1.5">
        {parts.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2 text-[13px]">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PEARL, opacity: opacities[i] ?? 0.14 }} />
            <span className="truncate text-ink">{s.label}</span>
            <span className="ml-auto shrink-0 tabular-nums text-ink/45">{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Thumbnail for a content row. Falls back to a lettered tile, never a gap. */
export function ContentThumb({ url, kind, label, size = 44 }: { url?: string | null; kind?: string | null; label?: string | null; size?: number }) {
  const box = { width: size, height: size };
  if (url && kind !== "video") {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        style={box}
        className="shrink-0 rounded-md object-cover"
      />
    );
  }
  if (url && kind === "video") {
    return (
      <span style={box} className="relative shrink-0 overflow-hidden rounded-md bg-surface">
        <video src={url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
        <span className="absolute inset-0 flex items-center justify-center bg-ink/25 text-[10px] text-white">▶</span>
      </span>
    );
  }
  return (
    <span
      style={box}
      className="flex shrink-0 items-center justify-center rounded-md bg-surface text-[13px] font-semibold text-ink/35"
    >
      {(label || "·").trim().charAt(0).toUpperCase()}
    </span>
  );
}
