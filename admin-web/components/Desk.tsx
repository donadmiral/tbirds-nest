'use client';

/**
 * The operations desk kit. One master-detail table used by every desk:
 * stat strip, tabs with counts, search, facet filters, paging, detail panel.
 * Rows arrive as plain data from the server, so no desk repeats this markup.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { fmt } from '@/lib/fmt';
import { Spark } from '@/components/Viz';

export type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'neutral' | 'accent';

const TONE: Record<Tone, { bg: string; fg: string; bd: string }> = {
  ok: { bg: 'rgba(var(--ok-rgb),0.10)', fg: 'var(--ok)', bd: 'rgba(var(--ok-rgb),0.22)' },
  bad: { bg: 'rgba(var(--bad-rgb),0.10)', fg: 'var(--bad)', bd: 'rgba(var(--bad-rgb),0.22)' },
  warn: { bg: 'rgba(var(--warn-rgb),0.12)', fg: 'var(--warn)', bd: 'rgba(var(--warn-rgb),0.24)' },
  info: { bg: 'rgba(var(--info-rgb),0.10)', fg: 'var(--info)', bd: 'rgba(var(--info-rgb),0.22)' },
  accent: { bg: 'rgba(var(--accent-rgb),0.10)', fg: 'var(--accent)', bd: 'rgba(var(--accent-rgb),0.20)' },
  neutral: { bg: 'rgba(var(--on),0.06)', fg: 'rgba(var(--on),0.55)', bd: 'rgba(var(--on),0.12)' },
};

export type Cell =
  | { t: 'text'; v: string; strong?: boolean }
  | { t: 'dim'; v: string }
  | { t: 'mono'; v: string; tone?: Tone }
  | { t: 'pill'; v: string; tone: Tone }
  | { t: 'user'; v: string; sub?: string; img?: string | null }
  | { t: 'link'; v: string; href: string };

export type Detail = {
  title: string;
  subtitle?: string;
  img?: string | null;
  pills?: { v: string; tone: Tone }[];
  stats?: { label: string; value: string }[];
  fields?: { label: string; value: string }[];
  body?: { label: string; text: string }[];
  links?: { label: string; href: string }[];
};

export type DeskRow = {
  id: string;
  tabs: string[];
  search: string;
  facets?: Record<string, string>;
  cells: Cell[];
  detail: Detail;
};

export type StatCard = {
  label: string; value: string; delta?: string; deltaTone?: Tone; note?: string; spark?: number[]; color?: string; icon?: string;
};

const PANEL: React.CSSProperties = { borderRadius: 13, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)', overflow: 'hidden' };

export function StatStrip({ cards }: { cards: StatCard[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
      {cards.map(c => (
        <div key={c.label} style={{ ...PANEL, padding: '14px 15px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 11.3, fontWeight: 600, color: 'rgba(var(--on),0.5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
            {c.icon ? (
              <span style={{ width: 26, height: 26, flex: '0 0 26px', borderRadius: 8, background: 'rgba(var(--on),0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" style={{ fill: c.color || 'var(--accent)' }}><path d={c.icon} /></svg>
              </span>
            ) : null}
          </div>
          <div className="pc-num" style={{ marginTop: 9, fontSize: 25, lineHeight: 1, color: 'var(--txt-strong)' }}>{c.value}</div>
          <div style={{ marginTop: 9, display: 'flex', alignItems: 'baseline', gap: 7, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {c.delta ? <span className="pc-num" style={{ flex: '0 0 auto', fontSize: 10.5, fontWeight: 600, color: TONE[c.deltaTone || 'neutral'].fg }}>{c.delta}</span> : null}
            <span style={{ flex: 1, minWidth: 0, fontSize: 10, color: 'rgba(var(--on),0.3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.note || ''}</span>
          </div>
          {c.spark && c.spark.length > 1 ? <div style={{ marginTop: 9 }}><Spark values={c.spark} color={c.color || 'var(--accent)'} height={24} /></div> : null}
        </div>
      ))}
    </div>
  );
}

function CellView({ c }: { c: Cell }) {
  if (c.t === 'pill') {
    const tn = TONE[c.tone];
    return <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2.5px 8px', borderRadius: 999, background: tn.bg, color: tn.fg, border: '1px solid ' + tn.bd, whiteSpace: 'nowrap' }}>{c.v}</span>;
  }
  if (c.t === 'user') {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        {c.img
          ? <img src={c.img} alt="" style={{ width: 29, height: 29, flex: '0 0 29px', borderRadius: '50%', objectFit: 'cover' }} />
          : <span style={{ width: 29, height: 29, flex: '0 0 29px', borderRadius: '50%', background: 'rgba(var(--on),0.07)', color: 'rgba(var(--on),0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 700 }}>{c.v.slice(0, 1).toUpperCase()}</span>}
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 12.3, fontWeight: 600, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.v}</span>
          {c.sub ? <span style={{ display: 'block', fontSize: 10.6, color: 'rgba(var(--on),0.36)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.sub}</span> : null}
        </span>
      </span>
    );
  }
  if (c.t === 'link') return <Link href={c.href} className="pc-crumb" style={{ fontSize: 12.2, color: 'var(--txt)', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.v}</Link>;
  if (c.t === 'mono') return <span className="pc-num" style={{ fontSize: 11.6, color: c.tone ? TONE[c.tone].fg : 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.v}</span>;
  if (c.t === 'dim') return <span style={{ fontSize: 11.8, color: 'rgba(var(--on),0.42)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.v}</span>;
  return <span style={{ fontSize: 12.2, fontWeight: c.strong ? 600 : 400, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.v}</span>;
}

export function Desk({
  tabs, columns, grid, rows, searchHint, filters = [], pageSize = 10, minWidth = 720, detailTitle = 'Details',
}: {
  tabs: { key: string; label: string; count: number }[];
  columns: { label: string; align?: 'left' | 'right' }[];
  grid: string;
  rows: DeskRow[];
  searchHint: string;
  filters?: { key: string; label: string; options: string[] }[];
  pageSize?: number;
  minWidth?: number;
  detailTitle?: string;
}) {
  const [tab, setTab] = useState(tabs[0]?.key ?? 'all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [facet, setFacet] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<string | null>(rows[0]?.id ?? null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r => {
      if (tab !== 'all' && !r.tabs.includes(tab)) return false;
      if (needle && !r.search.includes(needle)) return false;
      for (const f of filters) {
        const want = facet[f.key];
        if (want && want !== 'All' && (r.facets?.[f.key] || '') !== want) return false;
      }
      return true;
    });
  }, [rows, tab, q, facet, filters]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const shown = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const selected = rows.find(r => r.id === sel) || null;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_368px]">
      <div style={PANEL}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '3px 8px 0', borderBottom: '1px solid rgba(var(--on),0.10)', overflowX: 'auto' }}>
          {tabs.map(t => {
            const on = t.key === tab;
            return (
              <button key={t.key} type="button" onClick={() => { setTab(t.key); setPage(0); }}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '11px 12px 10px', background: 'none', border: 'none', borderBottom: '2px solid ' + (on ? 'var(--accent)' : 'transparent'), cursor: 'pointer', fontSize: 12.3, fontWeight: on ? 600 : 500, color: on ? 'var(--txt-strong)' : 'rgba(var(--on),0.45)', whiteSpace: 'nowrap' }}>
                {t.label}
                {t.count > 0 ? <span className="pc-num" style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 5, background: on ? 'rgba(var(--accent-rgb),0.14)' : 'rgba(var(--on),0.07)', color: on ? 'var(--accent)' : 'rgba(var(--on),0.45)' }}>{t.count}</span> : null}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 13px', borderBottom: '1px solid rgba(var(--on),0.10)', flexWrap: 'wrap' }}>
          <div className="pc-search" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6.5px 10px', borderRadius: 8, background: 'rgba(var(--on),0.035)', border: '1px solid rgba(var(--on),0.10)', minWidth: 200 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ stroke: 'rgba(var(--on),0.36)', flex: '0 0 12px' }} strokeWidth="2.4"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></svg>
            <input value={q} onChange={e => { setQ(e.target.value); setPage(0); }} placeholder={searchHint}
              style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', fontSize: 11.8, color: 'var(--txt)' }} />
          </div>
          {filters.map(f => (
            <select key={f.key} value={facet[f.key] || 'All'} onChange={e => { setFacet(p => ({ ...p, [f.key]: e.target.value })); setPage(0); }}
              style={{ padding: '6.5px 10px', borderRadius: 8, background: 'rgba(var(--on),0.035)', border: '1px solid rgba(var(--on),0.10)', fontSize: 11.8, color: 'rgba(var(--on),0.62)', outline: 'none', cursor: 'pointer' }}>
              <option value="All">{f.label}: All</option>
              {f.options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ))}
          <span className="pc-num" style={{ marginLeft: 'auto', fontSize: 10.5, color: 'rgba(var(--on),0.3)' }}>{filtered.length} of {rows.length}</span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth }}>
            <div style={{ display: 'grid', gridTemplateColumns: grid, padding: '0 13px', borderBottom: '1px solid rgba(var(--on),0.10)', background: 'rgba(var(--on),0.015)' }}>
              {columns.map((c, i) => (
                <div key={c.label + i} style={{ padding: '9px 8px', fontSize: 10.3, fontWeight: 700, color: 'rgba(var(--on),0.36)', textAlign: c.align || 'left', whiteSpace: 'nowrap' }}>{c.label}</div>
              ))}
            </div>
            {shown.length === 0 ? (
              <div style={{ padding: '38px 0', textAlign: 'center', fontSize: 12.4, color: 'rgba(var(--on),0.34)' }}>Nothing matches this view.</div>
            ) : shown.map(r => {
              const on = r.id === sel;
              return (
                <div key={r.id} onClick={() => setSel(r.id)} className="pc-nav"
                  style={{ display: 'grid', gridTemplateColumns: grid, padding: '0 13px', cursor: 'pointer', borderBottom: '1px solid rgba(var(--on),0.10)', background: on ? 'rgba(var(--on),0.05)' : 'transparent', boxShadow: on ? 'inset 2px 0 0 var(--accent)' : 'none' }}>
                  {r.cells.map((c, i) => (
                    <div key={i} style={{ padding: '10px 8px', display: 'flex', alignItems: 'center', minWidth: 0, justifyContent: columns[i]?.align === 'right' ? 'flex-end' : 'flex-start' }}>
                      <CellView c={c} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px' }}>
          <span className="pc-num" style={{ flex: 1, fontSize: 10.8, color: 'rgba(var(--on),0.34)' }}>
            {filtered.length === 0 ? 'Nothing to show' : 'Showing ' + (safePage * pageSize + 1) + ' to ' + Math.min(filtered.length, safePage * pageSize + pageSize) + ' of ' + filtered.length}
          </span>
          <button type="button" disabled={safePage === 0} onClick={() => setPage(p => Math.max(0, p - 1))} className="pc-icon-btn"
            style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(var(--on),0.10)', background: 'transparent', fontSize: 11.5, color: safePage === 0 ? 'rgba(var(--on),0.22)' : 'var(--txt)', cursor: safePage === 0 ? 'default' : 'pointer' }}>Back</button>
          <span className="pc-num" style={{ fontSize: 11.2, color: 'rgba(var(--on),0.45)' }}>{safePage + 1} / {pages}</span>
          <button type="button" disabled={safePage >= pages - 1} onClick={() => setPage(p => Math.min(pages - 1, p + 1))} className="pc-icon-btn"
            style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(var(--on),0.10)', background: 'transparent', fontSize: 11.5, color: safePage >= pages - 1 ? 'rgba(var(--on),0.22)' : 'var(--txt)', cursor: safePage >= pages - 1 ? 'default' : 'pointer' }}>Next</button>
        </div>
      </div>

      <div style={PANEL}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 12px', borderBottom: '1px solid rgba(var(--on),0.10)' }}>
          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: 'var(--txt)' }}>{detailTitle}</span>
        </div>
        {!selected ? (
          <div style={{ padding: '44px 16px', textAlign: 'center', fontSize: 12.4, color: 'rgba(var(--on),0.34)' }}>Pick a row to open it.</div>
        ) : (
          <div style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              {selected.detail.img
                ? <img src={selected.detail.img} alt="" style={{ width: 42, height: 42, flex: '0 0 42px', borderRadius: 11, objectFit: 'cover' }} />
                : <span style={{ width: 42, height: 42, flex: '0 0 42px', borderRadius: 11, background: 'var(--chip-bg)', color: 'var(--chip-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700 }}>{selected.detail.title.slice(0, 1).toUpperCase()}</span>}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--txt-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selected.detail.title}</div>
                {selected.detail.subtitle ? <div style={{ fontSize: 11.4, color: 'rgba(var(--on),0.4)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selected.detail.subtitle}</div> : null}
              </div>
            </div>

            {selected.detail.pills?.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                {selected.detail.pills.map((p, i) => <CellView key={i} c={{ t: 'pill', v: p.v, tone: p.tone }} />)}
              </div>
            ) : null}

            {selected.detail.stats?.length ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                {selected.detail.stats.map(s => (
                  <div key={s.label} style={{ flex: '1 1 78px', minWidth: 78, padding: '9px 10px', borderRadius: 10, border: '1px solid rgba(var(--on),0.10)' }}>
                    <div className="pc-num" style={{ fontSize: 16, color: 'var(--txt-strong)' }}>{s.value}</div>
                    <div style={{ fontSize: 10, color: 'rgba(var(--on),0.36)', marginTop: 3 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            ) : null}

            {selected.detail.fields?.length ? (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(var(--on),0.10)' }}>
                {selected.detail.fields.map(f => (
                  <div key={f.label} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '5px 0' }}>
                    <span style={{ flex: '0 0 108px', fontSize: 11.4, color: 'rgba(var(--on),0.38)' }}>{f.label}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11.8, color: 'var(--txt)', wordBreak: 'break-word' }}>{f.value}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {selected.detail.body?.map(b => (
              <div key={b.label} style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11.3, fontWeight: 600, color: 'rgba(var(--on),0.5)', marginBottom: 6 }}>{b.label}</div>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 11.8, lineHeight: 1.5, color: 'rgba(var(--on),0.62)', padding: 11, borderRadius: 10, background: 'rgba(var(--on),0.035)' }}>{b.text}</div>
              </div>
            ))}

            {selected.detail.links?.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(var(--on),0.10)' }}>
                {selected.detail.links.map(l => (
                  <Link key={l.href + l.label} href={l.href} className="pc-icon-btn"
                    style={{ padding: '8px 13px', borderRadius: 9, border: '1px solid rgba(var(--on),0.12)', fontSize: 12, fontWeight: 600, color: 'var(--txt)', textDecoration: 'none' }}>{l.label}</Link>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export { fmt };
