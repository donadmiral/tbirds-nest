'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { readPreferenceFlag, readPreferenceList, savePreference } from '@/lib/browserPreferences';
import { trapDialogTab } from '@/lib/dialogFocus';

export type RailItem = { href: string; label: string; icon: string; key: string };
export type RailGroup = { label: string; items: RailItem[] };

const K_COLLAPSED = 'pc-rail-collapsed';
const K_CLOSED = 'pc-rail-closed-groups';
const K_PINS = 'pc-rail-pins';

function RailIcon({ item }: { item: RailItem }) {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" className="pc-rail-icon">
    <path d={item.icon} fill={item.href === '/organizations' ? 'none' : 'currentColor'} stroke={item.href === '/organizations' ? 'currentColor' : 'none'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

export default function SideRail({ groups, counts, active, email, roleLabel }: {
  groups: RailGroup[]; counts: Record<string, number | null>; active: string; email: string; roleLabel: string;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [closed, setClosed] = useState<string[]>([]);
  const [pins, setPins] = useState<string[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const items = useMemo(() => groups.flatMap(group => group.items), [groups]);
  const allowed = useMemo(() => new Set(items.map(item => item.href)), [items]);
  const pinned = pins.flatMap(href => { const item = items.find(value => value.href === href); return item ? [item] : []; });

  useEffect(() => {
    setCollapsed(readPreferenceFlag(K_COLLAPSED));
    setClosed(readPreferenceList(K_CLOSED, new Set(groups.map(group => group.label))));
    setPins(readPreferenceList(K_PINS, allowed));
  }, [allowed, groups]);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) { mobileRef.current?.close(); return; }
    const dialog = mobileRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = 'hidden';
    const media = window.matchMedia('(min-width: 768px)');
    const onResize = () => { if (media.matches) setMobileOpen(false); };
    media.addEventListener('change', onResize);
    return () => {
      media.removeEventListener('change', onResize);
      document.body.style.overflow = previousOverflow;
      dialog?.close();
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [mobileOpen]);

  function togglePin(href: string) {
    setPins(previous => {
      const next = previous.includes(href) ? previous.filter(item => item !== href) : [...previous, href];
      savePreference(K_PINS, next);
      return next;
    });
  }

  function toggleGroup(label: string) {
    setClosed(previous => {
      const next = previous.includes(label) ? previous.filter(item => item !== label) : [...previous, label];
      savePreference(K_CLOSED, next);
      return next;
    });
  }

  function navigation(compact: boolean, mobile: boolean) {
    function itemRow(item: RailItem, isPinned = false) {
      const count = counts[item.href];
      const selected = item.href === active;
      return <div key={item.href} className="pc-rail-row" data-active={selected}>
        <Link href={item.href} aria-current={selected ? 'page' : undefined} title={compact ? item.label : undefined} className="pc-rail-link"
          onClick={event => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            if (mobile) setMobileOpen(false);
            if (pathname === item.href) window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
          }}>
          <RailIcon item={item} />
          <span className={compact ? 'sr-only' : 'pc-rail-label'}>{item.label}</span>
          {!compact && count !== undefined && (count === null || count > 0) ? <span className="pc-rail-count" aria-label={count === null ? 'Count unavailable' : `${count} waiting`}>{count === null ? '—' : count > 999 ? '999+' : count}</span> : null}
        </Link>
        {!compact ? <button type="button" className="pc-rail-pin" aria-label={`${isPinned || pins.includes(item.href) ? 'Unpin' : 'Pin'} ${item.label}`} aria-pressed={pins.includes(item.href)} onClick={() => togglePin(item.href)}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill={pins.includes(item.href) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m9 3 6 0-1 6 4 4v2H6v-2l4-4-1-6Zm3 12v6" /></svg>
        </button> : null}
      </div>;
    }
    return <>
      <div className="pc-rail-brand">
        <Link href="/dashboard" aria-label="Platinum Circles overview" onClick={() => mobile && setMobileOpen(false)}><img src="/logo.png" alt="" width="36" height="36" /></Link>
        {!compact ? <div className="pc-rail-brand-name"><strong>Platinum Circles</strong><span>Business & operations</span></div> : null}
        {mobile ? <button type="button" className="pc-icon-btn pc-rail-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}>×</button> : null}
      </div>
      <nav aria-label={mobile ? 'Mobile operations navigation' : 'Operations navigation'} className="pc-rail-nav">
        {pinned.length ? <section className="pc-rail-section" aria-label="Pinned desks">
          {!compact ? <div className="pc-rail-section-label">Pinned</div> : null}
          {pinned.map(item => itemRow(item, true))}
        </section> : null}
        {groups.map(group => {
          const expanded = compact || !closed.includes(group.label) || group.items.some(item => item.href === active);
          return <section key={group.label} className="pc-rail-section" aria-label={group.label}>
            {!compact ? <button type="button" className="pc-rail-section-toggle" aria-expanded={expanded} onClick={() => toggleGroup(group.label)} disabled={group.items.some(item => item.href === active)}>
              {group.label}<span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
            </button> : null}
            {expanded ? group.items.map(item => itemRow(item)) : null}
          </section>;
        })}
      </nav>
      <footer className="pc-rail-footer">
        <Link href="/security" className="pc-rail-account" title={compact ? 'Account security' : undefined}>
          <span className="pc-rail-avatar">{email.slice(0, 1).toUpperCase() || 'P'}</span>
          <span className={compact ? 'sr-only' : 'pc-rail-identity'}><strong>{email}</strong><span>{roleLabel}</span></span>
        </Link>
        {!mobile ? <button type="button" className="pc-rail-collapse" aria-label={compact ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={!compact} onClick={() => setCollapsed(previous => { savePreference(K_COLLAPSED, !previous); return !previous; })}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16m6-11-3 3 3 3" transform={compact ? 'translate(24 0) scale(-1 1)' : undefined} /></svg>
          {!compact ? <span>Collapse navigation</span> : null}
        </button> : null}
      </footer>
    </>;
  }

  return <>
    <a className="pc-skip-link" href="#workspace">Skip to workspace</a>
    <div className="pc-rail-spacer" data-collapsed={collapsed} />
    <aside className="pc-side-rail" data-collapsed={collapsed}>{navigation(collapsed, false)}</aside>
    <button ref={triggerRef} type="button" className="pc-mobile-nav-open pc-icon-btn" aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="pc-mobile-navigation" onClick={() => setMobileOpen(true)}>
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
    </button>
    <dialog id="pc-mobile-navigation" ref={mobileRef} className="pc-mobile-navigation" aria-label="Operations navigation" onKeyDown={trapDialogTab} onClose={() => setMobileOpen(false)} onClick={event => { if (event.target === event.currentTarget) setMobileOpen(false); }}>
      <div className="pc-mobile-rail">{navigation(false, true)}</div>
    </dialog>
  </>;
}
