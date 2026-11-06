'use client';
/**
 * The browser side of video frames: one hidden decoder per capture, released as soon as it has drawn; one store for the
 * visit, forgotten whenever the signed-in person changes; and the hook a still uses to ask for its frame. A capture
 * takes the first decoded picture unless the author chose a time. No default seek competes with the first picture. A video served without cross-origin headers taints
 * the canvas and gives no frame rather than a broken one. The data-saver preference means no video bytes are fetched
 * for a still at all.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { createVideoFrameCache, frameKey, IDLE, type FrameState } from './videoFrameCache';
import { dataSaverEnabled } from './mediaPrefs';
import { getNavigationStore } from './navigationCache';
import { isContentCapability } from '../../shared/contentMedia';

const MAX_WIDTH = 640;
// Legacy posts have no chosen timestamp. The first decoded picture needs no seek or second range request.
export const DEFAULT_MOMENT = 0;
export type StillFailure = 'metadata-timeout' | 'seek-timeout' | 'decode-timeout' | 'media' | 'canvas';
// A single 12 s clock was shared by the HTTP metadata request, seek and decoding. Start a separate bounded
// phase when metadata arrives. Retain a hard wall-clock limit even if a browser repeatedly emits media events.
export function preparePausedStill(video: HTMLVideoElement, url: string, at: number, ready: () => void, fail: (reason:StillFailure) => void, canvasReadable:boolean) {
  let done=false, phase: 'metadata'|'seek'|'decode'='metadata', target=0, metadata=false, seekFinished=true;
  let timer:ReturnType<typeof setTimeout>;
  const release=()=>{clearTimeout(timer);clearTimeout(hard);video.onloadedmetadata=null;video.onloadeddata=null;video.oncanplay=null;video.onseeked=null;video.onerror=null;};
  const stop=(reason:StillFailure)=>{if(!done){done=true;release();fail(reason);}};
  const hard=setTimeout(()=>stop(`${phase}-timeout`),42_000);
  const arm=(next:typeof phase,ms:number)=>{phase=next;clearTimeout(timer);timer=setTimeout(()=>stop(`${phase}-timeout`),ms);};
  const inspect=()=>{if(done || !metadata || !seekFinished || video.seeking || (target>0 && Math.abs(video.currentTime-target)>.1))return;
    if(phase==='seek')arm('decode',16_000);
    if(video.readyState<2 || !video.videoWidth || !video.videoHeight)return;
    done=true;release();video.preload='metadata';ready();
  };
  // The inline fallback displays pixels through the native element only. It never reads a cross-origin canvas.
  if(canvasReadable)video.crossOrigin='anonymous';
  video.muted=true;video.defaultMuted=true;video.playsInline=true;video.autoplay=false;video.controls=false;video.preload='metadata';
  video.onerror=()=>stop('media');video.onloadeddata=inspect;video.oncanplay=inspect;video.onseeked=()=>{seekFinished=true;inspect();};
  video.onloadedmetadata=()=>{if(done || metadata)return;metadata=true;
    target=Number.isFinite(at)&&at>0 ? (Number.isFinite(video.duration)?Math.min(at,Math.max(0,video.duration-.05)):at) : 0;
    if(target>0 && Math.abs(video.currentTime-target)>.02){seekFinished=false;arm('seek',16_000);try{video.currentTime=target;}catch{stop('media');return;}}
    else arm('decode',16_000);
    if(video.readyState<2)video.preload='auto';inspect();
  };
  arm('metadata',18_000);video.src=url;
  return ()=>{done=true;release();video.pause();video.removeAttribute('src');video.load();};
}
export function captureVideoFrame(url: string, at: number, signal: AbortSignal, maxWidth = MAX_WIDTH): Promise<string> {
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(Error('cancelled'));return;}
    const video=document.createElement('video');
    let cleanup=()=>{};
    const cancel=()=>{cleanup();reject(Error('cancelled'));};
    const finish=()=>{signal.removeEventListener('abort',cancel);cleanup();};
    signal.addEventListener('abort',cancel,{once:true});
    cleanup=preparePausedStill(video,url,at,()=>{
      try {
        const canvas=document.createElement('canvas'), scale=Math.min(1,maxWidth/Math.max(video.videoWidth,video.videoHeight));
        canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
        const context=canvas.getContext('2d');if(!context)throw Error('canvas');
        context.drawImage(video,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',.72);
        if(!data.startsWith('data:image/jpeg'))throw Error('canvas');finish();resolve(data);
      }catch{finish();reject(Error('canvas'));}
    },reason=>{finish();reject(Error(reason));},true);
  });
}

let cache: ReturnType<typeof createVideoFrameCache> | null = null;
/** The store for this browser visit; none on the server, where no viewer data may live in a module. */
export function getVideoFrameCache() {
  if (typeof window === 'undefined') return null;
  if (cache) return cache;
  const store = cache = createVideoFrameCache({ capture: captureVideoFrame });
  const navigation = getNavigationStore();
  let scope = navigation.getSnapshot().scope;
  navigation.subscribe(() => { const next = navigation.getSnapshot().scope; if (next !== scope) { scope = next; store.reset(); } });
  return store;
}

