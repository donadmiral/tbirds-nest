import {createClient} from './supabase/client';
import {hydrateSoundMedia} from './contentMedia';
import type {SoundtrackTrack,SoundtrackUse} from '../../shared/soundtrack';
export async function listSoundtracks(use:SoundtrackUse,query='',client=createClient()):Promise<SoundtrackTrack[]> {
 const {data,error}=await client.rpc('list_playable_sounds',{p_use:use,p_query:query,p_limit:50});
 if(error) throw new Error('Music could not load. Please retry.');
 return (data || []) as SoundtrackTrack[];
}
export async function getSoundtrack(soundId:string,use:SoundtrackUse,client=createClient()):Promise<SoundtrackTrack> {
 const {data,error}=await client.rpc('get_playable_sound',{p_sound_id:soundId,p_use:use});
 const track=data?.[0] as SoundtrackTrack | undefined;
 if(error || !track) throw new Error('This sound is no longer available.');
 const [safe]=await hydrateSoundMedia([track],client);
 if(!safe?.url) throw new Error('This sound is unavailable.');
 return safe;
}
