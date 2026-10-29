"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { StoryTextSticker } from "@/lib/stories";
import { moveStorySticker, storyStickerLabel } from "../../shared/storyCanvas";
import { MUSIC_CATALOG_ENABLED } from "../../shared/musicAvailability";
import { ArrowRight, ChevronDown, Globe2, Link2, MapPin, Music, MoreHorizontal, Pause, Pencil, Play, Plus, Redo2, Search, SlidersHorizontal, Smile, Star, Type, Undo2, Volume2, X } from "lucide-react";
import studio from "./StoryStudio.module.css";
import { stickerCss } from "./storyTextAppearance";
import { DrawSvg, extraFontCss, STICKER_ANIM_CSS } from "./StoryEngine";

import { StoryStickerPreview } from "@/components/StoryStickerPreview";
import { createClient } from "@/lib/supabase/client";
import { currentTextMentions, storyHandles } from "../../shared/storyMentions";
import { useStoryPostEditorFit } from "./useStoryPostEditorFit";

const KINDS = ["text", "emoji", "link", "question", "quiz", "slider", "countdown", "addyours", "hashtag", "location", "mention"] as const;
const buttonClass = studio.button;
const inputClass = studio.input;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Editing metadata uses the same coordinate system and sticker shapes as mobile. */
export function StoryEditor({ children, value, onChange, onNext, onOpenEdit, onClose, audience = "Everyone", onAudience, thumbnail, clips, onSelectClip, onRemoveClip, onAddClip, onOpenMusic, onOpenTiming, onOpenDraw, duration = 15, clock, onTogglePreview, previewPlaying = false }: {
  children: ReactNode; value: StoryTextSticker[]; onChange: (stickers: StoryTextSticker[]) => void;
  onNext?: () => void; onOpenEdit?: () => void; onClose?: () => void; audience?: string; onAudience?: () => void; thumbnail?: ReactNode;
  clips?: { id: string; thumbnail: ReactNode; selected: boolean }[]; onSelectClip?: (id: string) => void; onRemoveClip?: (id: string) => void; onAddClip?: () => void;
  onOpenMusic?: () => void; onOpenTiming?: () => void; onOpenDraw?: () => void; duration?: number; clock?: number; onTogglePreview?: () => void; previewPlaying?: boolean;
}) {
  const { stageRef, topbarRef, dockRef, keepOwnerPlacement } = useStoryPostEditorFit(value, onChange);
  const [panel, setPanel] = useState<"none" | "gallery" | "add" | "selected">("none");
  const [galleryTab, setGalleryTab] = useState<"foryou" | "saved" | "recent">("foryou");
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [textTab, setTextTab] = useState<"font" | "color" | "style" | "animate">("font");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragged = useRef(false);
  const textSession = useRef<StoryTextSticker[] | null>(null);
  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    if (panel === "none") return;
    const sync = () => setViewport(window.visualViewport ? { height: window.visualViewport.height, top: window.visualViewport.offsetTop } : null);
    sync(); window.visualViewport?.addEventListener("resize", sync); window.visualViewport?.addEventListener("scroll", sync);
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; window.visualViewport?.removeEventListener("resize", sync); window.visualViewport?.removeEventListener("scroll", sync); };
  }, [panel]);
  useEffect(() => {
    const read = (key: string) => { try { const v: unknown = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && KINDS.includes(x as typeof KINDS[number])).slice(0, 20) : []; } catch { return []; } };
    setFavorites(read("pc.story.stickers.saved.v1")); setRecents(read("pc.story.stickers.recent.v1"));
  }, []);
  useEffect(() => {
    if (panel === "none") return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => (panelRef.current?.querySelector<HTMLElement>(panel === "selected" ? "textarea" : "input") || panelRef.current?.querySelector<HTMLElement>("textarea,input,button"))?.focus());
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); if (textSession.current) { latestChange.current(textSession.current); textSession.current = null; } setPanel("none"); }
      if (e.key !== "Tab") return;
      const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]') || []).filter(x => x.offsetParent !== null);
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keys);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", keys); previous?.focus(); };
  }, [panel]);
  const persist = (key: string, next: string[]) => { try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* A private browser can still use the current session. */ } };
  const openKind = (next: typeof KINDS[number]) => {
    setKind(next); setText(""); setError(null);
    if (next === "text") {
      if (value.length >= 30) { setError("Use at most 30 stickers."); return; }
      const sticker: StoryTextSticker = { id: crypto.randomUUID(), kind: "text", text: "", style: "classic", color: "#FFFFFF", nx: .5, ny: .28, scale: 1, rotation: 0, bgEnabled: false, fontSizeOverride: 28 };
      textSession.current = value; onChange([...value, sticker]); setSelected(sticker.id); setTextTab("font"); setPanel("selected");
    } else setPanel("add");
  };
  const toggleFavorite = (item: string) => setFavorites(current => { const next = current.includes(item) ? current.filter(x => x !== item) : [...current, item]; persist("pc.story.stickers.saved.v1", next); return next; });
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
  const latestValue = useRef(value); latestValue.current = value;
  const latestChange = useRef(onChange); latestChange.current = onChange;
  const textSignature = value.filter(s => !s.kind || s.kind === "text").map(s => `${s.id}:${s.text}`).join("\n");
  useEffect(() => {
    let cancelled = false;
    const textStickers = latestValue.current.filter(s => !s.kind || s.kind === "text");
    const handles = [...new Set(textStickers.flatMap(s => storyHandles(s.text)))];
    if (!handles.length) return;
    const timer = setTimeout(() => {
      void createClient().from("profiles").select("id,username").in("username", handles).then(({ data, error }) => {
        if (cancelled || error) return;
        latestChange.current(latestValue.current.map(s => {
          if (!textStickers.some(original => original.id === s.id && original.text === s.text)) return s;
          return { ...s, mentions: currentTextMentions({ text: s.text, mentions: data || [] }) };
        }));
      });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [textSignature]);
  const active = value.find(s => s.id === selected);
  const editableText = !active?.kind || active.kind === "text" || active.kind === "emoji";
  const commit = (next: StoryTextSticker[]) => { if (!(panel === "selected" && editableText && textSession.current)) { setHistory(h => [...h.slice(-29), value]); setFuture([]); } onChange(next); };
  const update = (patch: Partial<StoryTextSticker>) => { if (selected && ('nx' in patch || 'ny' in patch || 'scale' in patch || 'rotation' in patch)) keepOwnerPlacement(selected); commit(value.map(s => s.id === selected ? { ...s, ...patch } : s)); };
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
    const next = { ...sticker, ...extra }; commit([...value, next]); setSelected(next.id); setText(""); setError(null); setPanel("selected");
    setRecents(current => { const items = [stickerKind, ...current.filter(x => x !== stickerKind)].slice(0, 20); persist("pc.story.stickers.recent.v1", items); return items; });
  }
  const finishText = (save: boolean) => { const start = textSession.current; if (!save && start) onChange(start); else { const next = value.filter(s => s.id !== selected || !!s.kind && s.kind !== "text" && s.kind !== "emoji" || s.text.trim()); if (start && JSON.stringify(start) !== JSON.stringify(next)) { setHistory(h => [...h.slice(-29), start]); setFuture([]); } onChange(next); } textSession.current = null; setPanel("none"); };
  const label = (item: string) => item === "luxury" ? "Editorial" : item === "typewriter" ? "Mono" : item === "addyours" ? "Add yours" : item[0].toUpperCase() + item.slice(1);
  const galleryKinds = (galleryTab === "saved" ? KINDS.filter(k => favorites.includes(k)) : galleryTab === "recent" ? recents.filter(k => KINDS.includes(k as typeof KINDS[number])) as (typeof KINDS[number])[] : ["location", "mention", "question", "quiz", "link", "slider", "countdown", "addyours", "hashtag", "emoji", "text"] as const).filter(k => label(k).toLowerCase().includes(search.toLowerCase()));
  const undo = () => { keepOwnerPlacement(); setFuture(f => [...f, value]); onChange(history[history.length - 1]); setHistory(h => h.slice(0, -1)); };
  const redo = () => { keepOwnerPlacement(); setHistory(h => [...h, value]); onChange(future[future.length - 1]); setFuture(f => f.slice(0, -1)); };
  return <div className={studio.studio}>
    <style>{STICKER_ANIM_CSS}</style>
    <div ref={stageRef} className={studio.stage} data-story-stage>
      <div className={studio.stageMedia}>{children}</div>
      <DrawSvg stickers={value} />
      {guides.vertical ? <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 z-10 w-px bg-white/80" /> : null}
      {guides.horizontal ? <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-px bg-white/80" /> : null}
      <div className="pointer-events-none absolute inset-0 z-[2]" aria-label="Story stickers">
        {value.filter(s => s.kind !== "drawing" && !(panel === "selected" && editableText && s.id === selected) && (clock == null || (s.startSec == null || clock >= s.startSec) && (s.endSec == null || clock <= s.endSec))).map(s => <button key={s.id} type="button" data-story-post-id={s.kind === "post" ? s.id : undefined} aria-label={`Edit ${s.kind || "text"} sticker: ${s.text}`} aria-pressed={selected === s.id}
          className="pointer-events-auto absolute max-w-[80%] touch-none select-none whitespace-pre-wrap rounded-xl px-3 py-2 text-center text-base font-bold outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          style={{ maxWidth: s.kind === "post" ? "100%" : undefined, padding: s.kind === "post" ? 0 : undefined, left: `${s.nx * 100}%`, top: `${s.ny * 100}%`, transform: `translate(-50%,-50%) rotate(${s.rotation}rad) scale(${s.scale})`, color: s.color, background: "transparent", boxShadow: selected === s.id ? "0 0 0 2px #E8D3B6" : undefined }}
          onClick={() => { if (dragged.current) { dragged.current = false; return; } textSession.current = value; setSelected(s.id); setTextTab("font"); setPanel("selected"); }}
          onPointerDown={e => { if (e.button !== 0) return; keepOwnerPlacement(s.id); dragged.current = false; setSelected(s.id); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: s.id, start: value, box: e.currentTarget.parentElement!.getBoundingClientRect(), x: e.clientX, y: e.clientY, moved: false }; }}
          onPointerMove={e => { const d = drag.current; if (!d || d.id !== s.id || !e.currentTarget.hasPointerCapture(e.pointerId)) return; const original = d.start.find(x => x.id === s.id)!; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (!d.moved && Math.hypot(dx, dy) < 3) return; d.moved = true; const next = moveStorySticker(original, dx, dy, d.box.width, d.box.height); setGuides({ vertical: next.vertical, horizontal: next.horizontal }); onChange(d.start.map(x => x.id === s.id ? { ...x, nx: next.nx, ny: next.ny } : x)); }}
          onPointerUp={() => { if (drag.current?.moved) { dragged.current = true; const start = drag.current.start; setHistory(h => [...h.slice(-29), start]); setFuture([]); } drag.current = null; setGuides({ vertical: false, horizontal: false }); }}
          onPointerCancel={() => { if (drag.current?.moved) onChange(drag.current.start); drag.current = null; setGuides({ vertical: false, horizontal: false }); }}
          onKeyDown={e => { if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); commit(value.filter(x => x.id !== s.id)); setSelected(null); return; } if (e.key === "Escape") { setSelected(null); return; } const offset = e.shiftKey ? .05 : .01; if (e.key.startsWith("Arrow")) { e.preventDefault(); keepOwnerPlacement(s.id); setSelected(s.id); commit(value.map(x => x.id !== s.id ? x : { ...x, nx: clamp(x.nx + (e.key === "ArrowRight" ? offset : e.key === "ArrowLeft" ? -offset : 0), .05, .95), ny: clamp(x.ny + (e.key === "ArrowDown" ? offset : e.key === "ArrowUp" ? -offset : 0), .05, .95) })); } }}>
          <StoryStickerPreview sticker={s} />
        </button>)}
      </div>
      <div ref={topbarRef} className={studio.topbar}>
        {onClose ? <button type="button" className={studio.icon} aria-label="Remove current story media" onClick={onClose}><X size={21} /></button> : null}
        <span className={studio.topbarSpacer} />
        <button type="button" className={studio.icon} aria-label="Add story text" onClick={() => openKind("text")}><Type size={22} /></button>
        <button type="button" className={studio.icon} aria-label="Open story stickers" onClick={() => { setPanel("gallery"); setError(null); }}><Smile size={22} /></button>
        {onOpenMusic ? <button type="button" className={studio.icon} aria-label={MUSIC_CATALOG_ENABLED ? "Choose story music or original audio" : "Adjust original video sound"} onClick={onOpenMusic}>{MUSIC_CATALOG_ENABLED ? <Music size={21} /> : <Volume2 size={21} />}</button> : null}
        {onOpenEdit ? <button type="button" className={studio.icon} aria-label="Edit story media" onClick={onOpenEdit}><MoreHorizontal size={23} /></button> : null}
      </div>
      {onTogglePreview ? <button type="button" className={`${studio.icon} ${studio.previewPlay}`} aria-label={previewPlaying ? "Pause story preview" : "Play story preview"} onClick={onTogglePreview}>{previewPlaying ? <Pause size={19} /> : <Play size={19} />}</button> : null}
      {history.length || future.length ? <div className={studio.history}><button type="button" className={studio.icon} aria-label="Undo story edit" disabled={!history.length} onClick={undo}><Undo2 size={18} /></button><button type="button" className={studio.icon} aria-label="Redo story edit" disabled={!future.length} onClick={redo}><Redo2 size={18} /></button></div> : null}
      <div ref={dockRef} className={studio.dock}>
        <div className={studio.dockTop}><div className={studio.filmstrip}>{clips?.length ? clips.map((clip, index) => <div className={studio.filmstripItem} key={clip.id}><button type="button" className={studio.thumb} aria-label={`Edit story clip ${index + 1}`} aria-current={clip.selected} onClick={() => onSelectClip?.(clip.id)}>{clip.thumbnail}</button>{onRemoveClip && clips.length > 1 ? <button type="button" aria-label={`Remove story clip ${index + 1}`} className={studio.clipRemove} onClick={() => onRemoveClip(clip.id)}><X size={11} /></button> : null}</div>) : <span className={studio.thumb}>{thumbnail || "Aa"}</span>}{onAddClip ? <button type="button" className={studio.addClip} aria-label="Add story clips" onClick={onAddClip}><Plus size={24} /></button> : null}</div>{onAudience ? <button type="button" className={studio.audience} onClick={onAudience}><Globe2 size={15} />{audience}<ChevronDown size={14} /></button> : null}</div>
        <div className={studio.dockTools} style={{ overflowX: "auto", paddingBottom: 2 }}>
          <button type="button" className={studio.dockTool} onClick={() => openKind("text")}><Type size={24} />Text</button>
          <button type="button" className={studio.dockTool} onClick={() => { setPanel("gallery"); setError(null); }}><Smile size={24} />Stickers</button>
          {onOpenMusic ? <button type="button" className={studio.dockTool} onClick={onOpenMusic}>{MUSIC_CATALOG_ENABLED ? <><Music size={23} />Music</> : <><Volume2 size={23} />Sound</>}</button> : null}
          {onOpenDraw ? <button type="button" className={studio.dockTool} aria-label="Draw on story" onClick={onOpenDraw}><Pencil size={22} />Draw</button> : null}
          {onOpenEdit ? <button type="button" className={studio.dockTool} onClick={onOpenEdit}><SlidersHorizontal size={22} />Edit</button> : null}
          {onNext ? <button type="button" className={`${studio.primary} ${studio.next}`} onClick={onNext}>Next<ArrowRight size={18} /></button> : null}
        </div>
      </div>
    </div>
    {panel === "selected" && editableText && active ? <div className={studio.textOverlay} style={viewport ? { height: viewport.height, top: viewport.top, bottom: 'auto' } : undefined}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Edit story text" className={studio.textStudio}>
        <div className={studio.textHeader}><button type="button" onClick={() => finishText(false)}>Cancel</button><button type="button" className={studio.primary} aria-label="Done editing sticker" onClick={() => finishText(true)}>Done</button></div>
        <div className={studio.textCanvas}><textarea aria-label="Story text" autoFocus value={active.text} maxLength={200} placeholder="Type here" rows={2} className={studio.canvasInput} style={{ ...stickerCss(active), ...extraFontCss(active.style), fontSize: active.fontSizeOverride || 28, textAlign: active.textAlign || 'center', opacity: active.opacity ?? 1 }} onChange={e => { const patch = storyStickerLabel(active.kind, e.target.value); update({ ...patch, mentions: currentTextMentions({ ...active, ...patch }) }); }} /></div>
        <div className={studio.textControls}>
          <div role="tablist" aria-label="Text tools" className={studio.tabs}>{(['font','color','style','animate'] as const).map(tab => <button type="button" role="tab" aria-selected={textTab === tab} key={tab} className={studio.tab} onPointerDown={e => e.preventDefault()} onClick={() => setTextTab(tab)}>{label(tab)}</button>)}</div>
          {textTab === 'font' ? <><div className={studio.fontStrip}>{['classic','luxury','bold','typewriter','signature','neon','outline'].map(font => <button type="button" key={font} className={studio.fontChoice} aria-pressed={active.style === font} style={extraFontCss(font)} onPointerDown={e => e.preventDefault()} onClick={() => update({ style: font })}>{label(font)}</button>)}</div><div className={studio.textSize}><button type="button" className={studio.button} aria-label={`Text alignment: ${active.textAlign || 'center'}`} onPointerDown={e => e.preventDefault()} onClick={() => update({ textAlign: active.textAlign === 'left' ? 'center' : active.textAlign === 'right' ? 'left' : 'right' })}>☰</button><input aria-label="Text size" type="range" min={12} max={72} step={1} value={active.fontSizeOverride || 28} onChange={e => update({ fontSizeOverride: Number(e.target.value) })} /><span>{active.fontSizeOverride || 28}</span></div></> : null}
          {textTab === 'color' ? <><div className={studio.colorStrip}>{['#FFFFFF','#F1DFC5','#F49C84','#C4CEB5','#A7C3D0','#0B1E3D','#111518'].map(color => <button type="button" key={color} className={studio.swatch} aria-label={`Text color ${color}`} aria-pressed={active.color.toUpperCase() === color} style={{ background: color }} onPointerDown={e => e.preventDefault()} onClick={() => update({ color })} />)}<input aria-label="Sticker colour" type="color" value={active.color} onChange={e => update({ color: e.target.value })} /></div><label className={studio.textSize}>Opacity<input aria-label="Text opacity" type="range" min={.2} max={1} step={.05} value={active.opacity ?? 1} onChange={e => update({ opacity: Number(e.target.value) })} /><span>{Math.round((active.opacity ?? 1) * 100)}%</span></label></> : null}
          {textTab === 'style' ? <><div className={studio.fontStrip}><button type="button" className={studio.button} aria-pressed={!!active.bgEnabled} onPointerDown={e => e.preventDefault()} onClick={() => update({ bgEnabled: !active.bgEnabled })}>Readable background</button>{(['left','center','right'] as const).map(textAlign => <button type="button" key={textAlign} className={studio.button} aria-pressed={(active.textAlign || 'center') === textAlign} onClick={() => update({ textAlign })}>Align {textAlign}</button>)}</div><label className={studio.textSize}>Rotate<input aria-label="Sticker rotation" type="range" min={-180} max={180} step={5} value={Math.round(active.rotation * 180 / Math.PI)} onChange={e => update({ rotation: Number(e.target.value) * Math.PI / 180 })} /><span>{Math.round(active.rotation * 180 / Math.PI)}°</span></label></> : null}
          {textTab === 'animate' ? <div className={studio.fontStrip}>{['none','fade','pop','bounce','rise','slide','zoom'].map(anim => <button type="button" key={anim} className={studio.button} aria-pressed={(active.anim || 'none') === anim} onPointerDown={e => e.preventDefault()} onClick={() => update({ anim })}>{label(anim)}</button>)}</div> : null}
          <div className={studio.textUtilities}>{onOpenTiming ? <button type="button" onClick={() => { finishText(true); onOpenTiming(); }}>Timing & layers</button> : null}<button type="button" onClick={() => { const before = textSession.current || value; textSession.current = null; setHistory(h => [...h.slice(-29), before]); setFuture([]); onChange(value.filter(s => s.id !== active.id)); setSelected(null); setPanel("none"); }}>Remove text</button></div>
        </div>
      </div>
    </div> : panel !== "none" ? <div className={studio.overlay} onPointerDown={e => { if (e.target === e.currentTarget) setPanel("none"); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={panel === "gallery" ? "Stickers" : panel === "add" ? `Add ${label(kind)}` : "Edit sticker"} className={studio.sheet}>
        <div className={studio.handle} />
        <div className={studio.sheetHeader}><h2 className={studio.sheetTitle}>{panel === "gallery" ? "Stickers" : panel === "add" ? label(kind) : active?.kind === "text" || !active?.kind ? "Edit text" : "Edit sticker"}</h2><button type="button" className={panel === "selected" ? studio.primary : studio.icon} onClick={() => setPanel("none")} aria-label={panel === "selected" ? "Done editing sticker" : "Close stickers"}>{panel === "selected" ? "Done" : <X size={20} />}</button></div>
        {panel === "gallery" ? <>
          <label className={studio.search}><Search size={18} /><input aria-label="Search stickers" placeholder="Search stickers" value={search} onChange={e => setSearch(e.target.value)} /></label>
          <div role="tablist" aria-label="Sticker collections" className={studio.tabs}>{([['foryou','For you'],['saved','Saved'],['recent','Recent']] as const).map(([id,title]) => <button type="button" role="tab" aria-selected={galleryTab === id} key={id} className={studio.tab} onClick={() => setGalleryTab(id)}>{title}</button>)}</div>
          <div className={studio.gallery}>{galleryKinds.map(k => <div className={studio.galleryItem} key={k}><button type="button" className={studio.galleryPick} onClick={() => openKind(k)}><span className={studio.galleryPreview} data-kind={k}>{k === "location" ? <><MapPin size={18} />Location</> : k === "mention" ? "@ Mention" : k === "link" ? <><Link2 size={20} />Add a link<small>Share something good</small></> : k === "question" ? <>Ask me anything<small>Type something…</small></> : k === "quiz" ? <>Quick question<small>A · Your first answer</small></> : k === "slider" ? <>How much?<span className={studio.previewSlider} /></> : k === "countdown" ? <>COUNTDOWN<small>DD : HH : MM</small></> : k === "addyours" ? <>Your turn<small>＋ Add yours</small></> : k === "emoji" ? <span style={{ fontSize: 32 }}>☺</span> : k === "hashtag" ? "# Hashtag" : "Aa"}</span><span>{label(k)}</span></button><button type="button" aria-label={`${favorites.includes(k) ? "Unsave" : "Save"} ${label(k)} sticker`} aria-pressed={favorites.includes(k)} className={studio.galleryStar} onClick={() => toggleFavorite(k)}><Star size={14} fill={favorites.includes(k) ? "currentColor" : "none"} /></button></div>)}</div>
          {!galleryKinds.length ? <p className={studio.empty}>{search ? "No matching stickers. Try another search." : galleryTab === "saved" ? "Tap the star on a sticker to save it here." : "Stickers you add will appear here."}</p> : null}
        </> : null}
        {panel === "add" ? <>
          <label className={studio.field}>{kind === "mention" ? "Find a person" : kind === "text" ? "Your words" : "Sticker text"}<textarea className={inputClass} value={text} maxLength={200} placeholder={kind === "text" ? "Make it a moment…" : kind === "mention" ? "Search by username" : "Write something…"} onChange={e => setText(e.target.value)} /></label>
          {kind === "link" ? <label className={studio.field}>Link<input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" /></label> : null}
          {kind === "quiz" ? <><label className={studio.field}>Answers, one per line<textarea value={options} onChange={e => setOptions(e.target.value)} /></label><label className={studio.field}>Correct answer<select value={correct} onChange={e => setCorrect(Number(e.target.value))}>{options.split("\n").filter(x => x.trim()).slice(0, 4).map((x, i) => <option key={i} value={i}>{x}</option>)}</select></label></> : null}
          {kind === "countdown" ? <label className={studio.field}>Ends at, in your local time<input type="datetime-local" value={target} onChange={e => setTarget(e.target.value)} /></label> : null}
          {kind === "mention" ? <div className={studio.row} aria-live="polite">{searching ? <p className={studio.note}>Finding people…</p> : people.map(person => <button key={person.id} type="button" className={buttonClass} onClick={() => void add({ kind: "mention", text: "@" + person.username, mentionUserId: person.id, mentionUsername: person.username })}>{person.full_name || person.username} · @{person.username}</button>)}</div> : <button type="button" className={studio.primary} onClick={() => void add()}>Add to story<ArrowRight size={17} /></button>}
        </> : null}
        {panel === "selected" && active ? <>
          {active.kind === "post" || active.kind === "story" ? <p className={studio.note}>This card stays linked to the original. Drag it on the canvas to move it, or adjust its size and rotation below.</p> : <label className={studio.field}>Your words<textarea maxLength={200} value={active.text} onChange={e => { const patch = storyStickerLabel(active.kind, e.target.value); update({ ...patch, mentions: currentTextMentions({ ...active, ...patch }) }); }} /></label>}
          {editableText ? <div role="tablist" aria-label="Text tools" className={studio.tabs}>{([['font','Font'],['color','Color'],['style','Style'],['animate','Animate']] as const).map(([id,title]) => <button type="button" role="tab" aria-selected={textTab === id} key={id} className={studio.tab} onClick={() => setTextTab(id)}>{title}</button>)}</div> : null}
          {editableText && textTab === "font" ? <><div className={studio.row}>{["classic", "bold", "luxury", "signature", "typewriter", "neon", "outline"].map(font => <button type="button" key={font} className={`${studio.button} ${studio.font}`} aria-pressed={active.style === font} style={extraFontCss(font)} onClick={() => update({ style: font })}>{label(font)}</button>)}</div><label className={studio.field}>Size<input aria-label="Sticker size" type="range" min={.5} max={2} step={.1} value={active.scale} onChange={e => update({ scale: Number(e.target.value) })} /></label></> : null}
          {editableText && textTab === "color" ? <><div className={studio.row}>{["#FFFFFF", "#E8D3B6", "#F2AF99", "#C5CEB4", "#A7C3D0", "#0B1E3D"].map(color => <button type="button" key={color} className={studio.swatch} aria-label={`Text color ${color}`} aria-pressed={active.color.toUpperCase() === color} style={{ background: color }} onClick={() => update({ color })} />)}<label className={studio.field}>Custom<input aria-label="Sticker colour" type="color" value={active.color} onChange={e => update({ color: e.target.value })} /></label></div><label className={studio.field}>Opacity<input aria-label="Text opacity" type="range" min={.2} max={1} step={.05} value={active.opacity ?? 1} onChange={e => update({ opacity: Number(e.target.value) })} /></label></> : null}
          {editableText && textTab === "style" ? <><div className={studio.row}><button type="button" className={buttonClass} aria-pressed={!!active.bgEnabled} onClick={() => update({ bgEnabled: !active.bgEnabled })}>Readable background</button>{(["left", "center", "right"] as const).map(textAlign => <button type="button" key={textAlign} className={buttonClass} aria-pressed={(active.textAlign || "center") === textAlign} onClick={() => update({ textAlign })}>Align {textAlign}</button>)}</div><label className={studio.field}>Rotation<input aria-label="Sticker rotation" type="range" min={-180} max={180} step={5} value={Math.round(active.rotation * 180 / Math.PI)} onChange={e => update({ rotation: Number(e.target.value) * Math.PI / 180 })} /></label></> : null}
          {editableText && textTab === "animate" ? <div className={studio.row}>{["none", "fade", "pop", "bounce", "rise", "slide", "zoom"].map(anim => <button type="button" key={anim} className={buttonClass} aria-pressed={(active.anim || "none") === anim} onClick={() => update({ anim })}>{label(anim)}</button>)}</div> : null}
          {!editableText ? <><label className={studio.field}>Size<input aria-label="Sticker size" type="range" min={.5} max={2} step={.1} value={active.scale} onChange={e => update({ scale: Number(e.target.value) })} /></label><label className={studio.field}>Rotation<input aria-label="Sticker rotation" type="range" min={-180} max={180} step={5} value={Math.round(active.rotation * 180 / Math.PI)} onChange={e => update({ rotation: Number(e.target.value) * Math.PI / 180 })} /></label></> : null}
          <div className={studio.row}><button type="button" className={buttonClass} onClick={() => update({ nx: .5, ny: .4 })}>Centre</button><button type="button" className={buttonClass} disabled={value[value.length - 1]?.id === active.id} onClick={() => commit([...value.filter(s => s.id !== active.id), active])}>Bring to front</button><button type="button" className={buttonClass} disabled={value[0]?.id === active.id} onClick={() => commit([active, ...value.filter(s => s.id !== active.id)])}>Send to back</button><button type="button" className={buttonClass} onClick={() => { commit(value.filter(s => s.id !== active.id)); setSelected(null); setPanel("none"); }}>Remove sticker</button></div>
          <p className={studio.note}>Drag on the canvas to move. Use arrow keys for precise placement, or hold Shift for larger steps.</p>
        </> : null}
        {error ? <p role="alert" className={studio.error}>{error}</p> : null}
      </div>
    </div> : null}
  </div>;
}
