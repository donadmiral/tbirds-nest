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
    const saved = Number(window.sessionStorage.getItem(k) || "0");
    if (saved > 0) {
      // The feed renders after its data arrives; retry briefly until the page
      // is tall enough to reach the saved offset.
      let tries = 0;
      const tick = () => {
        if (document.documentElement.scrollHeight - window.innerHeight >= saved || tries > 20) window.scrollTo(0, saved);
        else { tries += 1; setTimeout(tick, 100); }
      };
      tick();
    }
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => window.sessionStorage.setItem(k, String(window.scrollY)));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, [pathname]);

  return null;
}
