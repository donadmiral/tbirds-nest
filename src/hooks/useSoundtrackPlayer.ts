import {useEffect,useRef,useState} from 'react';
import {AppState} from 'react-native';
import {Audio} from 'expo-av';
import {useCallContext} from '../contexts/CallContext';
import {getSoundtrack} from '../services/soundtrackService';
import {readSoundtrack,soundtrackTime,type SoundtrackSelection,type SoundtrackUse,type SoundtrackClock} from '../../shared/soundtrack';
import {MUSIC_CATALOG_ENABLED} from '../../shared/musicAvailability';

/** One bounded excerpt. A supplied media clock remains authoritative after seeks/stalls. */
export function useSoundtrackPlayer({selection,use,active,clock}:{selection:SoundtrackSelection|null|undefined;use:SoundtrackUse;active:boolean;clock?:SoundtrackClock}) {
 const {callState}=useCallContext();
 const [error,setError]=useState<string|null>(null),[loading,setLoading]=useState(false),[attempt,setAttempt]=useState(0);
 const selectedValue=MUSIC_CATALOG_ENABLED?readSoundtrack(selection):null;
 const input=useRef({active,clock,callState,selection:selectedValue}); input.current={active,clock,callState,selection:selectedValue};
 const sound=useRef<Audio.Sound|null>(null),generation=useRef(0),busy=useRef(false);
 const key=selectedValue?.soundId??'';
 const [requestedKey,setRequestedKey]=useState(active?key:null);
 useEffect(()=>{if(active&&callState==='idle')setRequestedKey(key);},[active,key,callState]);
 useEffect(()=>{
  const selected=requestedKey===key?input.current.selection:null;const run=++generation.current;let owned:Audio.Sound|null=null,foreground=AppState.currentState==='active';
  let blocked=false;let limits:{duration_sec:number;max_excerpt_sec:number}|null=null;
  let timer:ReturnType<typeof setInterval>|undefined,rightsTimer:ReturnType<typeof setInterval>|undefined;
  const current=()=>run===generation.current;
  const allowed=()=>current()&&!blocked&&foreground&&input.current.active&&input.current.callState==='idle'&&(!input.current.clock||input.current.clock.playing);
  const fail=(message:string)=>{if(!current())return;blocked=true;setError(message);void owned?.pauseAsync().catch(()=>{});};
  const sync=async()=>{
   const selected=input.current.selection;
   if(!owned||!selected||busy.current||!current())return;busy.current=true;
   try{
    const status=await owned.getStatusAsync();if(!current()||!status.isLoaded)return;
    if(!allowed()){if(status.isPlaying)await owned.pauseAsync();return;}
    if(limits&&(selected.startSec+selected.durationSec>limits.duration_sec||selected.durationSec>limits.max_excerpt_sec)){fail('The selected excerpt is unavailable.');return;}
    const c=input.current.clock;const target=c?soundtrackTime(selected,c.time):selected.startSec;
    if(c&&Math.abs(status.positionMillis/1000-target)>.4||!c&&(status.positionMillis/1000<selected.startSec||status.positionMillis/1000>=selected.startSec+selected.durationSec))await owned.setPositionAsync(target*1000);
    if(!current()||!allowed())return;
    await owned.setVolumeAsync(selected.volume);
    if(status.rate!==(c?.rate||1))await owned.setRateAsync(c?.rate||1,true);
    if(!status.isPlaying&&allowed()){await owned.playAsync();if(!allowed())await owned.pauseAsync();}
   }catch{fail('Music could not play. Tap to retry.');}finally{busy.current=false;}
  };
  setError(null);setLoading(!!selected);
  if(selected)void(async()=>{
   try{
    const track=await getSoundtrack(selected.soundId,use);if(!current())return;limits=track;
    if(selected.startSec+selected.durationSec>track.duration_sec||selected.durationSec>track.max_excerpt_sec)throw Error('The selected excerpt is no longer available.');
    const loaded=await Audio.Sound.createAsync({uri:track.url},{shouldPlay:false,isLooping:false,positionMillis:selected.startSec*1000,volume:0,progressUpdateIntervalMillis:200});
    owned=loaded.sound;if(!current()){await owned.unloadAsync();return;}sound.current=owned;setLoading(false);void sync();timer=setInterval(()=>void sync(),200);
    rightsTimer=setInterval(()=>{void getSoundtrack(selected.soundId,use).then(track=>{if(!current())return;limits=track;const live=input.current.selection;if(live&&(live.startSec+live.durationSec>track.duration_sec||live.durationSec>track.max_excerpt_sec))fail('This excerpt is no longer available.');}).catch(()=>fail('This sound is no longer available.'));},30000);
   }catch{if(current()){setLoading(false);fail('Music could not load. Tap to retry.');}}
  })();
  const app=AppState.addEventListener('change',state=>{foreground=state==='active';void sync();});
  return()=>{generation.current++;app.remove();clearInterval(timer);clearInterval(rightsTimer);if(sound.current===owned)sound.current=null;if(owned)void owned.unloadAsync().catch(()=>{});};
 },[key,use,attempt,requestedKey]);
 useEffect(()=>{if(!active||callState!=='idle'||clock?.playing===false)void sound.current?.pauseAsync().catch(()=>{});},[active,callState,clock?.playing]);
 return {error,loading,retry:()=>setAttempt(n=>n+1)};
}
