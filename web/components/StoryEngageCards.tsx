"use client";
/**
 * StoryEngageCards - web twins of the phone question, quiz, slider and
 * countdown cards. Same RPCs as the phone (submit_sticker_response,
 * get_my_sticker_response, get_sticker_responses). Owners see results,
 * viewers answer once.
 */
import { useEffect, useMemo, useState } from "react";
import { submitStickerResponse, getMyStickerResponse, getStickerResponses, type StoryTextSticker, type StickerResponseValue } from "@/lib/stories";

const CARD: React.CSSProperties = { background: "#FFFFFF", borderRadius: 18, padding: "12px 14px", boxShadow: "0 10px 30px rgba(0,0,0,0.28)", color: "#0B1E3D", width: 250 };
const TITLE: React.CSSProperties = { fontSize: 15, fontWeight: 800, letterSpacing: -0.2, lineHeight: "19px", textAlign: "center", marginBottom: 10 };
const HINT: React.CSSProperties = { color: "rgba(11,30,61,0.55)", fontSize: 11.5, fontWeight: 600, textAlign: "center", marginTop: 6 };

function useMine(storyId: string, st: StoryTextSticker, isOwn: boolean) {
  const [mine, setMine] = useState<StickerResponseValue | null>(null);
  const [all, setAll] = useState<StickerResponseValue[]>([]);
  useEffect(() => {
    let dead = false;
    if (isOwn || st.kind === "quiz" || st.kind === "slider") getStickerResponses(storyId, st.id).then((r) => { if (!dead) setAll(r); }).catch(() => {});
    if (!isOwn) getMyStickerResponse(storyId, st.id).then((r) => { if (!dead) setMine(r); }).catch(() => {});
    return () => { dead = true; };
  }, [storyId, st.id, isOwn, st.kind]);
  return { mine, setMine, all, setAll };
}

export function QuestionCard({ st, storyId, isOwn }: { st: StoryTextSticker; storyId: string; isOwn: boolean }) {
  const { mine, setMine, all } = useMine(storyId, st, isOwn);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const v = text.trim(); if (!v || busy) return; setBusy(true);
    try { if (await submitStickerResponse(storyId, st.id, "question", { text_value: v })) { setMine({ text_value: v }); setText(""); } } finally { setBusy(false); }
  };
  return (
    <div className="pointer-events-auto" style={CARD}>
      <div style={{ ...TITLE, marginBottom: 8 }}>{st.questionPrompt || st.text || "Ask me anything"}</div>
      {isOwn ? <div style={HINT}>{all.length === 1 ? "1 answer" : all.length + " answers"}</div>
        : mine?.text_value ? <div style={{ ...HINT, color: "#0B1E3D", fontWeight: 700 }}>Sent: {mine.text_value}</div>
        : (
          <div style={{ display: "flex", gap: 6 }}>
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder="Type something..." style={{ flex: 1, minWidth: 0, border: "1.5px solid rgba(11,30,61,0.14)", borderRadius: 12, padding: "9px 11px", fontSize: 14, color: "#0B1E3D", background: "#F6F5F2", outline: "none" }} />
            <button type="button" onClick={send} disabled={!text.trim() || busy} style={{ border: 0, borderRadius: 12, padding: "0 14px", background: "#0B1E3D", color: "#FFF", fontWeight: 800, fontSize: 13, cursor: "pointer", opacity: text.trim() ? 1 : 0.4 }}>Send</button>
          </div>
        )}
    </div>
  );
}

