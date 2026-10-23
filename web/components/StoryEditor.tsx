"use client";

import { useRef, useState, type ReactNode } from "react";
import type { StoryTextSticker } from "@/lib/stories";
import AppleMusicPicker from "@/components/AppleMusicPicker";

const KINDS = ["text", "emoji", "link", "question", "quiz", "slider", "countdown", "addyours", "hashtag", "location"] as const;
const buttonClass = "rounded-lg border border-ink/15 px-3 py-2 text-xs font-semibold text-ink disabled:opacity-40";
const inputClass = "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink";
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Editing metadata uses the same coordinate system and sticker shapes as mobile. */
export function StoryEditor({ children, value, onChange }: { children: ReactNode; value: StoryTextSticker[]; onChange: (stickers: StoryTextSticker[]) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [kind, setKind] = useState<typeof KINDS[number]>("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [options, setOptions] = useState("Yes\nNo");
  const [correct, setCorrect] = useState(0);
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<StoryTextSticker[][]>([]);
  const [future, setFuture] = useState<StoryTextSticker[][]>([]);
  const drag = useRef<{ id: string; start: StoryTextSticker[]; box: DOMRect } | null>(null);
  const active = value.find(s => s.id === selected);
  const commit = (next: StoryTextSticker[]) => { setHistory(h => [...h.slice(-29), value]); setFuture([]); onChange(next); };
  const update = (patch: Partial<StoryTextSticker>) => commit(value.map(s => s.id === selected ? { ...s, ...patch } : s));
  function add(extra?: Partial<StoryTextSticker>) {
    const label = extra?.text ?? text.trim();
    if (!label || value.length >= 30) { setError(value.length >= 30 ? "Use at most 30 stickers." : "Write the sticker text first."); return; }
    const sticker: StoryTextSticker = { id: crypto.randomUUID(), kind, text: label, style: "classic", color: "#FFFFFF", nx: .5, ny: .4, scale: 1, rotation: 0, bgEnabled: true };
    if (kind === "link" && !extra) {
      try { const parsed = new URL(url); if (!["https:", "http:"].includes(parsed.protocol)) throw new Error(); sticker.url = parsed.href; }
      catch { setError("Enter a complete https:// link."); return; }
    }
    if (kind === "question") sticker.questionPrompt = label;
    if (kind === "slider") { sticker.sliderLabel = label; sticker.sliderEmoji = "😍"; }
    if (kind === "hashtag") sticker.hashtag = label.replace(/^#/, "");
    if (kind === "location") { sticker.locationName = label; sticker.locationDisplayName = label; }
    if (kind === "quiz") {
      const labels = options.split("\n").map(s => s.trim()).filter(Boolean);
      if (labels.length < 2 || labels.length > 4 || correct >= labels.length) { setError("Enter 2 to 4 answers and select the correct answer."); return; }
      sticker.quizQuestion = label; sticker.quizOptions = labels.map((label, i) => ({ id: crypto.randomUUID(), label: label.slice(0, 80), isCorrect: i === correct }));
    }
    if (kind === "countdown") {
      const date = new Date(target);
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) { setError("Choose a future date and time."); return; }
      sticker.countdownTitle = label; sticker.countdownTarget = date.toISOString();
    }
    if (kind === "addyours") sticker.addYoursPrompt = label;
    const next = { ...sticker, ...extra }; commit([...value, next]); setSelected(next.id); setText(""); setError(null);
  }
  return <>
    <div className="relative aspect-[9/14] w-full overflow-hidden rounded-2xl bg-ink">
      {children}
      <div className="pointer-events-none absolute inset-0" aria-label="Story stickers">
        {value.map(s => <button key={s.id} type="button" aria-label={`Edit ${s.kind || "text"} sticker: ${s.text}`} aria-pressed={selected === s.id}
          className="pointer-events-auto absolute max-w-[80%] touch-none select-none whitespace-pre-wrap rounded-xl px-3 py-2 text-center text-base font-bold outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          style={{ left: `${s.nx * 100}%`, top: `${s.ny * 100}%`, transform: `translate(-50%,-50%) rotate(${s.rotation}deg) scale(${s.scale})`, color: s.color, background: s.bgEnabled ? "rgba(11,30,61,.85)" : "transparent", boxShadow: selected === s.id ? "0 0 0 2px #C9BFB0" : undefined }}
          onClick={() => setSelected(s.id)}
          onPointerDown={e => { if (e.button !== 0) return; setSelected(s.id); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: s.id, start: value, box: e.currentTarget.parentElement!.getBoundingClientRect() }; }}
          onPointerMove={e => { const d = drag.current; if (!d || d.id !== s.id || !e.currentTarget.hasPointerCapture(e.pointerId)) return; onChange(value.map(x => x.id === s.id ? { ...x, nx: clamp((e.clientX - d.box.left) / d.box.width, .05, .95), ny: clamp((e.clientY - d.box.top) / d.box.height, .05, .95) } : x)); }}
          onPointerUp={() => { if (drag.current) { const start = drag.current.start; setHistory(h => [...h.slice(-29), start]); setFuture([]); drag.current = null; } }}
          onPointerCancel={() => { if (drag.current) onChange(drag.current.start); drag.current = null; }}
          onKeyDown={e => { const offset = e.shiftKey ? .05 : .01; if (e.key.startsWith("Arrow")) { e.preventDefault(); setSelected(s.id); commit(value.map(x => x.id !== s.id ? x : { ...x, nx: clamp(x.nx + (e.key === "ArrowRight" ? offset : e.key === "ArrowLeft" ? -offset : 0), .05, .95), ny: clamp(x.ny + (e.key === "ArrowDown" ? offset : e.key === "ArrowUp" ? -offset : 0), .05, .95) })); } }}>
          {s.kind === "link" ? "↗ " : s.kind === "hashtag" ? "#" : ""}{s.text}
          {s.kind === "quiz" ? <span className="mt-2 block text-xs font-normal">{s.quizOptions?.map(o => o.label).join(" / ")}</span> : null}
          {s.kind === "slider" ? <span className="block">{s.sliderEmoji} ━━━━</span> : null}
          {s.kind === "addyours" ? <span className="block text-xs">Add yours</span> : null}
        </button>)}
      </div>
    </div>
    <div className="mt-3 space-y-3 rounded-xl border border-ink/10 p-3">
      <div className="flex flex-wrap items-center gap-2"><span className="mr-auto text-sm font-semibold text-ink">Stickers</span>
        <button type="button" className={buttonClass} disabled={!history.length} onClick={() => { setFuture(f => [...f, value]); onChange(history[history.length - 1]); setHistory(h => h.slice(0, -1)); }}>Undo</button>
        <button type="button" className={buttonClass} disabled={!future.length} onClick={() => { setHistory(h => [...h, value]); onChange(future[future.length - 1]); setFuture(f => f.slice(0, -1)); }}>Redo</button>
      </div>
      <div className="flex flex-wrap gap-2">{KINDS.map(k => <button key={k} type="button" className={buttonClass} aria-pressed={kind === k} onClick={() => setKind(k)}>{k === "addyours" ? "Add yours" : k[0].toUpperCase() + k.slice(1)}</button>)}</div>
      <label className="block text-xs text-muted">Sticker text<input className={inputClass} value={text} maxLength={200} onChange={e => setText(e.target.value)} /></label>
      {kind === "link" ? <label className="block text-xs text-muted">Link<input className={inputClass} type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" /></label> : null}
      {kind === "quiz" ? <><label className="block text-xs text-muted">Answers, one per line<textarea className={inputClass} value={options} onChange={e => setOptions(e.target.value)} /></label><label className="block text-xs text-muted">Correct answer<select className={inputClass} value={correct} onChange={e => setCorrect(Number(e.target.value))}>{options.split("\n").filter(x => x.trim()).slice(0, 4).map((x, i) => <option key={i} value={i}>{x}</option>)}</select></label></> : null}
      {kind === "countdown" ? <label className="block text-xs text-muted">Ends at, in your local time<input className={inputClass} type="datetime-local" value={target} onChange={e => setTarget(e.target.value)} /></label> : null}
      <button type="button" className={buttonClass} onClick={() => add()}>Add sticker</button>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {active ? <div className="space-y-2 border-t border-ink/10 pt-3">
        <p className="text-xs text-muted">Drag the selected sticker, or use the arrow keys.</p>
        <label className="block text-xs text-muted">Size<input aria-label="Sticker size" type="range" min={.5} max={2} step={.1} value={active.scale} onChange={e => update({ scale: Number(e.target.value) })} /></label>
        <label className="block text-xs text-muted">Rotation<input aria-label="Sticker rotation" type="range" min={-180} max={180} step={5} value={active.rotation} onChange={e => update({ rotation: Number(e.target.value) })} /></label>
        <label className="inline-flex items-center gap-2 text-xs text-muted">Colour<input aria-label="Sticker colour" type="color" value={active.color} onChange={e => update({ color: e.target.value })} /></label>
        <button type="button" className={buttonClass} onClick={() => { commit(value.filter(s => s.id !== active.id)); setSelected(null); }}>Remove sticker</button>
      </div> : null}
      <AppleMusicPicker onSelect={track => add({ kind: "link", text: `${track.title} · ${track.artist}`, url: track.url })} />
    </div>
  </>;
}
