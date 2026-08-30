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
import { csv, downloadText, slug, stamp, trayAdd } from '@/lib/share';

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
  | { t: 'media'; v: string; sub?: string; thumb?: string | null; video?: boolean }
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
  /** full width media preview at the top of the panel */
  media?: { url: string; video?: boolean } | null;
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
  /** keys of the desk actions this row may take */
  actions?: string[];
  /** value posted as the action's id field, defaults to the row id */
  actionId?: string;
};

export type DeskInput = { name: string; placeholder?: string; required?: boolean; type?: string; options?: string[]; defaultValue?: string };

export type DeskAction = {
  key: string;
  label: string;
  tone?: Tone;
  /** a real server action, passed straight through from the page */
  action: (formData: FormData) => void | Promise<void>;
  idName: string;
  inputs?: DeskInput[];
};

export type StatCard = {
  label: string; value: string; delta?: string; deltaTone?: Tone; note?: string; spark?: number[]; color?: string; icon?: string;
};

const PANEL: React.CSSProperties = { borderRadius: 13, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)', overflow: 'hidden' };

export function StatStrip({ cards, page }: { cards: StatCard[]; page?: string }) {
  const label = page || deskName();
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
      {cards.map(c => (
        <div key={c.label} className="pc-collect" style={{ ...PANEL, padding: '14px 15px 12px', position: 'relative' }}>
          <CollectButton title={c.label} onAdd={() => trayAdd({
            kind: 'stat', title: c.label, page: label, path: here(),
            stat: { value: c.value, delta: c.delta, note: c.note },
          })} />
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

/** The route the admin is on, used to cite the source of a collected item. */
function here(): string {
  return typeof window === 'undefined' ? '' : window.location.pathname;
}

/** Desk label derived from the route when a page does not pass its own. */
function deskName(): string {
  const p = here().split('/')[1] || 'operations';
  return p.charAt(0).toUpperCase() + p.slice(1);
}

/** The small plus that drops a number or a table into the presentation tray. */
function CollectButton({ title, onAdd }: { title: string; onAdd: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" title={'Add ' + title + ' to the presentation'} className="pc-collect-btn"
      onClick={() => { onAdd(); setDone(true); setTimeout(() => setDone(false), 1300); }}
      style={{
        position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 7,
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        border: '1px solid rgba(var(--on),0.12)', background: 'var(--panel)',
        color: done ? 'var(--ok)' : 'rgba(var(--on),0.42)', zIndex: 2,
      }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round" style={{ stroke: 'currentColor' }}>
        <path d={done ? 'M5 13l4 4L19 7' : 'M12 5v14M5 12h14'} />
      </svg>
    </button>
  );
}

function CellView({ c }: { c: Cell }) {
  if (c.t === 'media') {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ width: 42, height: 42, flex: '0 0 42px', borderRadius: 9, overflow: 'hidden', background: 'rgba(var(--on),0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          {c.thumb
            ? (c.video
              ? <video src={c.thumb} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <img src={c.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)
            : <svg width="15" height="15" viewBox="0 0 24 24" style={{ fill: 'rgba(var(--on),0.24)' }}><path d="M4 4h16v12H5.2L4 17.2V4zm2 3h12v2H6V7zm0 4h8v2H6v-2z" /></svg>}
          {c.video && c.thumb ? (
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.28)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" style={{ fill: '#fff' }}><path d="M8 5v14l11-7z" /></svg>
            </span>
          ) : null}
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 12.3, fontWeight: 600, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.v}</span>
          {c.sub ? <span style={{ display: 'block', fontSize: 10.6, color: 'rgba(var(--on),0.36)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.sub}</span> : null}
        </span>
      </span>
    );
  }
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
  tabs, columns, grid, rows, searchHint, filters = [], pageSize = 10, minWidth = 720, detailTitle = 'Details', actions = [], pageLabel,
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
  actions?: DeskAction[];
  /** desk label carried onto anything shared from this table */
  pageLabel?: string;
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
          <TableShare page={pageLabel || deskName()} columns={columns.map(c => c.label)} filtered={filtered} all={rows}
            state={[tab !== 'all' ? 'Tab: ' + (tabs.find(t => t.key === tab)?.label || tab) : '', q.trim() ? 'Search: ' + q.trim() : '',
              ...filters.map(f => (facet[f.key] && facet[f.key] !== 'All' ? f.label + ': ' + facet[f.key] : ''))].filter(Boolean)} />
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
            {selected.detail.media ? (
              <div style={{ marginBottom: 14, borderRadius: 11, overflow: 'hidden', background: 'rgba(var(--on),0.05)', border: '1px solid rgba(var(--on),0.10)' }}>
                {selected.detail.media.video
                  ? <video key={selected.detail.media.url} src={selected.detail.media.url} controls playsInline preload="metadata" style={{ display: 'block', width: '100%', maxHeight: 320, objectFit: 'contain', background: '#000' }} />
                  : <img key={selected.detail.media.url} src={selected.detail.media.url} alt="" style={{ display: 'block', width: '100%', maxHeight: 320, objectFit: 'contain' }} />}
              </div>
            ) : null}
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

            {actions.filter(a => (selected.actions || []).includes(a.key)).map(a => {
              const tn = TONE[a.tone || 'neutral'];
              return (
                <form key={a.key} action={a.action} style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input type="hidden" name={a.idName} value={selected.actionId || selected.id} />
                  {(a.inputs || []).map(inp => inp.options ? (
                    <select key={inp.name} name={inp.name} defaultValue={inp.defaultValue}
                      style={{ padding: '8px 10px', borderRadius: 9, background: 'rgba(var(--on),0.035)', border: '1px solid rgba(var(--on),0.12)', fontSize: 12, color: 'var(--txt)', outline: 'none' }}>
                      {inp.options.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                    </select>
                  ) : (
                    <input key={inp.name} name={inp.name} type={inp.type || 'text'} required={inp.required} placeholder={inp.placeholder} defaultValue={inp.defaultValue}
                      style={{ padding: '8px 10px', borderRadius: 9, background: 'rgba(var(--on),0.035)', border: '1px solid rgba(var(--on),0.12)', fontSize: 12, color: 'var(--txt)', outline: 'none' }} />
                  ))}
                  <button type="submit"
                    style={{ padding: '9px 13px', borderRadius: 9, cursor: 'pointer', fontSize: 12, fontWeight: 600, background: tn.bg, color: tn.fg, border: '1px solid ' + tn.bd }}>{a.label}</button>
                </form>
              );
            })}

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

/**
 * Table sharing. Whatever the admin is looking at right now - this tab, this
 * search, these facets - is exactly what leaves the building, and the filter
 * state travels with it so the file can be trusted later.
 */
function TableShare({ page, columns, filtered, all, state }: {
  page: string;
  columns: string[];
  filtered: DeskRow[];
  all: DeskRow[];
  state: string[];
}) {
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState('');

  const body = (rs: DeskRow[]) => rs.map(r => r.cells.map(c => {
    const v = String((c as { v?: string }).v ?? '');
    const sub = (c as { sub?: string }).sub;
    return sub ? v + ' (' + sub + ')' : v;
  }));

  function note(msg: string) {
    setFlash(msg);
    setOpen(false);
    setTimeout(() => setFlash(''), 1500);
  }

  function exportRows(rs: DeskRow[], which: string) {
    downloadText(slug(page + '-' + which) + '-' + stamp() + '.csv', 'text/csv', csv(columns, body(rs)));
    note(rs.length + ' rows exported');
  }

  function exportJson(rs: DeskRow[]) {
    downloadText(slug(page) + '-' + stamp() + '.json', 'application/json', JSON.stringify({
      page, filters: state, exportedAt: new Date().toISOString(),
      columns, rows: body(rs),
    }, null, 2));
    note('JSON exported');
  }

  function collect() {
    trayAdd({
      kind: 'table', title: page + ' table', subtitle: state.join(' \u00b7 '), page, path: here(),
      table: { columns, rows: body(filtered).slice(0, 60), total: filtered.length, filters: state.length ? state : ['No filters, the full desk'] },
    });
    note('Added to presentation');
  }

  const row: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
    padding: '7.5px 10px', borderRadius: 7, border: 'none', background: 'transparent',
    cursor: 'pointer', fontSize: 12, fontWeight: 500, color: 'var(--txt)',
  };

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)} title="Share or export this table" className="pc-icon-btn"
        style={{ width: 27, height: 27, borderRadius: 7, border: '1px solid rgba(var(--on),0.10)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" style={{ fill: 'rgba(var(--on),0.45)' }}>
          <circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" />
        </svg>
      </button>

      {flash ? (
        <span style={{ position: 'absolute', top: 33, right: 0, whiteSpace: 'nowrap', padding: '5px 9px', borderRadius: 7, fontSize: 11, fontWeight: 600, color: 'var(--txt)', background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)', boxShadow: '0 10px 24px rgba(0,0,0,0.16)', zIndex: 40 }}>{flash}</span>
      ) : null}

      {open ? (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
          <div style={{ position: 'absolute', top: 33, right: 0, zIndex: 40, width: 246, padding: 5, borderRadius: 11, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.11)', boxShadow: '0 16px 42px rgba(0,0,0,0.22)' }}>
            <div style={{ padding: '6px 10px 7px', fontSize: 9.6, fontWeight: 700, letterSpacing: '0.04em', color: 'rgba(var(--on),0.36)' }}>
              {state.length ? state.join(' \u00b7 ').toUpperCase() : 'NO FILTERS APPLIED'}
            </div>
            <button type="button" className="pc-nav" style={row} onClick={() => exportRows(filtered, 'filtered')}>Export these {filtered.length} rows (CSV)</button>
            <button type="button" className="pc-nav" style={row} onClick={() => exportRows(all, 'all')}>Export all {all.length} rows (CSV)</button>
            <button type="button" className="pc-nav" style={row} onClick={() => exportJson(filtered)}>Export these rows (JSON)</button>
            <div style={{ height: 1, margin: '5px 8px', background: 'rgba(var(--on),0.08)' }} />
            <button type="button" className="pc-nav" style={row} onClick={collect}>Add this table to the presentation</button>
          </div>
        </>
      ) : null}
    </div>
  );
}
