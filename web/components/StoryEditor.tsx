"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { StoryTextSticker } from "@/lib/stories";
import { moveStorySticker, storyStickerLabel } from "../../shared/storyCanvas";
import AppleMusicPicker from "@/components/AppleMusicPicker";

import { StoryStickerPreview } from "@/components/StoryStickerPreview";
import { createClient } from "@/lib/supabase/client";
import { currentTextMentions, storyHandles } from "../../shared/storyMentions";

const KINDS = ["text", "emoji", "link", "question", "quiz", "slider", "countdown", "addyours", "hashtag", "location", "mention"] as const;
const buttonClass = "min-h-11 rounded-lg border border-ink/15 px-3 py-2 text-xs font-semibold text-ink disabled:opacity-40";
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
  const [people, setPeople] = useState<{ id: string; username: string; full_name: string | null }[]>([]);
  const [searching, setSearching] = useState(false);
  const mentionRequest = useRef(0);
  useEffect(() => {
    const request = ++mentionRequest.current; setPeople([]);
    if (kind !== "mention" || text.trim().length < 2) { setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      const q = text.replace(/^@/, "").replace(/[^A-Za-z0-9_. -]/g, "").slice(0, 60);
      void createClient().from("profiles").select("id,username,full_name").ilike("username", q + "%").limit(10).then(({ data, error }) => { if (request !== mentionRequest.current) return; setPeople(error ? [] : (data || []).filter(p => !!p.username)); setSearching(false); if (error) setError("People could not load. Try again."); });
    }, 250);
    return () => { clearTimeout(timer); ++mentionRequest.current; };
  }, [kind, text]);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<StoryTextSticker[][]>([]);
  const [future, setFuture] = useState<StoryTextSticker[][]>([]);
  const drag = useRef<{ id: string; start: StoryTextSticker[]; box: DOMRect; x: number; y: number; moved: boolean } | null>(null);
  const [guides, setGuides] = useState({ vertical: false, horizontal: false });
  const active = value.find(s => s.id === selected);
  const commit = (next: StoryTextSticker[]) => { setHistory(h => [...h.slice(-29), value]); setFuture([]); onChange(next); };
  const update = (patch: Partial<StoryTextSticker>) => commit(value.map(s => s.id === selected ? { ...s, ...patch } : s));
  async function add(extra?: Partial<StoryTextSticker>) {
    const request = mentionRequest.current;
    const label = extra?.text ?? text.trim();
    const stickerKind = extra?.kind ?? kind;
    if (!label || value.length >= 30) { setError(value.length >= 30 ? "Use at most 30 stickers." : "Write the sticker text first."); return; }
    const sticker: StoryTextSticker = { id: crypto.randomUUID(), kind: stickerKind, text: label, style: "classic", color: "#FFFFFF", nx: .5, ny: .4, scale: 1, rotation: 0, bgEnabled: true };
    if (stickerKind === "link" && !extra) {
      try { const parsed = new URL(url); if (!["https:", "http:"].includes(parsed.protocol)) throw new Error(); sticker.url = parsed.href; }
      catch { setError("Enter a complete https:// link."); return; }
    }
    if (stickerKind === "question") sticker.questionPrompt = label;
    if (stickerKind === "slider") { sticker.sliderLabel = label; sticker.sliderEmoji = "😍"; }
    if (stickerKind === "hashtag") sticker.hashtag = label.replace(/^#/, "");
    if (stickerKind === "location") { sticker.locationName = label; sticker.locationDisplayName = label; }
    if (stickerKind === "quiz") {
      const labels = options.split("\n").map(s => s.trim()).filter(Boolean);
      if (labels.length < 2 || labels.length > 4 || correct >= labels.length) { setError("Enter 2 to 4 answers and select the correct answer."); return; }
      sticker.quizQuestion = label; sticker.quizOptions = labels.map((label, i) => ({ id: crypto.randomUUID(), label: label.slice(0, 80), isCorrect: i === correct }));
    }
    if (stickerKind === "countdown") {
      const date = new Date(target);
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) { setError("Choose a future date and time."); return; }
      sticker.countdownTitle = label; sticker.countdownTarget = date.toISOString();
    }
    if (stickerKind === "addyours") sticker.addYoursPrompt = label;
    if (stickerKind === "mention" && !extra?.mentionUserId) { setError("Choose a person from the results."); return; }
    if (stickerKind === "text") {
      const handles = storyHandles(label);
      if (handles.length) {
        const { data, error: lookupError } = await createClient().from("profiles").select("id,username").in("username", handles);
        if (request !== mentionRequest.current) return;
        if (lookupError) { setError("Mentions could not be checked. Try again."); return; }
        sticker.mentions = (data || []).filter(p => !!p.username);
      }
    }
    const next = { ...sticker, ...extra }; commit([...value, next]); setSelected(next.id); setText(""); setError(null);
  }
  return <>
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl bg-ink">
      {children}
      {guides.vertical ? <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 z-10 w-px bg-white/80" /> : null}
      {guides.horizontal ? <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-px bg-white/80" /> : null}
      <div className="pointer-events-none absolute inset-0" aria-label="Story stickers">
        {value.map(s => <button key={s.id} type="button" aria-label={`Edit ${s.kind || "text"} sticker: ${s.text}`} aria-pressed={selected === s.id}
          className="pointer-events-auto absolute max-w-[80%] touch-none select-none whitespace-pre-wrap rounded-xl px-3 py-2 text-center text-base font-bold outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          style={{ left: `${s.nx * 100}%`, top: `${s.ny * 100}%`, transform: `translate(-50%,-50%) rotate(${s.rotation}rad) scale(${s.scale})`, color: s.color, background: "transparent", boxShadow: selected === s.id ? "0 0 0 2px #C9BFB0" : undefined }}
          onClick={() => setSelected(s.id)}
          onPointerDown={e => { if (e.button !== 0) return; setSelected(s.id); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: s.id, start: value, box: e.currentTarget.parentElement!.getBoundingClientRect(), x: e.clientX, y: e.clientY, moved: false }; }}
          onPointerMove={e => { const d = drag.current; if (!d || d.id !== s.id || !e.currentTarget.hasPointerCapture(e.pointerId)) return; const original = d.start.find(x => x.id === s.id)!; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (!d.moved && Math.hypot(dx, dy) < 3) return; d.moved = true; const next = moveStorySticker(original, dx, dy, d.box.width, d.box.height); setGuides({ vertical: next.vertical, horizontal: next.horizontal }); onChange(d.start.map(x => x.id === s.id ? { ...x, nx: next.nx, ny: next.ny } : x)); }}
          onPointerUp={() => { if (drag.current?.moved) { const start = drag.current.start; setHistory(h => [...h.slice(-29), start]); setFuture([]); } drag.current = null; setGuides({ vertical: false, horizontal: false }); }}
          onPointerCancel={() => { if (drag.current?.moved) onChange(drag.current.start); drag.current = null; setGuides({ vertical: false, horizontal: false }); }}
          onKeyDown={e => { if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); commit(value.filter(x => x.id !== s.id)); setSelected(null); return; } if (e.key === "Escape") { setSelected(null); return; } const offset = e.shiftKey ? .05 : .01; if (e.key.startsWith("Arrow")) { e.preventDefault(); setSelected(s.id); commit(value.map(x => x.id !== s.id ? x : { ...x, nx: clamp(x.nx + (e.key === "ArrowRight" ? offset : e.key === "ArrowLeft" ? -offset : 0), .05, .95), ny: clamp(x.ny + (e.key === "ArrowDown" ? offset : e.key === "ArrowUp" ? -offset : 0), .05, .95) })); } }}>
          <StoryStickerPreview sticker={s} />
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
      {kind === "mention" ? <div className="space-y-2" aria-live="polite">{searching ? <p className="text-xs text-muted">Finding people…</p> : people.map(person => <button key={person.id} type="button" className={buttonClass} onClick={() => void add({ kind: "mention", text: "@" + person.username, mentionUserId: person.id, mentionUsername: person.username })}>{person.full_name || person.username} · @{person.username}</button>)}</div> : null}
      <button type="button" className={buttonClass} onClick={() => void add()}>Add sticker</button>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {active ? <div className="space-y-2 border-t border-ink/10 pt-3">
        <p className="text-xs text-muted">Drag or use arrow keys to move. Hold Shift for larger steps. Centre guides appear as you drag.</p>
        <label className="block text-xs text-muted">Edit selected text<input className={inputClass} maxLength={200} value={active.text} onChange={e => { const patch = storyStickerLabel(active.kind, e.target.value); update({ ...patch, mentions: currentTextMentions({ ...active, ...patch }) }); }} /></label>
        <label className="flex min-h-11 items-center gap-2 text-xs text-muted"><input type="checkbox" checked={!!active.bgEnabled} onChange={e => update({ bgEnabled: e.target.checked })} />Readable background</label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} onClick={() => update({ nx: .5, ny: .5 })}>Centre</button>
          <button type="button" className={buttonClass} disabled={value[value.length - 1]?.id === active.id} onClick={() => commit([...value.filter(s => s.id !== active.id), active])}>Bring to front</button>
          <button type="button" className={buttonClass} disabled={value[0]?.id === active.id} onClick={() => commit([active, ...value.filter(s => s.id !== active.id)])}>Send to back</button>
        </div>
        <label className="block text-xs text-muted">Size<input aria-label="Sticker size" type="range" min={.5} max={2} step={.1} value={active.scale} onChange={e => update({ scale: Number(e.target.value) })} /></label>
        <label className="block text-xs text-muted">Rotation<input aria-label="Sticker rotation" type="range" min={-180} max={180} step={5} value={Math.round(active.rotation * 180 / Math.PI)} onChange={e => update({ rotation: Number(e.target.value) * Math.PI / 180 })} /></label>
        <label className="inline-flex items-center gap-2 text-xs text-muted">Colour<input aria-label="Sticker colour" type="color" value={active.color} onChange={e => update({ color: e.target.value })} /></label>
        <button type="button" className={buttonClass} onClick={() => { commit(value.filter(s => s.id !== active.id)); setSelected(null); }}>Remove sticker</button>
      </div> : null}
      <AppleMusicPicker onSelect={track => add({ kind: "link", text: `${track.title} · ${track.artist}`, url: track.url })} />
    </div>
  </>;
}
