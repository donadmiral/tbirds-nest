import React from "react";

/* ── Adjust: identical layer math to phone AdjustLayer ── */
export type StoryAdjust = { bri?: number; warm?: number; tint?: number; sat?: number; fade?: number; vig?: number };
function cN(v: any): number { const n = Number(v); if (!n || Number.isNaN(n)) return 0; return Math.max(-100, Math.min(100, n)); }
function c0(v: any): number { const n = Number(v); if (!n || Number.isNaN(n)) return 0; return Math.max(0, Math.min(100, n)); }

export function AdjustOverlay({ adjust }: { adjust: StoryAdjust | null | undefined }) {
  if (!adjust || typeof adjust !== "object") return null;
  const bri = cN(adjust.bri), warm = cN(adjust.warm), tint = cN(adjust.tint), sat = cN(adjust.sat), fade = c0(adjust.fade), vig = c0(adjust.vig);
  const a: any = adjust; const con = cN(a.con), hi = cN(a.hi), sh = cN(a.sh), grain = c0(a.grain);
  if (!bri && !con && !warm && !tint && !sat && !hi && !sh && !fade && !grain && !vig) return null;
  const layers: { color: string; opacity: number }[] = [];
  if (bri > 0) layers.push({ color: "#FFFFFF", opacity: (bri / 100) * 0.35 });
  if (bri < 0) layers.push({ color: "#000000", opacity: (-bri / 100) * 0.4 });
  if (warm > 0) layers.push({ color: "#FF9E45", opacity: (warm / 100) * 0.22 });
  if (warm < 0) layers.push({ color: "#3D7DFF", opacity: (-warm / 100) * 0.2 });
  if (tint > 0) layers.push({ color: "#E14CCB", opacity: (tint / 100) * 0.16 });
  if (tint < 0) layers.push({ color: "#3DBB6A", opacity: (-tint / 100) * 0.16 });
  if (sat < 0) layers.push({ color: "#808080", opacity: (-sat / 100) * 0.5 });
  if (sat > 0) layers.push({ color: "#FF3D6E", opacity: (sat / 100) * 0.06 });
  if (fade > 0) layers.push({ color: "#D8D2C8", opacity: (fade / 100) * 0.28 });
  if (con > 0) layers.push({ color: "#000000", opacity: (con / 100) * 0.10 });
  if (con < 0) layers.push({ color: "#8A8A8A", opacity: (-con / 100) * 0.22 });
  const vTB = (vig / 100) * 0.55, vLR = (vig / 100) * 0.4;
  // Same deterministic grain lattice as the phone (seeded LCG, 220 dots).
  const dots: { top: string; left: string; o: number; s: number }[] = [];
  if (grain > 0) { let seed = 9301; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }; for (let i = 0; i < 220; i++) dots.push({ top: (rnd() * 100).toFixed(2) + "%", left: (rnd() * 100).toFixed(2) + "%", o: 0.25 + rnd() * 0.75, s: rnd() > 0.5 ? 2 : 1 }); }
  const gk = Math.max(0, Math.min(100, grain)) / 100;
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none" }}>
      {layers.map((l, i) => (
        <div key={i} style={{ position: "absolute", inset: 0, backgroundColor: l.color, opacity: l.opacity }} />
      ))}
      {hi !== 0 ? <div style={{ position: "absolute", inset: 0, background: hi > 0 ? "linear-gradient(to bottom, rgba(255,255,255," + ((hi / 100) * 0.22) + "), rgba(255,255,255,0))" : "linear-gradient(to bottom, rgba(0,0,0," + ((-hi / 100) * 0.18) + "), rgba(0,0,0,0))" }} /> : null}
      {sh !== 0 ? <div style={{ position: "absolute", inset: 0, background: sh > 0 ? "linear-gradient(to top, rgba(255,255,255," + ((sh / 100) * 0.18) + "), rgba(255,255,255,0))" : "linear-gradient(to top, rgba(0,0,0," + ((-sh / 100) * 0.24) + "), rgba(0,0,0,0))" }} /> : null}
      {dots.map((d, i) => (<div key={"g" + i} style={{ position: "absolute", borderRadius: "50%", top: d.top, left: d.left, width: d.s, height: d.s, backgroundColor: i % 2 ? "#FFFFFF" : "#000000", opacity: d.o * gk * 0.35 }} />))}
      {vig > 0 ? (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: "32%", background: "linear-gradient(to bottom, rgba(0,0,0," + vTB + "), rgba(0,0,0,0))" }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "32%", background: "linear-gradient(to top, rgba(0,0,0," + vTB + "), rgba(0,0,0,0))" }} />
          <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "22%", background: "linear-gradient(to right, rgba(0,0,0," + vLR + "), rgba(0,0,0,0))" }} />
          <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: "22%", background: "linear-gradient(to left, rgba(0,0,0," + vLR + "), rgba(0,0,0,0))" }} />
        </>
      ) : null}
    </div>
  );
}

