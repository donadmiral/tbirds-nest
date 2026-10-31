'use client';
import NextImage from 'next/image';

import { useCallback,useEffect,useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Download, Film, X } from 'lucide-react';
import type { MemoryPage } from '../../lib/memoryAlbum';
import { captureStoryArtwork } from '../../lib/storyVideoExport';
import { exportMemoryMovie, memoryMovieLimit, MEMORY_MOVIE_WIDTH, MEMORY_MOVIE_HEIGHT, type MemoryMovieCapture, type MemoryMovieProgress } from '../../lib/memoryFilmExport';
import { exportCancelled, exportStep, type LocalExportAudio } from '../../lib/videoExportAudio';
import { ExportAudioPicker } from '../ExportAudioPicker';
import { MemoryStoryFrame } from './MemoryStoryFrame';
import { useMemoryDialog } from './useMemoryDialog';
import { memoryPageSoundtrack } from '../../../shared/memoryFilm';
import {createClient} from '../../lib/supabase/client';
import {hydrateMemoryAlbumMedia} from '../../lib/contentMedia';
import {assertLibraryExportRights} from '../../lib/libraryExportAudio';
import {readSoundtrack} from '../../../shared/soundtrack';
import {memoryMovieContentStamp,openMemoryMovieAccess} from '../../../shared/memoryMovieAccess';
import {planMemoryMovie} from '../../../shared/memoryMoviePlan';
import s from './MemoryMovieExport.module.css';

