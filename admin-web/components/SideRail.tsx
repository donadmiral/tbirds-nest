'use client';
import Image from 'next/image';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { readPreferenceFlag, readPreferenceList, savePreference } from '@/lib/browserPreferences';
import { preferenceList, usePreference } from '@/lib/browserPreferenceHooks';
import { trapDialogTab } from '@/lib/dialogFocus';
import AdminIcon from '@/components/AdminIcon';
import { matchingDestination, type NavigationItem, type NavigationGroup } from '@/lib/navigation';

export type RailItem = NavigationItem;
export type RailGroup = NavigationGroup;
const NO_TOOLS: NavigationItem[] = [];

const K_COLLAPSED = 'pc-rail-collapsed';
const K_CLOSED = 'pc-rail-closed-groups';
const K_PINS = 'pc-rail-pins';

function RailIcon({ item }: { item: RailItem }) {
  return <AdminIcon name={item.icon} size={20} className="pc-rail-icon" />;
}

export default function SideRail({ groups, counts, active, email, roleLabel, tools = NO_TOOLS }: {
  groups: RailGroup[]; counts: Record<string, number | null>; active: string; email: string; roleLabel: string; tools?: NavigationItem[];
}) {
  const pathname = usePathname();
  const collapsed = usePreference(K_COLLAPSED) === 'true';
  const closed = preferenceList(usePreference(K_CLOSED), new Set(groups.map(group => group.label)));
  const savedPins = usePreference(K_PINS);
  const [mobilePath, setMobilePath] = useState<string | null>(null);
  const mobileOpen = mobilePath === pathname;
  const setMobileOpen = (value: boolean) => setMobilePath(value ? pathname : null);
  const mobileRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const items = useMemo(() => [...groups.flatMap(group => group.items), ...tools], [groups, tools]);
  const selectedHref = matchingDestination(pathname, items) || active;
  const allowed = useMemo(() => new Set(items.map(item => item.href)), [items]);
  const pins = preferenceList(savedPins, allowed);
  const pinned = pins.flatMap(href => { const item = items.find(value => value.href === href); return item ? [item] : []; });

  useEffect(() => {
    if (!mobileOpen) { mobileRef.current?.close(); return; }
    const dialog = mobileRef.current;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = 'hidden';
    const media = window.matchMedia('(min-width: 768px)');
    const onResize = () => { if (media.matches) setMobilePath(null); };
    media.addEventListener('change', onResize);
    return () => {
      media.removeEventListener('change', onResize);
      document.body.style.overflow = previousOverflow;
      dialog?.close();
      trigger?.focus({ preventScroll: true });
    };
  }, [mobileOpen]);

  function togglePin(href: string) {
    const previous = readPreferenceList(K_PINS, allowed);
    savePreference(K_PINS, previous.includes(href) ? previous.filter(item => item !== href) : [...previous, href]);
  }

  function toggleGroup(label: string) {
    const previous = readPreferenceList(K_CLOSED, new Set(groups.map(group => group.label)));
    savePreference(K_CLOSED, previous.includes(label) ? previous.filter(item => item !== label) : [...previous, label]);
  }

  function navigation(compact: boolean, mobile: boolean) {
    function itemRow(item: RailItem, isPinned = false) {
      const count = counts[item.href];
      const selected = item.href === selectedHref;
      return <div key={item.href} className="pc-rail-row" data-active={selected} data-nested={!!item.parent && !isPinned}>
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
          <AdminIcon name="pin" size={14} />
        </button> : null}
      </div>;
    }
    return <>
      <div className="pc-rail-brand">
        <Link href="/dashboard" aria-label="Platinum Circles overview" onClick={() => mobile && setMobileOpen(false)}><Image unoptimized src="/logo.png" alt="" width="36" height="36" /></Link>
        {!compact ? <div className="pc-rail-brand-name"><strong>Platinum Circles</strong><span>OPERATIONS</span></div> : null}
        {mobile ? <button type="button" className="pc-icon-btn pc-rail-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><AdminIcon name="close" /></button> : null}
      </div>
      <nav aria-label={mobile ? 'Mobile operations navigation' : 'Operations navigation'} className="pc-rail-nav">
        {pinned.length ? <section className="pc-rail-section" aria-label="Pinned desks">
          {!compact ? <div className="pc-rail-section-label">Pinned</div> : null}
          {pinned.map(item => itemRow(item, true))}
        </section> : null}
        {groups.map(group => {
          const expanded = compact || !closed.includes(group.label) || group.items.some(item => item.href === selectedHref);
          return <section key={group.label} className="pc-rail-section" aria-label={group.label}>
            {!compact ? <button type="button" className="pc-rail-section-toggle" aria-expanded={expanded} onClick={() => toggleGroup(group.label)} disabled={group.items.some(item => item.href === selectedHref)}>
              {group.label}<AdminIcon name={expanded ? 'chevronUp' : 'chevronDown'} size={13} />
            </button> : null}
            {expanded ? group.items.map(item => itemRow(item)) : null}
          </section>;
        })}
      </nav>
      <footer className="pc-rail-footer">
        {tools.filter(item => item.href !== '/security?setup=1').length ? <nav className="pc-rail-tools" aria-label="Workspace tools">{tools.filter(item => item.href !== '/security?setup=1').map(item => itemRow(item))}</nav> : null}
        <Link href="/security?setup=1" aria-label="Account security" className="pc-rail-account" title={compact ? 'Account security' : undefined}>
          <span className="pc-rail-avatar">{email.slice(0, 1).toUpperCase() || 'P'}</span>
          <span className={compact ? 'sr-only' : 'pc-rail-identity'}><strong>{email}</strong><span>{roleLabel}</span></span>
        </Link>
        {!mobile ? <button type="button" className="pc-rail-collapse" aria-label={compact ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={!compact} onClick={() => savePreference(K_COLLAPSED, !readPreferenceFlag(K_COLLAPSED))}>
          <AdminIcon name="panel" size={18} style={compact ? { transform: 'scaleX(-1)' } : undefined} />
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
      <AdminIcon name="menu" size={22} />
    </button>
    <dialog id="pc-mobile-navigation" ref={mobileRef} className="pc-mobile-navigation" aria-label="Operations navigation" onKeyDown={trapDialogTab} onClose={() => setMobileOpen(false)} onClick={event => { if (event.target === event.currentTarget) setMobileOpen(false); }}>
      <div className="pc-mobile-rail">{navigation(false, true)}</div>
    </dialog>
  </>;
}
