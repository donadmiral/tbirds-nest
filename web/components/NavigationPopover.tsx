'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import chrome from './NavigationChrome.module.css';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]';

/** A small navigation disclosure with viewport positioning and a complete keyboard exit. */
export function NavigationPopover({ label, trigger, className = '', side = 'bottom', children }: {
  label: string; trigger: ReactNode; className?: string; side?: 'bottom' | 'right';
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const path = usePathname();
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => { setOpen(false); }, [path]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const width = panel.offsetWidth, height = panel.offsetHeight, edge = 12;
      const left = side === 'right' ? anchor.right + 12 : anchor.right - width;
      const top = side === 'right' ? anchor.top : anchor.bottom + 10;
      setPosition({
        left: Math.max(edge, Math.min(left, window.innerWidth - width - edge)),
        top: Math.max(edge, Math.min(top, window.innerHeight - height - edge)),
      });
    };
    place();
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus());
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, side]);

  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) => target instanceof Node && (panelRef.current?.contains(target) || triggerRef.current?.contains(target));
    const outside = (event: Event) => { if (!inside(event.target)) setOpen(false); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); return; }
      if (!panelRef.current?.contains(document.activeElement)) return;
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || document.activeElement?.matches('input, textarea, select')) return;
      const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(node => node.getClientRects().length > 0);
      if (!items.length) return;
      event.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', key); };
  }, [open]);

  return <>
    <button ref={triggerRef} type="button" className={className} aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(value => !value)}>{trigger}</button>
    {open ? createPortal(<div ref={panelRef} id={id} role="dialog" aria-label={label} className={chrome.popover} style={position}>
      {children(close)}
    </div>, document.body) : null}
  </>;
}
