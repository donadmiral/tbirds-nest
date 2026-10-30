"use client";
import NextImage from "next/image";

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Aperture, CheckCircle2, Circle, Crop, Eye, FlipHorizontal2, ImagePlus, Pause, Play, RotateCcw, RotateCw, Scissors, SlidersHorizontal, Sun, Thermometer, Type, Upload, Volume2, VolumeX, X } from 'lucide-react';
import { STORY_FILTERS, filterCss } from '@/lib/stories';
import { AdjustOverlay } from './StoryEngine';
import { PostCaption } from './PostCaption';
import { PostSoundtrack } from './PostSoundtrack';
import type { SoundtrackSelection } from '../../shared/soundtrack';
import type { PostMediaEditRecipe } from './VideoPlayer';
import { applyPostPlayback, POST_VOICE_EFFECTS, type PostVoiceEffect } from '../../shared/postVoiceEffects';
import { normalizePostCaptions, applyPostCaptionTiming, normalizePostRotation, postRotationParts, postAspectRatio, postTimeLabel, postTrimWindow, type PostCaptionCue } from '../../shared/postMediaEditing';
import s from './PostMediaEditor.module.css';

export type PostEditorMedia = { preview:string; width:number; height:number; isVideo:boolean; edit?:PostMediaEditRecipe|null; coverFile?:File|null; coverPreview?:string|null };
type Mode = 'crop'|'filter'|'adjust'|'trim'|'captions'|'cover'|'voice';
type Adjustment = keyof NonNullable<PostMediaEditRecipe['adjust']>;
const PHOTO_MODES = [{id:'crop',label:'Crop',icon:Crop},{id:'filter',label:'Filters',icon:Aperture},{id:'adjust',label:'Adjust',icon:SlidersHorizontal}] as const;
const VIDEO_MODES = [{id:'trim',label:'Trim',icon:Scissors},{id:'voice',label:'Voice',icon:Volume2},{id:'crop',label:'Crop',icon:Crop},{id:'captions',label:'Captions',icon:Type},{id:'cover',label:'Cover',icon:ImagePlus},{id:'filter',label:'Filters',icon:Aperture},{id:'adjust',label:'Adjust',icon:SlidersHorizontal}] as const;
const ADJUSTMENTS:{key:Adjustment;label:string;min?:number;icon:typeof Sun}[]=[{key:'bri',label:'Light',icon:Sun},{key:'con',label:'Contrast',icon:Circle},{key:'warm',label:'Warmth',icon:Thermometer},{key:'sat',label:'Color',icon:Aperture},{key:'hi',label:'Highlights',icon:Sun},{key:'sh',label:'Shadows',icon:Circle},{key:'tint',label:'Tint',icon:Aperture},{key:'fade',label:'Fade',min:0,icon:Circle},{key:'grain',label:'Grain',min:0,icon:Aperture},{key:'vig',label:'Vignette',min:0,icon:Circle}];

export function postMediaStyle(edit?:PostMediaEditRecipe|null):CSSProperties {
  return {objectFit:edit?.fit??'cover',transform:`translate(${(edit?.translateNX??0)*100}%, ${(edit?.translateNY??0)*100}%) scale(${edit?.scale??1}) rotate(${edit?.rotation??0}deg) scaleX(${edit?.flipX?-1:1})`,filter:filterCss(edit?.filterId,(edit?.filterAmt??100)/100)};
}

