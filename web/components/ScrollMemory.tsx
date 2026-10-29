"use client";

/**
 * Scroll position memory.
 *
 * Opening a post and coming back used to land at the top of the feed, which
 * on a long scroll meant finding your place again. The position is saved per
 * route as you scroll and restored on return, for the life of the tab.
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";

const KEY = "pc:scroll:";

export function ScrollMemory() {
  const pathname = usePathname();

  useEffect(() => {
    const k = KEY + pathname;
    let saved = 0;
    try { saved = Number(window.sessionStorage.getItem(k) || "0"); }
    catch { /* Browsers may disable storage; navigation must still work. */ }
    let active = true;
    let restoring = Number.isFinite(saved) && saved > 0;
    let restoreTimer: ReturnType<typeof setTimeout> | undefined;
    const stopRestoring = () => {
      restoring = false;
      if (restoreTimer !== undefined) clearTimeout(restoreTimer);
      restoreTimer = undefined;
    };
    // A tap, gesture or key means the member has taken control. A delayed
    // restoration must never move the page underneath that interaction.
    const intentEvents = ["pointerdown", "touchstart", "wheel", "keydown"] as const;
    intentEvents.forEach(event => window.addEventListener(event, stopRestoring, { capture: true, passive: true }));
    if (restoring) {
      // The feed renders after its data arrives; retry briefly until the page
      // is tall enough to reach the saved offset.
      let tries = 0;
      const tick = () => {
        if (!active || !restoring) return;
        if (document.documentElement.scrollHeight - window.innerHeight >= saved || tries >= 20) {
          stopRestoring();
          window.scrollTo(0, saved);
        } else { tries += 1; restoreTimer = setTimeout(tick, 100); }
      };
      tick();
    }
    let raf = 0;
    const onScroll = () => {
      if (restoring) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!active) return;
        try { window.sessionStorage.setItem(k, String(window.scrollY)); }
        catch { /* Scroll memory is optional when storage is unavailable. */ }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      active = false;
      stopRestoring();
      intentEvents.forEach(event => window.removeEventListener(event, stopRestoring, true));
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [pathname]);

  return null;
}
