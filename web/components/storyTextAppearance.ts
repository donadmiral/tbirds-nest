import type React from "react";
import type { StoryTextSticker } from "@/lib/stories";

function isColorLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return false;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

export function stickerCss(st: StoryTextSticker): React.CSSProperties {
  const fs = st.fontSizeOverride || 28;
  const pill = !!st.bgEnabled && st.style !== "highlight";
  const base: React.CSSProperties = { fontSize: fs, fontWeight: 700, color: st.color, lineHeight: 1.25, whiteSpace: "pre-wrap", textAlign: st.textAlign || "center" };
  if (pill) {
    return { ...base, background: st.color, color: isColorLight(st.color) ? "#000000" : "#FFFFFF", padding: "6px 12px", borderRadius: 20 };
  }
  switch (st.style) {
    case "bold": return { ...base, fontWeight: 800, letterSpacing: -0.5, textShadow: "0 2px 4px rgba(0,0,0,0.35)" };
    case "typewriter": return { ...base, fontWeight: 400, fontFamily: "ui-monospace, monospace", letterSpacing: 0.5, background: "rgba(0,0,0,0.55)", padding: "6px 10px", borderRadius: 6 };
    case "neon": return { ...base, fontWeight: 800, textShadow: "0 0 14px " + st.color + ", 0 0 26px " + st.color };
    case "highlight": return { ...base, background: st.color, color: isColorLight(st.color) ? "#000000" : "#FFFFFF", padding: "4px 10px", borderRadius: 8, boxDecorationBreak: "clone" as const, WebkitBoxDecorationBreak: "clone" as const };
    case "outline": return { ...base, color: "#FFFFFF", WebkitTextStroke: "1.5px " + st.color } as React.CSSProperties;
    case "shadow3d": return { ...base, fontWeight: 800, textShadow: "2px 2px 0 rgba(0,0,0,0.5), 4px 4px 0 rgba(0,0,0,0.25)" };
    case "retro": return { ...base, letterSpacing: 1, textShadow: "2px 2px 0 rgba(0,0,0,0.6)" };
    case "script": return { ...base, fontFamily: "Georgia, serif", fontStyle: "italic", fontWeight: 400 };
    default: return { ...base, textShadow: "0 1px 3px rgba(0,0,0,0.45)" };
  }
}

