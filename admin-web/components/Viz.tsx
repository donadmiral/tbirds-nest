'use client';

/**
 * Operations visuals. Plain SVG, no chart library, every colour a theme token
 * so light and dark both work. Nothing here invents a number: each component
 * draws exactly the values it is handed.
 */
import { useState } from 'react';

const MONO: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

export function fmt(n: number): string {
  if (!isFinite(n)) return '0';
  if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(n) >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString();
}

function dayLabel(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ── sparkline ─────────────────────────────────────────────────────────── */

export function Spark({ values, color = 'var(--accent)', height = 26 }: { values: number[]; color?: string; height?: number }) {
  const n = values.length;
  if (n < 2) return <div style={{ height }} />;
  const max = Math.max(1, ...values);
  const pt = (v: number, i: number) => [(i / (n - 1)) * 120, 26 - (v / max) * 24];
  const line = values.map((v, i) => { const p = pt(v, i); return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
  const area = line + ' L120 26 L0 26 Z';
  const id = 'sp' + Math.abs(values.reduce((a, v, i) => a + v * (i + 7), 0)).toString(36) + color.replace(/[^a-z0-9]/gi, '');
  return (
    <svg viewBox="0 0 120 26" preserveAspectRatio="none" style={{ width: '100%', height, display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.20" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={'url(#' + id + ')'} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ── multi series line chart ───────────────────────────────────────────── */

type Row = Record<string, number | string>;
type Series = { key: string; label: string; color: string };

export function SeriesChart({ rows, series, height = 250 }: { rows: Row[]; series: Series[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [off, setOff] = useState<string[]>([]);
  const [range, setRange] = useState<number>(30);

  const ranges = [7, 30, 90].filter(r => r <= Math.max(7, rows.length));
  const shown = rows.slice(-range);
  const live = series.filter(s => !off.includes(s.key));
  const n = shown.length;
  const w = 1000, h = 250;
  const max = Math.max(1, ...shown.flatMap(d => live.map(s => Number(d[s.key]) || 0))) * 1.18;

  const path = (key: string) => shown.map((d, i) => {
    const x = n > 1 ? (i / (n - 1)) * w : 0;
    const y = h - ((Number(d[key]) || 0) / max) * h;
    return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }).join(' ');

  const hoverX = hover !== null && n > 1 ? (hover / (n - 1)) * w : null;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  if (!rows.length) return <Empty note="No days recorded in daily_stats yet." />;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, flex: 1, minWidth: 0 }}>
          {series.map(s => {
            const on = !off.includes(s.key);
            return (
              <button key={s.key} type="button" onClick={() => setOff(p => on ? [...p, s.key] : p.filter(k => k !== s.key))}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 11.6, color: on ? 'var(--txt)' : 'rgba(var(--on),0.3)' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: on ? s.color : 'rgba(var(--on),0.2)' }} />
                {s.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 9, background: 'rgba(var(--on),0.05)', border: '1px solid rgba(var(--on),0.10)' }}>
          {ranges.map(r => (
            <button key={r} type="button" onClick={() => { setRange(r); setHover(null); }} className="pc-seg pc-num"
              style={{ border: 'none', cursor: 'pointer', borderRadius: 7, padding: '4px 10px', fontSize: 11, fontWeight: 600, background: range === r ? 'rgba(var(--on),0.10)' : 'transparent', color: range === r ? 'var(--txt-strong)' : 'rgba(var(--on),0.4)' }}>
              {r}D
            </button>
          ))}
        </div>
      </div>

      <div style={{ position: 'relative', paddingLeft: 36 }} onMouseLeave={() => setHover(null)}>
        <svg viewBox={'0 0 ' + w + ' ' + h} preserveAspectRatio="none" style={{ display: 'block', width: '100%', height }}
          onMouseMove={e => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * w;
            setHover(Math.max(0, Math.min(n - 1, Math.round((x / w) * (n - 1)))));
          }}>
          {ticks.map(t => <line key={t} x1="0" y1={h * t} x2={w} y2={h * t} stroke="rgba(var(--on),0.08)" vectorEffect="non-scaling-stroke" />)}
          {hoverX !== null ? <line x1={hoverX} y1="0" x2={hoverX} y2={h} stroke="rgba(var(--on),0.22)" vectorEffect="non-scaling-stroke" /> : null}
          {live.map(s => <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
          {hoverX !== null ? live.map(s => (
            <circle key={s.key} cx={hoverX} cy={h - ((Number(shown[hover!][s.key]) || 0) / max) * h} r="3.2" fill="var(--panel)" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          )) : null}
        </svg>

        <div className="pc-num" style={{ position: 'absolute', left: 0, top: 0, height, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', pointerEvents: 'none', fontSize: 10, color: 'rgba(var(--on),0.3)' }}>
          {[1, 0.75, 0.5, 0.25, 0].map(t => <span key={t} style={{ transform: 'translateY(-50%)' }}>{fmt(Math.round(max * t))}</span>)}
        </div>

        {hover !== null && shown[hover] ? (
          <div style={{ position: 'absolute', top: 6, left: 'min(max(' + ((hoverX! / w) * 100).toFixed(1) + '%, 10px), calc(100% - 190px))', pointerEvents: 'none', minWidth: 170, padding: '9px 11px', borderRadius: 10, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.12)', boxShadow: '0 8px 26px rgba(0,0,0,0.14)' }}>
            <div style={{ fontSize: 10.5, color: 'rgba(var(--on),0.42)', marginBottom: 5 }}>{dayLabel(String(shown[hover].day))}</div>
            {live.map(s => (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 3 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, flex: '0 0 6px' }} />
                <span style={{ flex: 1, fontSize: 11.4, color: 'rgba(var(--on),0.58)' }}>{s.label}</span>
                <span className="pc-num" style={{ fontSize: 11.4, fontWeight: 600, color: 'var(--txt)' }}>{fmt(Number(shown[hover][s.key]) || 0)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="pc-num" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 10.5, color: 'rgba(var(--on),0.3)' }}>
        {[0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => (
          <span key={i}>{shown[i] ? dayLabel(String(shown[i].day)) : ''}</span>
        ))}
      </div>
    </div>
  );
}

/* ── donut ─────────────────────────────────────────────────────────────── */

export type Slice = { label: string; value: number; color: string };

export function Donut({ slices, centerLabel, size = 168 }: { slices: Slice[]; centerLabel: string; size?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return <Empty note="Nothing recorded in this window yet." />;

  const r = 54, c = 2 * Math.PI * r;
  let acc = 0;
  const arcs = slices.map((s, i) => {
    const frac = s.value / total;
    const seg = { ...s, i, frac, dash: c * frac, offset: -c * acc };
    acc += frac;
    return seg;
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flex: '0 0 ' + size + 'px' }}>
        <svg viewBox="0 0 140 140" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
          {arcs.map(a => (
            <circle key={a.label} cx="70" cy="70" r={r} fill="none" stroke={a.color}
              strokeWidth={hover === a.i ? 24 : 19}
              strokeDasharray={Math.max(0, a.dash - 1.5) + ' ' + c}
              strokeDashoffset={a.offset}
              style={{ transition: 'stroke-width 140ms', opacity: hover === null || hover === a.i ? 1 : 0.35 }}
              onMouseEnter={() => setHover(a.i)} onMouseLeave={() => setHover(null)} />
          ))}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <span className="pc-num" style={{ fontSize: 21, color: 'var(--txt-strong)' }}>{hover === null ? fmt(total) : fmt(slices[hover].value)}</span>
          <span style={{ fontSize: 10.5, color: 'rgba(var(--on),0.4)', marginTop: 2, maxWidth: 96, textAlign: 'center' }}>{hover === null ? centerLabel : slices[hover].label}</span>
        </div>
      </div>
      <div style={{ flex: '1 1 150px', minWidth: 150 }}>
        {arcs.map(a => (
          <div key={a.label} onMouseEnter={() => setHover(a.i)} onMouseLeave={() => setHover(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 0', opacity: hover === null || hover === a.i ? 1 : 0.5 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: a.color, flex: '0 0 8px' }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 11.8, color: 'rgba(var(--on),0.62)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.label}</span>
            <span className="pc-num" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--txt)', ...MONO }}>{(a.frac * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── bars ──────────────────────────────────────────────────────────────── */

export function Bars({ items, height = 150 }: { items: { label: string; value: number }[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...items.map(i => i.value));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height }}>
        {items.map((it, i) => (
          <div key={it.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', height: '100%', gap: 6 }}>
            <span className="pc-num" style={{ fontSize: 10.5, color: hover === i ? 'var(--txt)' : 'rgba(var(--on),0.34)' }}>{it.value}</span>
            <div style={{ width: '100%', height: Math.max(2, (it.value / max) * (height - 26)), borderRadius: '5px 5px 2px 2px', background: hover === i ? 'var(--accent)' : 'rgba(var(--on),0.20)', transition: 'background 140ms, height 200ms' }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
        {items.map(it => <span key={it.label} style={{ flex: 1, textAlign: 'center', fontSize: 10.5, color: 'rgba(var(--on),0.36)' }}>{it.label}</span>)}
      </div>
    </div>
  );
}

export function StackBars({ days, series, height = 160 }: { days: Row[]; series: Series[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = days.map(d => series.reduce((a, s) => a + (Number(d[s.key]) || 0), 0));
  const max = Math.max(1, ...totals);
  if (!days.length) return <Empty note="No days in this window yet." />;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height }}>
        {days.map((d, i) => (
          <div key={String(d.day)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', position: 'relative' }}>
            {series.map(s => {
              const v = Number(d[s.key]) || 0;
              if (v <= 0) return null;
              return <div key={s.key} style={{ height: (v / max) * height, background: s.color, opacity: hover === null || hover === i ? 1 : 0.4, transition: 'opacity 140ms' }} />;
            })}
            {totals[i] === 0 ? <div style={{ height: 2, background: 'rgba(var(--on),0.09)' }} /> : null}
            {hover === i ? (
              <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translate(-50%,-6px)', zIndex: 5, whiteSpace: 'nowrap', padding: '7px 9px', borderRadius: 9, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.12)', boxShadow: '0 8px 22px rgba(0,0,0,0.14)' }}>
                <div style={{ fontSize: 10.3, color: 'rgba(var(--on),0.42)', marginBottom: 3 }}>{dayLabel(String(d.day))}</div>
                {series.map(s => (
                  <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 2, background: s.color }} />
                    <span style={{ fontSize: 11, color: 'rgba(var(--on),0.58)' }}>{s.label}</span>
                    <span className="pc-num" style={{ fontSize: 11, fontWeight: 600, color: 'var(--txt)' }}>{Number(d[s.key]) || 0}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7, fontSize: 10.5, color: 'rgba(var(--on),0.3) ' }}>
        <span>{dayLabel(String(days[0].day))}</span>
        <span>{dayLabel(String(days[days.length - 1].day))}</span>
      </div>
    </div>
  );
}

export function Empty({ note }: { note: string }) {
  return <div style={{ padding: '34px 0', textAlign: 'center', fontSize: 12.4, color: 'rgba(var(--on),0.34)' }}>{note}</div>;
}
