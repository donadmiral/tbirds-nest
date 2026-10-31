'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Mic, Square, Upload } from 'lucide-react';
import { ORIGINAL_AUDIO_PREPARING } from '../../shared/originalAudioAvailability';
import { addOriginalAudio, originalAudioReady } from '@/lib/originalAudio';
import { ORIGINAL_AUDIO_ACCEPT } from '../../shared/originalAudio';
import type { SoundtrackTrack, SoundtrackUse } from '../../shared/soundtrack';

/** Captures PCM and writes an ordinary WAV, which the server can inspect fully. */
function wavFile(chunks: Float32Array[], rate: number): File {
 const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
 const buffer = new ArrayBuffer(44 + length * 2), view = new DataView(buffer);
 const text = (offset: number, value: string) => { for (let i=0;i<value.length;i++) view.setUint8(offset+i,value.charCodeAt(i)); };
 text(0,'RIFF');view.setUint32(4,36+length*2,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);
 view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);
 view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,length*2,true);
 let offset=44;for(const chunk of chunks)for(const sample of chunk){const value=Math.max(-1,Math.min(1,sample));view.setInt16(offset,Math.round(value*(value<0?32768:32767)),true);offset+=2;}
 return new File([buffer], 'Voiceover.wav', { type: 'audio/wav' });
}
type OriginalAudioUploadProps = { owner: string; use?: SoundtrackUse; disabled?: boolean; onAdded(track: SoundtrackTrack): void; onBusyChange?(busy: boolean): void; };
export function OriginalAudioUpload(props: OriginalAudioUploadProps) { return <OriginalAudioUploadSession key={props.owner} {...props}/>; }
function OriginalAudioUploadSession({ owner, use = 'story', disabled = false, onAdded, onBusyChange }: OriginalAudioUploadProps) {
 const [available,setAvailable]=useState<boolean|null>(null),[availabilityError,setAvailabilityError]=useState(''),[availabilityAttempt,setAvailabilityAttempt]=useState(0);
 useEffect(()=>{let live=true;void originalAudioReady().then(ready=>{if(live){setAvailable(ready);setAvailabilityError('');}}).catch(failure=>{if(live){setAvailable(false);setAvailabilityError(failure instanceof Error?failure.message:'Audio availability could not be checked. Retry.');}});return()=>{live=false;};},[owner,availabilityAttempt]);
 const [attested,setAttested]=useState(false),[reuse,setReuse]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[recording,setRecording]=useState(false),[seconds,setSeconds]=useState(0),[pending,setPending]=useState<File|null>(null);
 const input=useRef<HTMLInputElement>(null),epoch=useRef(0),lock=useRef(false),recordingCleanup=useRef<((save:boolean)=>void)|null>(null);
 useEffect(()=>{const cancel=()=>{epoch.current += 1;recordingCleanup.current?.(false);};const hide=()=>{if(document.hidden)cancel();};
  window.addEventListener('platinum:stop-media',cancel);document.addEventListener('visibilitychange',hide);
  return()=>{cancel();window.removeEventListener('platinum:stop-media',cancel);document.removeEventListener('visibilitychange',hide);};},[owner]);
 async function upload(file:File) {
  if(lock.current||disabled||!attested||!available)return;lock.current=true;setBusy(true);onBusyChange?.(true);setError('');const generation=epoch.current;setPending(file);
  try{const track=await addOriginalAudio(file,owner,{rightsAttested:true,reuseAllowed:reuse,use});if(generation===epoch.current){onAdded(track);setPending(null);}}
  catch(failure){if(generation===epoch.current)setError(failure instanceof Error?failure.message:'Audio could not upload. Retry.');}
  finally{lock.current=false;setBusy(false);onBusyChange?.(false);}
 }
 async function record() {
  if(lock.current||disabled||!attested||!available||document.documentElement.dataset.platinumCallActive==='true')return;
  lock.current=true;setError('');setRecording(true);setSeconds(0);const generation=epoch.current;
  let stream:MediaStream|undefined,context:AudioContext|undefined,processor:ScriptProcessorNode|undefined,source:MediaStreamAudioSourceNode|undefined,timer:ReturnType<typeof setInterval>|undefined,finished=false;
  const chunks:Float32Array[]=[];let samples=0;
  const finish=(save:boolean)=>{if(finished)return;finished=true;clearInterval(timer);if(processor){processor.onaudioprocess=null;processor.disconnect();}source?.disconnect();stream?.getTracks().forEach(track=>track.stop());const rate=context?.sampleRate;void context?.close().catch(()=>{});recordingCleanup.current=null;lock.current=false;setRecording(false);
   if(save&&rate&&generation===epoch.current){if(samples>=rate)setPending(wavFile(chunks,rate));else setError('Record at least one second.');}};
  recordingCleanup.current=finish;
  try{stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true},video:false});
   if(finished||generation!==epoch.current){stream.getTracks().forEach(track=>track.stop());return;}
   context=new AudioContext();await context.resume();if(finished||generation!==epoch.current){void context.close();return;}
   source=context.createMediaStreamSource(stream);processor=context.createScriptProcessor(4096,1,1);const rate=context.sampleRate;
   processor.onaudioprocess=event=>{if(finished)return;const data=event.inputBuffer.getChannelData(0),remaining=30*rate-samples;
    if(remaining>0){const copy=data.slice(0,remaining);chunks.push(copy);samples+=copy.length;}if(samples>=30*rate)finish(true);};
   source.connect(processor);processor.connect(context.destination);timer=setInterval(()=>setSeconds(Math.floor(samples/rate)),250);
  }catch{finish(false);setError('The microphone could not start. Allow microphone access or choose an audio file.');}
 }
 return <section className="my-4 rounded-xl border border-current/15 p-4 text-sm" aria-label="Add original audio">
  <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Your original audio</h3><Link href="/settings/audio" className="min-h-11 py-3 text-xs underline">Manage audio</Link></div><p className="mb-3 mt-1 opacity-75">WAV, MP3 or M4A, up to 10 minutes and 50 MB. Record a voiceover up to 30 seconds. Licensed catalogue music is awaiting licensing.</p>
  {available!==true?<p role="status" className="mb-3 rounded-lg bg-current/5 p-3">{available===null?'Checking audio availability…':availabilityError||ORIGINAL_AUDIO_PREPARING} {available===false?<button type="button" className="underline" onClick={()=>setAvailabilityAttempt(value=>value+1)}>Retry availability</button>:null}</p>:null}
  <label className="mb-3 flex items-start gap-2"><input type="checkbox" checked={attested} disabled={busy||recording||!available} onChange={event=>setAttested(event.target.checked)}/>I own this audio and have permission to publish its music, voices and other content.</label>
  <label className="mb-3 flex items-start gap-2"><input type="checkbox" checked={reuse} disabled={busy||recording||!available} onChange={event=>setReuse(event.target.checked)}/>Also let others find and reuse this original in Platinum Circles.</label>
  <input hidden ref={input} type="file" accept={ORIGINAL_AUDIO_ACCEPT} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void upload(file);}}/>
  <div className="flex flex-wrap gap-2"><button type="button" disabled={!attested||busy||recording||disabled||!available} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-current/20 px-3 disabled:opacity-40" onClick={()=>input.current?.click()}><Upload size={17}/>{busy?'Verifying audio…':'Choose audio'}</button>
   <button type="button" disabled={!attested||busy||disabled||!available} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-current/20 px-3 disabled:opacity-40" onClick={()=>recording?recordingCleanup.current?.(true):void record()}>{recording?<Square size={17}/>:<Mic size={17}/>} {recording?`Stop · ${seconds}/30s`:'Record voiceover'}</button>
   {pending&&!busy?<button type="button" disabled={!attested||recording||disabled||!available} className="min-h-11 rounded-lg bg-[#152642] px-3 text-white disabled:opacity-40" onClick={()=>void upload(pending)}>{error?'Retry upload':'Use recording'}</button>:null}
  </div>{pending&&!busy?<p className="mt-2">{pending.name} is kept here until you upload it or close this editor.</p>:null}{error?<p role="alert" className="mt-3 text-red-600">{error}</p>:null}
 </section>;
}
