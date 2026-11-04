'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Maximize2, Minimize2, PictureInPicture2, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getNavigationStore } from '@/lib/navigationCache';
import { getLivePlayback, liveError, type LivePlayback } from '@/lib/liveApi';
import type { LiveSession } from '../../shared/liveDirectory';
import type Hls from 'hls.js';

type PlaybackContext = { session: LiveSession | null; status: string; error: string | null; time: number; duration: number; open(session: LiveSession,startAt?:number): void; close(): void; minimize(): void; seek(seconds: number): void; slot(id: string,node: HTMLElement | null): void; };
const Context=createContext<PlaybackContext|null>(null);
export const useLivePlayback=()=>{const value=useContext(Context);if(!value)throw Error('Live playback provider missing');return value;};
export function LivePlaybackProvider({children}:{children:React.ReactNode}) {
  const [client]=useState(createClient),[navigation]=useState(getNavigationStore),router=useRouter();
  const identity=useSyncExternalStore(navigation.subscribe,navigation.getSnapshot,navigation.getServerSnapshot);
  const [active,setActive]=useState<{session:LiveSession;scope:string|null}|null>(null);
  const [media,setMedia]=useState<LivePlayback|null>(null),[status,setStatus]=useState('idle'),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState('');
  const [time,setTime]=useState(0),[duration,setDuration]=useState(0),[dock,setDock]=useState(false),[rect,setRect]=useState<DOMRect|null>(null),[retry,setRetry]=useState(0);
  const video=useRef<HTMLVideoElement>(null),host=useRef<HTMLDivElement>(null),hls=useRef<Hls|null>(null),target=useRef<{id:string;node:HTMLElement}|null>(null),activeRef=useRef(active),generation=useRef(0);
  activeRef.current=active;
  const pendingSeek=useRef<number|null>(null);
  const close=useCallback(()=>{generation.current++;pendingSeek.current=null;video.current?.pause();hls.current?.destroy();hls.current=null;setActive(null);setMedia(null);setStatus('idle');setError(null);setNotice('');setTime(0);setDuration(0);},[]);
  useEffect(()=>{if(active && active.scope!==identity.scope)close();},[active,identity.scope,close]);
  const measure=useCallback(()=>{
    const entry=target.current;
    setRect(entry && entry.id===activeRef.current?.session.id ? entry.node.getBoundingClientRect() : null);
  },[]);
  const slot=useCallback((id:string,node:HTMLElement|null)=>{
    if(node)target.current={id,node};else if(target.current?.id===id)target.current=null;
    measure();
  },[measure]);
  useEffect(()=>{
    if(!active?.session.id)return;
    let frame=0;const update=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;measure();});};
    const observer=new ResizeObserver(update);observer.observe(document.documentElement);
    window.addEventListener('scroll',update,{passive:true,capture:true});window.addEventListener('resize',update);measure();
    return()=>{observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener('scroll',update,true);window.removeEventListener('resize',update);};
  },[measure,active?.session.id]);
  useEffect(()=>{
    if(!active || active.scope!==identity.scope)return;
    let alive=true,inFlight=false,timer:ReturnType<typeof setTimeout>|undefined;
    const version=++generation.current;setStatus('loading');setError(null);setMedia(null);
    const load=async()=>{
      if(!alive || version!==generation.current||inFlight)return;
      inFlight=true;clearTimeout(timer);
      try{
        const value=await getLivePlayback(client,active.session.id);
        if(!alive || version!==generation.current)return;
        setMedia(value);setError(null);
        const refresh=Math.max(5000,Math.min(90000,Date.parse(value.expires_at)-Date.now()-20000-Math.random()*5000));
        timer=setTimeout(()=>{if(document.visibilityState==='visible'||document.pictureInPictureElement)void load();},refresh);
      }catch(e){if(alive && version===generation.current){setError(liveError(e));setStatus('error');video.current?.pause();hls.current?.stopLoad();}}finally{inFlight=false;}
    };
    const visible=()=>{if(document.visibilityState==='visible'){clearTimeout(timer);void load();}else if(!document.pictureInPictureElement){clearTimeout(timer);video.current?.pause();}};
    void load();document.addEventListener('visibilitychange',visible);
    return()=>{alive=false;clearTimeout(timer);document.removeEventListener('visibilitychange',visible);};
  },[active?.session.id,active?.scope,identity.scope,client,retry]);
  useEffect(()=>{
    const element=video.current;if(!element||!media)return;
    let alive=true;const before=element.currentTime,wasPlaying=!element.paused;
    const restore=()=>{if(!alive)return;const position=pendingSeek.current??before;pendingSeek.current=null;if(!media.live&&position>0&&Number.isFinite(element.duration))element.currentTime=Math.min(position,element.duration);if(wasPlaying||before===0)void element.play().catch(()=>{if(alive)setStatus('ready');});};
    // Register before attaching a source so a cached manifest cannot race this listener.
    element.addEventListener('loadedmetadata',restore,{once:true});
    delete element.dataset.livePlaybackFailure;
    const attach=async()=>{
      hls.current?.destroy();hls.current=null;
      // Some Chromium builds report native HLS support but fail before loading
      // a rendition. Prefer the tested MSE pipeline; retain native-only Safari.
      const {default:HlsPlayer}=await import('hls.js');if(!alive)return;
      if(HlsPlayer.isSupported()){
        element.dataset.livePlaybackEngine='mse';
        const engine=new HlsPlayer({enableWorker:true,lowLatencyMode:true,maxBufferLength:20,maxMaxBufferLength:30,backBufferLength:15,manifestLoadingMaxRetry:2,fragLoadingMaxRetry:2});hls.current=engine;
        engine.on(HlsPlayer.Events.ERROR,(_event,detail)=>{
          if(!alive)return;
          // Only an enumerated error category, never a signed URL or provider payload.
          element.dataset.livePlaybackFailure=String(detail.details).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
          if(!detail.fatal)return;
          setError('Playback stopped. Retry to reconnect to the stream.');setStatus('error');engine.stopLoad();
        });
        engine.loadSource(media.url);engine.attachMedia(element);
      }else if(element.canPlayType('application/vnd.apple.mpegurl')){
        element.dataset.livePlaybackEngine='native';element.src=media.url;
      }else{
        element.dataset.livePlaybackEngine='unsupported';
        setError('This browser cannot play this stream. Try another supported browser.');setStatus('error');
      }
    };
    void attach().catch(()=>{if(alive){setError('The video player could not load. Retry to reconnect.');setStatus('error');}});
    return()=>{alive=false;element.removeEventListener('loadedmetadata',restore);hls.current?.destroy();hls.current=null;};
  },[media]);
  useEffect(()=>()=>{video.current?.pause();hls.current?.destroy();},[]);
  const open=useCallback((session:LiveSession,startAt?:number)=>{
    if(!identity.scope)return;
    if(activeRef.current?.session.id!==session.id)pendingSeek.current=null;
    if(startAt!==undefined&&Number.isFinite(startAt))pendingSeek.current=Math.max(0,startAt);
    setDock(false);
    setActive(previous=>previous?.session.id===session.id&&previous.scope===identity.scope?{...previous,session}:{session,scope:identity.scope});
    setTimeout(measure,0);
  },[identity.scope,measure]);
  const seek=useCallback((seconds:number)=>{if(!Number.isFinite(seconds))return;const element=video.current;if(element&&element.readyState>0)element.currentTime=Math.max(0,Math.min(seconds,Number.isFinite(element.duration)?element.duration:seconds));else pendingSeek.current=Math.max(0,seconds);},[]);
  const value=useMemo(()=>({session:active?.scope===identity.scope?active.session:null,status,error,time,duration,open,close,minimize:()=>setDock(true),seek,slot}),[active,identity.scope,status,error,time,duration,open,close,seek,slot]);
  const floating=dock||!rect||rect.bottom<60||rect.top>windowHeight();
  const style:CSSProperties=floating?{position:'fixed',right:16,bottom:90,width:'min(360px, calc(100vw - 32px))',zIndex:70}:{position:'fixed',left:rect!.left,top:rect!.top,width:rect!.width,height:rect!.height,zIndex:25};
  return <Context.Provider value={value}>{children}{active&&active.scope===identity.scope?<div ref={host} style={style} className="overflow-hidden rounded-2xl border border-white/10 bg-black shadow-lg" data-live-player data-floating={floating}>
    <div className="relative aspect-video h-full max-h-full"><video ref={video} controls playsInline autoPlay preload="metadata" poster={media?.poster_url||undefined} className="h-full w-full bg-black object-contain" aria-label={active.session.title} onTimeUpdate={e=>{const next=Math.floor(e.currentTarget.currentTime*10)/10;setTime(previous=>Math.floor(previous)===Math.floor(next)?previous:next);}} onDurationChange={e=>setDuration(Number.isFinite(e.currentTarget.duration)?e.currentTarget.duration:0)} onPlaying={()=>{setStatus('playing');setError(null);}} onWaiting={()=>setStatus('buffering')} onPause={()=>setStatus('paused')} onError={()=>{setError('The stream could not play. Retry to reconnect.');setStatus('error');}}>
      {media?.tracks.map(track=><track key={track.src} kind="subtitles" src={track.src} srcLang={track.language} label={track.label}/>)}
    </video>
    {!media||error?<div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 p-5 text-center text-white"><p role={error?'alert':'status'} className="text-sm">{error||'Connecting to stream…'}</p>{error?<button type="button" onClick={()=>setRetry(n=>n+1)} className="mt-4 min-h-11 rounded-full bg-white px-5 text-sm font-semibold text-black">Retry playback</button>:null}</div>:null}
    {notice?<p role="status" className="absolute inset-x-3 bottom-12 rounded-lg bg-black/85 p-2 text-xs text-white">{notice}<button type="button" aria-label="Dismiss playback message" onClick={()=>setNotice('')} className="ml-2 px-2">×</button></p>:null}
    <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/80 to-transparent p-2 text-white"><Link href={'/live/'+active.session.id} onClick={()=>{setDock(false);setTimeout(measure,0);}} className="min-w-0 truncate rounded px-2 py-2 text-sm font-semibold">{active.session.title}</Link><div className="flex shrink-0 gap-1">
      <button type="button" title="Picture in Picture" aria-label="Picture in Picture" onClick={async()=>{try{if(!video.current?.requestPictureInPicture||!document.pictureInPictureEnabled)throw Error();await video.current.requestPictureInPicture();}catch{setNotice('Picture in Picture is unavailable in this browser. Use Minimize to keep watching here.');}}} className="grid h-9 w-9 place-items-center rounded-lg bg-black/40"><PictureInPicture2 size={17}/></button>
      <button type="button" title={floating?'Expand player':'Minimize player'} aria-label={floating?'Expand player':'Minimize player'} onClick={()=>{if(floating&&!target.current){setDock(false);router.push('/live/'+active.session.id);return;}setDock(v=>!v);measure();}} className="grid h-9 w-9 place-items-center rounded-lg bg-black/40">{floating?<Maximize2 size={17}/>:<Minimize2 size={17}/>}</button>
      <button type="button" title="Close player" aria-label="Close player" onClick={close} className="grid h-9 w-9 place-items-center rounded-lg bg-black/40"><X size={17}/></button>
    </div></div></div>
  </div>:null}</Context.Provider>;
}
function windowHeight(){return typeof window==='undefined'?1000:window.innerHeight;}
export function LivePlayerSlot({session}:{session:LiveSession}) {
  const playback=useLivePlayback();const node=useRef<HTMLDivElement>(null);
  useEffect(()=>{playback.slot(session.id,node.current);return()=>playback.slot(session.id,null);},[session.id,playback.slot]);
  const same=playback.session?.id===session.id;
  return <div ref={node} className="grid aspect-video w-full place-items-center overflow-hidden rounded-2xl bg-black p-5 text-white"><div className="text-center">{same?<p className="text-sm">Your stream is playing. Use the player controls to expand or minimize.</p>:<button type="button" onClick={()=>playback.open(session)} className="min-h-12 rounded-full bg-white px-7 text-sm font-semibold text-black">{session.state==='ended'?'Watch replay':'Watch live'}</button>}</div></div>;
}