export function MemoryMovieExport({ bookId,revision,title, pages, soundtrack, filmSettings, reduceMotion=false, initialScore, initialOriginalAudio, scoreVolume, onClose, onRefresh }: {
  bookId?:string;revision?:number;title: string; pages: MemoryPage[]; soundtrack?: unknown; filmSettings?:unknown; reduceMotion?:boolean; initialScore: boolean; initialOriginalAudio: boolean; scoreVolume: number; onClose: () => void; onRefresh: () => void;
}) {
  const [score, setScore] = useState(initialScore), [originalAudio, setOriginalAudio] = useState(initialOriginalAudio);
  const [localAudio, setLocalAudio] = useState<LocalExportAudio | null>(null), [audioBusy, setAudioBusy] = useState(false);
  const [progress, setProgress] = useState<MemoryMovieProgress | null>(null), [error, setError] = useState(''), [cancelled, setCancelled] = useState(false);
  const [result, setResult] = useState<{ url: string; name: string; duration: number; memories: number } | null>(null);
  const [artwork, setArtwork] = useState<MemoryMovieCapture | null>(null), artworkRef = useRef<HTMLDivElement>(null);
  const access=useRef<Awaited<ReturnType<typeof openMemoryMovieAccess>>|null>(null),accessTimer=useRef<ReturnType<typeof setInterval>|null>(null),accessAbort=useRef<AbortController|null>(null);
  const base=process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const stamp=useMemo(()=>{try{return memoryMovieContentStamp({title,pages,filmSettings,soundtrack},base);}catch{return 'unsupported';}},[title,pages,filmSettings,soundtrack,base]);
  const stopAccess=useCallback(()=>{if(accessTimer.current)clearInterval(accessTimer.current);accessTimer.current=null;access.current?.stop();access.current=null;accessAbort.current?.abort();accessAbort.current=null;},[]);
  const controller = useRef<AbortController | null>(null), downloaded = useRef<string | null>(null), mounted = useRef(true);
  const close = () => { controller.current?.abort();stopAccess(); onClose(); };
  const dialog = useMemoryDialog(true, close), limit = memoryMovieLimit(pages, soundtrack,filmSettings);
  const hasPageAudio = pages.some(page => memoryPageSoundtrack(page) !== null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort();stopAccess(); if (downloaded.current) URL.revokeObjectURL(downloaded.current); }; }, [stopAccess]);
  useEffect(() => { if (downloaded.current) { URL.revokeObjectURL(downloaded.current); downloaded.current = null; setResult(null); } return () => {controller.current?.abort();stopAccess();}; }, [bookId,revision,stamp,stopAccess]);
  const start = () => {
    if (controller.current || limit || audioBusy) return;
    stopAccess();const abort = new AbortController(); controller.current = abort;accessAbort.current=abort;
    setError(''); setCancelled(false); setProgress({ phase: 'preparing', message: 'Preparing your memories…', percent: 0 });
    const current = () => mounted.current && controller.current === abort && !abort.signal.aborted;
    const rights=async()=>{const selected=[readSoundtrack(soundtrack),...planMemoryMovie(pages,filmSettings).scenes.map(scene=>memoryPageSoundtrack(pages[scene.sourceIndex]))].filter(value=>!!value);for(const selection of new Map(selected.map(value=>[[value.soundId,value.startSec,value.durationSec].join(':'),value])).values())await assertLibraryExportRights(selection,'memory_album',abort.signal);};
    const verify=async()=>{if(!access.current)throw new Error('The movie access session ended. Retry.');await access.current.check();await rights();};
    const prepare=async()=>{
      const session=await openMemoryMovieAccess({client:createClient(),base,bookId:bookId??'',expected:{title,pages,filmSettings,soundtrack,revision},signal:abort.signal,onInvalid:failure=>{abort.abort();if(mounted.current&&accessAbort.current===abort){if(downloaded.current){URL.revokeObjectURL(downloaded.current);downloaded.current=null;}setResult(null);setError(failure.message);}}});
      if(!current()){session.stop();throw new Error('Movie export was cancelled.');}access.current=session;
      accessTimer.current=setInterval(()=>{void verify().catch(error=>{abort.abort();if(mounted.current&&accessAbort.current===abort){if(downloaded.current){URL.revokeObjectURL(downloaded.current);downloaded.current=null;}setResult(null);setError(error instanceof Error?error.message:'Book access could not be verified. Retry.');}});},30000);
      const [fresh]=await hydrateMemoryAlbumMedia([session.book]);if(!current())throw new Error('Movie export was cancelled.');
      const movie=await exportMemoryMovie({ pages:fresh.pages, title, filmSettings, reduceMotion, soundtrack, signal: abort.signal, originalAudio, score: score ? { url: '/audio/platinum-memory-score.m4a', volume: scoreVolume } : null, localAudio,
      progress: next => { if (current()) { if (next.phase !== 'preparing') setArtwork(null); setProgress(previous => previous?.phase === next.phase && previous.percent === next.percent && previous.message === next.message ? previous : next); } },
      capture: async (request, signal) => {
        exportCancelled(signal); if (!current()) throw new Error('Movie export was cancelled.'); setArtwork(request);
        await exportStep(new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))), signal, 'The memory artwork did not become ready.');
        exportCancelled(signal); if (!current() || !artworkRef.current) throw new Error('Movie export was cancelled.');
        for (const text of artworkRef.current.querySelectorAll<HTMLElement>('[data-movie-text]')) if (text.scrollHeight > text.clientHeight + 1) throw new Error(`Memory ${pages.findIndex(page => page.id === request.item.id) + 1} has text that is too long for the movie frame. Shorten that text before exporting; it will not be cut off.`);
        return captureStoryArtwork(artworkRef.current, MEMORY_MOVIE_WIDTH, MEMORY_MOVIE_HEIGHT, signal);
      },
      });await verify();return movie;
    };
    void prepare().then(movie => {
      if (!current()) return;
      const url = URL.createObjectURL(movie.blob); downloaded.current = url;
      const name = (title.trim().replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 70) || 'Platinum memories') + '.' + movie.extension;
      setResult({ url, name, duration: movie.duration, memories: movie.memories });
    }).catch(failure => { if (mounted.current && controller.current === abort) { if (abort.signal.aborted) setCancelled(true); else setError(failure instanceof Error ? failure.message : 'This movie could not be created. Retry.'); }if(accessAbort.current===abort)stopAccess(); }).finally(() => {
      if (controller.current === abort) { controller.current = null; if (mounted.current) { setProgress(null); setArtwork(null); } }
    });
  };
  const downloadReady=async()=>{
    const file=result,session=access.current,scope=accessAbort.current;
    try{
      if(!file||!session||!scope||scope.signal.aborted)throw new Error('Reopen the book before downloading this movie.');
      await session.check();
      const selected=[readSoundtrack(soundtrack),...planMemoryMovie(pages,filmSettings).scenes.map(scene=>memoryPageSoundtrack(pages[scene.sourceIndex]))].filter(value=>!!value);
      for(const selection of new Map(selected.map(value=>[[value.soundId,value.startSec,value.durationSec].join(':'),value])).values())await assertLibraryExportRights(selection,'memory_album',scope.signal);
      if(!mounted.current||access.current!==session||accessAbort.current!==scope||downloaded.current!==file.url||scope.signal.aborted)throw new Error('Movie download was cancelled.');
      const link=document.createElement('a');link.href=file.url;link.download=file.name;link.click();
    }catch(failure){if(mounted.current&&accessAbort.current===scope)setError(failure instanceof Error?failure.message:'The movie download could not be authorized.');}
  };
  return <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Download memory movie" className={s.root} onKeyDown={event => event.stopPropagation()}>
    <section className={s.panel}>
      <header><div className={s.symbol}><Film size={24} /></div><div><span>PLATINUM MEMORIES</span><h2>{result ? 'Your movie is ready' : 'Download your memory movie'}</h2></div><button type="button" data-autofocus aria-label="Close movie download" onClick={close}><X size={22} /></button></header>
      <div className={s.body}>{progress ? <div className={s.progress}><p role="status">{progress.message}</p><div className={s.bar} role="progressbar" aria-label={progress.phase === 'preparing' ? 'Preparing movie' : 'Rendering movie'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><i style={{ width: `${progress.percent}%` }} /></div><strong>{progress.percent}%</strong><p>Keep this tab visible. The movie renders at playback speed. A call or leaving this tab stops the export so the file stays complete.</p><button type="button" className={s.secondary} onClick={() => controller.current?.abort()}>Cancel export</button></div> : result ? <div className={s.complete}><Check size={30} />{error&&<p role="alert">{error}</p>}<p><strong>{title}</strong><br />{result.memories} {result.memories === 1 ? 'memory' : 'memories'} · {Math.floor(Math.ceil(result.duration) / 60)}:{String(Math.ceil(result.duration) % 60).padStart(2, '0')} · 720 × 1280 · {result.name.endsWith('.webm') ? 'WebM' : 'MP4'}</p><p>The file follows your saved movie cut, including its selected memories, timing and title cards. Sound: {[originalAudio ? 'original video sound' : null, score&&!soundtrack ? 'Quiet light' : null, soundtrack?'book soundtrack':null, hasPageAudio?'saved story audio':null, localAudio ? localAudio.file.name : null].filter(Boolean).join(' · ') || 'silent'}. Your book is unchanged.</p><button type="button" className={s.primary} onClick={()=>void downloadReady()}><Download size={18} />Download movie</button><button type="button" className={s.secondary} onClick={close}><ArrowLeft size={17} />Back to memories</button></div> : <>
        <p className={s.description}>Make <strong>{title}</strong> into one movie using your saved cut. Photos, text, saved video trims, color and artwork stay together.</p>
        <div className={s.facts}><span>{pages.length} memories</span><span>Portrait · 720p</span><span>Up to 5 minutes</span></div>
        <label className={s.choice}><input type="checkbox" checked={originalAudio} onChange={event => setOriginalAudio(event.target.checked)} /><span><strong>Original video sound</strong><small>Use each clip’s saved level and mute setting.</small></span></label>
        <label className={s.choice}><input type="checkbox" disabled={!!soundtrack} checked={score&&!soundtrack} onChange={event => setScore(event.target.checked)} /><span><strong>Quiet light</strong><small>Original Platinum Circles instrumental · {Math.round(scoreVolume * 100)}% level · Lowered under video sound.</small></span></label>
        {!soundtrack&&<ExportAudioPicker value={localAudio} onChange={value => { setLocalAudio(value); if (value) setScore(false); }} onBusyChange={setAudioBusy} />}
        <p className={s.note}>The entire book must be supported. Animated stickers, GIFs, a second camera, embedded videos cannot be included yet. Your verified book soundtrack and saved story audio are included after an export-rights check. The download uses MP4 or WebM according to your browser.</p>
        {(limit || error) && <div className={s.error} role="alert"><p>{limit || error}</p>{error && <button type="button" onClick={onRefresh}>Refresh book media</button>}</div>}
        {cancelled && <p className={s.note} role="status">Export cancelled. No file was saved. Your choices are ready when you want to try again.</p>}
      </>}</div>
      {!progress && !result && <footer><button type="button" className={s.secondary} onClick={close}>Back to memories</button><button type="button" className={s.primary} disabled={!!limit || audioBusy} onClick={start}><Download size={18} />{error || cancelled ? 'Retry movie' : 'Create movie'}</button></footer>}
    </section>
    {artwork && <div ref={artworkRef} aria-hidden className={s.artwork}>
      <MemoryStoryFrame page={artwork.item.page as MemoryPage} clock={artwork.clock} layer={artwork.layer}>{style => artwork.item.kind === 'image' ? <NextImage unoptimized width={MEMORY_MOVIE_WIDTH} height={MEMORY_MOVIE_HEIGHT} src={artwork.item.uri!} alt="" style={{ width: '100%', height: '100%', ...style }} /> : artwork.item.kind === 'text' ? <div data-movie-text className={artwork.item.movie.titleCard?s.titlePage:s.textPage}>{artwork.item.excerpt || artwork.item.page.story_caption || artwork.item.page.caption || ''}</div> : null}</MemoryStoryFrame>
      {artwork.layer === 'overlay' && (artwork.item.page.caption && artwork.item.kind !== 'text' || artwork.item.author) && <div className={s.caption}>{artwork.item.kind !== 'text' && <p data-movie-text>{artwork.item.page.caption}</p>}{artwork.item.author && <small>Shared from {artwork.item.author}</small>}</div>}
    </div>}
  </div>;
}
