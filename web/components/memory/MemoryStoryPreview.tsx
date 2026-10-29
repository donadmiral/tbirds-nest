"use client";
import {useEffect,useRef,useState} from 'react';
import {ImageOff,Play,Type} from 'lucide-react';

type StoryPreview = {
  media_type: string; media_url: string|null; thumbnail_url: string|null; caption: string|null;
  text_background?: {color?:string;colors?:string[]} | string | null;
  stickers_json?: unknown;
};
/** Decorative preview inside an already labelled selection button. */
export function MemoryStoryPreview({story}:{story:StoryPreview}) {
  const [failedImages,setFailedImages]=useState<Set<string>>(new Set()),[failedVideo,setFailedVideo]=useState(false),[visible,setVisible]=useState(false);
  const root=useRef<HTMLSpanElement|null>(null);
  useEffect(()=>{
    if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}
    const node=root.current;if(!node)return;
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'150px'});
    observer.observe(node);return()=>observer.disconnect();
  },[]);
  const video=story.media_type==='video';
  const textStory=story.media_type==='text'||!story.media_url&&!story.thumbnail_url&&story.media_type!=='image'&&!video;
  const sticker=Array.isArray(story.stickers_json)?story.stickers_json.find((s:any)=>s?.kind==='post'):null;
  const text=story.caption?.trim()||(sticker as any)?.postText||(sticker?'Shared post':'Story');
  const bg=typeof story.text_background==='object'&&story.text_background?story.text_background:null;
  const colors=bg?.colors?.filter(c=>/^#[0-9a-f]{6}$/i.test(c)).slice(0,2);
  const background=colors?.length===2?`linear-gradient(160deg,${colors.join(',')})`:bg?.color&&/^#[0-9a-f]{6}$/i.test(bg.color)?bg.color:'#0B1E3D';
  const image=[story.thumbnail_url,!video?story.media_url:null].find(url=>url&&!failedImages.has(url))||null;
  return <span ref={root} aria-hidden="true" className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[#0B1E3D] text-white">
    {textStory?<span className="relative flex h-full w-full items-center justify-center p-3" style={{background}}><span className="absolute inset-0 bg-black/55"/><span className="relative line-clamp-6 whitespace-pre-wrap text-center text-[13px] font-semibold leading-relaxed">{text}</span><Type size={13} className="absolute left-2 top-2"/></span>
      :image?<img src={image} alt="" loading="lazy" onError={()=>setFailedImages(prev=>new Set(prev).add(image))} className="h-full w-full object-contain"/>
      :video&&story.media_url&&!failedVideo?<>{visible&&<video src={story.media_url} muted playsInline preload="metadata" controls={false} onLoadedMetadata={e=>{const node=e.currentTarget;if(Number.isFinite(node.duration)&&node.duration>0)node.currentTime=Math.min(.1,node.duration/2);}} onError={()=>setFailedVideo(true)} className="pointer-events-none h-full w-full object-contain"/>}</>
      :<span className="flex flex-col items-center gap-2 px-2 text-center text-xs"><ImageOff size={22}/><span>Preview unavailable</span>{story.caption&&<span className="line-clamp-2 opacity-80">{story.caption}</span>}</span>}
    {video&&<span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-[10px]"><Play size={10}/>Video</span>}
  </span>;
}
