'use client';

/**
 * The command bar. It replaces the old search box in the topbar and answers to
 * Cmd/Ctrl+K from anywhere. Desks, recent pages and permitted quick actions all
 * live in one list; free text falls through to a member search. G then a letter
 * jumps straight to a desk without opening anything. Esc closes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

export type PaletteItem = { href: string; label: string; group: string; key: string };

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const K_RECENT = 'pc-recent-pages';

type Row = { href: string; label: string; hint: string; kind: 'recent' | 'desk' | 'action' | 'search'; shortcut?: string };

export default function CommandPalette({ items, actions }: { items: PaletteItem[]; actions: { href: string; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [openBar, setOpenBar] = useState(false);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [mac, setMac] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gArmed = useRef(false);

  const byHref = useMemo(() => {
    const m: Record<string, PaletteItem> = {};
    for (const it of items) m[it.href] = it;
    return m;
  }, [items]);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    try {
      const raw = window.localStorage.getItem(K_RECENT);
      if (raw) setRecent(JSON.parse(raw) as string[]);
    } catch { /* private mode */ }
  }, []);

  // Every visit to a desk moves it to the front of the recent list.
  useEffect(() => {
    if (!pathname) return;
    const root = '/' + (pathname.split('/')[1] || '');
    if (!byHref[root]) return;
    setRecent(prev => {
      const next = [root, ...prev.filter(h => h !== root)].slice(0, 6);
      try { window.localStorage.setItem(K_RECENT, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, [pathname, byHref]);

  const rows: Row[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    const out: Row[] = [];
    if (!term) {
      for (const h of recent) {
        const it = byHref[h];
        if (it && h !== '/' + (pathname?.split('/')[1] || '')) out.push({ href: h, label: it.label, hint: 'Recent', kind: 'recent', shortcut: it.key });
      }
    }
    for (const it of items) {
      if (term && !it.label.toLowerCase().includes(term) && !it.group.toLowerCase().includes(term)) continue;
      if (!term && out.some(r => r.href === it.href)) continue;
      out.push({ href: it.href, label: it.label, hint: it.group, kind: 'desk', shortcut: it.key });
    }
    for (const a of actions) {
      if (term && !a.label.toLowerCase().includes(term)) continue;
      out.push({ href: a.href, label: a.label, hint: 'Quick action', kind: 'action' });
    }
    if (term) out.push({ href: '/users?q=' + encodeURIComponent(q.trim()), label: 'Search members for "' + q.trim() + '"', hint: 'Members', kind: 'search' });
    return out;
  }, [q, items, actions, recent, byHref, pathname]);

  const go = useCallback((href: string) => {
    setOpenBar(false);
    setQ('');
    router.push(href);
  }, [router]);

  useEffect(() => { setCursor(0); }, [q, openBar]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpenBar(v => !v);
        return;
      }
      if (e.key === 'Escape') {
        gArmed.current = false;
        setOpenBar(false);
        return;
      }
      if (openBar || typing || e.metaKey || e.ctrlKey || e.altKey) return;

      if (gArmed.current) {
        gArmed.current = false;
        if (gTimer.current) clearTimeout(gTimer.current);
        const hit = items.find(it => it.key.toLowerCase() === e.key.toLowerCase());
        if (hit) { e.preventDefault(); router.push(hit.href); }
        return;
      }
      if (e.key.toLowerCase() === 'g') {
        gArmed.current = true;
        if (gTimer.current) clearTimeout(gTimer.current);
        gTimer.current = setTimeout(() => { gArmed.current = false; }, 1400);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openBar, items, router]);

  useEffect(() => {
    if (!openBar) return;
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [openBar]);

  function listKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = rows[cursor]; if (r) go(r.href); }
  }

  return (
    <>
      <button type="button" onClick={() => setOpenBar(true)} className="pc-search"
        style={{
          marginLeft: 8, flex: '1 1 240px', minWidth: 190, maxWidth: 340,
          display: 'flex', alignItems: 'center', gap: 9, padding: '7px 11px',
          borderRadius: 9, background: 'rgba(var(--on),0.04)', border: '1px solid rgba(var(--on),0.10)',
          cursor: 'pointer', textAlign: 'left',
        }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ stroke: 'rgba(var(--on),0.38)', flex: '0 0 13px' }} strokeWidth="2.3"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></svg>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.3, color: 'rgba(var(--on),0.4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Search desks, members, actions</span>
        <span className="pc-num" style={{ fontSize: 10, color: 'rgba(var(--on),0.3)', border: '1px solid rgba(var(--on),0.11)', borderRadius: 4, padding: '1px 4px' }}>{mac ? '\u2318K' : 'Ctrl K'}</span>
      </button>

      {openBar ? (
        <div onClick={() => setOpenBar(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '13vh 16px 16px', background: 'rgba(0,0,0,0.34)', animation: 'pcFade 160ms ' + EASE }}>
          <div onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 560, borderRadius: 14, overflow: 'hidden',
              background: 'var(--panel)', border: '1px solid rgba(var(--on),0.12)',
              boxShadow: '0 30px 80px rgba(0,0,0,0.34)', animation: 'pcRise 160ms ' + EASE,
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 15px', borderBottom: '1px solid rgba(var(--on),0.09)' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ stroke: 'rgba(var(--on),0.34)', flex: '0 0 15px' }} strokeWidth="2.2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></svg>
              <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={listKey}
                placeholder="Jump to a desk, find a member, run an action"
                style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--txt)', background: 'transparent', border: 'none', outline: 'none' }} />
              <span className="pc-num" style={{ fontSize: 10, color: 'rgba(var(--on),0.3)', border: '1px solid rgba(var(--on),0.11)', borderRadius: 4, padding: '1px 4px' }}>Esc</span>
            </div>
            <div style={{ maxHeight: '52vh', overflowY: 'auto', padding: 6 }}>
              {rows.length === 0 ? (
                <div style={{ padding: '22px 12px', fontSize: 12.5, color: 'rgba(var(--on),0.4)', textAlign: 'center' }}>Nothing matches that.</div>
              ) : rows.map((r, i) => (
                <button key={r.kind + r.href + i} type="button" onMouseEnter={() => setCursor(i)} onClick={() => go(r.href)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                    padding: '9px 10px', borderRadius: 9, border: 'none', cursor: 'pointer',
                    background: i === cursor ? 'rgba(var(--on),0.06)' : 'transparent',
                    transition: 'background 120ms ' + EASE,
                  }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.2, fontWeight: 500, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
                  <span style={{ fontSize: 10.5, color: 'rgba(var(--on),0.36)' }}>{r.hint}</span>
                  {r.shortcut ? (
                    <span className="pc-num" style={{ fontSize: 9.5, color: 'rgba(var(--on),0.32)', border: '1px solid rgba(var(--on),0.11)', borderRadius: 4, padding: '0 4px' }}>G {r.shortcut}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
