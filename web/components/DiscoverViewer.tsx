"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Bookmark, ChevronLeft, ChevronRight, Heart, Maximize2, MessageCircle, Minimize2, X } from "lucide-react";
import type { FeedRow } from "@/lib/feed";
import { VideoPlayer } from "@/components/VideoPlayer";
import { Comments } from "@/components/Comments";
import { ShareMenu } from "@/components/ShareMenu";
import { PostSoundtrack } from "@/components/PostSoundtrack";
import { usePostInteractions } from "@/lib/usePostInteractions";
import { hydratePostMedia } from "@/lib/contentMedia";
import { createClient } from "@/lib/supabase/client";
import { STORY_FILTERS, filterCss } from "@/lib/stories";
import { AdjustOverlay } from "@/components/StoryEngine";
import { readSoundtrack } from "../../shared/soundtrack";
import { discoverFrame, discoverIndex, discoverNeedsMore } from "../../shared/discover";

function EditPlanes({ edit }: { edit: any }) {
  const filter = STORY_FILTERS.find(f=>f.id===edit?.filterId);
  const amount=Math.max(0,Math.min(1,(edit?.filterAmt??100)/100));
  return <>{filter?<div className="pointer-events-none absolute inset-0" style={{backdropFilter:filterCss(filter.id,amount),WebkitBackdropFilter:filterCss(filter.id,amount)}}>{filter.layers.map((l,i)=><div key={i} className="absolute inset-0" style={{backgroundColor:l.color,opacity:l.opacity*amount}}/>)}</div>:null}{edit?.adjust?<AdjustOverlay adjust={edit.adjust}/>:null}</>;
}
function DiscoverItem({post,active,expanded,onComments}:{post:FeedRow;active:boolean;expanded:boolean;onComments:()=>void}) {
  const [slide,setSlide]=useState(0),[fresh,setFresh]=useState<FeedRow|null>(null),[mediaError,setMediaError]=useState(false),[retrying,setRetrying]=useState(false);
  const live=useRef(true),generation=useRef(0),frameRef=useRef<HTMLDivElement>(null);
  const [revealed,setRevealed]=useState(false),[frameSize,setFrameSize]=useState({width:1,height:1});
  useEffect(()=>{setFresh(null);setMediaError(false);},[post]);
  useEffect(()=>{live.current=true;return()=>{live.current=false;generation.current++;};},[]);
  useEffect(()=>{const node=frameRef.current;if(!node)return;const measure=()=>setFrameSize({width:Math.max(1,node.clientWidth),height:Math.max(1,node.clientHeight)});measure();const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();},[]);
  const media=(fresh??post).media??[];const item=media[slide];const edit=(item as any)?.edit;
  const hidden=media.some(m=>(m as any).is_sensitive||(m as any).edit?.sensitive)&&!revealed;
  const frame=discoverFrame(frameSize.width,frameSize.height,item?.width,item?.height,Number(edit?.rotation)||0);
  const soundtrack=readSoundtrack((media[0] as any)?.edit?.soundtrack);
  const interaction=usePostInteractions(post.post_id,{liked:post.viewer_liked,bookmarked:post.viewer_bookmarked,likesCount:post.likes_count,bookmarksCount:post.bookmarks_count});
  const retry=async()=>{
    if(retrying)return;setRetrying(true);const run=++generation.current;
    try{const [renewed]=await hydratePostMedia([post],createClient());if(live.current&&run===generation.current){setFresh(renewed);setMediaError(false);}}
    catch{if(live.current&&run===generation.current)setMediaError(true);}finally{if(live.current&&run===generation.current)setRetrying(false);}
  };
  return <article data-post-id={post.post_id} className="flex h-full min-h-0 snap-start snap-always flex-col bg-white">
    <div ref={frameRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
      {hidden?<button onClick={()=>setRevealed(true)} className="rounded-xl bg-black/80 p-6 text-white">Sensitive content. Tap to view.</button>:item?.media_type==='video' ? <VideoPlayer src={item.url} postId={post.post_id} immersive allowPlayback={active} width={item.width??undefined} height={item.height??undefined} edit={edit} poster={edit?.coverUrl} soundtrack={soundtrack} mediaOverlay={<EditPlanes edit={edit}/>}/>
      :item?<><img src={item.url} alt={(item as any).alt_text||''} className="shrink-0 object-contain" onError={()=>setMediaError(true)} style={{...frame,transform:`translate(${(edit?.translateNX||0)*frameSize.width}px, ${(edit?.translateNY||0)*frameSize.height}px) rotate(${edit?.rotation||0}deg) scale(${(edit?.scale||1)*(edit?.flipX?-1:1)}, ${edit?.scale||1})`}}/><EditPlanes edit={edit}/></>
      :<div className="max-h-full overflow-y-auto p-8 text-xl leading-relaxed text-white"><h2 className="mb-3 font-bold">{post.article_title}</h2>{post.content||post.body}</div>}
      {!hidden&&item?.media_type!=='video'?<PostSoundtrack selection={soundtrack} active={active} className="absolute left-3 top-3"/>:null}
      {media.length>1?<div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-5 rounded-full bg-black/70 p-2 text-white"><button aria-label="Previous photo" disabled={slide===0} onClick={()=>{setSlide(v=>v-1);setMediaError(false);}} className="disabled:opacity-30"><ChevronLeft/></button><span>{slide+1}/{media.length}</span><button aria-label="Next photo" disabled={slide>=media.length-1} onClick={()=>{setSlide(v=>v+1);setMediaError(false);}} className="disabled:opacity-30"><ChevronRight/></button></div>:null}
      {mediaError?<button onClick={()=>void retry()} disabled={retrying} className="absolute rounded-xl bg-black/80 px-5 py-3 text-white">{retrying?'Retrying…':'Media could not load. Try again.'}</button>:null}
    </div>
    {!expanded?<div className="shrink-0 px-4 py-3 text-ink"><Link href={'/post/'+post.post_id} className="font-semibold">{post.author_name||post.author_username||'Member'}</Link><p className="line-clamp-2 text-sm text-muted">{post.content||post.body}</p><div className="mt-3 flex items-center gap-6"><button aria-label={interaction.liked?'Unlike post':'Like post'} aria-pressed={interaction.liked} disabled={interaction.pending} onClick={()=>void interaction.setLike(!interaction.liked)} className="flex items-center gap-2"><Heart size={21} fill={interaction.liked?'currentColor':'none'}/>{interaction.likesCount}</button><button aria-label="Open comments" onClick={onComments} className="flex items-center gap-2"><MessageCircle size={21}/>{post.comments_count}</button><button aria-label={interaction.bookmarked?'Unsave post':'Save post'} aria-pressed={interaction.bookmarked} disabled={interaction.pending} onClick={()=>void interaction.setBookmark(!interaction.bookmarked)}><Bookmark size={21} fill={interaction.bookmarked?'currentColor':'none'}/></button><ShareMenu postId={post.post_id}/><Link href={'/post/'+post.post_id} className="ml-auto text-xs underline">Open post</Link></div>{interaction.error?<button onClick={()=>void interaction.retry()} className="text-sm text-danger">{interaction.error} Retry</button>:null}</div>:null}
  </article>;
}
export function DiscoverViewer({posts,initialId,hasMore,loading,error,loadMore,onClose}:{posts:FeedRow[];initialId:string;hasMore:boolean;loading:boolean;error:string|null;loadMore:()=>Promise<void>;onClose:()=>void}) {
  const [activeId,setActiveId]=useState(initialId),[comments,setComments]=useState<string|null>(null),[expanded,setExpanded]=useState(false),[visible,setVisible]=useState(true);
  const scroller=useRef<HTMLDivElement>(null),dialog=useRef<HTMLDivElement>(null),didPosition=useRef(false);
  const current=useRef({onClose,comments,posts,activeId});current.current={onClose,comments,posts,activeId};
  const index=discoverIndex(posts.map(p=>p.post_id),activeId);
  const position=useCallback((i:number,behavior:ScrollBehavior='smooth')=>{const node=scroller.current;if(node)node.scrollTo({top:Math.max(0,Math.min(posts.length-1,i))*node.clientHeight,behavior});},[posts.length]);
  useEffect(()=>{if(!didPosition.current&&posts.length&&scroller.current){didPosition.current=true;scroller.current.scrollTop=index*scroller.current.clientHeight;}},[posts.length,index]);
  useEffect(()=>{if(discoverNeedsMore(index,posts.length,hasMore,loading,error))void loadMore();},[index,posts.length,hasMore,loading,error,loadMore]);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.current?.focus();
    const visibility=()=>setVisible(document.visibilityState==='visible');document.addEventListener('visibilitychange',visibility);
    const client=createClient();let owner:string|null|undefined;let live=true;
    const {data}=client.auth.onAuthStateChange((_event,session)=>{const id=session?.user.id??null;if(owner!==undefined&&owner!==id)current.current.onClose();owner=id;});
    void client.auth.getSession().then(({data})=>{if(live&&owner===undefined)owner=data.session?.user.id??null;});
    const resize=()=>{const node=scroller.current;if(node)node.scrollTop=discoverIndex(current.current.posts.map(p=>p.post_id),current.current.activeId)*node.clientHeight;};
    window.addEventListener('resize',resize);
    return()=>{live=false;document.body.style.overflow=overflow;document.removeEventListener('visibilitychange',visibility);window.removeEventListener('resize',resize);data.subscription.unsubscribe();previous?.focus();};
  },[]);
  const key=(e:React.KeyboardEvent)=>{
    if(e.key==='Escape'){e.preventDefault();if(comments)setComments(null);else onClose();return;}
    if(e.key==='Tab'){const nodes=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,textarea,[tabindex="0"]')??[]).filter(node=>!node.closest('[inert]'));if(nodes?.length){if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes[nodes.length-1].focus();}else if(!e.shiftKey&&document.activeElement===nodes[nodes.length-1]){e.preventDefault();nodes[0].focus();}}return;}
    if((e.target as HTMLElement).closest('input,textarea,select,button,[contenteditable="true"],[aria-label="Video player"]')||comments)return;
    if(e.key==='ArrowDown'||e.key==='PageDown'){e.preventDefault();position(index+1);}else if(e.key==='ArrowUp'||e.key==='PageUp'){e.preventDefault();position(index-1);}
  };
  return createPortal(<div ref={dialog} role="dialog" aria-modal="true" aria-label="Discover viewer" tabIndex={-1} onKeyDown={key} className="fixed inset-0 z-[200] flex flex-col bg-black outline-none">
    <header className="flex h-14 shrink-0 items-center justify-between bg-white px-4 text-ink"><button aria-label="Close Discover" onClick={onClose}><X/></button><h1 className="font-semibold">Discover</h1><button aria-label={expanded?'Show details':'Expand media'} onClick={()=>setExpanded(v=>!v)}>{expanded?<Minimize2/>:<Maximize2/>}</button></header>
    <div ref={scroller} className="min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto overscroll-contain" onScroll={e=>{const node=e.currentTarget;const i=Math.round(node.scrollTop/Math.max(1,node.clientHeight));if(posts[i])setActiveId(posts[i].post_id);}}>
      {posts.map((post,i)=><div key={post.post_id} inert={i!==index||!!comments} className="h-full snap-start">{Math.abs(index-i)<=1?<DiscoverItem post={post} active={i===index&&visible&&!comments} expanded={expanded} onComments={()=>setComments(post.post_id)}/>:<div className="h-full bg-black"/>}</div>)}
    </div>
    {loading?<div role="status" className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 text-xs text-white">Loading more…</div>:error?<button onClick={()=>void loadMore()} className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 text-xs text-white">Could not load more. Retry</button>:null}
    {comments?<div className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[75dvh] max-w-2xl flex-col rounded-t-3xl border border-ink/10 bg-white text-ink shadow-2xl"><div className="flex items-center justify-between p-4"><h2 className="font-semibold">Comments</h2><button aria-label="Close comments" onClick={()=>setComments(null)}><X/></button></div><div className="overflow-y-auto px-4 pb-4"><Comments postId={comments} autoFocus/></div></div>:null}
  </div>,document.body);
}
