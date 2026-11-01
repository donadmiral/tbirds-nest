'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import NextImage from 'next/image';
import { BookOpen, Download, Music2, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import type { MemoryPage } from '@/lib/memoryAlbum';
import { useMemoryPlayback } from '@/lib/useMemoryPlayback';
import { MEMORY_SCORE_DESCRIPTION, MEMORY_SCORE_DUCK, MEMORY_SCORE_TITLE, MEMORY_SCORE_VOLUME, createMemoryFilmProgressGuard, memoryFilmItems, memoryPageSoundtrack, memoryFilmPhotoDuration, memoryFilmProgress, memoryFilmStep, memoryFilmVideoWindow, type MemoryFilmItem } from '../../../shared/memoryFilm';
import { MemoryPageImage } from './MemoryPageImage';
import { MemoryStoryFrame } from './MemoryStoryFrame';
import { useMemoryDialog } from './useMemoryDialog';
import PostSoundtrack from '../PostSoundtrack';
import { readSoundtrack } from '../../../shared/soundtrack';
import { MemoryMovieExport } from './MemoryMovieExport';
import {planMemoryMovie,memoryMovieTimeline,memoryMovieVisual,type MemoryMovieTimelineItem} from '../../../shared/memoryMoviePlan';
import {memoryFilmSettings} from '../../../shared/memoryBookCreative';
import s from './MemoryFilm.module.css';

export function MemoryFilm({ bookId,revision,title, pages, soundtrack, filmSettings, reduceMotion, onClose, onReadBook, onRetry }: { bookId?:string;revision?:number;title: string; pages: MemoryPage[]; soundtrack?: unknown; filmSettings?:unknown; reduceMotion: boolean; onClose: () => void; onReadBook: () => void; onRetry: () => void }) {
  const savedMusic=readSoundtrack(soundtrack),hasSavedMusic=!!savedMusic;
  const [durations,setDurations]=useState<Record<string,number>>({});
  const cut=useMemo(()=>{try{const plan=planMemoryMovie(pages,filmSettings,durations);return{plan,items:memoryMovieTimeline(pages,plan,title),error:''};}catch(error){return{plan:null,items:memoryFilmItems(pages).map(item=>({...item,movie:{durationSec:memoryFilmPhotoDuration(item)/1000,fadeSec:0,motion:{fromScale:1,toScale:1,x:0,y:0},titleCard:null}} as MemoryMovieTimelineItem)),error:error instanceof Error?error.message:'This movie could not be planned.'};}},[pages,filmSettings,durations,title]);
  const items=cut.items;
  const [selection, setSelection] = useState({ id: items[0]?.id ?? '', run: 0 });
  const [playing, setPlaying] = useState(true), [foreground, setForeground] = useState(true), [callActive, setCallActive] = useState(false);
  const [music, setMusic] = useState(true), [volume, setVolume] = useState(savedMusic?.volume??MEMORY_SCORE_VOLUME), [originalMuted, setOriginalMuted] = useState(()=>filmSettings?!memoryFilmSettings(filmSettings).originalAudio:true);
  const [readyKey, setReadyKey] = useState(''), [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState({ key: '', message: '' }), [videoState, setVideoState] = useState({ key: '', progress: 0 });
  const [audioBlocked, setAudioBlocked] = useState(false), [audioError, setAudioError] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const dialog = useMemoryDialog(!exportOpen, onClose);
  const index = Math.max(0, items.findIndex(item => item.id === selection.id)), item = items[index];
  const pageMusic = memoryPageSoundtrack(item?.page),hasPageMusic=!!pageMusic;
  const slotKey = (entry: MemoryFilmItem) => JSON.stringify([entry.id, entry.uri, entry.poster, entry.page.media_transform, entry.page.filter_id, attempt]);
  const key = `${item ? slotKey(item) : ''}:${selection.run}`;
  const ready = item?.kind === 'text' || readyKey === key, error = failure.key === key ? failure.message : '';
  const active = playing && foreground && !callActive && !error && !exportOpen;
  const current = useRef({ items, index, key, active, music }); useLayoutEffect(()=>{current.current = { items, index, key, active, music };},[items,index,key,active,music]);
  const mediaReady = (eventKey: string) => { if (current.current.key === eventKey) setReadyKey(eventKey); };
  const mediaFailed = (eventKey: string, message: string) => { if (current.current.key === eventKey) setFailure({ key: eventKey, message }); };
  const mediaProgress = (eventKey: string, value: number) => { if (current.current.key === eventKey) setVideoState({ key: eventKey, progress: value }); };
  const advance = useCallback((direction: 1 | -1, expected?: string) => {
    const state = current.current;
    if (!state.items.length || expected && (expected !== state.key || !state.active)) return;
    const next = memoryFilmStep(state.index, state.items.length, direction);
    setSelection(previous => ({ id: state.items[next.index].id, run: previous.run + 1 }));
  }, []);
  const photoProgress = useMemoryPlayback(key, active && ready && item?.kind !== 'video', item ? item.movie.durationSec*1000 : 6000, () => advance(1, key));
  const progress = item?.kind === 'video' ? videoState.key === key ? videoState.progress : 0 : photoProgress;
  const visual=item?memoryMovieVisual(item,progress,reduceMotion):null;
  const metadata=(id:string,duration:number)=>{if(Number.isFinite(duration)&&duration>0)setDurations(previous=>previous[id]===duration?previous:{...previous,[id]:duration});};
  const playAudio = useCallback(() => {
    const node = audio.current; if (!node) return;
    const allowed = () => audio.current === node && node.isConnected && current.current.active && current.current.music && !hasSavedMusic && !document.hidden && document.documentElement.dataset.platinumCallActive !== 'true';
    if (!allowed()) { node.pause(); return; }
    setAudioError(false);
    void node.play().then(() => { if (!allowed()) node.pause(); else setAudioBlocked(false); }).catch(error => { if (allowed()) { setAudioBlocked(error?.name === 'NotAllowedError'); setAudioError(error?.name !== 'NotAllowedError'); } });
  }, [hasSavedMusic]);
  useEffect(() => {
    const visibility = () => { const visible = !document.hidden; setForeground(visible); if (!visible) audio.current?.pause(); };
    const call = () => { const blocked = document.documentElement.dataset.platinumCallActive === 'true'; setCallActive(blocked); if (blocked) audio.current?.pause(); };
    const stop = () => { setPlaying(false); audio.current?.pause(); };
    const observer = new MutationObserver(call); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-platinum-call-active'] });
    visibility(); call(); document.addEventListener('visibilitychange', visibility); window.addEventListener('platinum:stop-media', stop);
    const node = audio.current;
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('platinum:stop-media', stop); node?.pause(); };
  }, []);
  useEffect(() => { if (audio.current) audio.current.volume = volume * (item?.kind === 'video' && !originalMuted || hasPageMusic ? MEMORY_SCORE_DUCK : 1); }, [volume, item?.kind, originalMuted,hasPageMusic]);
  useEffect(() => { playAudio(); }, [active, music, playAudio]);
  useEffect(() => {
    if (!item || ready || error || !active) return;
    const timer = setTimeout(() => { if (current.current.active) mediaFailed(key, 'This memory is taking too long to load.'); }, 20000);
    return () => clearTimeout(timer);
  }, [key, ready, error, item, active]);
  const upcoming = items.length > 1 && foreground && !callActive && !exportOpen ? items[(index + 1) % items.length] : null;
  const nearby = item ? [item, ...(upcoming ? [upcoming] : [])] : [];
  const retry = () => { setAttempt(value => value + 1); onRetry(); };
  if (!item) return null;
  return <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${title} memory film`} className={s.root} onKeyDown={event => {
    if ((event.target as HTMLElement).closest('input,textarea,select,button,a')) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); advance(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); advance(-1); }
    if (event.key === ' ') { event.preventDefault(); setPlaying(value => !value); }
  }}>
    {savedMusic?<PostSoundtrack selection={{...savedMusic,volume:volume*(item?.kind==='video'&&!originalMuted||hasPageMusic?MEMORY_SCORE_DUCK:1)}} use="memory_album" active={active&&music} autoPlay controls={false}/>:<audio ref={audio} src="/audio/platinum-memory-score.m4a" preload="auto" loop onError={() => setAudioError(true)} />}
    {pageMusic?<PostSoundtrack key={key+':audio'} selection={pageMusic} use="memory_album" active={active&&ready} autoPlay controls={false}/>:null}
    <header className={s.header}><button type="button" data-autofocus aria-label="Close memory film" onClick={onClose}><X size={23} /></button><div><span>MEMORIES</span><h2>{title}</h2></div><button type="button" aria-label="Download memory movie" onClick={() => { setPlaying(false); audio.current?.pause(); setExportOpen(true); }}><Download size={21} /></button><button type="button" aria-label="Read memory book" onClick={onReadBook}><BookOpen size={22} /></button></header>
    <div className={s.timeline} role="progressbar" aria-label={`Memory ${index + 1} of ${items.length}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>{items.map((entry, i) => <span key={entry.id}><i style={{ width: `${i < index ? 100 : i === index ? progress * 100 : 0}%` }} /></span>)}</div>
    <div className={s.stage}>
      {(item.kind === 'image' ? item.uri : item.poster) && <NextImage unoptimized width={1080} height={1920} className={s.backdrop} alt="" aria-hidden src={(item.kind === 'image' ? item.uri : item.poster)!} />}
      {nearby.map(entry => {
        const selected = entry.id === item.id, eventKey = selected ? key : `${slotKey(entry)}:${selection.run + 1}`;
        return <div key={slotKey(entry)} className={s.frame} aria-hidden={!selected} inert={!selected} data-memory-film-slot={entry.id} data-memory-film-active={selected}
          style={{ visibility: selected ? 'visible' : 'hidden', pointerEvents: selected ? undefined : 'none', opacity: selected ? visual?.opacity : 1, transform: selected && visual ? `translate(${visual.x*100}%,${visual.y*100}%) scale(${visual.scale})` : undefined }}>
          {entry.kind === 'video' && entry.uri ? <FilmVideo item={entry} active={selected && active} run={selected ? selection.run : 0} muted={!selected || originalMuted} onMetadata={duration=>metadata(entry.id,duration)} onReady={() => mediaReady(eventKey)} onError={() => mediaFailed(eventKey, 'This memory video could not play.')} onProgress={value => mediaProgress(eventKey, value)} onEnd={() => advance(1, eventKey)} /> : <MemoryStoryFrame page={entry.page as MemoryPage} clock={selected ? photoProgress * entry.movie.durationSec : 0}>{style => entry.kind === 'image' ? <div className={s.photo}><MemoryPageImage active={selected && active} src={entry.uri} poster={entry.poster} style={style} onReady={() => mediaReady(eventKey)} onRetry={retry} /></div> : <div className={entry.movie.titleCard?s.titlePage:s.textPage}>{entry.excerpt || entry.page.story_caption || entry.page.caption || ''}</div>}</MemoryStoryFrame>}
        </div>;
      })}
      {!ready && !error && <div className={s.loading} role="status">Loading memory…</div>}
      {!!error && <div className={s.error} role="alert"><p>{error}</p><button type="button" onClick={retry}>Retry</button><button type="button" onClick={() => advance(1)}>Next memory</button></div>}
    </div>
    <footer className={s.footer}>
      {cut.error&&<p role="alert">{cut.error}</p>}{cut.plan?.settings.mode==='automatic'&&<p className={s.source}>{cut.plan.settings.style} · {cut.plan.selectedCount} of {cut.plan.sourceCount} memories · {Math.ceil(cut.plan.durationSec)} seconds{cut.plan.estimated?' estimated':''}</p>}
      {!!item.page.caption && item.kind !== 'text' && <p className={s.caption}>{item.page.caption}</p>}
      {!!item.postId && <Link className={s.source} href={`/post/${encodeURIComponent(item.postId)}`} onClick={() => { setPlaying(false); onClose(); }}>{item.author ? `Shared from ${item.author}` : 'View original post'} ↗</Link>}
      <div className={s.controls}><button type="button" aria-label="Previous memory" onClick={() => advance(-1)}><SkipBack size={22} /></button><button type="button" className={s.play} aria-label={playing ? 'Pause memory film' : 'Play memory film'} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={23} /> : <Play size={23} />}</button><button type="button" aria-label="Next memory" onClick={() => advance(1)}><SkipForward size={22} /></button><span>{index + 1} / {items.length}</span>{item.kind === 'video' && <button type="button" aria-label={originalMuted ? 'Unmute original video sound' : 'Mute original video sound'} aria-pressed={!originalMuted} onClick={() => setOriginalMuted(value => !value)}>{originalMuted ? <VolumeX size={21} /> : <Volume2 size={21} />}</button>}<button type="button" aria-label={music ? 'Turn off background music' : 'Play background music'} aria-pressed={music} onClick={() => { if (!music) { current.current.music = true; playAudio(); } setMusic(value => !value); }}><Music2 size={20} /></button></div>
      {music && <div className={s.music}><div><strong>{savedMusic?'Book soundtrack':MEMORY_SCORE_TITLE}</strong><small>{savedMusic?'Your saved excerpt and audio mix':MEMORY_SCORE_DESCRIPTION}</small></div><input aria-label="Background music volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={event => setVolume(Number(event.target.value))} /></div>}
      {music && (audioBlocked || audioError) && <button type="button" className={s.audioRetry} onClick={() => { audio.current?.load(); playAudio(); }}>{audioBlocked ? 'Play background music' : 'Music could not play · Retry'}</button>}
    </footer>
    {exportOpen && <MemoryMovieExport bookId={bookId} revision={revision} filmSettings={filmSettings} reduceMotion={reduceMotion} title={title} pages={pages} soundtrack={soundtrack} initialScore={music&&!savedMusic} initialOriginalAudio={!originalMuted} scoreVolume={volume} onRefresh={onRetry} onClose={() => setExportOpen(false)} />}
  </div>;
}

function FilmVideo({ item, active, run = 0, muted, onMetadata, onReady, onError, onProgress, onEnd }: { item: MemoryFilmItem; active: boolean; run?: number; muted: boolean; onMetadata?:(duration:number)=>void; onReady: () => void; onError: () => void; onProgress: (value: number) => void; onEnd: () => void }) {
  const ref = useRef<HTMLVideoElement>(null), done = useRef(false), initialized = useRef(false);
  const firstFrame = useRef(false), frameCallback = useRef<number|null>(null);
  const progressGuard = useRef(createMemoryFilmProgressGuard());
  const [clock, setClock] = useState(0), [blocked, setBlocked] = useState(false), [decoded, setDecoded] = useState(false);
  const lastRun = useRef(run);
  const state = useRef({ active, onEnd, onReady, onError, onProgress }); useLayoutEffect(()=>{state.current = { active, onEnd, onReady, onError, onProgress };},[active,onEnd,onReady,onError,onProgress]);
  const allowed = useCallback(() => !!ref.current?.isConnected && !done.current && state.current.active && !document.hidden && document.documentElement.dataset.platinumCallActive !== 'true', []);
  const play = useCallback(() => { const video = ref.current; if (!video) return; if (!allowed() || done.current) { video.pause(); return; } void video.play().then(() => { if (!allowed()) video.pause(); else setBlocked(false); }).catch(error => { if (allowed()) { if (error?.name === 'NotAllowedError') setBlocked(true); else if (error?.name !== 'AbortError') state.current.onError(); } }); }, [allowed]);
  const observeFrame = () => {
    const video = ref.current;
    if (!video || !initialized.current || done.current || firstFrame.current || frameCallback.current !== null) return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      frameCallback.current = video.requestVideoFrameCallback((_now, metadata) => {
        frameCallback.current = null;
        if (ref.current !== video || !video.isConnected || done.current) return;
        const start = memoryFilmVideoWindow(item.page, video.duration).start;
        if (video.seeking || video.readyState < 2 || video.currentTime < start - .05 || metadata.mediaTime < start - .05) { observeFrame(); return; }
        firstFrame.current = true; setDecoded(true); if (state.current.active) state.current.onReady();
      });
    } else if (video.readyState >= 2 && !video.seeking && video.currentTime >= memoryFilmVideoWindow(item.page, video.duration).start - .05) {
      firstFrame.current = true; setDecoded(true); if (state.current.active) state.current.onReady();
    }
  };
  const configure = () => { const video = ref.current; if (!video) return; onMetadata?.(video.duration); const window = memoryFilmVideoWindow(item.page, video.duration); video.playbackRate = window.speed; video.volume = window.volume; video.muted = muted || window.volume === 0; if (!initialized.current) { if(Math.abs(video.currentTime-window.start)>.01)video.currentTime = window.start; initialized.current = true; setClock(window.start); progressGuard.current.reset(); progressGuard.current.stalled(video.currentTime, Date.now(), allowed()); } observeFrame(); play(); };
  useLayoutEffect(() => {
    if (lastRun.current === run) return;
    lastRun.current = run; done.current = false; initialized.current = false; firstFrame.current = false; setDecoded(false);
    const video = ref.current;
    if (frameCallback.current !== null) video?.cancelVideoFrameCallback?.(frameCallback.current);
    frameCallback.current = null;
    if (video && video.readyState >= 1) configure();
  }, [run]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (active && firstFrame.current) state.current.onReady(); }, [active, run]);
  useEffect(() => {
    const video = ref.current; if (!video || !item.uri) return;
    if (video.getAttribute('src') !== item.uri) { video.src = item.uri; video.load(); }
    return () => { video.pause(); video.removeAttribute('src'); video.load(); };
  }, [item.uri]);
  const finish = () => { if (!allowed() || done.current) return; done.current = true; ref.current?.pause(); state.current.onProgress(1); state.current.onEnd(); };
  useEffect(() => {
    play(); observeFrame(); const node = ref.current, guard=progressGuard.current;
    const reset = () => { guard.reset(); if (node) guard.stalled(node.currentTime, Date.now(), allowed() && initialized.current && !blocked); };
    const stop = () => { reset(); if (!allowed()) node?.pause(); };
    reset(); document.addEventListener('visibilitychange', stop);
    const watchdog = setInterval(() => {
      if (node && guard.stalled(node.currentTime, Date.now(), allowed() && initialized.current && !blocked)) {
        done.current = true; node.pause(); state.current.onError();
      }
    }, 500);
    return () => { clearInterval(watchdog); guard.reset(); document.removeEventListener('visibilitychange', stop); node?.pause(); if(frameCallback.current!==null){node?.cancelVideoFrameCallback?.(frameCallback.current);frameCallback.current=null;} };
  }, [active, run, blocked, play, allowed]); // eslint-disable-line react-hooks/exhaustive-deps
  return <MemoryStoryFrame page={item.page as MemoryPage} clock={clock}>{style => <>
    {!decoded&&item.poster&&<NextImage unoptimized width={1080} height={1920} src={item.poster} alt="" aria-hidden style={{...style,position:'absolute',inset:0,width:'100%',height:'100%'}}/>}
    <video ref={ref} src={item.uri!} preload="auto" playsInline muted={muted} data-memory-film-video={item.id} data-memory-frame-ready={decoded} onLoadedMetadata={configure} onCanPlay={configure} onLoadedData={observeFrame} onPlaying={observeFrame} onSeeked={observeFrame} onError={onError} onPlay={event => { if (!allowed()) event.currentTarget.pause(); }} onTimeUpdate={event => { if (!allowed() || done.current) return; const video = event.currentTarget, window = memoryFilmVideoWindow(item.page, video.duration); setClock(video.currentTime); onProgress(memoryFilmProgress(video.currentTime, window.start, window.end)); if (window.end != null && video.currentTime >= window.end - .025) finish(); }} onEnded={finish} style={{...style,opacity:decoded?1:0}} className={s.video} />{blocked && <button type="button" className={s.videoPlay} onClick={play}><Play size={20} /> Play this memory</button>}</>}</MemoryStoryFrame>;
}
