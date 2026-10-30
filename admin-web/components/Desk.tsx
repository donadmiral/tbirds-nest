'use client';
import Image from 'next/image';
import CommandForm from '@/components/CommandForm';
import MediaPreview, { type ReviewMedia } from '@/components/MediaPreview';
import ReviewMediaGallery from '@/components/ReviewMediaGallery';

/**
 * The operations desk kit. One master-detail table used by every desk:
 * stat strip, tabs with counts, search, facet filters, paging, detail panel.
 * Rows arrive as plain data from the server, so no desk repeats this markup.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { fmt } from '@/lib/fmt';
import { Spark } from '@/components/Viz';
import { csv, downloadText, slug, stamp, trayAdd } from '@/lib/share';
import ActionPopover from '@/components/ActionPopover';
import AdminIcon, { type AdminIconName } from '@/components/AdminIcon';

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
  media?: ReviewMedia | null;
  gallery?: ReviewMedia[];
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
  /** Values confirmed for this record, used when reviewing an existing setting. */
  actionDefaults?: Record<string, Record<string, string>>;
};

export type DeskInput = { name: string; label?: string; placeholder?: string; help?: string; required?: boolean; type?: string; options?: string[]; defaultValue?: string; minLength?: number; maxLength?: number };

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
  label: string; value: string; delta?: string; deltaTone?: Tone; note?: string; spark?: number[]; color?: string; icon?: AdminIconName;
};

const PANEL: React.CSSProperties = { minWidth: 0, borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)', boxShadow: '0 1px 2px rgba(11,30,61,0.025)', overflow: 'hidden' };

