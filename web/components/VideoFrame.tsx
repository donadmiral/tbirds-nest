'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_MOMENT, preparePausedStill, useVideoFrame } from '@/lib/videoFrames';
import { dataSaverEnabled } from '@/lib/mediaPrefs';

let nativeDecoders=0;
const nativeWaiting=new Set<()=>void>();
function scheduleNative(start:(release:()=>void)=>()=>void){
  let occupied=false, stop:()=>void=()=>{};
  const release=()=>{if(!occupied)return;occupied=false;nativeDecoders--;const next=nativeWaiting.values().next().value;next?.();};
  const run=()=>{nativeWaiting.delete(run);occupied=true;nativeDecoders++;stop=start(release);};
  if(nativeDecoders<2)run();else nativeWaiting.add(run);
  return ()=>{nativeWaiting.delete(run);stop();release();};
}
// Display-only playback surface for a source the browser can present but cannot rasterize, e.g. absent CORS.
// No playback controls, autoplay, sound or canvas read. Do not expose a pre-trim image while seeking.
function NativeStill({url,at,className,alt,onReady,fallback}:{url:string;at:number;className?:string;alt:string;onReady:()=>void;fallback:ReactNode}) {
  const ref=useRef<HTMLVideoElement>(null), [state,setState]=useState<'pending'|'ready'|'failed'>('pending');
  useEffect(()=>{const node=ref.current;if(!node || dataSaverEnabled())return;
    return scheduleNative(release=>{
      if(dataSaverEnabled()){release();return ()=>{};}
      let alive=true;let dispose=()=>{};
      dispose=preparePausedStill(node,url,at,()=>{if(alive){setState('ready');onReady();release();}},()=>{if(alive){dispose();setState('failed');release();}},false);
      return ()=>{alive=false;dispose();};
    });
  },[url,at,onReady]);
  return <>{state!=='ready' && fallback}<video ref={ref} data-video-frame={state==='ready'?'native':state==='failed'?'failed':'native-pending'} aria-label={alt||undefined} aria-hidden={!alt} tabIndex={-1} muted playsInline disablePictureInPicture disableRemotePlayback className={`pointer-events-none absolute inset-0 ${className??''}`} style={{opacity:state==='ready'?1:0}} /></>;
}
export function VideoFrame({ url, at, sourceVersion, className, alt = '', fallback }: { url: string; at?: number | null; sourceVersion?: string; className?: string; alt?: string; fallback: ReactNode }) {
  const anchor=useRef<HTMLSpanElement>(null),[near,setNear]=useState(false),[visible,setVisible]=useState(false);
  useEffect(()=>{const node=anchor.current;if(!node)return;
    if(typeof IntersectionObserver!=='function'){setNear(true);setVisible(true);return;}
    const warm=new IntersectionObserver(entries=>setNear(entries.some(e=>e.isIntersecting)),{rootMargin:'600px'});
    const onScreen=new IntersectionObserver(entries=>setVisible(entries.some(e=>e.isIntersecting)));
    warm.observe(node);onScreen.observe(node);return ()=>{warm.disconnect();onScreen.disconnect();};
  },[]);
  const moment=at??DEFAULT_MOMENT,frame=useVideoFrame(near?url:null,moment,sourceVersion);
  return <span ref={anchor} className="relative block h-full w-full" data-video-frame={frame.src || (visible && frame.nativeKey) ? undefined : near?frame.state:'idle'}>
    {frame.src ? <img src={frame.src} alt={alt} decoding="async" draggable={false} className={className} data-video-frame="ready" />
      : visible && frame.nativeKey ? <NativeStill key={frame.nativeKey} url={url} at={moment} className={className} alt={alt} onReady={frame.nativeReady} fallback={fallback}/>:fallback}
  </span>;
}