/** The frame for a video URL, requested once the caller passes a URL; null until then, and never under data saver. */
export function useVideoFrame(url: string | null | undefined, at: number = DEFAULT_MOMENT, sourceVersion?: string): FrameState & { nativeKey: string | null; nativeReady: () => void } {
  const store = getVideoFrameCache();
  const navigation = getNavigationStore();
  const session = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getServerSnapshot);
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const [origin, setOrigin] = useState({ url, scope: session.scope, pending: !session.initialized });
  const grant = origin.url !== url || (origin.pending && session.initialized && !session.changed)
    ? { url, scope: session.scope, pending: !session.initialized } : origin;
  if (grant !== origin) setOrigin(grant);
  const protectedSource = !!url && isContentCapability(url, base);
  const allowed = !!url && (!protectedSource || (!!session.scope && grant.scope === session.scope));
  const identity = allowed && url ? JSON.stringify([protectedSource && !sourceVersion ? url : frameKey(url, base), sourceVersion ?? '', at]) : null;
  const [saver, setSaver] = useState(dataSaverEnabled);
  useEffect(() => {
    const read = () => setSaver(dataSaverEnabled());
    read(); window.addEventListener('pc-media-preferences', read);
    return () => window.removeEventListener('pc-media-preferences', read);
  }, []);
  const [foreground,setForeground]=useState(()=>typeof document==='undefined' || !document.hidden);
  useEffect(()=>{const read=()=>setForeground(!document.hidden);read();document.addEventListener('visibilitychange',read);return ()=>document.removeEventListener('visibilitychange',read);},[]);
  const key = !saver && foreground ? identity : null;
  const subscribe = useCallback((listener: () => void) => (store && key ? store.subscribe(key, listener) : () => {}), [store, key]);
  const read = useCallback(() => (store && key ? store.peek(key) : IDLE), [store, key]);
  const snapshot = useSyncExternalStore(subscribe, read, () => IDLE);
  // asked again when the store forgets the frame (another person signed in), not while it loads or has recently failed
  useEffect(() => { if (store && key && url && !saver && !dataSaverEnabled() && (snapshot.state === 'idle' || snapshot.state === 'failed')) store.request(key, url, at); }, [store, key, url, at, saver, snapshot.state]);
  const nativeReady=useCallback(()=>{if(key && url)store?.nativeReady(key,url);},[key,url,store]);
  return {...snapshot,nativeKey:store && key && url && snapshot.state==='failed' && store.failedFor(key,url) ? JSON.stringify([session.scope,key,url]) : null,nativeReady};
}
