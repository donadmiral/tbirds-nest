'use client';

import { useState } from 'react';

type Day = { day: string; dau: number; posts: number; stories: number; messages: number };

export default function PlatformActivityChart({ rows }: { rows: Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [range, setRange] = useState<7 | 30>(30);
  const shown = rows.slice(-range);
  const w = 720, h = 200;
  const maxV = Math.max(1, ...shown.flatMap(d => [d.dau, d.posts, d.stories, d.messages])) * 1.15;
  const n = shown.length;

  const series: { key: keyof Day; label: string; color: string }[] = [
    { key: 'dau', label: 'Active users', color: '#5B4BD1' },
    { key: 'posts', label: 'Posts', color: '#2E86AB' },
    { key: 'stories', label: 'Stories', color: '#C98A2C' },
    { key: 'messages', label: 'Messages', color: '#B03A6B' },
  ];

  function toPoints(key: keyof Day) {
    return shown.map((d, i) => (n > 1 ? (i / (n - 1)) * w : 0) + ',' + (h - ((d[key] as number) / maxV) * h)).join(' ');
  }

  const hoverX = hover !== null && n > 1 ? (hover / (n - 1)) * w : null;

  if (rows.length === 0) {
    return <p className="py-14 text-center text-[13px] text-[#9A9DA4]">No days recorded in daily_stats yet.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex flex-wrap gap-4 text-[12px] text-[#7A7D84]">
          {series.map(s => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        <div className="flex gap-1 rounded-[8px] bg-[#F4F3F0] p-0.5">
          {([7, 30] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={'rounded-[6px] px-2.5 py-1 text-[11.5px] font-semibold transition-colors duration-150 ' + (range === r ? 'bg-white text-[#17181C] shadow-sm' : 'text-[#9A9DA4]')}>
              {r}D
            </button>
          ))}
        </div>
      </div>
      <div className="relative" onMouseLeave={() => setHover(null)}>
        <svg viewBox={'0 0 ' + w + ' ' + h} className="block w-full" style={{ height: 200 }}
          onMouseMove={e => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * w;
            setHover(Math.max(0, Math.min(n - 1, Math.round((x / w) * (n - 1)))));
          }}
        >
          <line x1="0" y1={h * 0.25} x2={w} y2={h * 0.25} stroke="#EEEDE9" />
          <line x1="0" y1={h * 0.5} x2={w} y2={h * 0.5} stroke="#EEEDE9" />
          <line x1="0" y1={h * 0.75} x2={w} y2={h * 0.75} stroke="#EEEDE9" />
          {series.map(s => (
            <polyline key={s.key} points={toPoints(s.key)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {hoverX !== null && <line x1={hoverX} y1="0" x2={hoverX} y2={h} stroke="#D6D4CE" />}
        </svg>
        {hover !== null && (
          <div className="pointer-events-none absolute top-2 rounded-[9px] border border-[#E5E4E0] bg-white px-3 py-2 text-[11.5px] shadow-lg"
            style={{ left: Math.min(Math.max((hoverX! / w) * 100, 8), 78) + '%' }}>
            <p className="mb-1 text-[10.5px] uppercase tracking-wide text-[#9A9DA4]">
              {new Date(shown[hover].day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </p>
            {series.map(s => (
              <p key={s.key} className="flex items-center gap-1.5 tabular-nums">
                <span className="h-[6px] w-[6px] rounded-full" style={{ background: s.color }} />
                {s.label} <b>{(shown[hover][s.key] as number).toLocaleString()}</b>
              </p>
            ))}
          </div>
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-[#9A9DA4]">
        {[0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1].map((i, k) => (
          <span key={k}>{shown[i] ? new Date(shown[i].day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}</span>
        ))}
      </div>
    </div>
  );
}