'use client';

/**
 * Operations rail v7 - navigation as a system, not a list.
 * Three states (expanded 240, collapsed 74, hover overlay), a selection capsule
 * that glides between desks, per-section collapse, pinned desks, right-click
 * menus, scroll shadows and count chips that only speak when work is waiting.
 * Every preference is remembered in localStorage. Routes come from the server,
 * already filtered by role, so the rail can never point at a desk you cannot open.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export type RailItem = { href: string; label: string; icon: string; key: string };
export type RailGroup = { label: string; items: RailItem[] };

const W_OPEN = 240;
const W_RAIL = 74;
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const K_COLLAPSED = 'pc-rail-collapsed';
const K_CLOSED = 'pc-rail-closed-groups';
const K_PINS = 'pc-rail-pins';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch { return fallback; }
}

function save(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

export default function SideRail({ groups, counts, active, email, roleLabel }: {
  groups: RailGroup[];
  counts: Record<string, number>;
  active: string;
  email: string;
  roleLabel: string;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [closed, setClosed] = useState<string[]>([]);
  const [pins, setPins] = useState<string[]>([]);
  const [peek, setPeek] = useState(false);
  const [menu, setMenu] = useState<{ href: string; label: string; x: number; y: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [shadeTop, setShadeTop] = useState(false);
  const [shadeBottom, setShadeBottom] = useState(false);
  const [cap, setCap] = useState<{ top: number; height: number } | null>(null);
  const [pop, setPop] = useState<Record<string, boolean>>({});

  const scrollRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevCounts = useRef<Record<string, number>>(counts);

  const flat = useMemo(() => groups.flatMap(g => g.items), [groups]);
  const byHref = useMemo(() => {
    const m: Record<string, RailItem> = {};
    for (const it of flat) m[it.href] = it;
    return m;
  }, [flat]);

  useEffect(() => {
    setCollapsed(read<boolean>(K_COLLAPSED, false));
    setClosed(read<string[]>(K_CLOSED, []));
    setPins(read<string[]>(K_PINS, []));
    setReady(true);
  }, []);

  // A count that grows gets one short pulse, then holds still.
  useEffect(() => {
    const next: Record<string, boolean> = {};
    let any = false;
    for (const href of Object.keys(counts)) {
      if ((counts[href] || 0) > (prevCounts.current[href] || 0)) { next[href] = true; any = true; }
    }
    prevCounts.current = counts;
    if (!any) return;
    setPop(next);
    const t = setTimeout(() => setPop({}), 220);
    return () => clearTimeout(t);
  }, [counts]);

  const open = !collapsed || peek;
  const pinned = pins.map(h => byHref[h]).filter(Boolean) as RailItem[];

  const measure = useCallback(() => {
    const el = itemRefs.current[active];
    const box = scrollRef.current;
    if (!el || !box) { setCap(null); return; }
    setCap({ top: el.offsetTop, height: el.offsetHeight });
  }, [active]);

  useEffect(() => { measure(); }, [measure, open, closed, pins, groups]);

  const onScroll = useCallback(() => {
    const box = scrollRef.current;
    if (!box) return;
    setShadeTop(box.scrollTop > 2);
    setShadeBottom(box.scrollTop + box.clientHeight < box.scrollHeight - 2);
  }, []);

  useEffect(() => { onScroll(); }, [onScroll, open, closed, pins]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    setPeek(false);
    save(K_COLLAPSED, next);
  }

  function toggleGroup(label: string) {
    const next = closed.includes(label) ? closed.filter(l => l !== label) : [...closed, label];
    setClosed(next);
    save(K_CLOSED, next);
  }

  function togglePin(href: string) {
    const next = pins.includes(href) ? pins.filter(h => h !== href) : [...pins, href];
    setPins(next);
    save(K_PINS, next);
  }

  // Hovering a collapsed rail opens it as an overlay, but only after a real
  // dwell. Brushing past with the pointer must never move the interface.
  function railEnter() {
    if (!collapsed) return;
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(true), 400);
  }

  function railLeave() {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    setPeek(false);
    setHover(null);
  }

  function navClick(e: React.MouseEvent, href: string) {
    if (href !== active) return;
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openMenu(e: React.MouseEvent, item: RailItem) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ href: item.href, label: item.label, x: Math.min(e.clientX, window.innerWidth - 190), y: e.clientY });
  }

  const width = collapsed ? W_RAIL : W_OPEN;
  const shownWidth = open ? W_OPEN : W_RAIL;

  function row(item: RailItem, inPinned: boolean) {
    const on = active === item.href;
    const n = counts[item.href] || 0;
    const showTip = collapsed && !peek && hover === (inPinned ? 'pin:' : '') + item.href;
    return (
      <div key={(inPinned ? 'pin:' : '') + item.href} style={{ position: 'relative' }}>
        <Link
          href={item.href}
          ref={inPinned ? undefined : (el => { itemRefs.current[item.href] = el; })}
          onClick={e => navClick(e, item.href)}
          onContextMenu={e => openMenu(e, item)}
          onMouseEnter={() => setHover((inPinned ? 'pin:' : '') + item.href)}
          onMouseLeave={() => setHover(null)}
          title={undefined}
          style={{
            position: 'relative', zIndex: 1,
            display: 'flex', alignItems: 'center', gap: 10,
            padding: open ? '7px 9px' : '7px 0', marginBottom: 1,
            justifyContent: open ? 'flex-start' : 'center',
            borderRadius: 8, fontSize: 12.8, fontWeight: on ? 600 : 500, textDecoration: 'none',
            color: on ? 'var(--txt-strong)' : 'rgba(var(--on),0.55)',
            background: on && inPinned ? 'rgba(var(--on),0.075)' : 'transparent',
            transition: 'color 160ms ' + EASE + ', background 160ms ' + EASE,
          }}
        >
          <svg width="14.5" height="14.5" viewBox="0 0 24 24" style={{
            flex: '0 0 14.5px',
            fill: on ? 'var(--accent)' : 'rgba(var(--on),0.33)',
            transform: on ? 'scale(1.06)' : 'scale(1)',
            transition: 'fill 160ms ' + EASE + ', transform 200ms ' + EASE,
          }}><path d={item.icon} /></svg>
          {open ? (
            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
          ) : null}
          {open && n > 0 ? (
            <span className="pc-num" style={{
              fontSize: 10, fontWeight: 600, padding: '1.5px 5px', borderRadius: 5,
              background: on ? 'rgba(var(--accent-rgb),0.16)' : 'rgba(var(--on),0.07)',
              color: on ? 'var(--accent)' : 'rgba(var(--on),0.45)',
              transform: pop[item.href] ? 'scale(1.08)' : 'scale(1)',
              transition: 'transform 200ms ' + EASE,
            }}>{n}</span>
          ) : null}
          {!open && n > 0 ? (
            <span style={{
              position: 'absolute', top: 4, right: 13, width: 6, height: 6, borderRadius: '50%',
              background: 'var(--alert)',
              transform: pop[item.href] ? 'scale(1.35)' : 'scale(1)',
              transition: 'transform 200ms ' + EASE,
            }} />
          ) : null}
        </Link>
        {showTip ? (
          <div style={{
            position: 'absolute', left: W_RAIL - 8, top: 3, zIndex: 60,
            display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
            padding: '5px 9px', borderRadius: 8, fontSize: 11.8, fontWeight: 600,
            color: 'var(--txt)', background: 'var(--panel)',
            border: '1px solid rgba(var(--on),0.10)', boxShadow: '0 8px 22px rgba(0,0,0,0.16)',
            pointerEvents: 'none',
          }}>
            {item.label}
            <span className="pc-num" style={{ fontSize: 9.5, color: 'rgba(var(--on),0.38)', border: '1px solid rgba(var(--on),0.12)', borderRadius: 4, padding: '0 4px' }}>G {item.key}</span>
            {n > 0 ? <span className="pc-num" style={{ fontSize: 9.5, color: 'var(--alert)' }}>{n}</span> : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div style={{ flex: '0 0 ' + width + 'px', width, transition: ready ? 'width 200ms ' + EASE + ', flex-basis 200ms ' + EASE : undefined }} />

      <aside
        onMouseEnter={railEnter}
        onMouseLeave={railLeave}
        style={{
          position: 'fixed', top: 0, left: 0, height: '100vh', width: shownWidth, zIndex: 40,
          display: 'flex', flexDirection: 'column',
          background: 'var(--rail)',
          backdropFilter: 'blur(26px) saturate(1.15)', WebkitBackdropFilter: 'blur(26px) saturate(1.15)',
          borderRight: '1px solid rgba(var(--on),0.10)',
          boxShadow: peek ? '0 18px 50px rgba(0,0,0,0.22)' : 'none',
          transition: ready ? 'width 200ms ' + EASE + ', box-shadow 200ms ' + EASE : undefined,
        }}
      >

        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: open ? '17px 16px 16px' : '17px 0 16px', justifyContent: open ? 'flex-start' : 'center', borderBottom: '1px solid rgba(var(--on),0.10)' }}>
          <img src="/pearl.png" alt="Platinum Circles" className="pc-mark"
            style={{ width: 32, height: 32, flex: '0 0 32px', display: 'block', objectFit: 'contain', transition: 'transform 220ms ' + EASE }} />
          {open ? (
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, letterSpacing: '0.01em', color: 'var(--txt-strong)', lineHeight: 1.15, whiteSpace: 'nowrap' }}>Platinum Circles</div>
              <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.02em', color: 'rgba(var(--on),0.46)', marginTop: 2 }}>Operations</div>
            </div>
          ) : null}
          {open ? (
            <button type="button" onClick={toggleCollapse} className="pc-icon-btn" title={collapsed ? 'Keep expanded' : 'Collapse rail'}
              style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" style={{ stroke: 'rgba(var(--on),0.4)' }}>
                <path d={collapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : null}
        </div>

        <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
          <nav ref={el => { scrollRef.current = el; }} onScroll={onScroll} className="pc-rail-scroll"
            style={{ position: 'absolute', inset: 0, overflowY: 'auto', overflowX: 'hidden', padding: open ? '12px 10px 10px' : '12px 12px 10px' }}>

            {cap ? (
              <div aria-hidden style={{
                position: 'absolute', left: open ? 10 : 12, right: open ? 10 : 12,
                top: cap.top, height: cap.height, borderRadius: 8,
                background: 'rgba(var(--on),0.075)',
                boxShadow: 'inset 0 0 0 1px rgba(var(--accent-rgb),0.16)',
                transition: ready ? 'top 200ms ' + EASE + ', height 200ms ' + EASE : undefined,
                pointerEvents: 'none', zIndex: 0,
              }} />
            ) : null}

            {pinned.length > 0 && open ? (
              <div style={{ marginBottom: 15 }}>
                <div style={{ padding: '0 8px 6px', fontSize: 9.5, fontWeight: 700, color: 'rgba(var(--on),0.44)', letterSpacing: '0.04em' }}>PINNED</div>
                {pinned.map(it => row(it, true))}
              </div>
            ) : null}

            {groups.map(g => {
              const shut = closed.includes(g.label);
              return (
                <div key={g.label} style={{ marginBottom: 15 }}>
                  {open ? (
                    <button type="button" onClick={() => toggleGroup(g.label)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 5, padding: '0 8px 6px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                      <span style={{ flex: 1, fontSize: 9.5, fontWeight: 700, color: 'rgba(var(--on),0.44)', letterSpacing: '0.02em' }}>{g.label}</span>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" strokeWidth="2.6"
                        style={{ stroke: 'rgba(var(--on),0.3)', transform: shut ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 180ms ' + EASE }}>
                        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  ) : (
                    <div style={{ height: 1, margin: '0 6px 8px', background: 'rgba(var(--on),0.08)' }} />
                  )}
                  <div style={{
                    overflow: 'hidden',
                    maxHeight: shut && open ? 0 : 44 * g.items.length + 8,
                    opacity: shut && open ? 0 : 1,
                    transition: ready ? 'max-height 180ms ' + EASE + ', opacity 140ms ' + EASE : undefined,
                  }}>
                    {g.items.map(it => row(it, false))}
                  </div>
                </div>
              );
            })}
          </nav>

          <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 18, pointerEvents: 'none', opacity: shadeTop ? 1 : 0, transition: 'opacity 160ms ' + EASE, background: 'linear-gradient(to bottom, rgba(var(--on),0.07), rgba(var(--on),0))' }} />
          <div aria-hidden style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 18, pointerEvents: 'none', opacity: shadeBottom ? 1 : 0, transition: 'opacity 160ms ' + EASE, background: 'linear-gradient(to top, rgba(var(--on),0.07), rgba(var(--on),0))' }} />
        </div>

        <div style={{ borderTop: '1px solid rgba(var(--on),0.10)', padding: open ? '11px 13px' : '11px 0' }}>
          {open ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 27, height: 27, flex: '0 0 27px', borderRadius: 7, background: 'var(--chip-bg)', color: 'var(--chip-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{(email || '?').slice(0, 1).toUpperCase()}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11.8, fontWeight: 600, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{email}</div>
                <div style={{ fontSize: 9.5, color: 'rgba(var(--on),0.34)', textTransform: 'capitalize', marginTop: 1 }}>{roleLabel}</div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 27, height: 27, borderRadius: 7, background: 'var(--chip-bg)', color: 'var(--chip-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{(email || '?').slice(0, 1).toUpperCase()}</span>
              <button type="button" onClick={toggleCollapse} className="pc-icon-btn" title="Expand rail"
                style={{ width: 26, height: 26, borderRadius: 7, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" style={{ stroke: 'rgba(var(--on),0.4)' }}>
                  <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </aside>

      {menu ? (
        <div style={{
          position: 'fixed', left: menu.x, top: menu.y, zIndex: 80, width: 178, padding: 4,
          borderRadius: 10, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)',
          boxShadow: '0 14px 40px rgba(0,0,0,0.22)',
        }} onClick={e => e.stopPropagation()}>
          <div style={{ padding: '5px 9px 6px', fontSize: 10, fontWeight: 700, color: 'rgba(var(--on),0.38)', letterSpacing: '0.03em' }}>{menu.label.toUpperCase()}</div>
          <button type="button" className="pc-nav" onClick={() => { router.push(menu.href); setMenu(null); }} style={menuBtn}>Open</button>
          <button type="button" className="pc-nav" onClick={() => { window.open(menu.href, '_blank'); setMenu(null); }} style={menuBtn}>Open in new tab</button>
          <button type="button" className="pc-nav" onClick={() => { togglePin(menu.href); setMenu(null); }} style={menuBtn}>{pins.includes(menu.href) ? 'Unpin from top' : 'Pin to top'}</button>
          <button type="button" className="pc-nav" onClick={() => { void navigator.clipboard?.writeText(window.location.origin + menu.href); setMenu(null); }} style={menuBtn}>Copy link</button>
        </div>
      ) : null}
    </>
  );
}

const menuBtn: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', padding: '6.5px 9px', borderRadius: 7,
  border: 'none', background: 'transparent', cursor: 'pointer',
  fontSize: 12.3, fontWeight: 500, color: 'var(--txt)',
};
