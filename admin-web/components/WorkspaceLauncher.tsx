'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AdminIcon from '@/components/AdminIcon';
import { trapDialogTab } from '@/lib/dialogFocus';
import type { NavigationGroup, NavigationItem } from '@/lib/navigation';

/** A role-shaped map of the product, including desks that live under another desk. */
export default function WorkspaceLauncher({ groups, tools }: { groups: NavigationGroup[]; tools: NavigationItem[] }) {
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const open = openPath === pathname;
  function setOpen(value: boolean) { setOpenPath(value ? pathname : null); if (value) setSearch(''); }
  const sections = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...groups, { label: 'Your workspace', items: tools }].map(group => ({ ...group, items: group.items.filter(item => `${group.label} ${item.label} ${item.description}`.toLowerCase().includes(term)) })).filter(group => group.items.length);
  }, [groups, tools, search]);

  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    const node = dialog.current;
    const triggerNode = trigger.current;
    const overflow = document.body.style.overflow;
    node?.showModal();
    document.body.style.overflow = 'hidden';
    field.current?.focus();
    return () => { node?.close(); document.body.style.overflow = overflow; triggerNode?.focus({ preventScroll: true }); };
  }, [open]);

  return <>
    <button ref={trigger} type="button" className="pc-workspace-launcher pc-icon-btn" aria-label="All operations tools" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <AdminIcon name="grid" size={19} /><span>All tools</span>
    </button>
    <dialog ref={dialog} className="pc-tools-dialog" aria-label="All operations tools" onKeyDown={trapDialogTab} onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <header className="pc-tools-heading"><div><span className="pc-eyebrow">Platinum Circles Operations</span><h2>Your workspace</h2><p>Every desk available to your staff role.</p></div><button className="pc-button pc-button-square" type="button" aria-label="Close all tools" onClick={() => setOpen(false)}><AdminIcon name="close" /></button></header>
      <label className="pc-tools-search"><AdminIcon name="search" /><input ref={field} value={search} onChange={event => setSearch(event.target.value)} aria-label="Filter operations tools" placeholder="Find a workflow, queue or tool" /></label>
      <div className="pc-tools-content">
        {sections.length ? sections.map(group => <section key={group.label} aria-label={group.label}><h3>{group.label}</h3><div className="pc-tools-grid">{group.items.map(item => <Link href={item.href} key={item.href} className="pc-tool-card" onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) setOpen(false); }}><span className="pc-tool-icon"><AdminIcon name={item.icon} /></span><span><strong>{item.label}</strong><small>{item.description}</small></span><AdminIcon name="chevronRight" size={16} /></Link>)}</div></section>) : <div className="pc-tools-empty" role="status"><AdminIcon name="search" size={28} /><h3>No matching tools</h3><p>Try a name such as support, orders or review.</p><button type="button" className="pc-button" onClick={() => { setSearch(''); field.current?.focus(); }}>Clear search</button></div>}
      </div>
      <footer className="pc-tools-footer"><AdminIcon name="info" size={16} /><span>Use <kbd>Ctrl / ⌘ K</kbd> for quick search. Press <kbd>Esc</kbd> to return.</span></footer>
    </dialog>
  </>;
}
