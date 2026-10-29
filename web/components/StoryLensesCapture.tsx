"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, Camera, FlipHorizontal2, LoaderCircle, Search, Video, X } from 'lucide-react';
import { createCameraKitCaptureBridge } from '../../src/screens/stories/cameraKitBridge';
import { browserCameraKitHtml, cameraKitFile } from '../lib/cameraKitCapture';
import styles from './StoryLensesCapture.module.css';

type Lens = { id: string; groupId: string; name: string; iconUrl?: string | null };
type Phase = 'idle' | 'applying' | 'starting' | 'recording' | 'saving';
const apiToken = process.env.NEXT_PUBLIC_CAMERAKIT_API_TOKEN;
const lensGroupId = process.env.NEXT_PUBLIC_CAMERAKIT_LENS_GROUP_ID;

export function StoryLensesCapture({ onCapture, onClose, onBack }: { onCapture: (file: File) => Promise<void>; onClose: () => void; onBack: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null), alive = useRef(true), readyRef = useRef(false);
  const dialog = useRef<HTMLElement>(null);
  const generation = useRef(0);
  const bridge = useRef(createCameraKitCaptureBridge(25000));
  const files = useRef(new Map<string, File>()), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacks = useRef({ onCapture, onClose }); callbacks.current = { onCapture, onClose };
  const [html, setHtml] = useState(''), [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false), [phase, setPhase] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  const [mode, setMode] = useState<'photo' | 'video'>('photo'), [error, setError] = useState('');
  const [lenses, setLenses] = useState<Lens[]>([]), [selected, setSelected] = useState<string | null>(null), [query, setQuery] = useState('');
  const [seconds, setSeconds] = useState(0), [keyboardOffset, setKeyboardOffset] = useState(0);
  const updatePhase = useCallback((next: Phase) => { phaseRef.current = next; if (alive.current) setPhase(next); }, []);
  const send = useCallback((message: object) => {
    if (!frame.current?.contentWindow || !alive.current) throw Error('The Lens camera is closed. Reopen it to continue.');
    frame.current.contentWindow.postMessage(JSON.stringify(message), window.location.origin);
  }, []);
  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const fail = useCallback((message: string, fatal = false) => {
    clearTimer(); bridge.current.fail(message); updatePhase('idle');
    if (fatal) { readyRef.current = false; setReady(false); }
    if (alive.current) setError(message);
  }, [updatePhase]);
  useEffect(() => {
    const opener = document.activeElement;
    dialog.current?.focus();
    return () => { if (typeof HTMLElement !== 'undefined' && opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, []);
  useEffect(() => {
    alive.current = true; generation.current++;
    if (!apiToken || !lensGroupId) return;
    void import('../../src/screens/stories/cameraKitEngine').then(engine => {
      if (alive.current) setHtml(browserCameraKitHtml(engine.CAMERA_KIT_ENGINE_HTML, window.location.origin));
    }).catch(() => fail('The Lens camera could not load. Try again or return to the other capture modes.', true));
    const receive = (event: MessageEvent) => {
      if (!alive.current || event.source !== frame.current?.contentWindow || event.origin !== window.location.origin || typeof event.data?.platinumCameraKit !== 'string') return;
      let message: any; try { message = JSON.parse(event.data.platinumCameraKit); } catch { return; }
      if (message.type === 'ready') { clearTimer(); readyRef.current = true; setReady(true); setError(''); }
      else if (message.type === 'lenses') setLenses(Array.isArray(message.lenses) ? message.lenses.filter((lens: any) => typeof lens?.id === 'string' && typeof lens?.name === 'string' && typeof lens?.groupId === 'string') : []);
      else if (message.type === 'lensApplied') { setSelected(typeof message.lensId === 'string' ? message.lensId : null); if (phaseRef.current === 'applying') { clearTimer(); updatePhase('idle'); } }
      else if (message.type === 'flipped' && phaseRef.current === 'applying') { clearTimer(); updatePhase('idle'); }
      else if (message.type === 'recording' && message.state === 'started' && phaseRef.current === 'starting') { clearTimer(); setSeconds(0); updatePhase('recording'); }
      else if (message.type === 'error') fail(message.operation === 'startVideo' ? 'Video recording could not start. Check microphone access, or choose Photo.' : message.operation === 'loadGroup' ? 'Your available lenses could not load. Please retry.' : 'This Lens could not finish. Check camera access, then retry or choose another capture mode.', ['init', 'render', 'dispose'].includes(message.operation));
      else if (['photo', 'video'].includes(message.type) && typeof message.requestId === 'string') {
        void bridge.current.complete(message.requestId, message.type, async () => {
          const file = cameraKitFile(message.dataUrl, message.type), url = URL.createObjectURL(file); files.current.set(url, file); return url;
        }, url => { URL.revokeObjectURL(url); files.current.delete(url); });
      }
    };
    const visibility = () => {
      if (document.hidden) { try { send({ type: 'dispose' }); } catch {} fail('The camera paused while this page was away. Reopen it to continue.', true); }
    };
    const viewport = () => setKeyboardOffset(Math.max(0, window.innerHeight - (window.visualViewport?.height ?? window.innerHeight) - (window.visualViewport?.offsetTop ?? 0)));
    window.addEventListener('message', receive); document.addEventListener('visibilitychange', visibility);
    window.visualViewport?.addEventListener('resize', viewport); window.visualViewport?.addEventListener('scroll', viewport);
    return () => {
      try { send({ type: 'dispose' }); } catch {} alive.current = false; generation.current++; readyRef.current = false; clearTimer(); bridge.current.fail('The Lens camera was closed.');
      files.current.forEach((_file, url) => URL.revokeObjectURL(url)); files.current.clear();
      window.removeEventListener('message', receive); document.removeEventListener('visibilitychange', visibility);
      window.visualViewport?.removeEventListener('resize', viewport); window.visualViewport?.removeEventListener('scroll', viewport);
    };
  }, [attempt, fail, send, updatePhase]);
  const capture = useCallback(async (kind: 'photo' | 'video') => {
    if (!readyRef.current || !alive.current || (kind === 'photo' ? phaseRef.current !== 'idle' : phaseRef.current !== 'recording')) return;
    const requestGeneration = generation.current;
    updatePhase('saving'); setError('');
    let url = '';
    try {
      url = await bridge.current.request(kind, requestId => send({ type: kind === 'photo' ? 'capturePhoto' : 'stopVideo', requestId }));
      if (!alive.current || requestGeneration !== generation.current || document.hidden) return;
      const file = files.current.get(url); if (!file) throw Error('The captured file is no longer available. Please try again.');
      await callbacks.current.onCapture(file);
      if (alive.current && requestGeneration === generation.current) callbacks.current.onClose();
    } catch (failure) { if (alive.current && requestGeneration === generation.current) fail(failure instanceof Error ? failure.message : 'This capture could not be saved.'); }
    finally { if (url) { URL.revokeObjectURL(url); files.current.delete(url); } if (alive.current && requestGeneration === generation.current) updatePhase('idle'); }
  }, [fail, send, updatePhase]);
  useEffect(() => {
    if (phase !== 'recording') return;
    const started = Date.now(), interval = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    const limit = setTimeout(() => void capture('video'), 60000);
    return () => { clearInterval(interval); clearTimeout(limit); };
  }, [phase, capture]);
  const initialize = () => {
    if (!apiToken || !lensGroupId) return;
    readyRef.current = false; setReady(false); clearTimer();
    timer.current = setTimeout(() => fail('The Lens camera took too long to open. Retry or return to the other capture modes.', true), 25000);
    try { send({ type: 'init', apiToken, lensGroupId, facing: 'user' }); } catch (failure) { fail(String(failure), true); }
  };
  const shutter = () => {
    if (!readyRef.current || !alive.current) return;
    if (phaseRef.current === 'recording') { void capture('video'); return; }
    if (phaseRef.current !== 'idle') return;
    if (mode === 'photo') { void capture('photo'); return; }
    updatePhase('starting'); setError('');
    timer.current = setTimeout(() => { try { send({ type: 'dispose' }); } catch {} fail('Video recording did not start. Reopen the camera to try again.', true); }, 25000);
    try { send({ type: 'startVideo' }); } catch (failure) { fail(failure instanceof Error ? failure.message : 'Video recording could not start.'); }
  };
  const retry = () => { generation.current++; readyRef.current = false; setReady(false); setError(''); setLenses([]); setSelected(null); updatePhase('idle'); setAttempt(value => value + 1); };
  const leave = (next: () => void) => { try { send({type:'dispose'}); } catch {} alive.current=false; generation.current++; readyRef.current=false; clearTimer(); bridge.current.fail('The Lens camera was closed.'); next(); };
  const updateCamera = (message: object) => {
    if (!readyRef.current || !alive.current || phaseRef.current !== 'idle') return;
    (document.activeElement as HTMLElement)?.blur?.(); updatePhase('applying'); setError(''); clearTimer();
    timer.current = setTimeout(() => { try { send({ type: 'dispose' }); } catch {} fail('The camera update took too long. Reopen lenses to try again.', true); }, 25000);
    try { send(message); } catch (failure) { fail(failure instanceof Error ? failure.message : 'The camera could not update.'); }
  };
  const filtered = lenses.filter(lens => lens.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <section ref={dialog} tabIndex={-1} className={styles.camera} role="dialog" aria-modal="true" aria-label="Snapchat Lens camera" style={{ '--keyboard-offset': `${keyboardOffset}px` } as CSSProperties} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); leave(onClose); return; }
    if (event.key !== 'Tab') return;
    const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[tabindex="0"]') ?? []).filter(node => node.offsetParent !== null);
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); dialog.current?.focus(); }
    else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
  }}>
    {html && apiToken && lensGroupId ? <iframe ref={frame} key={attempt} tabIndex={-1} title="Live Snapchat Lens preview" srcDoc={html} allow="camera; microphone" className={styles.preview} onLoad={initialize} /> : null}
    <header className={styles.header}><button type="button" aria-label="Back to capture modes" onClick={()=>leave(onBack)}><ArrowLeft size={22}/></button><span>Snapchat lenses</span><button type="button" aria-label="Close Lens camera" onClick={()=>leave(onClose)}><X size={23}/></button></header>
    {!apiToken || !lensGroupId ? <div className={styles.notice}><Camera size={32}/><h2>Lenses are unavailable here</h2><p>You can keep creating with the other capture modes.</p><button type="button" onClick={onBack}>Back to camera</button></div> : error ? <div className={styles.notice} role="alert"><p>{error}</p><button type="button" onClick={retry}>Try lenses again</button><button type="button" onClick={onBack}>Other capture modes</button></div> : !ready ? <div className={styles.notice} aria-live="polite"><LoaderCircle className={styles.loading} size={28}/><p>Opening your Lens camera…</p></div> : null}
    {ready && !error ? <div className={styles.dock}>
      <label className={styles.search}><Search size={18}/><input aria-label="Search available Snapchat lenses" placeholder="Search your lenses" value={query} onChange={event => setQuery(event.target.value)} disabled={phase !== 'idle'}/>{query ? <button type="button" aria-label="Clear lens search" onClick={()=>setQuery('')}><X size={18}/></button> : null}</label>
      <div className={styles.lenses} aria-label="Available Snapchat lenses"><button type="button" aria-pressed={!selected} disabled={phase !== 'idle'} onClick={()=>updateCamera({type:'applyLens',lensId:null,groupId:lensGroupId})}><span className={styles.thumbnail}><Camera size={23}/></span><span>Original</span></button>{filtered.map(lens=><button type="button" key={lens.id} aria-pressed={selected===lens.id} disabled={phase!=='idle'} onClick={()=>updateCamera({type:'applyLens',lensId:lens.id,groupId:lens.groupId})}><span className={styles.thumbnail}>{lens.iconUrl?<img src={lens.iconUrl} alt=""/>:<Camera size={23}/>}</span><span>{lens.name}</span></button>)}</div>
      {!filtered.length?<p className={styles.caption}>{query?'No available Lens matches this search.':'Your Lens Group has no available lenses yet.'}</p>:null}
      <div className={styles.modes} role="tablist" aria-label="Lens capture mode">{(['photo','video'] as const).map(value=><button key={value} type="button" role="tab" aria-selected={mode===value} disabled={phase!=='idle'} onClick={()=>setMode(value)}>{value==='photo'?'Photo':'Video'}</button>)}</div>
      <div className={styles.shutterRow}><button type="button" className={styles.flip} aria-label="Switch Lens camera" disabled={phase!=='idle'} onClick={()=>updateCamera({type:'flip'})}><FlipHorizontal2 size={22}/></button><button type="button" className={styles.shutter} data-recording={phase==='recording'} aria-label={phase==='recording'?'Stop Lens recording':mode==='photo'?'Take Lens photo':'Record Lens video'} disabled={!ready||phase==='applying'||phase==='starting'||phase==='saving'} onClick={shutter}>{phase==='applying'||phase==='starting'||phase==='saving'?<LoaderCircle className={styles.loading} size={28}/>:<span/>}</button><span className={styles.duration}>{phase==='recording'?`${seconds}s`:mode==='video'?<Video size={22}/>:<Camera size={22}/>}</span></div>
      <p className={styles.caption} aria-live="polite">{phase==='applying'?'Updating your camera…':phase==='saving'?'Preparing your capture…':phase==='starting'?'Starting your recording…':phase==='recording'?'Tap to finish recording':mode==='photo'?'Capture with your selected Lens':'Record up to 60 seconds'}</p>
    </div>:null}
  </section>;
}