export function PostDraftPreview(props: Parameters<typeof PostDraftMedia>[0]) {return <PostDraftMedia key={props.item.preview} {...props}/>;}
function PostDraftMedia({item,active=true,autoPlay=false,soundtrack}:{item:PostEditorMedia;active?:boolean;autoPlay?:boolean;soundtrack?:SoundtrackSelection|null}) {
  const video=useRef<HTMLVideoElement|null>(null);
  const [clock,setClock]=useState(item.edit?.trimStart??0),[playing,setPlaying]=useState(false),[rate,setRate]=useState(item.edit?.speed??1),[error,setError]=useState('');
  const ratio=postAspectRatio(item.edit,item.width,item.height);
  const canPlay=()=>active&&!document.hidden&&document.documentElement.dataset.platinumCallActive!=='true';
  useEffect(()=>{const v=video.current;if(!v)return;v.muted=item.edit?.muted??false;v.volume=soundtrack?.originalVolume??1;applyPostPlayback(v,item.edit);},[item.edit,soundtrack?.originalVolume]);
  useEffect(()=>{if(video.current){video.current.currentTime=item.edit?.trimStart??0;}},[item.edit?.trimStart]);
  useEffect(()=>{const v=video.current;if(!v)return;if(!active){v.pause();}else if(autoPlay&&!document.hidden&&document.documentElement.dataset.platinumCallActive!=='true')void v.play().catch(()=>setError('Tap play to start the video preview.'));},[active,autoPlay,item.preview]);
  useEffect(()=>{const stop=()=>{video.current?.pause();setPlaying(false);};const visibility=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',visibility);window.addEventListener('platinum:stop-media',stop);return()=>{stop();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('platinum:stop-media',stop);};},[]);
  return <div style={{position:'relative',width:'100%',aspectRatio:ratio,overflow:'hidden',background:'#101923',borderRadius:16}}>
    {item.isVideo?<video ref={video} controls playsInline muted={item.edit?.muted??false} preload="metadata" poster={item.coverPreview??item.edit?.coverUrl??undefined} src={item.preview} style={{width:'100%',height:'100%',...postMediaStyle(item.edit)}} onLoadedMetadata={event=>{const v=event.currentTarget;applyPostPlayback(v,item.edit);v.volume=soundtrack?.originalVolume??1;v.currentTime=item.edit?.trimStart??0;setRate(v.playbackRate);}} onPlay={event=>{if(!canPlay())event.currentTarget.pause();else{setError('');setPlaying(true);}}} onPlaying={event=>{if(!canPlay())event.currentTarget.pause();else setPlaying(true);}} onPause={()=>setPlaying(false)} onWaiting={()=>setPlaying(false)} onStalled={()=>setPlaying(false)} onSeeking={event=>{setClock(event.currentTarget.currentTime);setPlaying(false);}} onSeeked={event=>setPlaying(canPlay()&&!event.currentTarget.paused&&event.currentTarget.readyState>=3)} onRateChange={event=>setRate(event.currentTarget.playbackRate)} onTimeUpdate={event=>{const v=event.currentTarget;const range=postTrimWindow(v.duration,item.edit?.trimStart,item.edit?.trimEnd);if(range.duration&&(v.currentTime>=range.end||v.currentTime<range.start-.2)){v.currentTime=range.start;setClock(range.start);}else setClock(v.currentTime);}} onError={()=>{setPlaying(false);setError('This video preview could not load. Try another supported video.');}}/>:<NextImage unoptimized width={item.width} height={item.height} src={item.preview} alt="Selected media preview" style={{width:'100%',height:'100%',...postMediaStyle(item.edit)}}/>}
    <PostFilterTint filterId={item.edit?.filterId} strength={item.edit?.filterAmt}/><AdjustOverlay adjust={item.edit?.adjust}/><PostCaption captions={item.edit?.captions} time={clock}/>
    {soundtrack?<PostSoundtrack selection={soundtrack} active={active} autoPlay={item.isVideo||autoPlay} controls={!item.isVideo&&!autoPlay} clock={item.isVideo?{time:Math.max(0,clock-(item.edit?.trimStart??0)),playing:active&&playing,rate}:undefined} className="absolute left-3 right-3 top-3"/>:null}
    {error?<p role="alert" style={{position:'absolute',left:10,right:10,top:10,padding:10,borderRadius:10,background:'rgba(0,0,0,.8)',color:'#fff',fontSize:12}}>{error}</p>:null}
  </div>;
}

/** Capture real, decoded frames; never invent a thumbnail or silently publish a blank cover. */
export function capturePostCover(url:string,at:number,maxWidth=1200):Promise<Blob> {
  return new Promise((resolve,reject)=>{
    const video=document.createElement('video'); let done=false;
    const finish=(blob?:Blob|null)=>{if(done)return;done=true;clearTimeout(timer);video.onloadeddata=null;video.onseeked=null;video.onerror=null;video.pause();video.removeAttribute('src');video.load();if(blob)resolve(blob);else reject(new Error('The selected video frame could not be prepared. Choose another frame or upload a cover.'));};
    const timer=setTimeout(()=>finish(),15000);
    video.muted=true;video.preload='auto';video.playsInline=true;video.onerror=()=>finish();
    const draw=()=>{if(done)return;try{if(!video.videoWidth||!video.videoHeight)throw new Error('Video dimensions unavailable');const canvas=document.createElement('canvas');const scale=Math.min(1,maxWidth/video.videoWidth);canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));const context=canvas.getContext('2d');if(!context)throw new Error('Canvas unavailable');context.drawImage(video,0,0,canvas.width,canvas.height);canvas.toBlob(finish,'image/jpeg',.88);}catch{finish();}};
    video.onloadeddata=()=>{const next=Math.min(Math.max(0,at),Math.max(0,video.duration-.05));if(next>.02){video.onseeked=draw;video.currentTime=next;}else draw();};video.src=url;
  });
}