export function StatStrip({ cards, page }: { cards: StatCard[]; page?: string }) {
  const label = page || deskName();
  return (
    <div className="pc-stat-strip" style={{ '--stat-count': cards.length } as React.CSSProperties}>
      {cards.map(c => (
        <div key={c.label} className="pc-collect" style={{ ...PANEL, padding: '18px 18px 16px', position: 'relative' }}>
          <CollectButton title={c.label} onAdd={() => trayAdd({
            kind: 'stat', title: c.label, page: label, path: here(),
            stat: { value: c.value, delta: c.delta, note: c.note },
          })} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: 'var(--txt-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
            {c.icon ? (
              <span style={{ width: 26, height: 26, flex: '0 0 26px', borderRadius: 8, background: 'rgba(var(--on),0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AdminIcon name={c.icon} size={18} style={{ color: c.color || 'var(--accent)' }} />
              </span>
            ) : null}
          </div>
          <div className="pc-num" style={{ marginTop: 12, fontSize: 30, lineHeight: 1.1, letterSpacing: '-0.04em', color: 'var(--txt-strong)' }}>{c.value}</div>
          <div style={{ marginTop: 9, display: 'flex', alignItems: 'baseline', gap: 7, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {c.delta ? <span className="pc-num" style={{ flex: '0 0 auto', fontSize: 12, fontWeight: 600, color: TONE[c.deltaTone || 'neutral'].fg }}>{c.delta}</span> : null}
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--txt-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.note || ''}</span>
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
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <><button type="button" title={'Add ' + title + ' to the presentation'} className="pc-collect-btn"
      aria-label={done ? 'Added to presentation' : 'Add ' + title + ' to the presentation'}
      onClick={() => {
        clearTimeout(timer.current);
        try { onAdd(); setError(''); setDone(true); timer.current = setTimeout(() => setDone(false), 3000); }
        catch (failure) { setDone(false); setError(failure instanceof Error ? failure.message : 'The item could not be saved.'); }
      }}
      style={{
        position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 7,
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        border: '1px solid rgba(var(--on),0.12)', background: 'var(--panel)',
        color: done ? 'var(--ok)' : 'var(--txt-muted)', zIndex: 2,
      }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round" style={{ stroke: 'currentColor' }}>
        <path d={done ? 'M5 13l4 4L19 7' : 'M12 5v14M5 12h14'} />
      </svg>
    </button>{error ? <span role="alert" className="pc-collect-feedback">{error}</span> : null}</>
  );
}

function CellView({ c }: { c: Cell }) {
  if (c.t === 'media') {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ width: 42, height: 42, flex: '0 0 42px', borderRadius: 9, overflow: 'hidden', background: 'rgba(var(--on),0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          {c.thumb
            ? <MediaPreview key={c.thumb} url={c.thumb} video={c.video} thumbnail />
            : <svg width="15" height="15" viewBox="0 0 24 24" style={{ fill: 'rgba(var(--on),0.24)' }}><path d="M4 4h16v12H5.2L4 17.2V4zm2 3h12v2H6V7zm0 4h8v2H6v-2z" /></svg>}
          {c.video && c.thumb ? (
            <span style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.28)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" style={{ fill: '#fff' }}><path d="M8 5v14l11-7z" /></svg>
            </span>
          ) : null}
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.v}</span>
          {c.sub ? <span style={{ display: 'block', fontSize: 12, color: 'var(--txt-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.sub}</span> : null}
        </span>
      </span>
    );
  }
  if (c.t === 'pill') {
    const tn = TONE[c.tone];
    return <span style={{ fontSize: 12, fontWeight: 600, padding: '2.5px 8px', borderRadius: 999, background: tn.bg, color: tn.fg, border: '1px solid ' + tn.bd, whiteSpace: 'nowrap' }}>{c.v}</span>;
  }
  if (c.t === 'user') {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        {c.img
          ? <Image unoptimized width={29} height={29} src={c.img} alt="" style={{ width: 29, height: 29, flex: '0 0 29px', borderRadius: '50%', objectFit: 'cover' }} />
          : <span style={{ width: 29, height: 29, flex: '0 0 29px', borderRadius: '50%', background: 'rgba(var(--on),0.07)', color: 'var(--txt-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{c.v.slice(0, 1).toUpperCase()}</span>}
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.v}</span>
          {c.sub ? <span style={{ display: 'block', fontSize: 12, color: 'var(--txt-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.sub}</span> : null}
        </span>
      </span>
    );
  }
  if (c.t === 'link') return <Link href={c.href} onClick={event => event.stopPropagation()} className="pc-crumb" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.v}</Link>;
  if (c.t === 'mono') return <span className="pc-num" style={{ fontSize: 13, color: c.tone ? TONE[c.tone].fg : 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.v}</span>;
  if (c.t === 'dim') return <span style={{ fontSize: 13, color: 'var(--txt-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.v}</span>;
  return <span style={{ fontSize: 13, fontWeight: c.strong ? 600 : 400, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.v}</span>;
}

export function Desk({
  tabs, columns, grid, rows, searchHint, filters = [], pageSize = 10, minWidth = 720, detailTitle = 'Details', actions = [], pageLabel, presentation = 'table',
}: {
  tabs: { key: string; label: string; count: number }[];
  columns: { label: string; align?: 'left' | 'right'; sort?: 'text' | 'number' | false }[];
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
  presentation?: 'table' | 'media';
}) {
  const [tab, setTab] = useState(tabs[0]?.key ?? 'all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(pageSize);
  const [sort, setSort] = useState<{ index: number; direction: 'asc' | 'desc' } | null>(null);
  const [facet, setFacet] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<string | null>(rows[0]?.id ?? null);
  const deskId = useId();
  const detailRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const selectRecord = (id: string) => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSel(id);
    if (window.innerWidth < 1280) {
      requestAnimationFrame(() => {
        detailRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        detailRef.current?.focus({ preventScroll: true });
      });
    }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r => {
      if (tab !== 'all' && !r.tabs.includes(tab)) return false;
      if (needle && !r.search.toLowerCase().includes(needle)) return false;
      for (const f of filters) {
        const want = facet[f.key];
        if (want && want !== 'All' && (r.facets?.[f.key] || '') !== want) return false;
      }
      return true;
    }).sort((a, b) => {
      if (!sort) return 0;
      const av = a.cells[sort.index]?.v || '';
      const bv = b.cells[sort.index]?.v || '';
      const type = columns[sort.index]?.sort || 'text';
      const result = type === 'number' ? Number(av.replace(/[^\d.-]/g, '')) - Number(bv.replace(/[^\d.-]/g, '')) : av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
      return (sort.direction === 'asc' ? 1 : -1) * result;
    });
  }, [rows, tab, q, facet, filters, sort, columns]);

  const pages = Math.max(1, Math.ceil(filtered.length / limit));
  const safePage = Math.min(page, pages - 1);
  const shown = filtered.slice(safePage * limit, safePage * limit + limit);
  const selected = sel === null ? null : shown.find(r => r.id === sel) || shown[0] || null;
  const selectedIndex = selected ? shown.findIndex(row => row.id === selected.id) : -1;
  const hasFilters = !!q.trim() || Object.values(facet).some(value => value && value !== 'All');
  function closeDetails() {
    setSel(null);
    if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true });
    else tableRef.current?.focus({ preventScroll: true });
  }

  return (
    <div className="pc-desk-grid" data-detail-open={!!selected}>
      <div ref={tableRef} tabIndex={-1} style={PANEL}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '3px 8px 0', borderBottom: '1px solid rgba(var(--on),0.10)', overflowX: 'auto' }}>
          {tabs.map(t => {
            const on = t.key === tab;
            return (
              <button key={t.key} type="button" aria-pressed={on} className="pc-desk-tab" onClick={() => { setTab(t.key); setPage(0); setSel(rows.find(row => t.key === 'all' || row.tabs.includes(t.key))?.id ?? null); }}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '11px 12px 10px', background: 'none', border: 'none', borderBottom: '2px solid ' + (on ? 'var(--accent)' : 'transparent'), cursor: 'pointer', fontSize: 14, fontWeight: on ? 600 : 500, color: on ? 'var(--txt-strong)' : 'var(--txt-muted)', whiteSpace: 'nowrap' }}>
                {t.label}
                {t.count > 0 ? <span className="pc-num" style={{ fontSize: 12, fontWeight: 600, padding: '1px 5px', borderRadius: 5, background: on ? 'rgba(var(--accent-rgb),0.14)' : 'rgba(var(--on),0.07)', color: on ? 'var(--accent)' : 'var(--txt-muted)' }}>{t.count}</span> : null}
              </button>
            );
          })}
        </div>

        <div className="pc-desk-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '1px solid rgba(var(--on),0.10)', flexWrap: 'wrap' }}>
          <div className="pc-search" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6.5px 10px', borderRadius: 8, background: 'rgba(var(--on),0.035)', border: '1px solid rgba(var(--on),0.10)', minWidth: 200 }}>
            <AdminIcon name="search" size={17} style={{ color: 'var(--txt-muted)' }} />
            <input aria-label={searchHint || 'Search records'} value={q} onChange={e => { setQ(e.target.value); setPage(0); }} placeholder={searchHint}
              style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: 'var(--txt)' }} />
          </div>
          {filters.map(f => (
            <select key={f.key} aria-label={f.label} value={facet[f.key] || 'All'} onChange={e => { setFacet(p => ({ ...p, [f.key]: e.target.value })); setPage(0); }}
              style={{ padding: '6.5px 10px', borderRadius: 8, background: 'rgba(var(--on),0.035)', border: '1px solid rgba(var(--on),0.10)', fontSize: 13, color: 'var(--txt-muted)', outline: 'none', cursor: 'pointer' }}>
              <option value="All">{f.label}: All</option>
              {f.options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ))}
          {hasFilters ? <button type="button" className="pc-filter-clear" onClick={() => { setQ(''); setFacet({}); setPage(0); }}>Clear filters</button> : null}
          <span className="pc-num" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--txt-muted)' }}>{filtered.length} of {rows.length}</span>
          <TableShare page={pageLabel || deskName()} columns={columns.map(c => c.label)} filtered={filtered} all={rows}
            state={[tab !== 'all' ? 'Tab: ' + (tabs.find(t => t.key === tab)?.label || tab) : '', q.trim() ? 'Search: ' + q.trim() : '',
              ...filters.map(f => (facet[f.key] && facet[f.key] !== 'All' ? f.label + ': ' + facet[f.key] : ''))].filter(Boolean)} />
        </div>

        {presentation === 'media' ? <div className="pc-media-review-grid">
          {shown.length === 0 ? <p className="pc-media-empty">Nothing matches this view. Try another filter or search.</p> : shown.map(r => (
            <article key={r.id} className="pc-media-review-card" data-selected={r.id === selected?.id} onClick={() => selectRecord(r.id)}>
              <div className="pc-media-review-cover">
                {r.detail.media ? <MediaPreview key={r.detail.media.url} {...r.detail.media} thumbnail /> : <div className="pc-media-text-preview"><span>Text</span><p>{r.detail.body?.find(b => b.label === 'Caption')?.text || r.detail.title}</p></div>}
                {r.detail.media?.video ? <span className="pc-media-kind">Video</span> : null}
              </div>
              <button type="button" className="pc-media-review-open" aria-pressed={r.id === selected?.id} onClick={event => { event.stopPropagation(); selectRecord(r.id); }}>
                <strong>{r.detail.title}</strong>
                {r.detail.subtitle ? <span>{r.detail.subtitle}</span> : null}
                <small>{r.id === selected?.id ? 'Selected' : 'Review content'} <AdminIcon name="arrowUpRight" size={15} /></small>
              </button>
            </article>
          ))}
        </div> : <div style={{ overflowX: 'auto' }}>
          <div role="grid" aria-label={detailTitle + ' records'} style={{ minWidth }}>
            <div role="row" style={{ display: 'grid', gridTemplateColumns: grid, padding: '0 13px', borderBottom: '1px solid rgba(var(--on),0.10)', background: 'rgba(var(--on),0.015)' }}>
              {columns.map((c, i) => (
                <div role="columnheader" key={c.label + i} aria-sort={sort?.index === i ? sort.direction === 'asc' ? 'ascending' : 'descending' : undefined} style={{ padding: '9px 8px', fontSize: 12, fontWeight: 600, color: 'var(--txt-muted)', justifyContent: c.align === 'right' ? 'flex-end' : 'flex-start', whiteSpace: 'nowrap' }}>
                  {c.sort || (i === 0 && c.sort !== false) ? <button type="button" className="pc-column-sort" onClick={() => { setSort(previous => ({ index: i, direction: previous?.index === i && previous.direction === 'asc' ? 'desc' : 'asc' })); setPage(0); }} aria-label={`Sort ${c.label} ${sort?.index === i && sort.direction === 'asc' ? 'descending' : 'ascending'}`}>
                    {c.label}<AdminIcon name={sort?.index === i ? sort.direction === 'asc' ? 'chevronUp' : 'chevronDown' : 'sort'} size={14} />
                  </button> : c.label}
                </div>
              ))}
            </div>
            {shown.length === 0 ? (
              <div style={{ padding: '38px 0', textAlign: 'center', fontSize: 13, color: 'var(--txt-muted)' }}>Nothing matches this view.</div>
            ) : shown.map(r => {
              const on = r.id === selected?.id;
              return (
                <div key={r.id} role="row" tabIndex={0} aria-selected={on} aria-label={r.detail.title} onClick={event => { if (!(event.target as HTMLElement).closest('a,button,input,select,textarea')) { event.currentTarget.focus({ preventScroll: true }); selectRecord(r.id); } }} className="pc-desk-row"
                  onKeyDown={event => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectRecord(r.id); }
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault();
                      const sibling = event.key === 'ArrowDown' ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling;
                      if (sibling instanceof HTMLElement && sibling.tabIndex === 0) sibling.focus();
                    }
                  }}
                  style={{ display: 'grid', gridTemplateColumns: grid, minHeight: 64, padding: '0 13px', cursor: 'pointer', borderBottom: '1px solid var(--line)', background: on ? 'rgba(var(--accent-rgb),0.065)' : 'transparent', boxShadow: on ? 'inset 3px 0 0 var(--accent)' : 'none' }}>
                  {r.cells.map((c, i) => (
                    <div role="gridcell" key={i} style={{ padding: '10px 8px', display: 'flex', alignItems: 'center', minWidth: 0, justifyContent: columns[i]?.align === 'right' ? 'flex-end' : 'flex-start' }}>
                      <CellView c={c} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>}

        <div className="pc-desk-pagination">
          <span role="status" className="pc-desk-page-count">
            {filtered.length === 0 ? 'No matching records' : 'Showing ' + (safePage * limit + 1) + '–' + Math.min(filtered.length, safePage * limit + limit) + ' of ' + filtered.length}
          </span>
          <label className="pc-page-size"><span>Rows</span><select aria-label="Rows per page" value={limit} onChange={event => { setLimit(Number(event.target.value)); setPage(0); }}>{[...new Set([pageSize, 10, 25, 50])].sort((a, b) => a - b).map(size => <option key={size} value={size}>{size}</option>)}</select></label>
          <button type="button" disabled={safePage === 0} onClick={() => setPage(Math.max(0, safePage - 1))} className="pc-icon-btn"
            style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(var(--on),0.10)', background: 'transparent', fontSize: 13, color: safePage === 0 ? 'rgba(var(--on),0.22)' : 'var(--txt)', cursor: safePage === 0 ? 'default' : 'pointer' }}>Back</button>
          <span className="pc-num" style={{ fontSize: 12, color: 'var(--txt-muted)' }}>{safePage + 1} / {pages}</span>
          <button type="button" disabled={safePage >= pages - 1} onClick={() => setPage(Math.min(pages - 1, safePage + 1))} className="pc-icon-btn"
            style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(var(--on),0.10)', background: 'transparent', fontSize: 13, color: safePage >= pages - 1 ? 'rgba(var(--on),0.22)' : 'var(--txt)', cursor: safePage >= pages - 1 ? 'default' : 'pointer' }}>Next</button>
        </div>
      </div>

      <div ref={detailRef} role="region" aria-label={detailTitle} tabIndex={-1} className="pc-review-detail" data-empty={!selected} style={PANEL} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented && !(event.target as HTMLElement).closest('dialog, [role="dialog"]')) { event.preventDefault(); closeDetails(); } }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 12px', borderBottom: '1px solid rgba(var(--on),0.10)' }}>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: 'var(--txt)' }}>{detailTitle}</span>
          {selected ? <div className="pc-detail-navigation">
            <button type="button" aria-label="Previous record" disabled={selectedIndex <= 0} onClick={() => setSel(shown[selectedIndex - 1].id)}><AdminIcon name="chevronLeft" size={18} /></button>
            <button type="button" aria-label="Next record" disabled={selectedIndex >= shown.length - 1} onClick={() => setSel(shown[selectedIndex + 1].id)}><AdminIcon name="chevronRight" size={18} /></button>
            <button type="button" aria-label="Close details" onClick={closeDetails}><AdminIcon name="close" size={18} /></button>
          </div> : null}
        </div>
        {!selected ? (
          <div style={{ padding: '44px 16px', textAlign: 'center', fontSize: 13, color: 'var(--txt-muted)' }}>Select an item to review its details.</div>
        ) : (
          <div style={{ padding: 16 }}>
            {selected.detail.media ? (
              <div style={{ marginBottom: 14, borderRadius: 11, overflow: 'hidden', background: 'rgba(var(--on),0.05)', border: '1px solid rgba(var(--on),0.10)' }}>
                <ReviewMediaGallery key={selected.id} media={selected.detail.gallery?.length ? selected.detail.gallery : [selected.detail.media]} />
              </div>
            ) : null}
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              {selected.detail.img
                ? <Image unoptimized width={42} height={42} src={selected.detail.img} alt="" style={{ width: 42, height: 42, flex: '0 0 42px', borderRadius: 11, objectFit: 'cover' }} />
                : <span style={{ width: 42, height: 42, flex: '0 0 42px', borderRadius: 11, background: 'var(--chip-bg)', color: 'var(--chip-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700 }}>{selected.detail.title.slice(0, 1).toUpperCase()}</span>}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--txt-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selected.detail.title}</div>
                {selected.detail.subtitle ? <div style={{ fontSize: 13, color: 'var(--txt-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selected.detail.subtitle}</div> : null}
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
                    <div style={{ fontSize: 12, color: 'var(--txt-muted)', marginTop: 3 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            ) : null}

            {selected.detail.fields?.length ? (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(var(--on),0.10)' }}>
                {selected.detail.fields.map(f => (
                  <div key={f.label} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '5px 0' }}>
                    <span style={{ flex: '0 0 108px', fontSize: 13, color: 'var(--txt-muted)' }}>{f.label}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--txt)', wordBreak: 'break-word' }}>{f.value}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {selected.detail.body?.map(b => (
              <div key={b.label} style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt-muted)', marginBottom: 6 }}>{b.label}</div>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5, color: 'var(--txt-muted)', padding: 11, borderRadius: 10, background: 'rgba(var(--on),0.035)' }}>{b.text}</div>
              </div>
            ))}

            {actions.filter(a => (selected.actions || []).includes(a.key)).map(a => {
              const tn = TONE[a.tone || 'neutral'];
              return (
                <CommandForm scope={a.key} key={`${selected.id}:${selected.actionId || selected.id}:${a.key}`} action={a.action} style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input type="hidden" name={a.idName} value={selected.actionId || selected.id} />
                  {(a.inputs || []).map(inp => {
                    const id = `${deskId}-${a.key}-${inp.name}`;
                    const props = { id, name: inp.name, required: inp.required, defaultValue: selected.actionDefaults?.[a.key]?.[inp.name] ?? inp.defaultValue, 'aria-describedby': inp.help ? `${id}-help` : undefined, className: 'pc-action-input' };
                    return <div key={inp.name} className="pc-action-field">
                      <label htmlFor={id}>{inp.label || inp.placeholder || inp.name.replace(/_/g, ' ')}{inp.required ? <span aria-hidden="true"> *</span> : null}</label>
                      {inp.options ? <select {...props}>{inp.options.map(option => <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>)}</select>
                        : inp.type === 'textarea' ? <textarea {...props} minLength={inp.minLength} maxLength={inp.maxLength} placeholder={inp.placeholder} rows={4} />
                          : <input {...props} type={inp.type || 'text'} minLength={inp.minLength} maxLength={inp.maxLength} placeholder={inp.placeholder} />}
                      {inp.help ? <p id={`${id}-help`}>{inp.help}</p> : null}
                    </div>;
                  })}
                  <button type="submit"
                    style={{ padding: '9px 13px', borderRadius: 9, cursor: 'pointer', fontSize: 12, fontWeight: 600, background: tn.bg, color: tn.fg, border: '1px solid ' + tn.bd }}>{a.label}</button>
                </CommandForm>
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
  const [flash, setFlash] = useState('');
  const [failure, setFailure] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const body = (records: DeskRow[]) => records.map(record => record.cells.map(cell => {
    const value = String((cell as { v?: string }).v ?? '');
    const sub = (cell as { sub?: string }).sub;
    return sub ? value + ' (' + sub + ')' : value;
  }));

  function perform(action: () => void, message: string, close: () => void) {
    clearTimeout(timer.current);
    try { action(); setFailure(false); setFlash(message); close(); }
    catch (error) { setFailure(true); setFlash(error instanceof Error ? error.message : 'The export could not be prepared.'); }
    timer.current = setTimeout(() => setFlash(''), 8000);
  }

  return <div className="pc-share-control">
    <ActionPopover label="Share or export this table" trigger={<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" /></svg>}>
      {close => <>
        <p className="pc-popover-heading">{state.length ? state.join(' · ') : 'No filters applied'}</p>
        <button type="button" className="pc-popover-action" onClick={() => perform(() => downloadText(slug(page + '-filtered') + '-' + stamp() + '.csv', 'text/csv', csv(columns, body(filtered))), 'CSV download prepared', close)}>Export these {filtered.length} rows (CSV)</button>
        <button type="button" className="pc-popover-action" onClick={() => perform(() => downloadText(slug(page + '-all') + '-' + stamp() + '.csv', 'text/csv', csv(columns, body(all))), 'CSV download prepared', close)}>Export all {all.length} loaded rows (CSV)</button>
        <button type="button" className="pc-popover-action" onClick={() => perform(() => downloadText(slug(page) + '-' + stamp() + '.json', 'application/json', JSON.stringify({ page, filters: state, exportedAt: new Date().toISOString(), columns, rows: body(filtered) }, null, 2)), 'JSON download prepared', close)}>Export these rows (JSON)</button>
        <div className="pc-popover-divider" />
        <button type="button" className="pc-popover-action" onClick={() => perform(() => {
          trayAdd({ kind: 'table', title: page + ' table', subtitle: state.join(' · '), page, path: here(),
            table: { columns, rows: body(filtered).slice(0, 60), total: filtered.length, filters: state.length ? state : ['No filters, the loaded desk'] } });
        }, 'Added to presentation', close)}>Add this table to the presentation</button>
        {filtered.length > 60 ? <p className="pc-popover-help">The presentation keeps the first 60 rows. Use CSV to export all {filtered.length} matching loaded rows.</p> : null}
      </>}
    </ActionPopover>
    {flash ? <p role={failure ? 'alert' : 'status'} className="pc-share-feedback" data-error={failure}>{flash}</p> : null}
  </div>;
}
