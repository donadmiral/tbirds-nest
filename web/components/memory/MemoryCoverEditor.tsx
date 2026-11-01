'use client';
import NextImage from 'next/image';
import {useEffect, useRef, useState, type PointerEvent} from 'react';
import {MemoryBookCover, type MemoryBookCoverProps} from './MemoryBookCover';
import {MemoryCoverInk} from './MemoryCoverInk';
import {memoryCoverMedia, type MemoryCoverPage} from '../../../shared/memoryBookDesign';
import {
  personalizeMemoryCover, MEMORY_COVER_DRAWING_COLORS, MEMORY_COVER_MAX_PHOTOS,
  MEMORY_COVER_MAX_STROKES, MEMORY_COVER_MAX_POINTS, MEMORY_COVER_MAX_STROKE_POINTS,
  type MemoryCoverArtwork, type MemoryCoverStroke,
} from '../../../shared/memoryBookCreative';

type Props = Omit<MemoryBookCoverProps, 'artwork'|'width'|'height'> & {
  value: MemoryCoverArtwork; onChange: (value: MemoryCoverArtwork) => void;
  coverPages: readonly MemoryCoverPage[]; selectedCoverId?: string | null;
  onSelectCover: (id: string) => void; disabled?: boolean;
};
const PAPER_COLORS = ['#F5F0E4', '#FBE3EA', '#E4EEE2', '#E2EEF6', '#ECE7F7', '#F5E5A5', '#24272A'];
function CoverThumbnail({page}: {page: MemoryCoverPage}) {
  const media = memoryCoverMedia(page), [failed, setFailed] = useState<string[]>([]);
  const photo = [media.photoUrl, media.fallbackPhotoUrl].find(url => url && !failed.includes(url));
  if (photo) return <NextImage unoptimized fill sizes="80px" src={photo} alt="" draggable={false} style={{objectFit: 'cover'}} onError={() => setFailed(old => [...old.slice(-3), photo])}/>;
  if (media.videoUrl) return <video src={media.videoUrl} muted playsInline preload="metadata" className="h-full w-full object-cover"/>;
  return <span className="flex h-full items-center justify-center bg-[#142642] p-2 text-xs text-white">Memory</span>;
}