export function PostMediaEditor({item,index,total,onClose,onSave}:{item:PostEditorMedia;index:number;total:number;onClose:()=>void;onSave:(edit:PostMediaEditRecipe,coverFile:File|null,coverPreview:string|null,applyLookToAll?:boolean)=>void}) {
  const [edit,setEdit]=useState<PostMediaEditRecipe>(item.edit?.aspectRatio||item.edit?.aspect?{...item.edit}:{aspectRatio:4/5,...item.edit});
  const [mode,setMode]=useState<Mode>(item.isVideo?'trim':'crop');
  const [duration,setDuration]=useState(0),[clock,setClock]=useState(0),[playing,setPlaying]=useState(false);
  const [compare,setCompare]=useState(false),[adjustKey,setAdjustKey]=useState<Adjustment>('bri');
  const [coverFile,setCoverFile]=useState<File|null>(item.coverFile??null),[coverPreview,setCoverPreview]=useState<string|null>(item.coverPreview??null);
  const [frames,setFrames]=useState<string[]>([]),[framePreview,setFramePreview]=useState<string|null>(null),[error,setError]=useState('');
  const [selectedCue,setSelectedCue]=useState(0);
  const [applyLookToAll,setApplyLookToAll]=useState(false);
  const [captionDrafts,setCaptionDrafts]=useState<Record<string,{start?:string;end?:string}>>({});
  const captionDraftsRef=useRef<Record<string,{start?:string;end?:string}>>({});
  const video=useRef<HTMLVideoElement|null>(null),dialog=useRef<HTMLDivElement|null>(null),coverInput=useRef<HTMLInputElement|null>(null);
  const drag=useRef<{x:number;y:number;nx:number;ny:number;w:number;h:number}|null>(null);
  const localCovers=useRef<string[]>([]),saved=useRef(false);
  const range=postTrimWindow(duration,edit.trimStart,edit.trimEnd);
  const [sourceDims,setSourceDims]=useState({width:item.width,height:item.height});
  const ratio=postAspectRatio(edit,sourceDims.width,sourceDims.height);
  const modes=item.isVideo?VIDEO_MODES:PHOTO_MODES;
  const draftTiming=(id:string,key:'start'|'end',text:string)=>{const next={...captionDraftsRef.current,[id]:{...captionDraftsRef.current[id],[key]:text}};captionDraftsRef.current=next;setCaptionDrafts(next);};
  const commitTiming=(caption:PostCaptionCue)=>{const next=applyPostCaptionTiming(caption,captionDraftsRef.current[caption.id],range.start,range.end);setEdit(previous=>({...previous,captions:(previous.captions??[]).map(c=>c.id===caption.id?next:c)}));const drafts={...captionDraftsRef.current};delete drafts[caption.id];captionDraftsRef.current=drafts;setCaptionDrafts(drafts);};

  const cue=edit.captions?.[selectedCue];
  const adjustment=ADJUSTMENTS.find(a=>a.key===adjustKey)!;
  const rotationParts=postRotationParts(edit.rotation);

  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    dialog.current?.focus();
    const pause=()=>video.current?.pause();
    const hidden=()=>{if(document.hidden)pause();};
    window.addEventListener('platinum:stop-media',pause);document.addEventListener('visibilitychange',hidden);
    return()=>{pause();window.removeEventListener('platinum:stop-media',pause);document.removeEventListener('visibilitychange',hidden);previous?.focus();localCovers.current.forEach(url=>{if(!saved.current||url!==coverPreview)URL.revokeObjectURL(url);});};
    // Capture the mounting surface; a saved draft owns its selected cover URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{if(video.current)applyPostPlayback(video.current,edit);},[edit]);
  useEffect(()=>{
    if(!item.isVideo||!duration)return;
    let alive=true;const urls:string[]=[];
    void (async()=>{try{for(let i=0;i<8;i++){const blob=await capturePostCover(item.preview,(Math.max(0,duration-.05)*i)/7,150);if(!alive)return;urls.push(URL.createObjectURL(blob));setFrames([...urls]);}}catch{if(alive)setError('This browser could not decode the timeline. You can still select a time or upload a cover.');}})();
    return()=>{alive=false;urls.forEach(URL.revokeObjectURL);};
  },[item.preview,item.isVideo,duration]);
  useEffect(()=>{
    if(mode!=='cover'||!item.isVideo||coverFile||!duration)return;
    let alive=true;let url:string|null=null;
    const timer=setTimeout(()=>{void capturePostCover(item.preview,Math.max(range.start,Math.min(range.coverEnd,edit.coverAt??range.start))).then(blob=>{if(!alive)return;url=URL.createObjectURL(blob);setFramePreview(url);}).catch(e=>{if(alive)setError(e.message);});},90);
    return()=>{alive=false;clearTimeout(timer);if(url)URL.revokeObjectURL(url);};
  },[mode,item.isVideo,item.preview,coverFile,duration,edit.coverAt,range.start,range.coverEnd]);

  const seek=(time:number)=>{if(video.current){video.current.pause();video.current.currentTime=Math.max(range.start,Math.min(range.coverEnd,time));}};
  const updateCue=(patch:Partial<PostCaptionCue>)=>setEdit(prev=>({...prev,captions:(prev.captions??[]).map((c,i)=>i===selectedCue?{...c,...patch}:c)}));
  const addCue=()=>{if((edit.captions?.length??0)>=8)return;setSelectedCue(edit.captions?.length??0);setEdit(prev=>({...prev,captions:[...(prev.captions??[]),{id:crypto.randomUUID(),text:'',start:range.start,end:range.end||duration||15,style:'clean',position:'bottom'}]}));video.current?.pause();};
  const selectMode=(next:Mode)=>{setMode(next);setError('');if(next==='cover'||next==='captions')video.current?.pause();if(next==='captions'&&!edit.captions?.length)addCue();};
  const trim=(start:number,end:number)=>{const next=postTrimWindow(duration,start,end);setEdit(p=>({...p,trimStart:next.start,trimEnd:next.end,coverAt:Math.max(next.start,Math.min(next.coverEnd,p.coverAt??next.start))}));seek(next.start);};
  const keyDown=(event:React.KeyboardEvent)=>{
    if(event.key==='Escape'){event.stopPropagation();onClose();return;}
    if(event.key!=='Tab')return;
    const nodes=dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea,select,[tabindex="0"]');if(!nodes?.length)return;
    const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };
  const poster=coverPreview||framePreview||frames[0];
  const activeStyle=postMediaStyle(compare?null:edit);
  return <div className={s.backdrop} onKeyDown={keyDown}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Edit post media" className={s.editor}>
      <header className={s.header}><button className={s.cancel} onClick={onClose}>Cancel</button><h2 className={s.heading}>{modes.find(m=>m.id===mode)?.label}<span>· {index+1} of {total}</span></h2><button className={s.apply} onClick={()=>{saved.current=true;localCovers.current=localCovers.current.filter(url=>{if(url===coverPreview)return false;URL.revokeObjectURL(url);return false;});onSave({...edit,captions:normalizePostCaptions((edit.captions??[]).map(c=>applyPostCaptionTiming(c,captionDraftsRef.current[c.id],range.start,range.end)),duration||600)},coverFile,coverPreview,applyLookToAll);}}>Apply</button></header>
      <div className={s.body}>
        <div className={s.preview}><div className={`${s.stage} ${mode==='crop'?s.draggable:''}`} style={{aspectRatio:ratio,width:`min(100%, calc(42dvh * ${ratio}))`}}
          onPointerDown={event=>{if(mode!=='crop')return;event.currentTarget.setPointerCapture(event.pointerId);const r=event.currentTarget.getBoundingClientRect();drag.current={x:event.clientX,y:event.clientY,nx:edit.translateNX??0,ny:edit.translateNY??0,w:r.width,h:r.height};}}
          onPointerMove={event=>{const d=drag.current;if(!d)return;setEdit(p=>({...p,translateNX:Math.max(-.75,Math.min(.75,d.nx+(event.clientX-d.x)/d.w)),translateNY:Math.max(-.75,Math.min(.75,d.ny+(event.clientY-d.y)/d.h))}));}}
          onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
          {item.isVideo?<video ref={video} src={item.preview} playsInline muted={edit.muted??false} preload="auto" className={s.media} style={activeStyle} onLoadedMetadata={ev=>{const v=ev.currentTarget;setDuration(v.duration);setSourceDims({width:v.videoWidth,height:v.videoHeight});applyPostPlayback(v,edit);v.currentTime=edit.trimStart??0;}} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onTimeUpdate={ev=>{const v=ev.currentTarget;setClock(v.currentTime);if(duration&&(v.currentTime>=range.end||v.currentTime<range.start-.2))v.currentTime=range.start;}} onError={()=>setError('This video could not be decoded in this browser. Try another supported video.')} />:<NextImage unoptimized width={item.width} height={item.height} src={item.preview} draggable={false} alt="Post editing preview" className={s.media} style={activeStyle}/>}
          {mode==='cover'&&poster?<NextImage unoptimized width={item.width} height={item.height} src={poster} draggable={false} alt="Selected video cover" className={s.media} style={activeStyle}/>:null}
          {!compare?<><PostFilterTint filterId={edit.filterId} strength={edit.filterAmt}/><AdjustOverlay adjust={edit.adjust}/></>:null}
          {!compare&&mode!=='cover'?<PostCaption captions={edit.captions} time={clock} preview={mode==='captions'?cue:null}/>:null}
          {mode==='crop'||mode==='cover'?<div className={s.grid}/>:null}
          {mode==='filter'||mode==='adjust'?<button className={s.compare} onPointerDown={()=>setCompare(true)} onPointerUp={()=>setCompare(false)} onPointerLeave={()=>setCompare(false)} onKeyDown={e=>{if(e.key===' '||e.key==='Enter')setCompare(true);}} onKeyUp={()=>setCompare(false)} onBlur={()=>setCompare(false)}><Eye size={15}/>{compare?'Original':'Hold to compare'}</button>:null}
        </div></div>
        <section className={s.panel} aria-label={`${mode} controls`}>
          {error?<p role="alert" className={s.error}>{error}</p>:null}
          {mode==='crop'?<><h3 className={s.sectionTitle}>Choose your frame</h3><div className={s.ratios}>{[{label:'Original',value:sourceDims.width&&sourceDims.height?Math.max(.25,Math.min(4,sourceDims.width/sourceDims.height)):.8},{label:'1:1',value:1},{label:'4:5',value:.8},{label:'16:9',value:16/9}].map(r=>{const selected=r.label==='Original'?edit.aspect==='original':edit.aspect!=='original'&&Math.abs(ratio-r.value)<.001;return <button key={r.label} aria-pressed={selected} className={`${s.choice} ${s.ratio} ${selected?s.active:''}`} onClick={()=>setEdit(p=>({...p,aspectRatio:r.value,aspect:r.label==='Original'?'original':undefined,scale:1,translateNX:0,translateNY:0}))}><span className={s.ratioIcon} style={{width:r.value>=1?27:22,height:r.value>=1?27/r.value:27}}/>{r.label}</button>;})}</div>
            <Slider label="Straighten" value={rotationParts.straighten} min={-45} max={45} unit="°" onChange={straighten=>setEdit(p=>({...p,rotation:normalizePostRotation(postRotationParts(p.rotation).base+straighten)}))}/><Slider label="Zoom" value={edit.scale??1} min={1} max={3} step={.01} unit="×" onChange={scale=>setEdit(p=>({...p,scale}))}/>
            <div className={s.actions}><button className={s.button} onClick={()=>setEdit(p=>({...p,rotation:normalizePostRotation((p.rotation??0)+90)}))}><RotateCw size={17}/>Rotate</button><button className={s.button} onClick={()=>setEdit(p=>({...p,flipX:!p.flipX}))}><FlipHorizontal2 size={17}/>Flip</button>{(['contain','cover'] as const).map(fit=><button key={fit} aria-pressed={(edit.fit??'cover')===fit} className={`${s.choice} ${(edit.fit??'cover')===fit?s.active:''}`} onClick={()=>setEdit(p=>({...p,fit}))}>{fit==='contain'?'Fit':'Fill'}</button>)}</div>
            <p className={s.hint}>Drag the image to position it inside the frame.</p><button className={s.reset} onClick={()=>setEdit(p=>({...p,aspectRatio:.8,aspect:undefined,scale:1,translateNX:0,translateNY:0,rotation:0,flipX:false,fit:'cover'}))}><RotateCcw size={15}/>Reset crop</button>
          </>:null}
          {mode==='filter'?<><h3 className={s.sectionTitle}>Find your look</h3><div className={s.filterStrip}>{[{id:null,label:'Original'},...STORY_FILTERS].map(f=><button key={f.id??'original'} className={s.filter} aria-pressed={(edit.filterId??null)===f.id} onClick={()=>setEdit(p=>({...p,filterId:f.id}))}><span className={s.filterPreview}>{item.isVideo&&!frames[0]?<span className={s.choice}>Video</span>:<NextImage unoptimized width={96} height={96} src={item.isVideo?frames[0]:item.preview} alt="" style={{filter:filterCss(f.id)}}/>}<PostFilterTint filterId={f.id}/></span>{f.label}</button>)}</div><Slider label="Strength" value={edit.filterAmt??100} min={0} max={100} onChange={filterAmt=>setEdit(p=>({...p,filterAmt}))}/><button className={s.reset} onClick={()=>setEdit(p=>({...p,filterId:null,filterAmt:100}))}><RotateCcw size={15}/>Reset filter</button></>:null}
          {mode==='adjust'?<><h3 className={s.sectionTitle}>Make it yours</h3><div className={s.adjustments}>{ADJUSTMENTS.map(a=><button key={a.key} role="tab" aria-selected={adjustKey===a.key} className={s.tab} onClick={()=>setAdjustKey(a.key)}><span className={s.tabIcon}><a.icon size={21}/></span>{a.label}</button>)}</div><Slider label={adjustment.label} value={edit.adjust?.[adjustKey]??0} min={adjustment.min??-100} max={100} onChange={value=>setEdit(p=>({...p,adjust:{...p.adjust,[adjustKey]:value}}))}/><button className={s.reset} onClick={()=>setEdit(p=>({...p,adjust:null}))}><RotateCcw size={15}/>Reset adjustments</button></>:null}
          {total>1&&(mode==='filter'||mode==='adjust')?<label className={s.settingRow}><input type="checkbox" checked={applyLookToAll} onChange={event=>setApplyLookToAll(event.target.checked)} style={{width:22,height:22,accentColor:'#F2D5C2'}}/><span>Apply this look to all media</span><span className={s.muted}>{total} items</span></label>:null}
          {mode==='trim'?<><div className={s.timeRow}><button className={s.iconButton} aria-label={playing?'Pause video':'Play video'} onClick={()=>{if(playing)video.current?.pause();else void video.current?.play().catch(()=>setError('Tap play again to start the preview.'));}}>{playing?<Pause size={24}/>:<Play size={24}/>}</button><span>{postTimeLabel(clock)} / {postTimeLabel(duration)}</span></div><Filmstrip frames={frames} duration={duration} start={range.start} end={range.end} at={clock}/><Slider label="Trim start" value={range.start} min={0} max={Math.max(0,range.end-.1)} step={.1} unit="s" onChange={start=>trim(start,range.end)}/><Slider label="Trim end" value={range.end} min={Math.min(duration,range.start+.1)} max={duration} step={.1} unit="s" onChange={end=>trim(range.start,end)}/><p className={s.hint}>{range.duration.toFixed(1)} seconds selected</p><button className={s.settingRow} onClick={()=>setEdit(p=>({...p,muted:!p.muted}))}>{edit.muted?<VolumeX size={19}/>:<Volume2 size={19}/>}<span>Original audio</span><span className={s.muted}>{edit.muted?'Muted':'On'}</span></button><label className={s.settingRow}><Play size={19}/><span>Speed</span><select aria-label="Video speed" value={edit.speed??1} onChange={ev=>setEdit(p=>({...p,speed:Number(ev.target.value)}))}>{[.5,1,1.5,2,3].map(n=><option key={n} value={n}>{n}×</option>)}</select></label></>:null}
          {mode==='voice'?<><h3 className={s.sectionTitle}>Voice and pace</h3><p className={s.hint}>Change the pitch and pace of your original audio together. Your video stays in sync. These effects need a video with sound.</p><div className={s.choices}>{POST_VOICE_EFFECTS.map(effect=><button key={effect.id} aria-pressed={(edit.voiceEffect??'original')===effect.id} className={`${s.choice} ${s.captionChoice} ${(edit.voiceEffect??'original')===effect.id?s.active:''}`} onClick={()=>setEdit(value=>({...value,voiceEffect:effect.id as PostVoiceEffect,muted:false}))}><Volume2 size={22}/><strong>{effect.label}</strong><span>{effect.description}</span></button>)}</div><button type="button" className={s.settingRow} onClick={()=>{if(playing)video.current?.pause();else void video.current?.play().catch(()=>setError('Tap play again to hear the preview.'));}}>{playing?<Pause size={19}/>:<Play size={19}/>}<span>{playing?'Pause preview':'Hear preview'}</span></button></>:null}
          {mode==='cover'?<><h3 className={s.sectionTitle}>Choose your cover</h3><p className={s.hint}>This is how your video appears before it plays.</p>{!coverFile?<><Filmstrip frames={frames} duration={duration} start={range.start} end={range.end} at={edit.coverAt??range.start}/><Slider label="Selected frame" value={Math.max(range.start,Math.min(range.coverEnd,edit.coverAt??range.start))} min={range.start} max={range.coverEnd} step={.05} unit="s" onChange={coverAt=>{setEdit(p=>({...p,coverAt}));seek(coverAt);}}/></>:null}<div className={s.choices}><button className={`${s.choice} ${s.captionChoice} ${!coverFile?s.active:''}`} onClick={()=>{setCoverFile(null);setCoverPreview(null);}}><ImagePlus size={23}/>Video frame{!coverFile?<CheckCircle2 size={17}/>:<Circle size={17}/>}</button><button className={`${s.choice} ${s.captionChoice} ${coverFile?s.active:''}`} onClick={()=>coverInput.current?.click()}><Upload size={23}/>Upload cover{coverFile?<CheckCircle2 size={17}/>:<Circle size={17}/>}</button></div><input ref={coverInput} type="file" hidden accept="image/*" onChange={async event=>{const file=event.target.files?.[0];if(!file)return;try{const bitmap=await createImageBitmap(file);bitmap.close();const url=URL.createObjectURL(file);localCovers.current.push(url);setCoverFile(file);setCoverPreview(url);setError('');}catch{setError('That photo could not be opened. Choose another image.');}event.target.value='';}}/><button className={s.settingRow} onClick={()=>selectMode('crop')}><Crop size={18}/><span>Adjust crop</span><span>›</span></button></>:null}
          {mode==='captions'?<><h3 className={s.sectionTitle}>Add your words</h3>{cue?<><textarea aria-label="Video caption" maxLength={160} className={s.captionInput} value={cue.text} onChange={ev=>updateCue({text:ev.target.value})} placeholder="Write a caption for this moment"/><p className={s.hint} style={{textAlign:'right',margin:'5px 0 15px'}}>{cue.text.length}/160</p><div className={s.choices}>{(['clean','bold','highlight'] as const).map(style=><button key={style} className={`${s.choice} ${s.captionChoice} ${cue.style===style?s.active:''}`} onClick={()=>updateCue({style})}><b style={{fontFamily:style==='clean'?'Georgia,serif':undefined,fontWeight:style==='bold'?800:400}}>Aa</b>{style[0].toUpperCase()+style.slice(1)}</button>)}</div><div className={s.timings}><label>Start (seconds)<input type="text" inputMode="decimal" aria-label="Caption start in seconds" value={captionDrafts[cue.id]?.start??String(cue.start)} onChange={ev=>draftTiming(cue.id,'start',ev.target.value)} onBlur={()=>commitTiming(cue)}/></label><label>End (seconds)<input type="text" inputMode="decimal" aria-label="Caption end in seconds" value={captionDrafts[cue.id]?.end??String(cue.end)} onChange={ev=>draftTiming(cue.id,'end',ev.target.value)} onBlur={()=>commitTiming(cue)}/></label></div><div className={s.choices}>{(['top','middle','bottom'] as const).map(position=><button key={position} className={`${s.choice} ${cue.position===position?s.active:''}`} onClick={()=>updateCue({position})}>{position[0].toUpperCase()+position.slice(1)}</button>)}</div></>:null}<div style={{marginTop:20}}>{(edit.captions??[]).map((c,i)=><div key={c.id} className={`${s.cue} ${i===selectedCue?s.active:''}`}><button onClick={()=>{setSelectedCue(i);seek(c.start);}}>{postTimeLabel(c.start)} · {c.text||'New caption'}</button><button aria-label={`Remove caption ${i+1}`} className={s.iconButton} onClick={()=>{setEdit(p=>({...p,captions:(p.captions??[]).filter((_,x)=>x!==i)}));setSelectedCue(0);}}><X size={16}/></button></div>)}</div>{(edit.captions?.length??0)<8?<button className={s.settingRow} onClick={addCue}><Type size={18}/><span>Add another caption</span><span>+</span></button>:null}</>:null}
        </section>
      </div>
      <nav role="tablist" aria-label="Media editing tools" className={s.tabs}>{modes.map(m=><button key={m.id} role="tab" aria-selected={mode===m.id} className={s.tab} onClick={()=>selectMode(m.id)}><span className={s.tabIcon}><m.icon size={22}/></span>{m.label}</button>)}</nav>
    </div>
  </div>;
}

