"use client";
import {useEffect,useRef,useState} from 'react';
import {getSoundtrack} from '@/lib/soundtrack';
import {readSoundtrack,soundtrackTime,type SoundtrackSelection,type SoundtrackUse,type SoundtrackClock} from '../../shared/soundtrack';
export function PostSoundtrack({selection,use='post',active=true,clock,className='',autoPlay=false}:{selection:SoundtrackSelection|null|undefined;use?:SoundtrackUse;active?:boolean;clock?:SoundtrackClock;className?:string;autoPlay?:boolean}) {
 const [playing,setPlaying]=useState(autoPlay),[error,setError]=useState<string|null>(null),[attempt,setAttempt]=useState(0);
 const ref=useRef<HTMLAudioElement|null>(null),inputs=useRef({active,clock,playing});inputs.current={active,clock,playing};
 const key=JSON.stringify(selection);
 useEffect(()=>{
  const selected=readSoundtrack(selection);let disposed=false,audio:HTMLAudioElement|null=null,rights:ReturnType<typeof setInterval>|undefined,timer:ReturnType<typeof setInterval>|undefined,blocked=false;
  setError(null);
  const allowed=()=>!disposed&&!blocked&&!document.hidden&&document.documentElement.dataset.platinumCallActive!=='true'&&inputs.current.active&&inputs.current.playing&&(!inputs.current.clock||inputs.current.clock.playing);
  const stop=()=>{audio?.pause();setPlaying(false);};
  const hide=()=>{if(document.hidden)audio?.pause();};
  const sync=()=>{if(!audio||!selected)return;if(!allowed()){audio.pause();return;}const c=inputs.current.clock;const target=c?soundtrackTime(selected,c.time):selected.startSec;
   if(c&&Math.abs(audio.currentTime-target)>.4||!c&&(audio.currentTime<selected.startSec||audio.currentTime>=selected.startSec+selected.durationSec))audio.currentTime=target;
   audio.volume=selected.volume;audio.playbackRate=c?.rate||1;if(audio.paused)void audio.play().catch(()=>{if(!disposed){setPlaying(false);setError('Tap Play music to start the soundtrack.');}});
  };
  if(selected)void getSoundtrack(selected.soundId,use).then(track=>{
   if(disposed)return;if(selected.startSec+selected.durationSec>track.duration_sec||selected.durationSec>track.max_excerpt_sec)throw Error('Excerpt unavailable');
   audio=new Audio(track.url);ref.current=audio;audio.preload='auto';audio.currentTime=selected.startSec;audio.onerror=()=>{if(!disposed){setError('Music could not load. Retry.');setPlaying(false);}};
   timer=setInterval(sync,200);rights=setInterval(()=>void getSoundtrack(selected.soundId,use).catch(()=>{if(!disposed){blocked=true;stop();setError('This sound is no longer available.');}}),30000);sync();
  }).catch(()=>{if(!disposed){setError('Music could not load. Retry.');setPlaying(false);}});
  document.addEventListener('visibilitychange',hide);window.addEventListener('platinum:stop-media',stop);
  return()=>{disposed=true;clearInterval(timer);clearInterval(rights);document.removeEventListener('visibilitychange',hide);window.removeEventListener('platinum:stop-media',stop);if(audio){audio.pause();audio.removeAttribute('src');audio.load();}if(ref.current===audio)ref.current=null;};
 },[key,use,attempt]);
 useEffect(()=>{if(!active||!playing||clock?.playing===false)ref.current?.pause();},[active,playing,clock?.playing]);
 if(!readSoundtrack(selection))return null;
 return <div className={className}><button type="button" className="rounded-full bg-black/70 px-3 py-1.5 text-xs text-white" onClick={e=>{e.stopPropagation();if(document.documentElement.dataset.platinumCallActive==='true')return;if(error){setAttempt(n=>n+1);setError(null);}else if(!playing&&active&&(!clock||clock.playing)){void ref.current?.play().catch(()=>{});}setPlaying(v=>!v);}}>{playing?'Pause music':'Play music'}</button>{error?<span role="status" className="ml-2 rounded bg-black/80 px-2 text-xs text-white">{error}</span>:null}</div>;
}
export default PostSoundtrack;
