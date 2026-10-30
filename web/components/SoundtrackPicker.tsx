"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Bookmark, ChevronLeft, Music2, Pause, Play, Search, X } from 'lucide-react';
import { OriginalAudioUpload } from './OriginalAudioUpload';
import { soundFavorites, saveSoundFavorite } from '@/lib/originalAudio';
import { createClient } from '@/lib/supabase/client';
import { getSoundtrack, listSoundtracks } from '@/lib/soundtrack';
import { PostSoundtrack } from './PostSoundtrack';
import { constrainSoundtrack, selectSoundtrack, type SoundtrackSelection, type SoundtrackTrack, type SoundtrackUse } from '../../shared/soundtrack';
import { ORIGINAL_AUDIO_ENABLED, MUSIC_UNAVAILABLE_MESSAGE } from '../../shared/musicAvailability';
import { loadSoundtrackChoices, soundtrackLabel, soundtrackRead, type SoundtrackSection } from '../../shared/soundtrackPicker';
import s from './SoundtrackPicker.module.css';

type Props = {value:SoundtrackSelection|null;use?:SoundtrackUse;ownerId?:string;originalAudio?:boolean;renderPreview?:(selection:SoundtrackSelection|null,active:boolean)=>ReactNode;onChange:(selection:SoundtrackSelection|null)=>void;onClose:()=>void};
type Phase = 'browse'|'excerpt'|'mix';
export function SoundtrackPicker(props:Props) { return <SoundtrackPickerSession key={props.ownerId||'signed-out'} {...props}/>; }
function SoundtrackPickerSession({value,use='post',ownerId,originalAudio=true,renderPreview,onChange,onClose}:Props) {
  const dialog=useRef<HTMLDivElement|null>(null);
  const [phase,setPhase]=useState<Phase>(value?'excerpt':'browse'),[section,setSection]=useState<SoundtrackSection>('Available');
  const [query,setQuery]=useState(''),[rows,setRows]=useState<SoundtrackTrack[]>([]),[selected,setSelected]=useState(value),[track,setTrack]=useState<SoundtrackTrack|null>(null);
  const [playing,setPlaying]=useState(false),[loading,setLoading]=useState(false),[checking,setChecking]=useState(false),[attempt,setAttempt]=useState(0),[selectionAttempt,setSelectionAttempt]=useState(0);
  const [listError,setListError]=useState(''),[trackError,setTrackError]=useState(''),[savedError,setSavedError]=useState(''),[saved,setSaved]=useState<string[]>([]),[savedReady,setSavedReady]=useState(false);
  const [client]=useState(()=>createClient()),[saving,setSaving]=useState(false);
  const active=useRef(false),generation=useRef(0),closeRef=useRef(onClose),savedRef=useRef<string[]>([]),savedLoaded=useRef(false);
  const saveLock=useRef<object|null>(null),pendingWrites=useRef(new Set<Promise<void>>());
  useLayoutEffect(()=>{closeRef.current=onClose;},[onClose]);
  const isCurrent=useCallback((mine:number)=>active.current&&generation.current===mine,[]);
  const invalidate=useCallback(()=>{active.current=false;generation.current++;savedLoaded.current=false;},[]);
  const close=()=>{if(!active.current)return;active.current=false;generation.current++;savedLoaded.current=false;setPlaying(false);closeRef.current();};
  useLayoutEffect(()=>{
    active.current=true;generation.current++;savedLoaded.current=false;saveLock.current=null;
    const {data:{subscription}}=client.auth.onAuthStateChange((event,session)=>{if(active.current&&(event==='SIGNED_OUT'||(ownerId&&session?.user.id!==ownerId))){active.current=false;generation.current++;savedLoaded.current=false;setPlaying(false);setSavedReady(false);closeRef.current();}});
    return()=>{invalidate();subscription.unsubscribe();};
  },[ownerId,client,invalidate]);
  const inlineMedia=phase!=='browse'&&!!renderPreview;
  useEffect(()=>{const opener=document.activeElement;dialog.current?.focus();return()=>{if(opener instanceof HTMLElement&&opener.isConnected)opener.focus();};},[]);
  useEffect(()=>{
    let live=true;const mine=generation.current;savedLoaded.current=false;
    if(!ORIGINAL_AUDIO_ENABLED||!ownerId)return;
    queueMicrotask(()=>{if(live&&isCurrent(mine)){setSavedReady(false);setSavedError('');}});
    void Promise.allSettled([...pendingWrites.current]).then(()=>live&&isCurrent(mine)?soundFavorites(ownerId,client):null).then(ids=>{if(ids&&live&&isCurrent(mine)){savedRef.current=ids;savedLoaded.current=true;setSaved(ids);setSavedReady(true);}}).catch(()=>{if(live&&isCurrent(mine))setSavedError('Saved sounds could not load. Retry to check your saved selection.');});
    return()=>{live=false;};
  },[ownerId,attempt,client,isCurrent]);
  const selectedId=selected?.soundId;
  useEffect(()=>{if(!ORIGINAL_AUDIO_ENABLED)return;let live=true;const mine=generation.current;if(section==='Saved'&&!savedReady){queueMicrotask(()=>{if(live&&isCurrent(mine)){setRows([]);setLoading(false);}});return()=>{live=false;};}queueMicrotask(()=>{if(live&&isCurrent(mine)){setLoading(true);setListError('');}});const timer=setTimeout(()=>void loadSoundtrackChoices(use,query,section,saved,listSoundtracks,getSoundtrack,()=>{if(live&&isCurrent(mine))setListError('Some saved sounds could not be checked. Retry to refresh their availability.');}).then(result=>{if(live&&isCurrent(mine))setRows(result);}).catch(()=>{if(live&&isCurrent(mine)){setRows([]);setListError('Music could not load. Retry.');}}).finally(()=>{if(live&&isCurrent(mine))setLoading(false);}),180);return()=>{live=false;clearTimeout(timer);};},[use,query,section,saved,savedReady,attempt,isCurrent]);
  useEffect(()=>{if(!ORIGINAL_AUDIO_ENABLED||!selectedId)return;let live=true;const mine=generation.current;queueMicrotask(()=>{if(live&&isCurrent(mine)){setChecking(true);setTrackError('');}});void soundtrackRead(getSoundtrack(selectedId,use)).then(result=>{if(live&&isCurrent(mine)){setTrack(result);setSelected(previous=>previous?.soundId===result.id?constrainSoundtrack(previous,result):previous);}}).catch(()=>{if(live&&isCurrent(mine)){setTrack(null);setPlaying(false);setTrackError('This sound could not be checked. Retry or choose another.');}}).finally(()=>{if(live&&isCurrent(mine))setChecking(false);});return()=>{live=false;};},[selectedId,use,attempt,selectionAttempt,isCurrent]);
  const choose=(row:SoundtrackTrack)=>{if(!isCurrent(generation.current))return;setChecking(true);setSelectionAttempt(n=>n+1);setTrack(row);setSelected(selectSoundtrack(row));setPlaying(true);setTrackError('');};
  const toggleSaved=async(id:string)=>{
    const mine=generation.current;if(!ownerId||!isCurrent(mine)||!savedLoaded.current||saveLock.current)return;
    const token={},next=!savedRef.current.includes(id);saveLock.current=token;setSaving(true);setSavedError('');
    const work=saveSoundFavorite(id,next,ownerId,client);pendingWrites.current.add(work);
    try{await work;if(isCurrent(mine)&&saveLock.current===token){savedRef.current=next?[id,...savedRef.current.filter(item=>item!==id)]:savedRef.current.filter(item=>item!==id);setSaved(savedRef.current);}}
    catch{if(isCurrent(mine)&&saveLock.current===token){savedLoaded.current=false;setSavedReady(false);setSavedError('The saved selection could not be confirmed. Retry to check its status.');}}
    finally{pendingWrites.current.delete(work);if(saveLock.current===token){saveLock.current=null;if(isCurrent(mine))setSaving(false);}}
  };
  const change=(key:'startSec'|'durationSec'|'volume'|'originalVolume',value:number)=>{if(track)setSelected(previous=>previous?constrainSoundtrack({...previous,[key]:value},track):previous);};
  const move=(next:Phase)=>{setPlaying(false);setPhase(next);};
  const commit=()=>{if(!isCurrent(generation.current)||selected&&(!track||checking))return;setPlaying(false);onChange(selected&&track?constrainSoundtrack(selected,track):null);close();};
  const slider=(label:string,key:'startSec'|'durationSec'|'volume'|'originalVolume',min:number,max:number,percent=false)=>selected?<label className={s.slider}><span><span>{label}</span><output>{percent?Math.round(selected[key]*100)+'%':soundtrackLabel(selected[key])}</output></span><input type="range" aria-label={label} min={min} max={Math.max(min,max)} step={percent ? 0.01 : 0.1} value={selected[key]} onChange={event=>change(key,Number(event.target.value))}/></label>:null;
  const selectedMeta=track?.id===selected?.soundId?track:rows.find(row=>row.id===selected?.soundId);
  const art=(small=false)=><span className={`${s.art} ${small?s.smallArt:''}`} aria-hidden="true"><Music2 size={small?21:25}/></span>;
  const empty=section==='Saved'?'No saved sounds yet':query?'No matching music':'No music available';
  const emptyLine=section==='Saved'?'Tap a bookmark to keep a sound across your devices.':query?'Try a different song or artist.':'You can publish with your original audio, or without music.';
  const keyDown=(event:React.KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();close();return;}if(event.key!=='Tab')return;const controls=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[tabindex="0"]')??[]).filter(node=>node.offsetParent!==null);const first=controls[0],last=controls[controls.length-1];if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){event.preventDefault();first?.focus();}};
  if (!ORIGINAL_AUDIO_ENABLED) return <div className={s.backdrop} onKeyDown={keyDown} onClick={event=>{if(event.target===event.currentTarget)close();}}><div ref={dialog} role="dialog" aria-modal="true" aria-label="Music unavailable" tabIndex={-1} className={s.dialog}><header className={s.header}><button type="button" className={s.back} aria-label="Close music" onClick={close}><ChevronLeft size={25}/></button><h2>Music</h2><span className={s.headerSpacer}/></header><div className={s.body}><div className={s.empty}><Music2 size={34}/><h3>Music unavailable</h3><p>{MUSIC_UNAVAILABLE_MESSAGE}</p></div>{value?<button type="button" className={s.remove} onClick={()=>{if(!isCurrent(generation.current))return;onChange(null);close();}}>Remove selected music</button>:null}<button type="button" className={s.preview} onClick={close}>Back to editing</button></div></div></div>;
  return <div className={s.backdrop} onClick={event=>{if(event.target===event.currentTarget)close();}} onKeyDown={keyDown}><div ref={dialog} role="dialog" aria-modal="true" aria-label={phase==='browse'?'Music':phase==='excerpt'?'Music excerpt':'Audio mix'} tabIndex={-1} className={s.dialog}>
    <header className={s.header}><button type="button" className={s.back} aria-label={phase==='browse'?'Close music':'Back'} onClick={()=>phase==='browse'?close():move(phase==='mix'?'excerpt':'browse')}><ChevronLeft size={25}/></button><h2>{phase==='browse'?'Music':phase==='excerpt'?'Music excerpt':'Audio mix'}</h2>{phase==='browse'?<span className={s.headerSpacer}/>:<button type="button" className={s.done} disabled={!selected||!track||checking} onClick={()=>phase==='excerpt'&&use==='post'?move('mix'):commit()}>{phase==='excerpt'&&use==='post'?'Next':'Done'}</button>}</header>
    <div className={s.body}>
      {phase==='browse'?<>{ownerId?<OriginalAudioUpload owner={ownerId} use={use} onAdded={row=>{if(!isCurrent(generation.current))return;choose(row);setAttempt(n=>n+1);move('excerpt');}}/>:null}<div className={s.search}><Search size={19}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search songs or artists" aria-label="Search music"/>{query?<button type="button" aria-label="Clear music search" onClick={()=>setQuery('')}><X size={18}/></button>:null}</div><div className={s.tabs} role="tablist" aria-label="Music library">{(['Available','Originals',...(ownerId?['Saved']:[])] as SoundtrackSection[]).map(tab=><button type="button" key={tab} role="tab" aria-selected={section===tab} className={section===tab?s.activeTab:''} onClick={()=>setSection(tab)}>{tab}</button>)}</div><div className={s.sectionHeading}><h3>{section==='Saved'?'Saved sounds':section==='Originals'?'Original sounds':'Find your sound'}</h3>{!loading&&rows.length?<span>{rows.length} sounds</span>:null}</div>
        {loading?<p role="status" className={s.status}>Loading music…</p>:null}
        {listError?<button type="button" className={s.notice} onClick={()=>setAttempt(n=>n+1)}>{listError}</button>:null}
        {!loading&&!rows.length&&!listError&&(section!=='Saved'||savedReady)?<div className={s.empty}><Music2 size={34}/><h3>{empty}</h3><p>{emptyLine}</p></div>:null}
        {rows.map(row=><div key={row.id} className={`${s.trackRow} ${row.id===selected?.soundId?s.selectedTrack:''}`}><button type="button" className={s.trackChoice} aria-label={`Choose ${row.title}`} onClick={()=>choose(row)}>{art()}<span><strong>{row.title}</strong><small>{row.artist||'Original audio'} · {soundtrackLabel(row.duration_sec)}</small></span></button><button type="button" className={s.round} aria-label={row.id===selected?.soundId&&playing?'Pause '+row.title:'Preview '+row.title} onClick={()=>row.id===selected?.soundId?setPlaying(value=>!value):choose(row)}>{row.id===selected?.soundId&&playing?<Pause size={18}/>:<Play size={18}/>}</button>{ownerId?<button type="button" disabled={!savedReady||saving} aria-label={saved.includes(row.id)?'Unsave '+row.title:'Save '+row.title} className={`${s.bookmark} ${saved.includes(row.id)?s.saved:''}`} onClick={()=>toggleSaved(row.id)}><Bookmark size={20}/></button>:null}</div>)}
      </>:<>
        {renderPreview?<div className={s.mediaStage}>{renderPreview(selected,playing)}</div>:<div className={s.albumStage}><Music2 size={60}/><h3>{selectedMeta?.title||'Selected music'}</h3></div>}
        <div className={s.selectedRow}>{art()}<span><strong>{selectedMeta?.title||'Checking music…'}</strong><small>{selectedMeta?.artist||'Original audio'}</small></span><button type="button" className={s.replace} onClick={()=>move('browse')}>Replace</button></div>
        {checking?<p role="status" className={s.status}>Checking availability…</p>:null}
        {selected&&track&&phase==='excerpt'?<><div className={s.timeline} aria-label="Excerpt timeline"><div className={s.ticks} aria-hidden="true">{Array.from({length:41},(_,i)=><i key={i} style={{height:i%5===0?28:16}}/>)}</div><div className={s.excerpt} style={{left:`${selected.startSec/track.duration_sec*100}%`,width:`${selected.durationSec/track.duration_sec*100}%`}}><i/><i/></div></div><div className={s.timeRow}><span>{soundtrackLabel(selected.startSec)}</span><span className={s.duration}>{Math.round(selected.durationSec*10)/10} sec</span><span>{soundtrackLabel(selected.startSec+selected.durationSec)}</span></div>{slider('Start','startSec',0,track.duration_sec-selected.durationSec)}{slider('Length','durationSec',1,Math.min(track.duration_sec,track.max_excerpt_sec))}<p className={s.hint}>Choose the part your {use==='memory_album'?'book':use} will play.</p></>:null}
        {selected&&track&&phase==='mix'?<div className={s.mix}>{originalAudio?slider('Original video','originalVolume',0,1,true):null}{slider(track.title,'volume',0,1,true)}<p className={s.hint}>{originalAudio?'Balance your video and music together.':'Set the music level for your photos.'}</p></div>:null}
        <button type="button" className={s.preview} disabled={!selected||!track||checking} onClick={()=>setPlaying(value=>!value)}>{playing?<Pause size={21}/>:<Play size={21}/>}<span>{playing?'Pause preview':phase==='mix'?'Preview mix':'Preview excerpt'}</span></button><button type="button" className={s.remove} onClick={()=>{setPlaying(false);if(!isCurrent(generation.current))return;onChange(null);close();}}>Remove music</button>
      </>}
      {trackError?<button type="button" className={s.notice} onClick={()=>setAttempt(n=>n+1)}>{trackError}</button>:null}
      {savedError?<button type="button" className={s.notice} onClick={()=>{savedLoaded.current=false;setSavedReady(false);setAttempt(n=>n+1);}}>{savedError}</button>:null}
      {!inlineMedia&&selected?<PostSoundtrack selection={selected} use={use} active={playing} autoPlay controls={false} className={s.audioStatus}/>:null}
    </div>
    {phase==='browse'&&selected&&selectedMeta?<footer className={s.miniPlayer}>{art(true)}<span><strong>{selectedMeta.title}</strong><small>{selectedMeta.artist||'Original audio'}</small></span><button type="button" className={s.round} aria-label={playing?'Pause music preview':'Play music preview'} onClick={()=>setPlaying(value=>!value)}>{playing?<Pause size={18}/>:<Play size={18}/>}</button><button type="button" disabled={!track||checking} className={s.useTrack} onClick={()=>move('excerpt')}>Use track</button></footer>:null}
  </div></div>;
}
export default SoundtrackPicker;
