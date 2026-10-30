'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Music2, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import type { MemoryPage } from '@/lib/memoryAlbum';
import { useMemoryPlayback } from '@/lib/useMemoryPlayback';
import { MEMORY_SCORE_DESCRIPTION, MEMORY_SCORE_DUCK, MEMORY_SCORE_TITLE, MEMORY_SCORE_VOLUME, memoryFilmItems, memoryFilmPhotoDuration, memoryFilmProgress, memoryFilmStep, memoryFilmVideoWindow, type MemoryFilmItem } from '../../../shared/memoryFilm';
import { MemoryPageImage } from './MemoryPageImage';
import { MemoryStoryFrame } from './MemoryStoryFrame';
import { useMemoryDialog } from './useMemoryDialog';
import s from './MemoryFilm.module.css';

export function MemoryFilm({ title, pages, reduceMotion, onClose, onReadBook, onRetry }: { title: string; pages: MemoryPage[]; reduceMotion: boolean; onClose: () => void; onReadBook: () => void; onRetry: () => void }) {
  const items = useMemo(() => memoryFilmItems(pages), [pages]);
  const [selection, setSelection] = useState({ id: pages[0]?.id ?? '', run: 0 });
  const [playing, setPlaying] = useState(true), [foreground, setForeground] = useState(true), [callActive, setCallActive] = useState(false);
  const [music, setMusic] = useState(true), [volume, setVolume] = useState(MEMORY_SCORE_VOLUME), [originalMuted, setOriginalMuted] = useState(true);
  const [readyKey, setReadyKey] = useState(''), [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState({ key: '', message: '' }), [videoState, setVideoState] = useState({ key: '', progress: 0 });
  const [audioBlocked, setAudioBlocked] = useState(false), [audioError, setAudioError] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const dialog = useMemoryDialog(true, onClose);
  const index = Math.max(0, items.findIndex(item => item.id === selection.id)), item = items[index];
  const key = `${item?.id}:${item?.uri}:${selection.run}:${attempt}`;
  const ready = item?.kind === 'text' || readyKey === key, error = failure.key === key ? failure.message : '';
  const active = playing && foreground && !callActive && !error;
  const current = useRef({ items, index, key, active, music }); current.current = { items, index, key, active, music };
  const advance = useCallback((direction: 1 | -1, expected?: string) => {
    const state = current.current;
    if (!state.items.length || expected && (expected !== state.key || !state.active)) return;
    const next = memoryFilmStep(state.index, state.items.length, direction);
    setSelection(previous => ({ id: state.items[next.index].id, run: previous.run + 1 }));
  }, []);
  const photoProgress = useMemoryPlayback(key, active && ready && item?.kind !== 'video', item ? memoryFilmPhotoDuration(item) : 6000, () => advance(1, key));
  const progress = item?.kind === 'video' ? videoState.key === key ? videoState.progress : 0 : photoProgress;
  const playAudio = useCallback(() => {
    const node = audio.current; if (!node) return;
    const allowed = () => audio.current === node && node.isConnected && current.current.active && current.current.music && !document.hidden && document.documentElement.dataset.platinumCallActive !== 'true';
    if (!allowed()) { node.pause(); return; }
    setAudioError(false);
    void node.play().then(() => { if (!allowed()) node.pause(); else setAudioBlocked(false); }).catch(error => { if (allowed()) { setAudioBlocked(error?.name === 'NotAllowedError'); setAudioError(error?.name !== 'NotAllowedError'); } });
  }, []);
  useEffect(() => {
    const visibility = () => { const visible = !document.hidden; setForeground(visible); if (!visible) audio.current?.pause(); };
    const call = () => { const blocked = document.documentElement.dataset.platinumCallActive === 'true'; setCallActive(blocked); if (blocked) audio.current?.pause(); };
    const stop = () => { setPlaying(false); audio.current?.pause(); };
    const observer = new MutationObserver(call); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-platinum-call-active'] });
    visibility(); call(); document.addEventListener('visibilitychange', visibility); window.addEventListener('platinum:stop-media', stop);
    const node = audio.current;
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('platinum:stop-media', stop); node?.pause(); };
  }, []);
  useEffect(() => { if (audio.current) audio.current.volume = volume * (item?.kind === 'video' && !originalMuted ? MEMORY_SCORE_DUCK : 1); }, [volume, item?.kind, originalMuted]);
  useEffect(() => { playAudio(); }, [active, music, playAudio]);
  useEffect(() => {
    if (!item || ready || error) return;
    const timer = setTimeout(() => setFailure({ key, message: 'This memory is taking too long to load.' }), 20000);
    return () => clearTimeout(timer);
  }, [key, ready, error, item]);
  useEffect(() => {
    const next = items[(index + 1) % Math.max(1, items.length)], uri = next?.kind === 'image' ? next.uri : next?.poster;
    if (uri) { const preload = new Image(); preload.src = uri; }
  }, [items, index]);
  const retry = () => { setAttempt(value => value + 1); onRetry(); };
  if (!item) return null;
  return <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${title} memory film`} className={s.root} onKeyDown={event => {
    if ((event.target as HTMLElement).closest('input,textarea,select,button,a')) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); advance(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); advance(-1); }
    if (event.key === ' ') { event.preventDefault(); setPlaying(value => !value); }
  }}>
    <audio ref={audio} src="/audio/platinum-memory-score.m4a" preload="auto" loop onError={() => setAudioError(true)} />
    <header className={s.header}><button type="button" data-autofocus aria-label="Close memory film" onClick={onClose}><X size={23} /></button><div><span>MEMORIES</span><h2>{title}</h2></div><button type="button" aria-label="Read memory book" onClick={onReadBook}><BookOpen size={22} /></button></header>
    <div className={s.timeline} role="progressbar" aria-label={`Memory ${index + 1} of ${items.length}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>{items.map((entry, i) => <span key={entry.id}><i style={{ width: `${i < index ? 100 : i === index ? progress * 100 : 0}%` }} /></span>)}</div>
    <div className={s.stage}>
      {(item.kind === 'image' ? item.uri : item.poster) && <img className={s.backdrop} alt="" aria-hidden src={(item.kind === 'image' ? item.uri : item.poster)!} />}
      <div key={key} className={`${s.frame} ${reduceMotion ? '' : s.enter}`}>
        {item.kind === 'video' && item.uri ? <FilmVideo item={item} active={active} muted={originalMuted} onReady={() => setReadyKey(key)} onError={() => setFailure({ key, message: 'This memory video could not play.' })} onProgress={value => setVideoState({ key, progress: value })} onEnd={() => advance(1, key)} /> : <MemoryStoryFrame page={item.page as MemoryPage}>{style => item.kind === 'image' ? <div className={s.photo} style={{ transform: reduceMotion ? undefined : `scale(${.965 + photoProgress * .035})` }}><MemoryPageImage src={item.uri} poster={item.poster} style={style} onReady={() => setReadyKey(key)} onRetry={retry} /></div> : <div className={s.textPage}>{item.excerpt || item.page.story_caption || item.page.caption || ''}</div>}</MemoryStoryFrame>}
      </div>
      {!ready && !error && <div className={s.loading} role="status">Loading memory…</div>}
      {!!error && <div className={s.error} role="alert"><p>{error}</p><button type="button" onClick={retry}>Retry</button><button type="button" onClick={() => advance(1)}>Next memory</button></div>}
    </div>
    <footer className={s.footer}>
      {!!item.page.caption && item.kind !== 'text' && <p className={s.caption}>{item.page.caption}</p>}
      {!!item.postId && <Link className={s.source} href={`/post/${encodeURIComponent(item.postId)}`} onClick={() => { setPlaying(false); onClose(); }}>{item.author ? `Shared from ${item.author}` : 'View original post'} ↗</Link>}
      <div className={s.controls}><button type="button" aria-label="Previous memory" onClick={() => advance(-1)}><SkipBack size={22} /></button><button type="button" className={s.play} aria-label={playing ? 'Pause memory film' : 'Play memory film'} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={23} /> : <Play size={23} />}</button><button type="button" aria-label="Next memory" onClick={() => advance(1)}><SkipForward size={22} /></button><span>{index + 1} / {items.length}</span>{item.kind === 'video' && <button type="button" aria-label={originalMuted ? 'Unmute original video sound' : 'Mute original video sound'} aria-pressed={!originalMuted} onClick={() => setOriginalMuted(value => !value)}>{originalMuted ? <VolumeX size={21} /> : <Volume2 size={21} />}</button>}<button type="button" aria-label={music ? 'Turn off background music' : 'Play background music'} aria-pressed={music} onClick={() => { if (!music) { current.current.music = true; playAudio(); } setMusic(value => !value); }}><Music2 size={20} /></button></div>
      {music && <div className={s.music}><div><strong>{MEMORY_SCORE_TITLE}</strong><small>{MEMORY_SCORE_DESCRIPTION}</small></div><input aria-label="Background music volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={event => setVolume(Number(event.target.value))} /></div>}
      {music && (audioBlocked || audioError) && <button type="button" className={s.audioRetry} onClick={() => { audio.current?.load(); playAudio(); }}>{audioBlocked ? 'Play background music' : 'Music could not play · Retry'}</button>}
    </footer>
  </div>;
}

