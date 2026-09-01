/**
 * StoryEngine - web twins of the phone creative engine.
 * Mirrors phone/src/components/stories: storyPanels (AdjustLayer,
 * BackgroundLayer), DrawLayer (DrawingLayer), storyExtras (gif, photo,
 * time, date, weather, entity stickers + entrance animations + extra
 * text fonts). Keep the constants in lockstep with the phone files.
 */
"use client";
import React from "react";
import type { StoryTextSticker } from "@/lib/stories";

/* ── Adjust: identical layer math to phone AdjustLayer ── */
export type StoryAdjust = { bri?: number; warm?: number; tint?: number; sat?: number; fade?: number; vig?: number };
function cN(v: any): number { const n = Number(v); if (!n || Number.isNaN(n)) return 0; return Math.max(-100, Math.min(100, n)); }
function c0(v: any): number { const n = Number(v); if (!n || Number.isNaN(n)) return 0; return Math.max(0, Math.min(100, n)); }

export function AdjustOverlay({ adjust }: { adjust: StoryAdjust | null | undefined }) {
  if (!adjust || typeof adjust !== "object") return null;
  const bri = cN(adjust.bri), warm = cN(adjust.warm), tint = cN(adjust.tint), sat = cN(adjust.sat), fade = c0(adjust.fade), vig = c0(adjust.vig);
  if (!bri && !warm && !tint && !sat && !fade && !vig) return null;
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
  const vTB = (vig / 100) * 0.55, vLR = (vig / 100) * 0.4;
  return (
    <div className="pointer-events-none absolute inset-0 z-[1]">
      {layers.map((l, i) => (
        <div key={i} className="absolute inset-0" style={{ backgroundColor: l.color, opacity: l.opacity }} />
      ))}
      {vig > 0 ? (
        <>
          <div className="absolute inset-x-0 top-0" style={{ height: "32%", background: "linear-gradient(to bottom, rgba(0,0,0," + vTB + "), rgba(0,0,0,0))" }} />
          <div className="absolute inset-x-0 bottom-0" style={{ height: "32%", background: "linear-gradient(to top, rgba(0,0,0," + vTB + "), rgba(0,0,0,0))" }} />
          <div className="absolute inset-y-0 left-0" style={{ width: "22%", background: "linear-gradient(to right, rgba(0,0,0," + vLR + "), rgba(0,0,0,0))" }} />
          <div className="absolute inset-y-0 right-0" style={{ width: "22%", background: "linear-gradient(to left, rgba(0,0,0," + vLR + "), rgba(0,0,0,0))" }} />
        </>
      ) : null}
    </div>
  );
}

/* ── Backdrop: identical semantics to phone BackgroundLayer ── */
export type StoryBgSpec = { kind: "blur" | "color" | "gradient" | "none"; a?: string; b?: string };
export function BgLayer({ bg, mediaUrl }: { bg: StoryBgSpec | null | undefined; mediaUrl?: string | null }) {
  if (!bg || bg.kind === "blur" || !bg.kind) {
    if (!mediaUrl) return <div className="absolute inset-0 bg-black" />;
    return (
      <div className="absolute inset-0 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mediaUrl} alt="" className="h-full w-full scale-110 object-cover opacity-[0.22]" style={{ filter: "blur(35px)" }} />
      </div>
    );
  }
  if (bg.kind === "none") return <div className="absolute inset-0 bg-black" />;
  if (bg.kind === "color") return <div className="absolute inset-0" style={{ backgroundColor: bg.a || "#000" }} />;
  return <div className="absolute inset-0" style={{ background: "linear-gradient(135deg," + (bg.a || "#000") + "," + (bg.b || bg.a || "#000") + ")" }} />;
}

