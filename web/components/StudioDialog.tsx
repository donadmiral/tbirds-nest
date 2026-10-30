"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import styles from "./StudioWorkspace.module.css";

/** Native dialog supplies focus containment, Escape and focus restoration. */
export function StudioDialog({ title, description, open, onClose, busy = false, children, wide = false }: {
  title: string; description?: string; open: boolean; onClose: () => void; busy?: boolean; children: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    return () => { if (dialog.open) dialog.close(); previous?.focus({ preventScroll: true }); };
  }, [open]);
  return <dialog ref={ref} className={`${styles.dialog} ${wide ? styles.dialogWide : ""}`} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target !== event.currentTarget || busy) return; const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); }}>
    <header className={styles.dialogHeader}><div><h2 id={titleId}>{title}</h2>{description ? <p id={descriptionId}>{description}</p> : null}</div><button type="button" className={styles.iconButton} disabled={busy} onClick={onClose} aria-label={`Close ${title}`}><X size={20} strokeWidth={1.75} /></button></header>
    {open ? children : null}
  </dialog>;
}