export function QuizCard({ st, storyId, isOwn }: { st: StoryTextSticker; storyId: string; isOwn: boolean }) {
  const { mine, setMine, all } = useMine(storyId, st, isOwn);
  const [busy, setBusy] = useState(false);
  const opts = st.quizOptions || [];
  const counts = useMemo(() => { const c: Record<string, number> = {}; all.forEach((r) => { if (r.option_id) c[r.option_id] = (c[r.option_id] || 0) + 1; }); return c; }, [all]);
  const total = all.length;
  const revealed = isOwn || !!mine?.option_id;
  const pick = async (id: string) => {
    if (revealed || busy) return; setBusy(true);
    try { if (await submitStickerResponse(storyId, st.id, "quiz", { option_id: id })) setMine({ option_id: id }); } finally { setBusy(false); }
  };
  return (
    <div className="pointer-events-auto" style={CARD}>
      <div style={TITLE}>{st.quizQuestion || st.text}</div>
      {opts.map((o, i) => {
        const chosen = mine?.option_id === o.id;
        const bg = !revealed ? "#F6F5F2" : o.isCorrect ? "#DCF5E6" : chosen ? "#FBE1E1" : "#F6F5F2";
        const pct = total > 0 ? Math.round(((counts[o.id] || 0) / total) * 100) : null;
        return (
          <button key={o.id} type="button" onClick={() => pick(o.id)} disabled={revealed || busy} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", border: "1.5px solid rgba(11,30,61,0.14)", borderRadius: 12, background: bg, padding: "10px 12px", marginBottom: 8, cursor: revealed ? "default" : "pointer", textAlign: "left", color: "#0B1E3D", fontSize: 14, fontWeight: 600 }}>
            <span style={{ width: 24, height: 24, borderRadius: 12, background: "#0B1E3D", color: "#FFF", fontSize: 12, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{String.fromCharCode(65 + i)}</span>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
            {revealed && o.isCorrect ? <span style={{ fontWeight: 800 }}>{"\u2713"}</span> : null}
            {revealed && isOwn && pct != null ? <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>{pct}%</span> : null}
          </button>
        );
      })}
      {isOwn ? <div style={HINT}>{total === 1 ? "1 answer" : total + " answers"}</div> : null}
    </div>
  );
}

export function SliderCard({ st, storyId, isOwn }: { st: StoryTextSticker; storyId: string; isOwn: boolean }) {
  const { mine, setMine, all } = useMine(storyId, st, isOwn);
  const [val, setVal] = useState(50);
  const [busy, setBusy] = useState(false);
  const avg = useMemo(() => { const v = all.map((r) => r.number_value).filter((n): n is number => typeof n === "number"); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; }, [all]);
  const done = isOwn || typeof mine?.number_value === "number";
  const shown = typeof mine?.number_value === "number" ? mine.number_value : (isOwn && avg != null ? avg : val);
  const commit = async () => {
    if (done || busy) return; setBusy(true);
    try { if (await submitStickerResponse(storyId, st.id, "slider", { number_value: val })) setMine({ number_value: val }); } finally { setBusy(false); }
  };
  return (
    <div className="pointer-events-auto" style={CARD}>
      <div style={TITLE}>{st.sliderLabel || st.text || "Slide to rate"}</div>
      <div style={{ position: "relative", height: 34, display: "flex", alignItems: "center" }}>
        <div style={{ position: "absolute", left: 0, right: 0, height: 10, borderRadius: 5, background: "rgba(11,30,61,0.10)" }} />
        <div style={{ position: "absolute", left: 0, width: shown + "%", height: 10, borderRadius: 5, background: "linear-gradient(90deg,#C9BFB0,#E8A13A)" }} />
        <span style={{ position: "absolute", left: "calc(" + shown + "% - 16px)", fontSize: 26, lineHeight: "32px", transition: "left 120ms" }}>{st.sliderEmoji || "\uD83D\uDE0D"}</span>
        {!done ? <input type="range" min={0} max={100} value={val} onChange={(e) => setVal(Number(e.target.value))} onMouseUp={commit} onTouchEnd={commit} onKeyUp={(e) => { if (e.key === "Enter") commit(); }} style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer" }} /> : null}
      </div>
      <div style={HINT}>{isOwn ? (all.length ? all.length + (all.length === 1 ? " response" : " responses") + (avg != null ? " \u00B7 average " + avg + "%" : "") : "No responses yet") : done ? "You said " + shown + "%" : "Drag and release"}</div>
    </div>
  );
}

export function CountdownCard({ st }: { st: StoryTextSticker }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const target = st.countdownTarget ? new Date(st.countdownTarget).getTime() : NaN;
  const left = Number.isFinite(target) ? Math.max(0, target - now) : 0;
  const d = Math.floor(left / 86400000), h = Math.floor((left % 86400000) / 3600000), m = Math.floor((left % 3600000) / 60000), s = Math.floor((left % 60000) / 1000);
  const cell = (n: number, lb: string) => (<div key={lb} style={{ textAlign: "center", minWidth: 44 }}><div style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: "28px" }}>{String(n).padStart(2, "0")}</div><div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: "rgba(11,30,61,0.55)" }}>{lb}</div></div>);
  return (
    <div className="pointer-events-auto" style={{ ...CARD, width: 236 }}>
      <div style={{ ...TITLE, marginBottom: 6 }}>{st.countdownTitle || st.text || "Countdown"}</div>
      {!Number.isFinite(target) ? <div style={HINT}>No date set</div> : left <= 0 ? <div style={{ ...HINT, color: "#0B1E3D", fontWeight: 800 }}>It's here</div> : (
        <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>{[cell(d, "DAYS"), cell(h, "HRS"), cell(m, "MIN"), cell(s, "SEC")]}</div>
      )}
    </div>
  );
}
