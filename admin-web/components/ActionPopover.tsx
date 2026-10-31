'use client';

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** A nonmodal action panel. Tab can leave it, Escape returns to its trigger. */
export default function ActionPopover({ label, trigger, children, align = 'end' }: {
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // The render prop receives only a state transition. Focus restoration belongs
  // to the popover lifecycle, so calling a child renderer never reads a DOM ref.
  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open) return;
    const panelNode = panel.current;
    const triggerNode = button.current;
    const position = () => {
      const anchor = button.current?.getBoundingClientRect();
      const node = panel.current;
      if (!anchor || !node) return;
      const width = Math.min(300, window.innerWidth - 24);
      node.style.width = `${width}px`;
      node.style.maxHeight = `${Math.max(120, window.innerHeight - 24)}px`;
      const height = node.getBoundingClientRect().height;
      node.style.left = `${Math.max(12, Math.min(align === 'start' ? anchor.left : anchor.right - width, window.innerWidth - width - 12))}px`;
      const below = anchor.bottom + 6;
      node.style.top = `${Math.max(12, below + height <= window.innerHeight - 12 ? below : anchor.top - height - 6)}px`;
    };
    position();
    panel.current?.querySelector<HTMLElement>('button:not(:disabled),a[href],input,textarea,select')?.focus();
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    };
    const observer = new ResizeObserver(position);
    if (panel.current) observer.observe(panel.current);
    document.addEventListener('pointerdown', away);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      if (document.activeElement === document.body || panelNode?.contains(document.activeElement)) triggerNode?.focus({ preventScroll: true });
    };
  }, [open, align]);

  return <div ref={root} className="pc-action-popover" onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)
      && !panel.current?.contains(event.relatedTarget as Node)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <button ref={button} type="button" className="pc-icon-btn pc-action-popover-trigger" aria-label={label}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(value => !value)} onKeyDown={event => {
        if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true); }
      }}>{trigger}</button>
    {open ? createPortal(<div ref={panel} id={id} role="dialog" aria-label={label}
      className="pc-action-popover-panel">{children(close)}</div>, document.body) : null}
  </div>;
}
