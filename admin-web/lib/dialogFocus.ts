import type { KeyboardEvent } from 'react';

/** Keep keyboard navigation inside an open modal, including reverse tab order. */
export function trapDialogTab(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab') return;
  const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]')]
    .filter(element => element.tabIndex >= 0 && !element.hasAttribute('disabled') && element.getClientRects().length > 0);
  const first = elements[0], last = elements[elements.length - 1];
  if (!first) { event.preventDefault(); event.currentTarget.focus(); return; }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) {
    event.preventDefault(); first.focus();
  }
}
