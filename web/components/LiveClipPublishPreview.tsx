'use client';
import {useEffect,useRef,useState} from 'react';
import {clipDownload} from '@/lib/liveClips';
import type {LiveClient} from '@/lib/liveApi';

export function LiveClipPublishPreview({client,clipId,format,title,onReady}:{client:LiveClient;clipId:string;format:string;title:string;onReady(value:boolean):void}){
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[retry,setRetry]=useState(0),video=useRef<HTMLVideoElement>(null);
 useEffect(()=>{let active=true;setUrl('');setError('');onReady(false);void clipDownload(client,clipId,format).then(asset=>{if(active)setUrl(asset.url);}).catch(()=>{if(active)setError('The preview could not load. Refresh it before confirming this post.');});return()=>{active=false;video.current?.pause();};},[client,clipId,format,retry,onReady]);
 return <section aria-label="Post video preview" className="overflow-hidden rounded-2xl border border-ink/10 bg-surface"><div className="flex min-h-40 items-center justify-center bg-black">{url?<video key={format+':'+retry} ref={video} src={url} controls playsInline preload="metadata" aria-label={'Preview: '+title} className="max-h-96 w-full object-contain" onLoadedMetadata={()=>onReady(true)} onError={()=>{onReady(false);setError('The preview could not load or its video link expired. Refresh it before posting.');}}/>:<p role="status" className="p-6 text-sm text-white">{error?'Preview unavailable':'Loading preview…'}</p>}</div>{error?<p role="alert" className="p-4 text-sm text-ink">{error}</p>:null}<button type="button" onClick={()=>setRetry(value=>value+1)} className="min-h-11 px-4 text-sm text-ink underline">Refresh video preview</button></section>;
}
