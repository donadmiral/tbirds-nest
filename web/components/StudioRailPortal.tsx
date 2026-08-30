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
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export const STUDIO_RAIL_SLOT = "studio-rail-slot";

export function StudioRailPortal({ children }: { children: React.ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // The slot only exists after the shell has mounted, so this runs on the
    // client and re-checks on every navigation between desks.
    setHost(document.getElementById(STUDIO_RAIL_SLOT));
  }, []);

  if (!host) return null;
  return createPortal(children, host);
}
