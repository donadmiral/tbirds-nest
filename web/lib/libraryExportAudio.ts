import { createClient } from './supabase/client';
import { hydrateSoundMedia } from './contentMedia';
import { readSoundtrack, type SoundtrackSelection, type SoundtrackUse } from '../../shared/soundtrack';
import { inspectOriginalAudio, ORIGINAL_AUDIO_MAX_BYTES } from '../../shared/originalAudio';
import { exportStep, exportCancelled, type LocalExportAudio } from './videoExportAudio';
export async function assertOriginalExportRights(selection: SoundtrackSelection, use: SoundtrackUse, signal: AbortSignal) {
 const client=createClient();const {data,error}=await exportStep(Promise.resolve(client.rpc('authorize_original_audio_export',{p_sound_id:selection.soundId,p_use:use})),signal,'Audio rights could not be checked. Retry.');
 if(error||!data)throw new Error('Only original audio you own can be exported from the library. This sound needs separate export permission.');
 return {client,data};
}
export async function libraryExportAudio(selection: SoundtrackSelection, use: SoundtrackUse, signal: AbortSignal): Promise<LocalExportAudio> {
 if(!readSoundtrack(selection))throw new Error('The saved audio excerpt is invalid. Choose it again.');
 const {client,data}=await assertOriginalExportRights(selection,use,signal);
 const [track]=await exportStep(hydrateSoundMedia([data],client),signal,'Audio access could not be prepared. Retry.');
 if(!track?.url)throw new Error('This original audio is unavailable.');
 const response=await exportStep(fetch(track.url,{signal,cache:'no-store',credentials:'omit'}),signal,'The original audio took too long to download.');
 if(!response.ok||!response.body)throw new Error('This original audio could not be downloaded.');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const item=await exportStep(reader.read(),signal,'The original audio download stopped. Retry.');if(item.done)break;size+=item.value.length;if(size>ORIGINAL_AUDIO_MAX_BYTES)throw new Error('This audio file is too large to export.');chunks.push(item.value);}}
 finally{void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{/* The pending read may already have released its lock. */}}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const info=inspectOriginalAudio(bytes);
 if(selection.startSec+selection.durationSec>info.durationSec+.01)throw new Error('The saved audio excerpt exceeds this recording.');
 exportCancelled(signal);
 return {file:new File([bytes],`${data.title}.${info.extension}`,{type:info.mime}),duration:info.durationSec,volume:selection.volume,startSec:selection.startSec,endSec:selection.startSec+selection.durationSec,loop:true};
}
