"use client";
// The pearl-glow boot screen: shown once per session while the app comes up, then fades.
import { useEffect, useState } from "react";

export default function BootSplash() {
  const [show, setShow] = useState(false);
  const [fading, setFading] = useState(false);
  useEffect(() => {
    try { if (sessionStorage.getItem("pc.boot") === "1") return; sessionStorage.setItem("pc.boot", "1"); } catch {}
    setShow(true);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const t1 = setTimeout(() => setFading(true), reduce ? 200 : 500);
    const t2 = setTimeout(() => setShow(false), reduce ? 250 : 950);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  if (!show) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[1000] flex items-center justify-center" style={{ background: "radial-gradient(75% 50% at 50% 40%, #FFFFFF 0%, #FAF9F6 50%, #F1EEE8 100%)", opacity: fading ? 0 : 1, transition: "opacity 600ms ease" }}>
      <div className="relative w-[240px] md:w-[300px]">
        <div className="absolute left-1/2 top-1/2 h-[140%] w-[140%] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: "radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 65%)" }} />
        <div className="absolute left-1/2 -bottom-6 h-10 w-1/2 -translate-x-1/2 rounded-full" style={{ background: "rgba(11,30,61,0.28)", filter: "blur(16px)" }} />
        <img src="/brand/mark-light.png" alt="" className="relative block w-full" style={{ filter: "drop-shadow(0 24px 32px rgba(11,30,61,0.18))" }} />
        <img src="/brand/mark-light.png" alt="" className="absolute left-0 top-full block w-full -scale-y-100" style={{ opacity: 0.12, marginTop: "-6%", WebkitMaskImage: "linear-gradient(to top, rgba(0,0,0,0.9), transparent 70%)", maskImage: "linear-gradient(to top, rgba(0,0,0,0.9), transparent 70%)" }} />
      </div>
    </div>
  );
}