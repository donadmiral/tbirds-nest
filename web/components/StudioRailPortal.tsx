"use client";

/**
 * A desk's own rail panels.
 *
 * The shell owns the rail column, but the panels that belong to one desk need
 * that desk's data, which only the page has. A portal lets the page render into
 * the column without the shell having to know about every desk's queries, and
 * without lifting page state up into a layout that would then reload it.
 *
 * Panels rendered here sit above the shared ones, so the desk-specific answer
 * comes first and the general actions stay where they always are.
 */
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

export const STUDIO_RAIL_SLOT = "studio-rail-slot";

const railHost = () => document.getElementById(STUDIO_RAIL_SLOT);
const serverRailHost = () => null;
function subscribeToRail(notify: () => void) {
  let previous = railHost();
  const observer = new MutationObserver(() => {
    const next = railHost();
    if (next !== previous) { previous = next; notify(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

export function StudioRailPortal({ children }: { children: React.ReactNode }) {
  // The shell owns this external DOM node. Reconnect if navigation replaces it,
  // including a delayed shell mount after authentication finishes.
  const host = useSyncExternalStore(subscribeToRail, railHost, serverRailHost);

  if (!host) return null;
  return createPortal(children, host);
}
