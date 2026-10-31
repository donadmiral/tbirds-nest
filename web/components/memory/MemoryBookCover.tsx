'use client';
import NextImage from "next/image";
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {ImageIcon,Plane} from 'lucide-react';
import {memoryArtwork,memoryDesign,memoryCoverDate,memoryCoverTitleSize} from '../../../shared/memoryBookDesign';
import {memoryCoverArtwork,memoryCoverPhotoPosition,type MemoryCoverArtwork} from '../../../shared/memoryBookCreative';
import styles from './MemoryBookCover.module.css';
type Props={artwork?:MemoryCoverArtwork|null;title:string;subtitle?:string|null;color?:string;design?:string;photoUrl?:string;fallbackPhotoUrl?:string;videoUrl?:string;takenAt?:string;width?:number;height?:number};
function CoverPhoto({photoUrl,fallbackPhotoUrl,videoUrl,position='50% 50%',zoom=1,monochrome=false}:{photoUrl?:string;fallbackPhotoUrl?:string;videoUrl?:string;position?:string;zoom?:number;monochrome?:boolean}){
 const [failed,setFailed]=useState<string[]>([]),video=useRef<HTMLVideoElement>(null);
 const src=[photoUrl,fallbackPhotoUrl].find(url=>url&&!failed.includes(url));
 const fail=(url:string)=>setFailed(old=>[...old.slice(-3),url]);
 const style={objectPosition:position,transform:`scale(${zoom})`,transformOrigin:position,filter:monochrome?'grayscale(1) contrast(1.08)':undefined};
 if(src)return <NextImage unoptimized fill sizes="300px" src={src} alt="" draggable={false} style={style} onError={()=>fail(src)}/>;
 if(videoUrl&&!failed.includes(videoUrl))return <video ref={video} src={videoUrl} muted playsInline preload="metadata" style={style} onLoadedMetadata={()=>{if(video.current&&Number.isFinite(video.current.duration))video.current.currentTime=Math.min(.1,video.current.duration/2);}} onError={()=>fail(videoUrl)}/>;
 return <span className={styles.empty}><ImageIcon size="18%"/><span style={{fontSize:'.6em'}}>{photoUrl||videoUrl?'Open to view':'Your memories'}</span></span>;
}
export function MemoryBookCover({artwork:rawArtwork,title,subtitle,color,design,photoUrl,fallbackPhotoUrl,videoUrl,takenAt,width=144,height=188}:Props){
 const d=memoryDesign(design),a=memoryArtwork(design,color),u=width/200,typeSize=memoryCoverTitleSize(title,design)*u,artwork=memoryCoverArtwork(rawArtwork),date=artwork.showDate?memoryCoverDate(takenAt):null;
 const longPostcard=title.trim().length>12;
 const photo=(style:CSSProperties,position='50% 50%',auxiliary=false,monochrome=false)=>{const [x,y]=position.split(' ').map(parseFloat),crop=memoryCoverPhotoPosition(artwork,x,y);return <span className={styles.photo} style={style}><CoverPhoto photoUrl={photoUrl} fallbackPhotoUrl={fallbackPhotoUrl} videoUrl={auxiliary?undefined:videoUrl} position={`${crop.x}% ${crop.y}%`} zoom={artwork.photo.scale} monochrome={monochrome}/></span>;};
 const text=(style:CSSProperties,lines=2)=>({...style,color:a.ink,fontSize:typeSize,WebkitLineClamp:lines});
 return <span role="img" aria-label={`${d.label} book cover: ${title}${subtitle?'. '+subtitle:''}${artwork.inscription?'. '+artwork.inscription:''}${artwork.postmark?'. '+artwork.postmark:''}`} className={styles.cover} style={{width,height,background:a.paper,fontSize:14*u,boxShadow:`${2*u}px ${6*u}px ${10*u}px #31271930,0 ${1*u}px ${1*u}px #45371930`}}>
  <span className={styles.cloth} style={{backgroundColor:a.spine}}/>
  <span className={styles.surface} style={{backgroundColor:a.paper}}><span className={styles.paper}/>
   {d.id==='postcard'?<>
    <span className={styles.type+' '+styles.clamp} style={text({left:12*u,right:48*u,top:12*u,lineHeight:.98},longPostcard?2:1)}>{title}</span>
    <svg aria-hidden="true" className={styles.postmark} viewBox="0 0 54 37" style={{right:6*u,top:17*u,width:50*u,height:34*u}}><circle cx="15" cy="17" r="14" fill="none" stroke="currentColor" strokeWidth=".5"/><circle cx="15" cy="17" r="12.7" fill="none" stroke="currentColor" strokeWidth=".3"/>{[7,12,17,22,27].map(y=><path key={y} d={`M27 ${y} C35 ${y-4},44 ${y+4},54 ${y}`} fill="none" stroke="currentColor" strokeWidth=".45"/>)}<text x="15" y="15" textAnchor="middle" fontSize="6" fill="currentColor">{date?.month??'KEPT'}</text><text x="15" y="23" textAnchor="middle" fontSize="6" fill="currentColor">{date?.year??'WITH LOVE'}</text></svg>
    {subtitle&&<span className={styles.small+' '+styles.clamp} style={{left:13*u,right:10*u,top:(longPostcard?72:44)*u,fontSize:10*u,color:a.accent,WebkitLineClamp:1}}>{subtitle}</span>}
    {photo({left:11*u,right:10*u,top:(longPostcard?88:59)*u,bottom:24*u})}
    <span className={styles.ticket} style={{left:2*u,bottom:14*u,width:49*u,height:41*u,padding:5*u}}><span style={{display:'block',fontSize:4.7*u,letterSpacing:1*u}}>{artwork.postmark||'MOMENT KEPT'}</span><span style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:6*u,fontSize:8*u}}>MEM <Plane size={9*u}/></span>{date&&<span style={{display:'block',fontSize:4.5*u,letterSpacing:.4*u,marginTop:5*u}}>{date.ticket}</span>}</span>
    <span className={styles.small} style={{right:10*u,bottom:9*u,fontSize:5.5*u,letterSpacing:.7*u,color:a.accent}}>MEMORY BOOK</span>
   </>:d.id==='editorial'?<>
    {photo({inset:0},'50% 50%',false,true)}<span style={{position:'absolute',inset:0,background:'linear-gradient(120deg,#0a0b0b66,transparent 65%)'}}/>
    <span className={styles.type+' '+styles.clamp} style={text({left:10*u,right:12*u,top:9*u,lineHeight:.83},3)}>{title}</span>{date&&<span className={styles.small} style={{right:6*u,top:10*u,color:'#FAF6E9',fontSize:6*u}}>{date.year}</span>}
    {subtitle&&<span className={styles.small+' '+styles.clamp} style={{bottom:12*u,left:12*u,right:12*u,fontSize:7*u,color:a.ink,WebkitLineClamp:2,letterSpacing:.5*u}}>{subtitle}</span>}
   </>:d.id==='keepsake'||d.id==='classic'||d.id==='botanical'?<>
    {photo({left:38*u,right:32*u,top:'17%',height:'51%',border:`${2*u}px solid #c7baa1`,boxShadow:`0 0 0 ${1*u}px #fff7e599`})}
    <span className={styles.type+' '+styles.clamp} style={text({left:16*u,right:16*u,top:'74%',lineHeight:1.02,textAlign:'center'})}>{title}</span>{subtitle&&<span className={styles.small+' '+styles.clamp} style={{left:16*u,right:16*u,bottom:12*u,fontSize:7*u,color:a.accent,textAlign:'center',WebkitLineClamp:2}}>{subtitle}</span>}
   </>:d.id==='field_notes'?<>
    <span className={styles.clamp} style={{position:'absolute',left:15*u,right:12*u,top:20*u,fontSize:typeSize,color:a.ink,fontFamily:'Arial,sans-serif',fontWeight:800,letterSpacing:-.6*u,lineHeight:1.03,WebkitLineClamp:2}}>{title}</span><span className={styles.small} style={{left:16*u,top:61*u,fontSize:5*u,letterSpacing:1*u,color:a.ink}}>A COLLECTION OF MOMENTS</span>
    {photo({left:0,right:0,top:'27.5%',height:'42%'})}{photo({right:14*u,bottom:15*u,width:49*u,height:51*u,border:`${1*u}px solid #eee3bb`},'90% 95%',true)}
    <span className={styles.small+' '+styles.clamp} style={{left:17*u,right:74*u,bottom:28*u,fontSize:5.8*u,letterSpacing:.8*u,lineHeight:1.5,color:a.ink,textTransform:'uppercase',WebkitLineClamp:4}}>{subtitle||'Out into the world'}{date&&<><br/>{date.month} {date.year}</>}</span>
   </>:d.id==='night_film'?<>
    {photo({inset:0},'50% 65%')}<span style={{position:'absolute',inset:0,background:'linear-gradient(160deg,#11110bf0,transparent 68%)'}}/>
    <span className={styles.type+' '+styles.clamp} style={text({left:12*u,right:43*u,top:12*u,lineHeight:.86},3)}>{title}</span><span className={styles.small+' '+styles.clamp} style={{left:13*u,right:47*u,top:'37%',fontSize:5.5*u,lineHeight:1.4,letterSpacing:1*u,color:a.ink,textTransform:'uppercase',WebkitLineClamp:2}}>{subtitle||'Moments after hours'}{date?' / '+date.year:''}</span>
    <span className={styles.film} style={{width:39*u,padding:`${7*u}px ${5*u}px ${7*u}px ${8*u}px`,gap:5*u}}>{[0,1,2,3].map(n=><span key={n} className={styles.filmFrame}>{photo({inset:0},`50% ${n*33}%`,true,true)}</span>)}</span>
   </>:<>
    <span className={styles.type+' '+styles.clamp} style={text({left:9*u,width:115*u,top:8*u,lineHeight:.85},2)}>{title}</span><span style={{position:'absolute',right:9*u,top:14*u,width:28*u,height:28*u,borderRadius:'50%',background:'#ED542F',display:'flex',alignItems:'center',justifyContent:'center',textAlign:'center',fontSize:5.6*u,lineHeight:1.3,letterSpacing:.5*u,color:'#FFF7E5'}}>{date?<>{date.month}<br/>{date.year}</>:'GOOD DAYS'}</span>
    {photo({left:7*u,width:103*u,top:'40%',bottom:'7%'},'15% 65%')}{photo({right:7*u,width:66*u,top:'23%',bottom:'22%'},'88% 30%',true)}
    <span className={styles.small+' '+styles.clamp} style={{right:10*u,width:64*u,bottom:14*u,fontFamily:'Brush Script MT,Segoe Script,cursive',fontSize:20*u,fontStyle:'italic',transform:'rotate(-11deg)',color:'#4E4C23',WebkitLineClamp:1}}>{date?.signature||'Kept'}</span>{subtitle&&<span className={styles.small+' '+styles.clamp} style={{left:8*u,width:102*u,bottom:5*u,fontSize:5.3*u,color:a.ink,WebkitLineClamp:1}}>{subtitle}</span>}
   </>}
   {artwork.postmark&&d.id!=='postcard'&&<span className={styles.small} style={{right:8*u,top:'48%',maxWidth:'65%',padding:`${3*u}px ${5*u}px`,background:'#F7EEDBEE',color:'#764538',fontSize:6.5*u,letterSpacing:.5*u,transform:'rotate(-5deg)',border:`${.5*u}px solid #76453866`}}>{artwork.postmark}</span>}
   {artwork.inscription&&<span className={styles.inscription} style={{left:14*u,right:14*u,top:artwork.inscriptionPosition==='top'?'27%':'57%',padding:`${6*u}px ${8*u}px`,fontSize:(artwork.inscription.length>90?9:artwork.inscription.length>50?11:13)*u,fontFamily:artwork.inscriptionStyle==='handwritten'?'Brush Script MT,Segoe Script,cursive':artwork.inscriptionStyle==='serif'?'Georgia,serif':'Arial,sans-serif',fontStyle:artwork.inscriptionStyle==='handwritten'?'italic':'normal'}}>{artwork.inscription}</span>}
   <span className={styles.foil}/>
  </span>
 </span>;
}
export function ResponsiveMemoryBookCover(props:Omit<Props,'width'|'height'>){
 const ref=useRef<HTMLSpanElement>(null),[width,setWidth]=useState(180);
 useEffect(()=>{const node=ref.current;if(!node)return;const resize=new ResizeObserver(entries=>{const next=entries[0]?.contentRect.width;if(next>0)setWidth(next);});resize.observe(node);return()=>resize.disconnect();},[]);
 return <span ref={ref} className={styles.responsive}><span className={styles.responsiveInner}><MemoryBookCover {...props} width={width} height={width*1.31}/></span></span>;
}