/* ── Drawing: identical stroke replay to phone DrawingLayer ── */
type DrawStroke = { tool: string; color: string; width: number; points: { x: number; y: number }[] };
const DRAW_VB_W = 390, DRAW_VB_H = 780;
function toPath(points: { x: number; y: number }[], w: number, h: number): string {
  if (!points.length) return "";
  let d = "M " + points[0].x * w + " " + points[0].y * h;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1], c = points[i];
    const mx = ((p.x + c.x) / 2) * w, my = ((p.y + c.y) / 2) * h;
    d += " Q " + p.x * w + " " + p.y * h + " " + mx + " " + my;
  }
  const last = points[points.length - 1];
  d += " L " + last.x * w + " " + last.y * h;
  return d;
}
function StrokeEl({ st }: { st: DrawStroke }) {
  const w = DRAW_VB_W, h = DRAW_VB_H;
  const d = toPath(st.points, w, h);
  const common = { strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  if (st.points.length === 1 || st.tool === "dot") {
    const p = st.points[st.points.length - 1];
    if (!p) return null;
    return <circle cx={p.x * w} cy={p.y * h} r={Math.max(2, st.width * 0.9)} fill={st.color} opacity={st.tool === "highlight" ? 0.4 : 1} />;
  }
  if (st.tool === "neon") {
    return (
      <>
        <path d={d} stroke={st.color} strokeWidth={st.width * 2.6} opacity={0.35} {...common} />
        <path d={d} stroke={st.color} strokeWidth={st.width * 1.5} opacity={0.55} {...common} />
        <path d={d} stroke="#FFFFFF" strokeWidth={Math.max(1.5, st.width * 0.6)} {...common} />
      </>
    );
  }
  if (st.tool === "highlight") return <path d={d} stroke={st.color} strokeWidth={st.width * 2.2} strokeLinecap="butt" strokeLinejoin="round" fill="none" opacity={0.4} />;
  if (st.tool === "marker") return <path d={d} stroke={st.color} strokeWidth={st.width * 1.6} opacity={0.75} {...common} />;
  if (st.tool === "arrow") {
    const n = st.points.length;
    const a = st.points[Math.max(0, n - 4)], b = st.points[n - 1];
    let head: React.ReactNode = null;
    if (a && b) {
      const ang = Math.atan2((b.y - a.y) * h, (b.x - a.x) * w);
      const L = Math.max(10, st.width * 3.2);
      const x = b.x * w, y = b.y * h;
      const p1x = x - L * Math.cos(ang - Math.PI / 7), p1y = y - L * Math.sin(ang - Math.PI / 7);
      const p2x = x - L * Math.cos(ang + Math.PI / 7), p2y = y - L * Math.sin(ang + Math.PI / 7);
      head = <path d={"M " + p1x + " " + p1y + " L " + x + " " + y + " L " + p2x + " " + p2y} stroke={st.color} strokeWidth={st.width} {...common} />;
    }
    return (<><path d={d} stroke={st.color} strokeWidth={st.width} {...common} />{head}</>);
  }
  return <path d={d} stroke={st.color} strokeWidth={st.width} {...common} />;
}
export function DrawSvg({ stickers }: { stickers: StoryTextSticker[] | null | undefined }) {
  const strokes: DrawStroke[] = (((stickers || []).find((s: any) => s?.kind === "drawing") as any)?.strokes) || [];
  if (!strokes.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[3]">
      <svg width="100%" height="100%" viewBox={"0 0 " + DRAW_VB_W + " " + DRAW_VB_H} preserveAspectRatio="none">
        {strokes.map((st, i) => <StrokeEl key={i} st={st} />)}
      </svg>
    </div>
  );
}

/* ── Entrance animations: CSS twins of phone StickerAnim ── */
export const STICKER_ANIM_CSS = `
@keyframes pcst-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes pcst-pop { 0% { opacity: 0; transform: scale(0.3) } 70% { transform: scale(1.06) } 100% { opacity: 1; transform: scale(1) } }
@keyframes pcst-bounce { 0% { opacity: 0; transform: scale(0.3) } 55% { transform: scale(1.12) } 78% { transform: scale(0.96) } 100% { opacity: 1; transform: scale(1) } }
@keyframes pcst-zoom { from { opacity: 0; transform: scale(1.6) } to { opacity: 1; transform: scale(1) } }
@keyframes pcst-slide { from { opacity: 0; transform: translateX(-60px) } to { opacity: 1; transform: translateX(0) } }
@keyframes pcst-rise { from { opacity: 0; transform: translateY(40px) } to { opacity: 1; transform: translateY(0) } }
@keyframes pcst-drop { from { opacity: 0; transform: translateY(-40px) } to { opacity: 1; transform: translateY(0) } }
`;
export function animStyle(anim?: string | null): React.CSSProperties {
  if (!anim || anim === "none") return {};
  const name = "pcst-" + anim;
  const dur = anim === "fade" ? "420ms" : anim === "bounce" ? "560ms" : anim === "pop" ? "420ms" : "340ms";
  return { animation: name + " " + dur + " cubic-bezier(0.22, 1, 0.36, 1) both" };
}

/* ── Extra text fonts: closest web equivalents of phone EXTRA_MAP ── */
export function extraFontCss(style?: string | null): React.CSSProperties {
  switch (style) {
    case "mono": return { fontFamily: '"Courier New", Courier, monospace', fontWeight: 600 };
    case "serif2": return { fontFamily: "Georgia, serif", fontWeight: 400 };
    case "condensed": return { fontFamily: '"Arial Narrow", "Helvetica Neue", sans-serif', fontWeight: 600 };
    case "marker": return { fontFamily: '"Comic Sans MS", "Marker Felt", cursive', fontWeight: 400 };
    case "signature": return { fontFamily: '"Segoe Script", "Snell Roundhand", cursive', fontWeight: 600 };
    case "poster": return { fontFamily: '"Arial Narrow", "Helvetica Neue", sans-serif', fontWeight: 900, letterSpacing: 0.5 };
    case "luxury": return { fontFamily: 'Didot, "Bodoni MT", "Playfair Display", serif', fontWeight: 400, letterSpacing: 1 };
    case "tech": return { fontFamily: "Menlo, Consolas, monospace", fontWeight: 600, letterSpacing: 0.5 };
    case "bubble": return { fontFamily: '"Comic Sans MS", "Chalkboard SE", cursive', fontWeight: 700 };
    default: return {};
  }
}

/* ── New sticker kinds: CSS twins of phone storyExtras views ── */
function weatherGlyph(code: number): string {
  if (code === 0) return "\u2600\uFE0F";
  if (code <= 2) return "\uD83C\uDF24\uFE0F";
  if (code === 3) return "\u2601\uFE0F";
  if (code >= 45 && code <= 48) return "\uD83C\uDF2B\uFE0F";
  if (code >= 51 && code <= 67) return "\uD83C\uDF27\uFE0F";
  if (code >= 71 && code <= 77) return "\uD83C\uDF28\uFE0F";
  if (code >= 80 && code <= 82) return "\uD83C\uDF26\uFE0F";
  if (code >= 95) return "\u26C8\uFE0F";
  return "\uD83C\uDF21\uFE0F";
}
const HUGE_SHADOW = "0 2px 8px rgba(0,0,0,0.45)";
const PILL: React.CSSProperties = { background: "rgba(0,0,0,0.72)", borderRadius: 22, padding: "9px 16px", color: "#FFFFFF", fontSize: 18, fontWeight: 700, letterSpacing: 0.4, display: "inline-block" };
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

export function EngineSticker({ st }: { st: StoryTextSticker }) {
  const s: any = st;
  const kind = s.kind;
  if (kind === "gif" && s.gifUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={s.gifUrl} alt="" style={{ width: 180, height: 180, objectFit: "contain" }} />;
  }
  if (kind === "photo") {
    const uri = s.photoUrl || s.photoUri;
    if (!uri) return null;
    const shape = s.photoShape || "rounded";
    const radius = shape === "circle" ? 100 : shape === "rounded" ? 22 : 2;
    // eslint-disable-next-line @next/next/no-img-element
    return <div style={{ width: 200, height: 200, borderRadius: radius, overflow: "hidden", border: "3px solid #FFFFFF", background: "#111" }}><img src={uri} alt="" className="h-full w-full object-cover" /></div>;
  }
  if (kind === "time") {
    const now = new Date();
    const idx = (s.infoStyle || 0) % 3;
    const hh = now.getHours(); const mm = now.getMinutes().toString().padStart(2, "0");
    const h12 = hh % 12 === 0 ? 12 : hh % 12; const ap = hh >= 12 ? "PM" : "AM";
    if (idx === 1) return <span style={PILL}>{h12 + ":" + mm + " " + ap}</span>;
    if (idx === 2) return (
      <div style={{ background: "rgba(255,255,255,0.92)", borderRadius: 18, padding: "10px 18px", textAlign: "center" }}>
        <div style={{ fontSize: 34, fontWeight: 800, color: "#0B1E3D" }}>{h12 + ":" + mm}</div>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#8A93A6", letterSpacing: 2 }}>{ap}</div>
      </div>
    );
    return <span style={{ fontSize: 54, fontWeight: 800, color: "#FFFFFF", textShadow: HUGE_SHADOW }}>{h12 + ":" + mm}</span>;
  }
  if (kind === "date") {
    const now = new Date();
    const idx = (s.infoStyle || 0) % 3;
    if (idx === 1) return (
      <div style={{ width: 96, borderRadius: 16, overflow: "hidden", background: "#FFFFFF", textAlign: "center" }}>
        <div style={{ background: "#E24C4B", color: "#FFF", fontWeight: 800, fontSize: 13, letterSpacing: 2, padding: "5px 0" }}>{MONTHS[now.getMonth()]}</div>
        <div style={{ fontSize: 42, fontWeight: 800, color: "#0B1E3D", padding: "6px 0" }}>{now.getDate()}</div>
      </div>
    );
    if (idx === 2) return <span style={PILL}>{WEEKDAYS[now.getDay()]}</span>;
    return <span style={{ fontSize: 30, fontWeight: 800, color: "#FFFFFF", letterSpacing: 1, textShadow: HUGE_SHADOW }}>{MONTHS[now.getMonth()] + " " + now.getDate() + ", " + now.getFullYear()}</span>;
  }
  if (kind === "weather") {
    const idx = (s.infoStyle || 0) % 2;
    const t = typeof s.weatherTemp === "number" ? s.weatherTemp + "\u00B0" : "--\u00B0";
    const g = weatherGlyph(Number(s.weatherCode) || 0);
    if (idx === 1) return <span style={PILL}>{g + " " + t}</span>;
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 42 }}>{g}</div>
        <div style={{ fontSize: 34, fontWeight: 800, color: "#FFFFFF", marginTop: 2, textShadow: HUGE_SHADOW }}>{t}</div>
      </div>
    );
  }
  if (kind === "entity") {
    const label = s.entityType === "listing" ? "Marketplace" : s.entityType === "job" ? "Job" : s.entityType === "article" ? "Article" : "Profile";
    const href = s.entityType === "listing" ? "/market/" + s.entityId : s.entityType === "job" ? "/jobs/" + s.entityId : s.entityType === "article" ? "/post/" + s.entityId : "/profile/" + s.entityId;
    return (
      <a href={href} className="pointer-events-auto" style={{ width: 260, display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.96)", borderRadius: 18, padding: 10, boxShadow: "0 4px 10px rgba(0,0,0,0.25)", textDecoration: "none" }}>
        {s.entityImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.entityImage} alt="" style={{ width: 52, height: 52, borderRadius: 12, objectFit: "cover", flexShrink: 0 }} />
        ) : (
          <div style={{ width: 52, height: 52, borderRadius: 12, background: "#EDE9E1", flexShrink: 0 }} />
        )}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 10.5, fontWeight: 800, color: "#8A93A6", letterSpacing: 0.6, textTransform: "uppercase" }}>{label}</span>
          <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: "#0B1E3D", lineHeight: "18px", overflow: "hidden", textOverflow: "ellipsis" }}>{s.entityTitle || st.text}</span>
          {s.entitySub ? <span style={{ display: "block", fontSize: 12, color: "#5A6478", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.entitySub}</span> : null}
        </span>
        <span style={{ color: "#8A93A6", fontSize: 16 }}>{"\u203A"}</span>
      </a>
    );
  }
  return null;
}
