'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ImageIcon, Send } from 'lucide-react';
import { memoryArtwork, memoryDesign, memoryCoverTitleSize } from '../../../shared/memoryBookDesign';
type Props={title:string;subtitle?:string|null;color?:string;design?:string;photoUrl?:string;fallbackPhotoUrl?:string;videoUrl?:string;width?:number;height?:number};
function CoverPhoto({photoUrl,fallbackPhotoUrl,videoUrl}:{photoUrl?:string;fallbackPhotoUrl?:string;videoUrl?:string}) {
 const [failed,setFailed]=useState<string[]>([]);const video=useRef<HTMLVideoElement>(null);
 const src=[photoUrl,fallbackPhotoUrl].find(url=>url&&!failed.includes(url));
 const fail=(url:string)=>setFailed(prev=>[...prev.slice(-3),url]);
 if(src)return <img src={src} alt="" className="h-full w-full object-cover" onError={()=>fail(src)}/>;
 if(videoUrl&&!failed.includes(videoUrl))return <video ref={video} src={videoUrl} muted playsInline preload="metadata" onLoadedMetadata={()=>{if(video.current&&Number.isFinite(video.current.duration))video.current.currentTime=Math.min(.1,video.current.duration/2);}} onError={()=>fail(videoUrl)} className="h-full w-full object-cover"/>;
 return <span className="flex h-full flex-col items-center justify-center gap-1 opacity-50"><ImageIcon size="18%"/><span style={{fontSize:'.6em'}}>{photoUrl||videoUrl?'Open to view':'Your memories'}</span></span>;
}
export function MemoryBookCover({title,subtitle,color,design,photoUrl,fallbackPhotoUrl,videoUrl,width=144,height=188}:Props) {
 const d=memoryDesign(design),a=memoryArtwork(design,color),u=width/200,dark=d.id==='editorial'||d.id==='night_film',titleSize=memoryCoverTitleSize(title,design)*u;
 const photo=(style:CSSProperties)=><span className="absolute overflow-hidden bg-black/10" style={style}><CoverPhoto photoUrl={photoUrl} fallbackPhotoUrl={fallbackPhotoUrl} videoUrl={videoUrl}/></span>;
 const type:CSSProperties={fontFamily:'Georgia, Times New Roman, serif',color:a.ink};
 return <span role="img" aria-label={d.label+' book cover: '+title+(subtitle?'. '+subtitle:'')} className="relative block shrink-0" style={{width,height,background:a.paper,borderRadius:2*u,boxShadow:(2*u)+'px '+(5*u)+'px '+(9*u)+'px #31271933',fontSize:14*u}}>
  <span className="absolute inset-y-0 left-0" style={{width:12*u,background:a.spine,borderRadius:(2*u)+'px 0 0 '+(2*u)+'px'}}/><span className="absolute inset-y-0 bg-white/15" style={{left:5*u,width:2*u}}/>
  <span className="absolute inset-y-0 right-0 overflow-hidden border border-black/10" style={{left:12*u}}>
   {dark?<>
    {photo({inset:0})}<span className="absolute inset-0 bg-black/35"/><span className="absolute line-clamp-3" style={{...type,left:12*u,right:(d.id==='night_film'?40:14)*u,top:12*u,fontSize:titleSize,lineHeight:1.0}}>{title}</span>
    {subtitle&&<span className="absolute line-clamp-2 uppercase" style={{left:14*u,right:15*u,bottom:14*u,fontSize:8*u,letterSpacing:1.2*u,color:a.ink}}>{subtitle}</span>}
    {d.id==='night_film'&&<span className="absolute inset-y-0 right-0 flex flex-col gap-1 bg-[#171717]" style={{width:31*u,padding:5*u}}>{[0,1,2].map(n=><span key={n} className="relative flex-1 border-l-2 border-[#B7AA8B77]">{photo({left:3*u,right:0,top:0,bottom:0})}</span>)}</span>}
   </>:d.id==='keepsake'||d.id==='botanical'||d.id==='classic'?<>
    {photo({left:33*u,right:23*u,top:'18%',height:'49%',border:(3*u)+'px solid #C8BCA3'})}<span className="absolute line-clamp-2 text-center" style={{...type,left:16*u,right:16*u,top:'70%',fontSize:titleSize,lineHeight:1.05}}>{title}</span>
    {subtitle&&<span className="absolute line-clamp-2 text-center" style={{...type,left:18*u,right:18*u,bottom:12*u,fontSize:9*u,color:a.accent}}>{subtitle}</span>}
   </>:d.id==='field_notes'?<>
    <span className="absolute line-clamp-2 font-extrabold" style={{left:15*u,right:12*u,top:18*u,fontSize:titleSize,lineHeight:1.08,color:a.ink}}>{title}</span>{photo({left:0,right:0,top:'29%',height:'47%'})}
    <span className="absolute line-clamp-3 uppercase" style={{left:16*u,right:16*u,bottom:18*u,fontSize:8*u,letterSpacing:1*u,color:a.ink}}>{subtitle||'A COLLECTION OF MOMENTS'}</span>
   </>:d.id==='daybook'?<>
    <span className="absolute line-clamp-2" style={{...type,left:12*u,right:15*u,top:8*u,fontSize:titleSize,lineHeight:.98}}>{title}</span>{photo({left:9*u,width:96*u,top:'48%',bottom:20*u})}{photo({right:8*u,width:65*u,top:'39%',bottom:'19%'})}
    <span className="absolute line-clamp-2 italic" style={{...type,right:10*u,width:65*u,bottom:10*u,fontSize:12*u}}>{subtitle||'The good days'}</span>
   </>:<>
    <span className="absolute line-clamp-2" style={{...type,left:12*u,right:16*u,top:12*u,fontSize:titleSize,lineHeight:1.04}}>{title}</span>{subtitle&&<span className="absolute truncate" style={{...type,left:13*u,right:12*u,top:'30%',fontSize:11*u,color:a.accent}}>{subtitle}</span>}
    {photo({left:10*u,right:10*u,top:subtitle?'38%':'30%',bottom:24*u})}<span className="absolute rotate-[-7deg] bg-[#BDD5DF]" style={{left:8*u,bottom:9*u,width:44*u,height:38*u,padding:5*u,color:a.accent}}><Send size={12*u}/><span className="mt-1 block" style={{fontSize:5.5*u,letterSpacing:1*u}}>MOMENTS KEPT</span></span><span className="absolute" style={{right:10*u,bottom:7*u,fontSize:6*u,letterSpacing:1*u,color:a.accent}}>VOL. 01</span>
   </>}
   <span className="pointer-events-none absolute inset-y-0 left-0 bg-black/5" style={{width:5*u}}/>
  </span>
 </span>;
}

export function ResponsiveMemoryBookCover(props:Omit<Props,'width'|'height'>) {
 const ref=useRef<HTMLSpanElement>(null),[width,setWidth]=useState(180);
 useEffect(()=>{const node=ref.current;if(!node)return;const resize=new ResizeObserver(entries=>{const n=entries[0]?.contentRect.width;if(n>0)setWidth(n);});resize.observe(node);return()=>resize.disconnect();},[]);
 return <span ref={ref} className="relative block w-full" style={{aspectRatio:'200 / 262'}}><span className="absolute inset-0"><MemoryBookCover {...props} width={width} height={width*1.31}/></span></span>;
}