function FilmVideo({ item, active, muted, onReady, onError, onProgress, onEnd }: { item: MemoryFilmItem; active: boolean; muted: boolean; onReady: () => void; onError: () => void; onProgress: (value: number) => void; onEnd: () => void }) {
  const ref = useRef<HTMLVideoElement>(null), done = useRef(false), initialized = useRef(false);
  const [clock, setClock] = useState(0), [blocked, setBlocked] = useState(false);
  const state = useRef({ active, onEnd, onReady, onError, onProgress }); state.current = { active, onEnd, onReady, onError, onProgress };
  const allowed = () => !!ref.current?.isConnected && state.current.active && !document.hidden && document.documentElement.dataset.platinumCallActive !== 'true';
  const play = () => { const video = ref.current; if (!video) return; if (!allowed() || done.current) { video.pause(); return; } void video.play().then(() => { if (!allowed()) video.pause(); else setBlocked(false); }).catch(error => { if (allowed()) { if (error?.name === 'NotAllowedError') setBlocked(true); else if (error?.name !== 'AbortError') state.current.onError(); } }); };
  const configure = () => { const video = ref.current; if (!video) return; const window = memoryFilmVideoWindow(item.page, video.duration); video.playbackRate = window.speed; video.volume = window.volume; video.muted = muted || window.volume === 0; if (!initialized.current) { video.currentTime = window.start; initialized.current = true; setClock(window.start); } state.current.onReady(); play(); };
  const finish = () => { if (!allowed() || done.current) return; done.current = true; ref.current?.pause(); state.current.onProgress(1); state.current.onEnd(); };
  useEffect(() => { play(); const node = ref.current; const stop = () => { if (!allowed()) node?.pause(); }; document.addEventListener('visibilitychange', stop); return () => { document.removeEventListener('visibilitychange', stop); node?.pause(); }; }, [active]);
  return <MemoryStoryFrame page={item.page as MemoryPage} clock={clock}>{style => <><video ref={ref} src={item.uri!} poster={item.poster || undefined} preload="auto" playsInline muted={muted} onLoadedMetadata={configure} onCanPlay={configure} onError={onError} onPlay={event => { if (!allowed()) event.currentTarget.pause(); }} onTimeUpdate={event => { if (!allowed() || done.current) return; const video = event.currentTarget, window = memoryFilmVideoWindow(item.page, video.duration); setClock(video.currentTime); onProgress(memoryFilmProgress(video.currentTime, window.start, window.end)); if (window.end != null && video.currentTime >= window.end - .025) finish(); }} onEnded={finish} style={style} className={s.video} />{blocked && <button type="button" className={s.videoPlay} onClick={play}><Play size={20} /> Play this memory</button>}</>}</MemoryStoryFrame>;
}