export function MemoryCoverEditor({value, onChange, coverPages, selectedCoverId, onSelectCover, disabled = false, ...preview}: Props) {
  const [drawing, setDrawing] = useState(false), [tool, setTool] = useState<'pen'|'marker'|'eraser'>('pen');
  const [penColor, setPenColor] = useState<string>('#142642'), [size, setSize] = useState(2.5), [limit, setLimit] = useState('');
  const [redo, setRedo] = useState<MemoryCoverStroke[]>([]), [live, setLive] = useState<MemoryCoverStroke | null>(null);
  const liveRef = useRef<MemoryCoverStroke | null>(null), container = useRef<HTMLDivElement>(null), [width, setWidth] = useState(280);
  useEffect(() => {const node = container.current; if (!node) return; const observer = new ResizeObserver(entries => {const size = entries[0]?.contentRect.width; if (size > 0) setWidth(size);}); observer.observe(node); return () => observer.disconnect();}, []);
  const personal = personalizeMemoryCover(value), height = width * 1.31;
  const requested = personal.storyIds.length ? personal.storyIds : selectedCoverId ? [selectedCoverId] : [];
  const candidates = coverPages.filter(page => !!page.story_id && !!(memoryCoverMedia(page).photoUrl || memoryCoverMedia(page).videoUrl));
  const selected = requested.filter(id => candidates.some(page => page.story_id === id));
  const setStrokes = (strokes: MemoryCoverStroke[]) => {setRedo([]); onChange({...personal, strokes});};
  const point = (event: PointerEvent<HTMLDivElement>) => {const rect = event.currentTarget.getBoundingClientRect(); return {x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))};};
  const erase = (p: {x: number; y: number}) => setStrokes(personal.strokes.filter(stroke => !stroke.points.some(other => Math.hypot((p.x - other.x) * width, (p.y - other.y) * height) < 18)));
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    const p = point(event);
    if (tool === 'eraser') {erase(p); return;}
    if (personal.strokes.length >= MEMORY_COVER_MAX_STROKES || personal.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0) >= MEMORY_COVER_MAX_POINTS) {setLimit('This cover has reached its drawing limit. Undo or erase a stroke to keep drawing.'); return;}
    setLimit(''); liveRef.current = {tool, color: penColor, width: size, points: [p]}; setLive(liveRef.current);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const p = point(event), stroke = liveRef.current;
    if (tool === 'eraser') {erase(p); return;}
    if (!stroke || stroke.points.length >= MEMORY_COVER_MAX_STROKE_POINTS || personal.strokes.reduce((sum, item) => sum + item.points.length, 0) + stroke.points.length >= MEMORY_COVER_MAX_POINTS) return;
    const last = stroke.points[stroke.points.length - 1]; if (Math.hypot(p.x - last.x, p.y - last.y) < .003) return;
    liveRef.current = {...stroke, points: [...stroke.points, p]}; setLive(liveRef.current);
  };
  const finish = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    if (liveRef.current && !cancel && !disabled) setStrokes([...personal.strokes, liveRef.current]);
    liveRef.current = null; setLive(null); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const chooseSource = (id: string) => {
    if (personal.layout === 'single') {onSelectCover(id); if (value.version === 2) onChange({...personal, storyIds: [id]}); return;}
    const next = selected.includes(id) ? selected.length > 1 ? selected.filter(item => item !== id) : selected : selected.length < MEMORY_COVER_MAX_PHOTOS ? [...selected, id] : selected;
    if (next.length) onSelectCover(next[0]); onChange({...personal, storyIds: next});
  };
  const button = (label: string, active: boolean, onClick: () => void, unavailable = false) => <button key={label} type="button" aria-pressed={active} disabled={disabled || unavailable} onClick={onClick} className={'min-h-11 rounded-xl border px-3 py-2 text-sm disabled:opacity-40 ' + (active ? 'border-ink bg-ink text-[var(--canvas)]' : 'border-ink/20 text-ink')}>{label}</button>;
  return <fieldset disabled={disabled} className="my-5 min-w-0 disabled:opacity-60">
    <div ref={container} className="relative mx-auto mb-4 w-full max-w-[288px]" style={{height}}><MemoryBookCover {...preview} artwork={value} coverPages={coverPages} width={width} height={height}/>
      {drawing && <div data-testid="memory-cover-drawing-canvas" aria-label="Draw or write on the cover" className="absolute inset-0 touch-none cursor-crosshair" onPointerDown={start} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}>{live && <MemoryCoverInk strokes={[live]} width={width} height={height}/>}</div>}
    </div>
    <div className="flex justify-center">{button(drawing ? 'Done drawing' : 'Draw on cover', drawing, () => {setDrawing(!drawing); setLimit('');})}</div>
    {drawing && <div className="mt-3 rounded-2xl bg-ink/5 p-3"><p className="mb-2 text-xs text-muted">Write your own signature or sketch directly on the cover.</p><div className="flex flex-wrap gap-2">{(['pen', 'marker', 'eraser'] as const).map(item => button(item === 'pen' ? 'Pen' : item === 'marker' ? 'Marker' : 'Eraser', tool === item, () => setTool(item)))}</div>
      <div className="mt-2 flex flex-wrap gap-1">{MEMORY_COVER_DRAWING_COLORS.map(color => <button key={color} type="button" aria-label={`Drawing color ${color}`} aria-pressed={penColor === color} onClick={() => setPenColor(color)} className="flex h-11 w-10 items-center justify-center"><span className={'h-7 w-7 rounded-full border ' + (penColor === color ? 'border-ink ring-2 ring-ink' : 'border-ink/30')} style={{background: color}}/></button>)}</div>
      <div className="flex flex-wrap gap-2">{[{label: 'Fine', value: 1}, {label: 'Medium', value: 2.5}, {label: 'Bold', value: 5}].map(item => button(item.label, size === item.value, () => setSize(item.value)))}</div>
      <div className="mt-2 flex flex-wrap gap-2">{button('Undo drawing', false, () => {const last = personal.strokes.at(-1); if (last) {setRedo(old => [...old, last]); onChange({...personal, strokes: personal.strokes.slice(0, -1)}); setLimit('');}}, !personal.strokes.length)}{button('Redo drawing', false, () => {const last = redo.at(-1); if (last) {setRedo(old => old.slice(0, -1)); onChange({...personal, strokes: [...personal.strokes, last]});}}, !redo.length)}{button('Clear drawing', false, () => {setRedo([]); onChange({...personal, strokes: []}); setLimit('');}, !personal.strokes.length)}</div>
      {!!limit && <p role="alert" className="mt-2 text-xs">{limit}</p>}
    </div>}
    <p className="mb-2 mt-5 text-xs font-semibold text-muted">Cover photos</p><div className="flex flex-wrap gap-2">{button('Single photo', personal.layout === 'single', () => {const first = selected[0]; if (first) onSelectCover(first); onChange({...personal, layout: 'single', storyIds: first ? [first] : []});})}{button('Photo collage', personal.layout === 'collage', () => {const ids = [...new Set([...selected, ...candidates.map(page => page.story_id!)])].slice(0, Math.max(2, selected.length)); if (ids[0]) onSelectCover(ids[0]); onChange({...personal, layout: 'collage', storyIds: ids.slice(0, MEMORY_COVER_MAX_PHOTOS)});}, candidates.length < 2)}</div>
    <p className="mt-2 text-xs leading-relaxed text-muted">{personal.layout === 'collage' ? `Choose up to four thumbnails in the order you want them. ${selected.length}/4 selected.` : 'Choose a photo or video thumbnail from the memories in this book.'}</p>
    {candidates.length ? <div className="flex gap-2 overflow-x-auto py-3">{candidates.map((page, index) => {const order = selected.indexOf(page.story_id!); return <button key={page.story_id} type="button" aria-label={`Cover photo ${index + 1}${page.caption ? ': ' + page.caption : ''}`} aria-pressed={order >= 0} onClick={() => chooseSource(page.story_id!)} className={'relative h-[90px] w-[70px] shrink-0 overflow-hidden rounded-lg border-[3px] ' + (order >= 0 ? 'border-ink' : 'border-transparent')}><CoverThumbnail page={page}/>{order >= 0 && <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#142642] text-xs text-white">{personal.layout === 'collage' ? order + 1 : '✓'}</span>}</button>;})}</div> : <p className="mt-2 text-xs text-muted">Add photo or video memories to choose a cover thumbnail. You can still write and draw on your cover.</p>}
    <p className="mb-2 mt-4 text-xs font-semibold text-muted">Cover title style</p><div className="flex flex-wrap gap-2">{([{id: 'design', label: 'Design title'}, {id: 'handwritten', label: 'Cursive title'}, {id: 'serif', label: 'Serif title'}, {id: 'sans', label: 'Simple title'}] as const).map(option => button(option.label, personal.titleStyle === option.id, () => onChange({...personal, titleStyle: option.id})))}</div>
    {([{key: 'paperColor', label: 'Cover background', colors: PAPER_COLORS}, {key: 'inkColor', label: 'Title color', colors: MEMORY_COVER_DRAWING_COLORS}] as const).map(group => <div key={group.key} className="mt-4"><p className="text-xs font-semibold text-muted">{group.label}</p><div className="flex flex-wrap gap-1"><button type="button" aria-label={`Use design ${group.label.toLowerCase()}`} onClick={() => onChange({...personal, [group.key]: null})} className="min-h-11 px-2 text-xs underline">Reset</button>{group.colors.map(color => <button key={color} type="button" aria-label={`${group.label} ${color}`} aria-pressed={personal[group.key] === color} onClick={() => onChange({...personal, [group.key]: color})} className="flex h-11 w-10 items-center justify-center"><span className={'h-7 w-7 rounded-full border ' + (personal[group.key] === color ? 'border-ink ring-2 ring-ink' : 'border-ink/30')} style={{background: color}}/></button>)}</div></div>)}
  </fieldset>;
}
