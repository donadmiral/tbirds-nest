'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { readPreferenceList, savePreference } from '@/lib/browserPreferences';
import { trapDialogTab } from '@/lib/dialogFocus';
import AdminIcon, { type AdminIconName } from '@/components/AdminIcon';
import { matchingDestination, routePath } from '@/lib/navigation';

export type PaletteItem = { href: string; label: string; group: string; key: string; icon?: AdminIconName; description?: string };
type Row = { href: string; label: string; hint: string; kind: 'recent' | 'desk' | 'action' | 'search'; shortcut?: string; icon?: AdminIconName };
const K_RECENT = 'pc-recent-pages';

export default function CommandPalette({ items, actions }: { items: PaletteItem[]; actions: { href: string; label: string; desk?: string; icon?: AdminIconName }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [mac, setMac] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const byHref = useMemo(() => new Map(items.map(item => [item.href, item])), [items]);
  const memberSearchAllowed = byHref.has('/users');

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    const root = matchingDestination(pathname, items);
    const previous = readPreferenceList(K_RECENT, new Set(byHref.keys()));
    const next = (root ? [root, ...previous.filter(href => href !== root)] : previous).slice(0, 6);
    setRecent(next);
    savePreference(K_RECENT, next);
    setOpen(false);
  }, [pathname, byHref, items]);

  const rows: Row[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    const result: Row[] = [];
    if (!term) for (const href of recent) {
      const item = byHref.get(href);
      if (item && href !== matchingDestination(pathname, items)) result.push({ ...item, hint: 'Recent', kind: 'recent', shortcut: item.key });
    }
    for (const item of items) {
      if (term && !`${item.label} ${item.group} ${item.description || ''}`.toLowerCase().includes(term)) continue;
      if (!term && result.some(row => row.href === item.href)) continue;
      result.push({ ...item, hint: item.group, kind: 'desk', shortcut: item.key });
    }
    for (const action of actions) {
      if (!byHref.has(action.desk || routePath(action.href)) || (term && !action.label.toLowerCase().includes(term))) continue;
      result.push({ ...action, hint: 'Quick action', kind: 'action' });
    }
    if (term && memberSearchAllowed) result.push({ href: '/users?q=' + encodeURIComponent(q.trim()), label: `Search members for “${q.trim()}”`, hint: 'Members', kind: 'search' });
    return result;
  }, [q, recent, byHref, pathname, items, actions, memberSearchAllowed]);
  const selectedIndex = Math.min(cursor, Math.max(0, rows.length - 1));

  const go = useCallback((href: string) => { setOpen(false); setQ(''); router.push(href); }, [router]);

  useEffect(() => {
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = !!target?.closest('input, textarea, select, [contenteditable="true"]');
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen(previous => !previous); return; }
      if (open || typing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || target?.closest('dialog')) { armed = false; return; }
      if (armed) {
        armed = false;
        clearTimeout(timer);
        const item = items.find(value => value.key.toLowerCase() === event.key.toLowerCase());
        if (item) { event.preventDefault(); go(item.href); }
      } else if (event.key.toLowerCase() === 'g') {
        armed = true;
        timer = setTimeout(() => { armed = false; }, 900);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(timer); };
  }, [items, go, open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open) { dialog?.close(); return; }
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    setQ(''); setCursor(0);
    dialog?.showModal();
    document.body.style.overflow = 'hidden';
    inputRef.current?.focus();
    return () => { dialog?.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus({ preventScroll: true }); };
  }, [open]);

  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selectedIndex]);

  return <>
    <button ref={triggerRef} type="button" onClick={() => setOpen(true)} className="pc-search pc-command-trigger" aria-haspopup="dialog">
      <AdminIcon name="search" size={18} />
      <span>{memberSearchAllowed ? 'Search desks, members, actions' : 'Search desks and actions'}</span><kbd>{mac ? '⌘ K' : 'Ctrl K'}</kbd>
    </button>
    <dialog ref={dialogRef} className="pc-command-dialog" aria-label="Search operations" onKeyDown={trapDialogTab} onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="pc-command-panel">
        <div className="pc-command-input">
          <AdminIcon name="search" size={21} />
          <input ref={inputRef} role="combobox" aria-label="Find a desk or action" aria-expanded="true" aria-autocomplete="list" aria-controls={`${id}-results`} aria-activedescendant={rows[selectedIndex] ? `${id}-result-${selectedIndex}` : undefined} value={q}
            onChange={event => { setQ(event.target.value); setCursor(0); }} placeholder="Where would you like to go?"
            onKeyDown={event => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setCursor(Math.min(selectedIndex + 1, Math.max(0, rows.length - 1))); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setCursor(Math.max(0, selectedIndex - 1)); }
              if (event.key === 'Enter' && rows[selectedIndex]) { event.preventDefault(); go(rows[selectedIndex].href); }
            }} />
          <button type="button" className="pc-command-dismiss" aria-label="Close search" onClick={() => setOpen(false)}>Esc</button>
        </div>
        <div ref={listRef} id={`${id}-results`} role="listbox" aria-label="Matching destinations" className="pc-command-results">
          {rows.length ? rows.map((row, index) => <div key={`${row.kind}:${row.href}`} id={`${id}-result-${index}`} role="option" aria-selected={index === selectedIndex} className="pc-command-result" onMouseEnter={() => setCursor(index)} onMouseDown={event => event.preventDefault()} onClick={() => go(row.href)}>
            <span className="pc-command-result-icon"><AdminIcon name={row.kind === 'recent' ? 'history' : row.kind === 'search' ? 'search' : row.icon || 'arrowUpRight'} size={18} /></span>
            <span><strong>{row.label}</strong><small>{row.hint}</small></span>
            {row.shortcut ? <kbd>G {row.shortcut}</kbd> : null}
          </div>) : <div className="pc-command-empty" role="status"><strong>No matching destinations</strong><p>Try a desk name or another action.</p></div>}
        </div>
        <div className="pc-command-footer"><span>↑ ↓ to navigate</span><span>↵ to open</span><span>Esc to close</span></div>
      </div>
    </dialog>
  </>;
}