function Slider({label,value,min,max,step=1,unit='',onChange}:{label:string;value:number;min:number;max:number;step?:number;unit?:string;onChange:(v:number)=>void}) {
  return <label className={s.slider}><span className={s.sliderTitle}><span>{label}</span><output>{Math.round(value*100)/100}{unit}</output></span><input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/></label>;
}
function Filmstrip({frames,duration,start,end,at}:{frames:string[];duration:number;start:number;end:number;at:number}) {
  return <div className={s.filmstrip} aria-label="Video timeline">{frames.map((url,i)=><NextImage unoptimized width={150} height={90} src={url} key={i} alt=""/>)}{duration>0?<><span className={s.trimShade} style={{left:0,width:`${start/duration*100}%`}}/><span className={s.trimShade} style={{right:0,width:`${(1-end/duration)*100}%`}}/><span className={s.marker} style={{left:`${Math.min(99.5,at/duration*100)}%`}}/></>:null}</div>;
}

function PostFilterTint({filterId,strength=100}:{filterId?:string|null;strength?:number}) {
  const filter=STORY_FILTERS.find(f=>f.id===filterId);const amount=Math.max(0,Math.min(1,strength/100));
  return filter?<div className="pointer-events-none absolute inset-0">{filter.layers.map((layer,i)=><div key={i} className="absolute inset-0" style={{backgroundColor:layer.color,opacity:layer.opacity*amount}}/>)}</div>:null;
}
